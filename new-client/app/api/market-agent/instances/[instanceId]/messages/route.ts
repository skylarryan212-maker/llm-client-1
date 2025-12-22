import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { Tool } from "openai/resources/responses/responses";

import { calculateCost } from "@/lib/pricing";
import { estimateTokens } from "@/lib/tokens/estimateTokens";
import { logUsageRecord } from "@/lib/usage";
import {
  ensureMarketAgentConversation,
  getMarketAgentEvents,
  getMarketAgentInstance,
  getMarketAgentState,
  insertMarketAgentMessage,
  listMarketAgentMessages,
  listMarketAgentUiEventIds,
  upsertMarketAgentUiEvent,
  type MarketAgentChatMessage,
} from "@/lib/data/market-agent";
import { MarketSuggestionEvent } from "@/types/market-suggestion";
import {
  MAX_SUGGESTIONS,
  A2UI_TAG_START,
  SUGGESTION_CHAT_PROMPT,
  buildSuggestionContextMessage,
  extractSuggestionEvents,
  extractSuggestionPayloadFromText,
  parseSuggestionResponsePayload,
} from "@/lib/market-agent/a2ui";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

const MODEL_ID = "gpt-5-nano";
const CONTEXT_LIMIT_TOKENS = 350_000;
const BASE_SYSTEM_PROMPT =
  "You are the Market Agent. Keep replies short and focused on helping the user configure the agent or understand the latest reports. Only propose watchlist or cadence changes when the user explicitly asks or when the report clearly supports a change.";
const buildCadenceContext = (cadenceSeconds: number | null) =>
  typeof cadenceSeconds === "number" && Number.isFinite(cadenceSeconds)
    ? `Current cadence: ${cadenceSeconds} seconds.`
    : "Current cadence: unknown.";
const buildChatPrompt = (cadenceSeconds: number | null) =>
  [BASE_SYSTEM_PROMPT, buildCadenceContext(cadenceSeconds)].join(" ");

type SuggestionOutcomePayload = {
  decision: "accepted" | "declined";
  cadenceSeconds?: number;
  watchlistSymbols?: string[];
  reason?: string;
};

const formatCadenceLabel = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return `${seconds} sec`;
  }
  const normalized = Math.round(seconds);
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const secs = normalized % 60;
  const parts: string[] = [];
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (minutes) {
    parts.push(`${minutes}m`);
  }
  if (!hours && secs) {
    parts.push(`${secs}s`);
  }
  return parts.length ? parts.join(" ") : `${seconds}s`;
};

const buildSuggestionOutcomeMessage = (outcome?: SuggestionOutcomePayload) => {
  if (!outcome) return null;
  const { cadenceSeconds, watchlistSymbols, decision, reason } = outcome;
  const cadenceValid = Number.isFinite(cadenceSeconds ?? NaN) && (cadenceSeconds ?? 0) > 0;
  const statements: string[] = [];
  if (cadenceValid) {
    const cadenceLabel = formatCadenceLabel(cadenceSeconds ?? 0);
    statements.push(decision === "accepted"
      ? `Accepted the cadence suggestion (${cadenceLabel}).`
      : `Declined the cadence suggestion (${cadenceLabel}).`);
  }
  if (watchlistSymbols && watchlistSymbols.length) {
    const listLabel = watchlistSymbols.join(", ");
    statements.push(
      decision === "accepted"
        ? `Accepted the watchlist change: ${listLabel}.`
        : `Declined the watchlist change: ${listLabel}.`
    );
  }
  if (!statements.length) {
    return null;
  }
  const base = decision === "accepted" ? "User accepted a suggestion." : "User declined a suggestion.";
  const reasonText = reason?.trim() ? ` Reason: ${reason.trim()}.` : "";
  return `${base} ${statements.join(" ")}${reasonText}`;
};
const WEB_SEARCH_TOOL: Tool = { type: "web_search_preview" };

const extractTimezoneFromState = (state: unknown): string | undefined => {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return undefined;
  }
  const timezone = (state as Record<string, unknown>).timezone;
  return typeof timezone === "string" ? timezone : undefined;
};

