import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { Tool, FunctionTool } from "openai/resources/responses/responses";

import { calculateCost } from "@/lib/pricing";
import { estimateTokens } from "@/lib/tokens/estimateTokens";
import { logUsageRecord } from "@/lib/usage";
import {
  ensureMarketAgentConversation,
  getMarketAgentInstance,
  insertMarketAgentMessage,
  listMarketAgentMessages,
  type MarketAgentChatMessage,
} from "@/lib/data/market-agent";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

const MODEL_ID = "gpt-5-nano";
const CONTEXT_LIMIT_TOKENS = 350_000;
const BASE_SYSTEM_PROMPT =
  "You are the Market Agent. Keep replies short and focused on helping the user configure the agent or understand the latest reports. Only propose watchlist or cadence changes when the user explicitly asks or when the report clearly supports a change.";
const ALLOWED_CADENCE_SECONDS = [60, 120, 300, 600, 1800, 3600] as const;
const buildCadenceContext = (cadenceSeconds: number | null) =>
  typeof cadenceSeconds === "number" && Number.isFinite(cadenceSeconds)
    ? `Current cadence: ${cadenceSeconds} seconds.`
    : "Current cadence: unknown.";
const TOOL_USAGE_INSTRUCTIONS = [
  "When the user asks to adjust cadence or watchlist, call the matching function tool (suggest_schedule_cadence or suggest_watchlist_change) instead of claiming the change was applied.",
  "Always include a short natural-language summary alongside any tool call; mention the current cadence and keep it to 1-2 sentences.",
  "Stay within the allowed cadence set and keep responses tight.",
].join(" ");
const buildChatPrompt = (cadenceSeconds: number | null) =>
  [BASE_SYSTEM_PROMPT, TOOL_USAGE_INSTRUCTIONS, buildCadenceContext(cadenceSeconds)].join(" ");

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
const SUGGEST_CADENCE_TOOL: FunctionTool = {
  type: "function" as const,
  name: "suggest_schedule_cadence",
  description:
    "Recommend a schedule cadence (in seconds) and explain why the change makes sense.",
  parameters: {
    type: "object",
    properties: {
      cadence_seconds: {
        type: "number",
        enum: ALLOWED_CADENCE_SECONDS,
        description: "Desired cadence between reports or checks, expressed in seconds.",
      },
      reason: {
        type: ["string", "null"],
        description: "Short rationale for the cadence recommendation.",
      },
    },
    required: ["cadence_seconds", "reason"],
    additionalProperties: false,
  },
  strict: false,
};

const SUGGEST_WATCHLIST_TOOL: FunctionTool = {
  type: "function" as const,
  name: "suggest_watchlist_change",
  description:
    "Propose an updated watchlist by listing the symbol set the agent should track going forward.",
  parameters: {
    type: "object",
    properties: {
      watchlist: {
        type: "array",
        description: "Symbols to track (uppercase).",
        items: {
          type: "string",
          pattern: "^[A-Z0-9]{1,6}$",
        },
        minItems: 1,
      },
      reason: {
        type: ["string", "null"],
        description: "Why these symbols should be tracked (optional).",
      },
    },
    required: ["watchlist"],
    additionalProperties: false,
  },
  strict: false,
};

const WEB_SEARCH_TOOL: Tool = { type: "web_search_preview" };
const RESPONSE_TOOLS: Tool[] = [SUGGEST_CADENCE_TOOL, SUGGEST_WATCHLIST_TOOL, WEB_SEARCH_TOOL];
const TOOL_NAMES = RESPONSE_TOOLS.map((tool) =>
  tool.type === "function" ? (tool as FunctionTool).name : tool.type
);

type CombinedSuggestionPayload = {
  suggestionId: string;
  cadenceSeconds?: number;
  cadenceReason?: string;
  watchlistSymbols?: string[];
  watchlistReason?: string;
};

function extractInstanceId(request: NextRequest, params?: { instanceId?: string }) {
  if (params?.instanceId) return params.instanceId;
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  return segments[segments.length - 2] || null;
}

