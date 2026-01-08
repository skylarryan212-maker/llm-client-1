// Use the Node.js runtime so the OpenAI Node client and Node APIs work correctly
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createOpenAIClient } from "@/lib/openai/client";
import { runWebSearchPipeline } from "@/lib/search/fast-web-pipeline";
import { writeSearchQueriesAndTime } from "@/lib/search/search-llm";
import { supabaseServerAdmin } from "@/lib/supabase/server";
import {
  ensureGuestSession,
  incrementGuestSessionRequest,
  attachGuestCookie,
  shouldResetDailyCounter,
  GUEST_PROMPT_LIMIT_PER_DAY,
  addGuestUsage,
} from "@/lib/guest-session";
import { calculateCost } from "@/lib/pricing";
import type { ResponseStreamEvent, Tool } from "openai/resources/responses/responses";

export async function POST(request: NextRequest) {
  type GuestChatRequest = {
    message: string;
    model?: string;
    previousResponseId?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };

  try {
    console.log("[guest-chat] Received request");
    const body = (await request.json()) as GuestChatRequest;
    const message = body.message?.trim();
    if (!message) {
      console.log("[guest-chat] No message provided");
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    console.log("[guest-chat] Message:", message.substring(0, 50));
    // Supabase may not be available in some guest deployments; fall back gracefully.
    let supabase: any = null;
    let session:
      | {
          id: string;
          request_count: number | null;
          token_count: number | null;
          estimated_cost: number | null;
          last_seen: string | null;
        }
      | null = null;
    let cookieValue: string | undefined;
    try {
      supabase = await supabaseServerAdmin();
      const ensured = await ensureGuestSession(request, supabase);
      session = ensured.session;
      cookieValue = ensured.cookieValue;
    } catch (err) {
      console.warn("[guest-chat] Supabase unavailable, using in-memory guest session fallback:", err);
      session = {
        id: `guest-fallback-${Date.now()}`,
        request_count: 0,
        token_count: 0,
        estimated_cost: 0,
        last_seen: null,
      };
    }

    let requestCount = session?.request_count ?? 0;
    if (session && shouldResetDailyCounter(session as any)) {
      requestCount = 0;
    }
    if (session && supabase && requestCount >= GUEST_PROMPT_LIMIT_PER_DAY) {
      const limitResponse = NextResponse.json(
        {
          error: "Guest limit reached",
          message: `Guests can send ${GUEST_PROMPT_LIMIT_PER_DAY} prompts per day. Please sign in or wait until tomorrow.`,
        },
        { status: 429 }
      );
      attachGuestCookie(limitResponse, cookieValue);
      return limitResponse;
    }

    if (supabase && session) {
      await incrementGuestSessionRequest(supabase, session.id, requestCount + 1);
    }

    // Guest mode always uses a single model to keep behavior predictable.
    const model = "gpt-5-nano";
    const previousResponseId = body.previousResponseId;

    console.log("[guest-chat] Using model:", model);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[guest-chat] Missing OPENAI_API_KEY");
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    console.log("[guest-chat] Creating OpenAI stream");
    const client = createOpenAIClient({ apiKey });
    const historyInput =
      Array.isArray(body.history) && body.history.length
        ? body.history.filter(
            (item) =>
              item &&
              typeof item === "object" &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string"
          )
        : [];

    // No tools for guest chat (guests are unauthenticated; web search is handled by our fast-web-pipeline)
    const tools: Tool[] = [];

    console.log("[guest-chat] Tools configured:", tools);
    const stream = client.responses.stream({
      model,
      store: true,
      previous_response_id: previousResponseId,
      reasoning: { effort: "low" },
      instructions:
        "You are a helpful AI assistant. The user is in guest mode; keep answers concise and do not include links.",
      input: [
        ...historyInput,
        { role: "user", content: message },
      ],
      tools,
      tool_choice: "auto",
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const enqueue = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          console.log("[guest-chat] Starting to stream chunks");
          // Emit an immediate marker so clients know the stream started.
          enqueue({ stream: "start" });
          // Buffer small token deltas and flush on interval to avoid many tiny writes.
          let tokenBuffer = "";
          const flushIntervalMs = 40;
          const flushTimer = setInterval(() => {
            if (tokenBuffer.length > 0) {
              enqueue({ token: tokenBuffer });
              tokenBuffer = "";
            }
          }, flushIntervalMs);
          let responseId: string | undefined;
          let emittedToken = false;
          let inputTokens = 0;
          let cachedTokens = 0;
          let outputTokens = 0;

          // Kick off query writer and web pipeline in parallel so we can emit search status events
          let queryWriterPromise = writeSearchQueriesAndTime({
            prompt: message,
            count: Math.max(1, historyInput?.length ? 1 : 1),
            currentDate: new Date().toISOString(),
            recentMessages: historyInput as any,
          }).catch(() => null);

          let webPipelineStarted = false;
          const startWebPipelineIfNeeded = async () => {
            let queryWriterResult: any = null;
            try {
              queryWriterResult = await queryWriterPromise;
            } catch {}
            try {
              const webResult = await runWebSearchPipeline(message, {
                recentMessages: historyInput as any,
                currentDate: new Date().toISOString(),
                precomputedQueryResult: queryWriterResult ?? undefined,
                onSearchStart: ({ query }) => {
                  webPipelineStarted = true;
                  enqueue({ toolStatus: { type: "search-start", query } });
                },
                onProgress: (event: any) => {
                  if (!webPipelineStarted) return;
                  enqueue({ toolStatus: { type: "search-progress", count: event.searched } });
                },
              });
              if (webPipelineStarted) {
                const qLabel = (webResult?.queries?.join(" | ") || message).trim();
                enqueue({ toolStatus: { type: "search-complete", query: qLabel, results: webResult?.results?.length ?? 0 } });
              }
            } catch (err) {
              if (webPipelineStarted) {
                enqueue({ toolStatus: { type: "search-error", query: message, message: String(err) } });
              }
            }
          };

          // Fire-and-forget the pipeline (runs concurrently with streaming)
          startWebPipelineIfNeeded().catch(() => null);

          for await (const event of stream) {
            const typedEvent = event as ResponseStreamEvent;
            // Capture response id for chaining
            const maybeId = (typedEvent as any)?.response?.id ?? (typedEvent as any)?.id;
            if (maybeId && !responseId) {
              responseId = maybeId as string;
              enqueue({ response_id: responseId });
            }

            // Capture usage if available
            const usage = (typedEvent as any)?.response?.usage;
            if (usage) {
              inputTokens =
                usage.input_tokens ??
                usage.prompt_tokens ??
                usage.total_tokens ??
                inputTokens;
              cachedTokens =
                usage.input_tokens_details?.cached_tokens ??
                usage.input_tokens_details?.cache_read_input_tokens ??
                usage.cached_input_tokens ??
                cachedTokens;
              outputTokens = usage.output_tokens ?? usage.completion_tokens ?? outputTokens;
            }

                // Stream text deltas
                if (typedEvent.type === "response.output_text.delta" && typedEvent.delta) {
                  emittedToken = true;
                  const deltaStr = typedEvent.delta as string;
                  console.log("[guest-chat] Token delta:", deltaStr.substring(0, 50));
                  // Buffer small deltas and let the interval flush them.
                  tokenBuffer += deltaStr;
                } else if (typedEvent.type === "response.output_text.delta") {
                  console.log("[guest-chat] output_text.delta event received but no delta property");
                }

            // Log all response.completed events to diagnose
            if (typedEvent.type === "response.completed") {
              console.log("[guest-chat] response.completed event", {
                emittedToken,
                hasOutputText: !!(typedEvent as any)?.response?.output_text,
                outputTextLength: ((typedEvent as any)?.response?.output_text || "").length,
              });
              // Fallback: if completed and we never emitted tokens, send the full text
              if (
                !emittedToken &&
                (typedEvent as any)?.response?.output_text
              ) {
                emittedToken = true;
                console.log("[guest-chat] Emitting fallback output_text:", (typedEvent as any).response.output_text.substring(0, 50));
                enqueue({ token: (typedEvent as any).response.output_text });
              }
            }

            if (typedEvent.type === "response.completed") {
              try {
                const estimatedCost = calculateCost(model, inputTokens, cachedTokens, outputTokens);
                const totalTokens = (inputTokens || 0) + (cachedTokens || 0) + (outputTokens || 0);
                if (supabase && session) {
                  await addGuestUsage(
                    supabase,
                    session.id,
                    (session as any)?.token_count,
                    (session as any)?.estimated_cost,
                    totalTokens,
                    estimatedCost
                  );
                }
              } catch (usageErr) {
                console.error("[guest-chat] Failed to log guest usage:", usageErr);
              }
              // Flush any buffered tokens before finishing.
              if (tokenBuffer.length > 0) {
                enqueue({ token: tokenBuffer });
                tokenBuffer = "";
              }
              clearInterval(flushTimer);
              enqueue({ done: true });
              console.log("[guest-chat] Stream completed successfully");
              controller.close();
              return;
            }

            if (typedEvent.type === "error" && typedEvent.message) {
              enqueue({ error: typedEvent.message });
            }
          }
          // If loop exited without explicit return, flush buffer and close
          if (tokenBuffer.length > 0) {
            enqueue({ token: tokenBuffer });
            tokenBuffer = "";
          }
          clearInterval(flushTimer);
          enqueue({ done: true });
          controller.close();
        } catch (err: any) {
          console.error("[guest-chat] Stream error:", err);
          enqueue({ error: err?.message || "guest_chat_error" });
          if (tokenBuffer.length > 0) {
            enqueue({ token: tokenBuffer });
            tokenBuffer = "";
          }
          clearInterval(flushTimer);
          enqueue({ done: true });
          controller.close();
        }
      },
    });

    const response = new NextResponse(readable, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
    attachGuestCookie(response, cookieValue);
    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "guest_chat_internal_error" },
      { status: 500 }
    );
  }
}
// Lightweight proxy: forward guest requests to the main chat handler so guests run the same code path.
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
// Import the main chat POST handler and re-export for guest access.
import { POST as mainChatPOST } from "../chat/route";

export async function POST(request: NextRequest) {
  // Forward the incoming request to the main chat handler.
  // This keeps behavior identical between guest and main chat and avoids divergence.
  return await mainChatPOST(request as any);
}
