import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

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
  "You are the Market Agent, here to help the user configure the agent and explain recent report findings. Help with setup choices and answer follow-up questions, without pretending to run the analysis yourself.";
const ALLOWED_CADENCE_SECONDS = [60, 120, 300, 600, 1800, 3600] as const;
const buildCadenceContext = (cadenceSeconds: number | null) =>
  typeof cadenceSeconds === "number" && Number.isFinite(cadenceSeconds)
    ? `Current cadence: ${cadenceSeconds} seconds.`
    : "Current cadence: unknown.";
const buildToolPrompt = (cadenceSeconds: number | null) =>
  [
    BASE_SYSTEM_PROMPT,
    "Always call suggest_schedule_cadence exactly once per user turn.",
    "Use cadence_seconds in seconds and choose one of: 60, 120, 300, 600, 1800, 3600.",
    "If the user does not request a change, keep cadence_seconds equal to the current cadence.",
    "Do not mention accepting or declining the suggestion; the UI handles acceptance.",
    "Explain your reasoning in no more than one concise sentence.",
    buildCadenceContext(cadenceSeconds),
  ].join(" ");
const buildChatPrompt = (cadenceSeconds: number | null, hasSuggestion = false) =>
  [
    BASE_SYSTEM_PROMPT,
    hasSuggestion
      ? "A cadence suggestion has already been captured for this turn. Mention the pending change and prompt the user to accept or decline it."
      : "Answer setup questions and explain any report findings without repeating cadence suggestions.",
    buildCadenceContext(cadenceSeconds),
  ].join(" ");