const buildSuggestionSummary = (
  suggestion: CombinedSuggestionPayload,
  currentCadenceSeconds: number | null,
) => {
  const pieces: string[] = [];
  if (typeof suggestion.cadenceSeconds === "number" && Number.isFinite(suggestion.cadenceSeconds)) {
    const cadenceLabel = formatCadenceLabel(suggestion.cadenceSeconds);
    const cadenceReason = suggestion.cadenceReason?.trim();
    pieces.push(cadenceReason ? `Proposed ${cadenceLabel} cadence: ${cadenceReason}.` : `Proposed ${cadenceLabel} cadence.`);
  }
  if (suggestion.watchlistSymbols?.length) {
    const watchlistLabel = suggestion.watchlistSymbols.join(", ");
    const watchlistReason = suggestion.watchlistReason?.trim();
    pieces.push(
      watchlistReason ? `Watchlist update (${watchlistLabel}): ${watchlistReason}.` : `Watchlist update (${watchlistLabel}).`
    );
  }
  if (!pieces.length) return null;
  const cadenceContext =
    typeof currentCadenceSeconds === "number" && Number.isFinite(currentCadenceSeconds)
      ? `Current cadence: ${formatCadenceLabel(currentCadenceSeconds)}.`
      : "";
  return `${pieces.join(" ")} ${cadenceContext}`.trim();
};

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
    const chatPrompt = buildChatPrompt(cadenceSeconds);
    const chatMessages = [
      { role: "system" as const, content: chatPrompt },
      ...suggestionOutcomeEntries,
      ...historyMessages,
    ];
    const contextMessages = chatMessages;
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
        let cancelled = false;

        const upstreamSignal = request.signal as AbortSignal | undefined;
        const abortController = new AbortController();
        if (upstreamSignal) {
          upstreamSignal.addEventListener("abort", () => {
            cancelled = true;
            abortController.abort();
          });
        }

        const parseCadenceSuggestion = (argsRaw: string) => {
          try {
            const parsedArgs = JSON.parse(argsRaw) as {
              cadence_seconds?: number;
              reason?: string;
            };
            const cadenceSeconds =
              typeof parsedArgs.cadence_seconds === "number" ? parsedArgs.cadence_seconds : null;
            if (cadenceSeconds === null || !Number.isFinite(cadenceSeconds) || cadenceSeconds <= 0) {
              return null;
            }
            return {
              cadenceSeconds,
              reason: typeof parsedArgs.reason === "string" ? parsedArgs.reason : undefined,
            };
          } catch {
            return null;
          }
        };
        const parseWatchlistSuggestion = (argsRaw: string) => {
          try {
            const parsed = JSON.parse(argsRaw);
            const symbols =
              Array.isArray(parsed.watchlist) && parsed.watchlist.every((sym: unknown) => typeof sym === "string")
                ? parsed.watchlist.map((sym: string) => sym.trim().toUpperCase()).filter(Boolean)
                : null;
            const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : undefined;
            if (!symbols || !symbols.length) return null;
            return { watchlist: symbols, reason };
          } catch {
            return null;
          }
        };

        const ensureCallId = (call: any) => {
          if (call?.call_id && typeof call.call_id === "string" && call.call_id.trim()) {
            return call.call_id;
          }
          if (call?.id && typeof call.id === "string" && call.id.trim()) {
            return call.id;
          }
          return `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        };
        let combinedSuggestion: CombinedSuggestionPayload | null = null;
        let suggestionCounter = 0;
        const captureSuggestion = (update: Partial<CombinedSuggestionPayload>) => {
          if (!combinedSuggestion) {
            combinedSuggestion = {
              suggestionId: `${Date.now()}-${suggestionCounter++}`,
              ...update,
            };
          } else {
            combinedSuggestion = {
              ...combinedSuggestion,
              ...update,
            };
          }
        };

        const argBuffer: Record<string, { name: string; args: string }> = {};
        const finalizeFunctionCall = (callId: string) => {
          const buf = argBuffer[callId];
          if (!buf || !buf.name) return;
          if (buf.name === SUGGEST_CADENCE_TOOL.name) {
            const suggestion = parseCadenceSuggestion(buf.args);
            captureSuggestion({
              cadenceSeconds: suggestion?.cadenceSeconds,
              cadenceReason: suggestion?.reason,
            });
          } else if (buf.name === SUGGEST_WATCHLIST_TOOL.name) {
            const suggestion = parseWatchlistSuggestion(buf.args);
            if (suggestion) {
              captureSuggestion({
                watchlistSymbols: suggestion.watchlist,
                watchlistReason: suggestion.reason,
              });
            }
          }
        };

        try {
          const stream = await client.responses.create({
            model: MODEL_ID,
            input: chatMessages,
            stream: true,
            store: false,
            tools: RESPONSE_TOOLS,
            tool_choice: "auto",
            reasoning: { effort: "low" },
          });
          console.log("[market-agent] OpenAI stream started", {
            model: MODEL_ID,
            tools: TOOL_NAMES,
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
              enqueue({ token: delta });
            }

            if (eventType === "response.output_item.added" && (event as any)?.item?.type === "function_call") {
              const item = (event as any).item;
              const callId = ensureCallId(item);
              const existing = argBuffer[callId] ?? { name: item?.name ?? "", args: "" };
              if (typeof item?.arguments === "string") {
                existing.args = item.arguments;
              }
              existing.name = item?.name ?? existing.name;
              argBuffer[callId] = existing;
              if (existing.args) {
                finalizeFunctionCall(callId);
              }
            }

            if (eventType === "response.function_call_arguments.delta") {
              const callId = (event as any)?.item_id || (event as any)?.call_id;
              if (callId) {
                const existing = argBuffer[callId] ?? { name: (event as any)?.name ?? "", args: "" };
                existing.args += String((event as any)?.delta ?? "");
                argBuffer[callId] = existing;
              }
            }

            if (eventType === "response.function_call_arguments.done") {
              const callId = (event as any)?.item_id || (event as any)?.call_id;
              if (callId) {
                const existing = argBuffer[callId] ?? { name: (event as any)?.name ?? "", args: "" };
                if (typeof (event as any)?.arguments === "string") {
                  existing.args = (event as any).arguments;
                }
                argBuffer[callId] = existing;
                finalizeFunctionCall(callId);
              }
            }

            if (eventType === "response.completed") {
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

        if (combinedSuggestion) {
          enqueue({ suggestion: combinedSuggestion });
        }

        let assistantContent =
          assistantText ||
          (combinedSuggestion ? buildSuggestionSummary(combinedSuggestion, cadenceSeconds) : "");
        if (!assistantContent) {
          assistantContent = "I'm here. Ask me about the markets.";
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