function extractInstanceId(request: NextRequest, params?: { instanceId?: string }) {
  if (params?.instanceId) return params.instanceId;
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  return segments[segments.length - 2] || null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ instanceId: string }> },
) {
  try {
    await requireUserIdServer();
    const params = await context.params;
    const instanceId = extractInstanceId(request, params);
    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }
    const messages = await listMarketAgentMessages(instanceId, 200);
    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load chat messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ instanceId: string }> },
) {
  try {
    const userId = await requireUserIdServer();
    const params = await context.params;
    const instanceId = extractInstanceId(request, params);
    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }
    const instance = await getMarketAgentInstance(instanceId, userId);
    if (!instance) {
      return NextResponse.json({ error: "Market agent not found" }, { status: 404 });
    }
    const body = (await request.json()) as {
      role?: string;
      content?: string;
      suggestionOutcome?: SuggestionOutcomePayload;
    };
    const role = body?.role === "agent" ? "agent" : body?.role === "system" ? "system" : "user";
    const content = (body?.content ?? "").toString();
    const suggestionOutcome = body.suggestionOutcome;
    const userMessage = await insertMarketAgentMessage({ instanceId, role, content });

    if (role !== "user") {
      return NextResponse.json({ message: userMessage });
    }

    const conversation = await ensureMarketAgentConversation(instanceId);
    const history = await listMarketAgentMessages(instanceId, 500);
    const cadenceSeconds = typeof instance.cadence_seconds === "number" ? instance.cadence_seconds : null;
    console.log("[market-agent] Starting request", {
      instanceId,
      conversationId: conversation.id,
      historyCount: history.length,
    });
    const historyMessages = history.map((msg) => ({
      role:
        msg.role === "agent"
          ? ("assistant" as const)
          : msg.role === "assistant"
            ? ("assistant" as const)
            : (msg.role as "user" | "system"),
      content: msg.content,
    }));
    const suggestionOutcomeMessage = buildSuggestionOutcomeMessage(suggestionOutcome);
    const suggestionOutcomeEntries = suggestionOutcomeMessage
      ? [{ role: "system" as const, content: suggestionOutcomeMessage }]
      : [];
    const [stateRow, latestEvents, recentEventIds] = await Promise.all([
      getMarketAgentState(instanceId),
      getMarketAgentEvents({ instanceId, limit: 1 }),
      listMarketAgentUiEventIds(instanceId, 50),
    ]);
    const latestEvent = latestEvents[0] ?? null;
    const configRecord = typeof instance.config === "object" && instance.config ? instance.config : {};
    const cadenceMode: "market_hours" | "always_on" =
      (configRecord as Record<string, unknown>).cadence_mode === "market_hours" ? "market_hours" : "always_on";
    const agentStatePayload = {
      status: instance.status === "running" ? "running" : "paused",
      cadenceSeconds: instance.cadence_seconds ?? null,
      cadenceMode,
      watchlistTickers: instance.watchlist,
      timezone: extractTimezoneFromState(stateRow?.state ?? null),
      lastRunAt: latestEvent?.ts ?? latestEvent?.created_at ?? new Date().toISOString(),
    };
    const marketSnapshot = {
      timestamp: latestEvent?.ts ?? latestEvent?.created_at ?? new Date().toISOString(),
      summary: latestEvent?.summary ?? "",
      tickers: latestEvent?.tickers ?? [],
      state: stateRow?.state ?? {},
    };
    const suggestionContextMessage = buildSuggestionContextMessage({
      agentState: agentStatePayload,
      marketSnapshot,
      lastAnalysisSummary: latestEvent?.summary ?? "",
      lastUiEventIds: recentEventIds,
    });
    console.log("[a2ui] Prepared suggestion context", {
      instanceId,
      lastEventId: latestEvent?.id ?? null,
      dedupeCount: recentEventIds.length,
    });
    const suggestionSystemMessages = [
      { role: "system" as const, content: SUGGESTION_CHAT_PROMPT },
      { role: "system" as const, content: suggestionContextMessage },
    ];
    const chatPrompt = buildChatPrompt(cadenceSeconds);
    const chatMessages = [
      { role: "system" as const, content: chatPrompt },
      ...suggestionSystemMessages,
      ...suggestionOutcomeEntries,
      ...historyMessages,
    ];
    const contextMessages = chatMessages;
    const dedupeSet = new Set<string>(recentEventIds);
    const estimatedInputTokens = contextMessages.reduce(
      (acc, msg) => acc + estimateTokens(typeof msg.content === "string" ? msg.content : ""),
      0
    );
    if (estimatedInputTokens > CONTEXT_LIMIT_TOKENS) {
      console.warn("[market-agent] Context limit exceeded", {
        instanceId,
        estimatedInputTokens,
        contextLimit: CONTEXT_LIMIT_TOKENS,
      });
      return NextResponse.json(
        {
          message: userMessage,
          error: "context_limit_exceeded",
          contextTokens: estimatedInputTokens,
          contextLimit: CONTEXT_LIMIT_TOKENS,
        },
        { status: 413 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ message: userMessage, error: "missing_openai_api_key" }, { status: 500 });
    }

    const client = new OpenAI({ apiKey });
    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        const enqueue = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        };
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        };

        enqueue({ message: userMessage });

        let searchActive = false;
        const emitSearchStatus = (type: "search-start" | "search-complete", query?: string) => {
          if (type === "search-start") {
            if (searchActive) return;
            searchActive = true;
          } else {
            if (!searchActive) return;
            searchActive = false;
          }
          const queryLabel = query?.trim() || "web search";
          enqueue({
            toolStatus: {
              type,
              query: queryLabel,
            },
          });
        };

        let responseId: string | null = null;
        let inputTokens = 0;
        let cachedTokens = 0;
        let outputTokens = 0;
        let assistantText = "";
        let finalResponse: unknown = null;
        let cancelled = false;
        let streamSuppressed = false;
        let pendingTail = "";
        const tagStart = A2UI_TAG_START;
        const tagStartLen = tagStart.length;
        const emitFilteredDelta = (delta: string) => {
          if (streamSuppressed) return;
          const combined = pendingTail + delta;
          const tagIndex = combined.indexOf(tagStart);
          if (tagIndex === -1) {
            if (combined.length < tagStartLen) {
              pendingTail = combined;
              return;
            }
            const safeCut = combined.length - (tagStartLen - 1);
            const visible = combined.slice(0, safeCut);
            pendingTail = combined.slice(safeCut);
            if (visible) {
              enqueue({ token: visible });
            }
            return;
          }
          const visible = combined.slice(0, tagIndex);
          if (visible) {
            enqueue({ token: visible });
          }
          streamSuppressed = true;
          pendingTail = "";
        };

        const upstreamSignal = request.signal as AbortSignal | undefined;
        const abortController = new AbortController();
        if (upstreamSignal) {
          upstreamSignal.addEventListener("abort", () => {
            cancelled = true;
            abortController.abort();
          });
        }

        try {
          const stream = await client.responses.create({
            model: MODEL_ID,
            input: chatMessages,
            stream: true,
            store: false,
            tools: [WEB_SEARCH_TOOL],
            tool_choice: "auto",
            reasoning: { effort: "low" },
          });
          console.log("[market-agent] OpenAI stream started", {
            model: MODEL_ID,
            tools: ["web_search_preview"],
          });

          for await (const event of stream as any) {
            if (cancelled) break;

            const maybeId = (event as any)?.response?.id ?? (event as any)?.id;
            if (maybeId && !responseId) {
              responseId = String(maybeId);
              enqueue({ response_id: responseId });
              console.log("[market-agent] Response id assigned", { responseId });
            }

            const usage = (event as any)?.response?.usage;
            if (usage) {
              inputTokens =
                usage.input_tokens ??
                usage.prompt_tokens ??
                inputTokens;
              cachedTokens =
                usage.input_tokens_details?.cached_tokens ??
                usage.input_tokens_details?.cache_read_input_tokens ??
                usage.cached_input_tokens ??
                cachedTokens;
              outputTokens =
                usage.output_tokens ??
                usage.completion_tokens ??
                outputTokens;
            }

            const eventType = (event as any)?.type;
            if (eventType === "response.output_text.delta" && (event as any)?.delta) {
              const delta = String((event as any).delta);
              assistantText += delta;
              emitFilteredDelta(delta);
            }

            if (eventType === "response.completed") {
              finalResponse = (event as any)?.response ?? finalResponse;
              if (!assistantText && (event as any)?.response?.output_text) {
                assistantText = String((event as any).response.output_text);
              }
            }

            if (
              eventType === "response.web_search_call.in_progress" ||
              eventType === "response.web_search_call.searching"
            ) {
              emitSearchStatus("search-start", (event as any)?.query);
            } else if (eventType === "response.web_search_call.completed") {
              emitSearchStatus("search-complete", (event as any)?.query);
            }
          }

          if (searchActive) {
            emitSearchStatus("search-complete");
          }
        } catch (err: any) {
          if (err?.name === "AbortError" || cancelled) {
            if (responseId) {
              try {
                await client.responses.cancel(responseId);
              } catch (cancelErr) {
                console.warn("[market-agent] Cancel error:", cancelErr);
              }
            }
            close();
            return;
          }
          console.error("[market-agent] Stream error:", err);
          enqueue({ error: err?.message || "stream_error" });
          close();
          return;
        }

        if (!streamSuppressed && pendingTail) {
          enqueue({ token: pendingTail });
          pendingTail = "";
        }
        let assistantContent = (assistantText ?? "").trim() ? assistantText ?? "" : "";
        const taggedSuggestion = extractSuggestionPayloadFromText(assistantContent);
        assistantContent = taggedSuggestion.cleanedText;
        if (!assistantContent.trim()) {
          assistantContent = "I'm here. Ask me about the markets.";
        }
        let suggestionPayload = taggedSuggestion.payload ?? null;
        if (!suggestionPayload && finalResponse) {
          suggestionPayload = parseSuggestionResponsePayload(finalResponse);
        }
        if (taggedSuggestion.payload === null && assistantText.includes(A2UI_TAG_START)) {
          console.warn("[a2ui] Failed to parse tagged suggestion payload");
        }
        if (suggestionPayload) {
          const candidates = extractSuggestionEvents(suggestionPayload);
          console.log("[a2ui] Parsed suggestions", {
            count: candidates.length,
            eventIds: candidates.map((c) => c.eventId),
          });
          if (!candidates.length) {
            console.log("[a2ui] No suggestions in payload");
          }
          if (candidates.length) {
            const insertedEvents: MarketSuggestionEvent[] = [];
            for (const candidate of candidates) {
              if (dedupeSet.has(candidate.eventId)) continue;
              if (insertedEvents.length >= MAX_SUGGESTIONS) break;
              try {
                await upsertMarketAgentUiEvent({
                  instanceId,
                  eventId: candidate.eventId,
                  kind: candidate.kind,
                  payload: candidate,
                  status: "proposed",
                });
                dedupeSet.add(candidate.eventId);
                insertedEvents.push(candidate);
              } catch (eventErr) {
                console.error("[market-agent] Failed to persist suggestion", eventErr);
              }
            }
            if (insertedEvents.length) {
              enqueue({ marketSuggestions: insertedEvents });
            }
          }
        }
        const agentMetadata = {
          agent: "market-agent",
          market_agent_instance_id: instanceId,
          modelUsed: MODEL_ID,
          resolvedFamily: MODEL_ID,
        };

        try {
          const { data: agentRow, error: agentInsertError } = await supabaseAny
            .from("messages")
            .insert([
              {
                user_id: userId,
                conversation_id: conversation.id,
                role: "agent",
                content: assistantContent,
                metadata: agentMetadata,
                openai_response_id: responseId,
              },
            ])
            .select()
            .maybeSingle();

          if (agentInsertError) {
            console.error("[market-agent] Failed to save assistant message:", agentInsertError);
          } else if (agentRow) {
            const agentMessage: MarketAgentChatMessage = {
              id: agentRow.id,
              role: (agentRow.role as MarketAgentChatMessage["role"]) ?? "agent",
              content: agentRow.content ?? assistantContent,
              created_at: agentRow.created_at ?? null,
              metadata: agentRow.metadata ?? agentMetadata,
            };
            enqueue({ agentMessage });
          }
        } catch (persistErr) {
          console.error("[market-agent] Persist assistant failed:", persistErr);
          enqueue({ error: "persist_failed" });
        }

        if (inputTokens > 0 || outputTokens > 0) {
          try {
            const estimatedCost = calculateCost(MODEL_ID, inputTokens, cachedTokens, outputTokens);
            await logUsageRecord({
              userId,
              conversationId: conversation.id,
              model: MODEL_ID,
              inputTokens,
              cachedTokens,
              outputTokens,
              estimatedCost,
            });
            console.log("[market-agent] Usage logged (stream)", {
              inputTokens,
              cachedTokens,
              outputTokens,
              estimatedCost,
            });
          } catch (usageErr) {
            console.error("[market-agent] Failed to log usage:", usageErr);
          }
        }

        console.log("[market-agent] Stream completed", {
          responseId,
          outputLength: assistantContent.length,
        });
        enqueue({ done: true });
        close();
      },
    });

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create chat message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