const CADENCE_TRIGGER_KEYWORDS = ["cadence", "schedule", "frequency", "interval", "tempo"];
const CADENCE_TRIGGER_REGEX = /(\d+(\.\d+)?)(\s*)(m(in(ute)?s?)?)\b/;
const shouldSuggestCadenceForText = (text: string) => {
  if (!text) return false;
  const normalized = text.toLowerCase();
  if (CADENCE_TRIGGER_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }
  return CADENCE_TRIGGER_REGEX.test(normalized);
};

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
const SUGGEST_CADENCE_TOOL = {
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

const SUGGEST_WATCHLIST_TOOL = {
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

const buildWatchlistPrompt = (cadenceSeconds: number | null) =>
  [
    BASE_SYSTEM_PROMPT,
    "Suggest modifications to the watchlist to keep the focus tight. Return the new watchlist symbols and a short reason.",
    "Keep the watchlist reasoning brief—no more than one sentence.",
    buildCadenceContext(cadenceSeconds),
  ].join(" ");

const WATCHLIST_TRIGGER_KEYWORDS = ["watchlist", "ticker", "symbol", "add", "remove", "upgrade"];
const WATCHLIST_SYMBOL_REGEX = /\b[A-Z0-9]{2,6}\b/g;
const shouldSuggestWatchlistForText = (text: string) => {
  if (!text) return false;
  const normalized = text.toLowerCase();
  if (WATCHLIST_TRIGGER_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }
  const upper = text.toUpperCase();
  const symbols = (upper.match(WATCHLIST_SYMBOL_REGEX) ?? []).filter((token) => token.match(/[A-Z]/));
  return symbols.length >= 1;
};

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
    const wantsCadenceSuggestion = shouldSuggestCadenceForText(content);
    const wantsWatchlistSuggestion = shouldSuggestWatchlistForText(content);
    const chatPrompt = buildChatPrompt(cadenceSeconds, wantsCadenceSuggestion || wantsWatchlistSuggestion);
    const chatMessages = [
      { role: "system" as const, content: chatPrompt },
      ...suggestionOutcomeEntries,
      ...historyMessages,
    ];
    const toolMessages = wantsCadenceSuggestion
      ? [
          { role: "system" as const, content: buildToolPrompt(cadenceSeconds) },
          ...suggestionOutcomeEntries,
          ...historyMessages,
        ]
      : [];
    const watchlistToolMessages = wantsWatchlistSuggestion
      ? [
          { role: "system" as const, content: buildWatchlistPrompt(cadenceSeconds) },
          ...suggestionOutcomeEntries,
          ...historyMessages,
        ]
      : [];
    const toolContextMessages = [
      ...(wantsCadenceSuggestion ? toolMessages : []),
      ...(wantsWatchlistSuggestion ? watchlistToolMessages : []),
    ];
    const contextMessages = toolContextMessages.length ? toolContextMessages : chatMessages;
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

        type ToolCallPayload = {
          type: "function_call";
          name: string;
          call_id?: string;
          arguments: string;
        };

        type ToolCallOutput = {
          type: "function_call_output";
          call_id: string;
          output: string;
        };

        const toolCallOutputs: ToolCallOutput[] = [];
        const toolCallPayloads: ToolCallPayload[] = [];
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

        if (wantsCadenceSuggestion) {
          try {
            const toolResponse = await client.responses.create({
              model: MODEL_ID,
              input: toolMessages,
              tools: [SUGGEST_CADENCE_TOOL],
              tool_choice: { type: "function", name: SUGGEST_CADENCE_TOOL.name },
              reasoning: { effort: "low" },
              store: false,
            });
            const toolOutputItems = Array.isArray((toolResponse as any).output)
              ? (toolResponse as any).output
              : [];
            const toolCall = toolOutputItems.find(
              (item: any) => item?.type === "function_call" && item?.name === SUGGEST_CADENCE_TOOL.name
            );
            if (toolCall) {
              toolCallPayloads.push({
                type: "function_call",
                name: toolCall.name,
                call_id: toolCall.call_id,
                arguments: typeof toolCall.arguments === "string" ? toolCall.arguments : "",
              });
            }
            if (toolCall && typeof toolCall.arguments === "string") {
              const suggestion = parseCadenceSuggestion(toolCall.arguments);
              captureSuggestion({
                cadenceSeconds: suggestion?.cadenceSeconds,
                cadenceReason: suggestion?.reason,
              });
              if (toolCall.call_id) {
                toolCallOutputs.push({
                  type: "function_call_output",
                  call_id: toolCall.call_id,
                  output: JSON.stringify(
                    suggestion
                      ? {
                          cadence_seconds: suggestion.cadenceSeconds,
                          reason: suggestion.reason ?? "",
                          status: "suggested",
                        }
                      : {
                          status: "invalid_suggestion",
                          error: "Failed to parse cadence suggestion.",
                        }
                  ),
                });
              }
              if (suggestion) {
                console.log("[market-agent] Emitted cadence suggestion", {
                  cadenceSeconds: suggestion.cadenceSeconds,
                  hasReason: typeof suggestion.reason === "string" && suggestion.reason.length > 0,
                });
              }
            }
            const toolUsage = (toolResponse as any)?.usage;
            if (toolUsage) {
              const toolInputTokens = toolUsage.input_tokens ?? toolUsage.prompt_tokens ?? 0;
              const toolCachedTokens =
                toolUsage.input_tokens_details?.cached_tokens ??
                toolUsage.input_tokens_details?.cache_read_input_tokens ??
                toolUsage.cached_input_tokens ??
                0;
              const toolOutputTokens = toolUsage.output_tokens ?? toolUsage.completion_tokens ?? 0;
              if (toolInputTokens > 0 || toolOutputTokens > 0) {
                const estimatedCost = calculateCost(
                  MODEL_ID,
                  toolInputTokens,
                  toolCachedTokens,
                  toolOutputTokens
                );
                await logUsageRecord({
                  userId,
                  conversationId: conversation.id,
                  model: MODEL_ID,
                  inputTokens: toolInputTokens,
                  cachedTokens: toolCachedTokens,
                  outputTokens: toolOutputTokens,
                  estimatedCost,
                });
                console.log("[market-agent] Usage logged (cadence tool)", {
                  inputTokens: toolInputTokens,
                  cachedTokens: toolCachedTokens,
                  outputTokens: toolOutputTokens,
                  estimatedCost,
                });
              }
            }
          } catch (toolErr) {
            console.error("[market-agent] Tool call error:", toolErr);
          }
        }
        if (wantsWatchlistSuggestion) {
          try {
            const watchlistResponse = await client.responses.create({
              model: MODEL_ID,
              input: watchlistToolMessages,
              tools: [SUGGEST_WATCHLIST_TOOL],
              tool_choice: { type: "function", name: SUGGEST_WATCHLIST_TOOL.name },
              reasoning: { effort: "low" },
              store: false,
            });
            const watchlistItems = Array.isArray((watchlistResponse as any).output)
              ? (watchlistResponse as any).output
              : [];
            const watchlistCall = watchlistItems.find(
              (item: any) => item?.type === "function_call" && item?.name === SUGGEST_WATCHLIST_TOOL.name
            );
              if (watchlistCall) {
                toolCallPayloads.push({
                  type: "function_call",
                  name: watchlistCall.name,
                  call_id: watchlistCall.call_id,
                  arguments: typeof watchlistCall.arguments === "string" ? watchlistCall.arguments : "",
                });
              }
            if (watchlistCall && typeof watchlistCall.arguments === "string") {
              try {
                const parsed = JSON.parse(watchlistCall.arguments);
                const symbols =
                  Array.isArray(parsed.watchlist) && parsed.watchlist.every((sym: unknown) => typeof sym === "string")
                    ? parsed.watchlist.map((sym: string) => sym.trim().toUpperCase()).filter(Boolean)
                    : null;
                if (symbols && symbols.length) {
                  captureSuggestion({
                    watchlistSymbols: symbols,
                    watchlistReason:
                      typeof parsed.reason === "string" ? parsed.reason.trim() : undefined,
                  });
                }
              } catch {
                // ignore parse errors
              }
              if (watchlistCall.call_id) {
                toolCallOutputs.push({
                  type: "function_call_output",
                  call_id: watchlistCall.call_id,
                  output: JSON.stringify({
                    status: "suggested",
                    watchlist: watchlistCall.arguments,
                  }),
                });
              }
            }
            const toolUsage = (watchlistResponse as any)?.usage;
            if (toolUsage) {
              const toolInputTokens = toolUsage.input_tokens ?? toolUsage.prompt_tokens ?? 0;
              const toolCachedTokens =
                toolUsage.input_tokens_details?.cached_tokens ??
                toolUsage.input_tokens_details?.cache_read_input_tokens ??
                toolUsage.cached_input_tokens ??
                0;
              const toolOutputTokens = toolUsage.output_tokens ?? toolUsage.completion_tokens ?? 0;
              if (toolInputTokens > 0 || toolOutputTokens > 0) {
                const estimatedCost = calculateCost(
                  MODEL_ID,
                  toolInputTokens,
                  toolCachedTokens,
                  toolOutputTokens
                );
                await logUsageRecord({
                  userId,
                  conversationId: conversation.id,
                  model: MODEL_ID,
                  inputTokens: toolInputTokens,
                  cachedTokens: toolCachedTokens,
                  outputTokens: toolOutputTokens,
                  estimatedCost,
                });
                console.log("[market-agent] Usage logged (watchlist tool)", {
                  inputTokens: toolInputTokens,
                  cachedTokens: toolCachedTokens,
                  outputTokens: toolOutputTokens,
                  estimatedCost,
                });
              }
            }
          } catch (watchErr) {
            console.error("[market-agent] Watchlist tool error:", watchErr);
          }
        }
        if (combinedSuggestion) {
          enqueue({ suggestion: combinedSuggestion });
        }

        if (cancelled) {
          close();
          return;
        }

        const followupInput = [
          ...chatMessages,
          ...toolCallPayloads,
          ...toolCallOutputs,
        ];

        try {
          const stream = await client.responses.create({
            model: MODEL_ID,
            input: followupInput,
            stream: true,
            store: false,
            tools: [{ type: "web_search" as any }],
            reasoning: { effort: "low" },
          });
          console.log("[market-agent] OpenAI stream started", {
            model: MODEL_ID,
            tools: ["web_search"],
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

        const assistantContent = assistantText || "I'm here. Ask me about the markets.";
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

