"use server";

import { NextRequest, NextResponse } from "next/server";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { Json } from "@/lib/supabase/types";
import { encodingForModel } from "js-tiktoken";
import { A2UI_TAG_END, A2UI_TAG_START, extractSuggestionPayloadFromText, stripSuggestionPayloadFromText } from "@/lib/market-agent/a2ui";

type DraftRequestBody = {
  prompt?: string;
  taskId?: string;
};

const SYSTEM_PROMPT = [
  "You are a concise human writing assistant.",
  "Write directly to the user's request with clear, natural language.",
  "Do not talk about being an AI. Do not add meta comments.",
  "Keep it focused, readable, and practical.",
  "After the draft, append a UI-control payload wrapped in tags.",
  `Use ${A2UI_TAG_START}{"cta":{"show":true,"reason":"..."}}${A2UI_TAG_END} at the very end.`,
  "Set show=true only when the draft is full, paragraph-style prose that should be humanized now.",
  "Set show=false for outlines, bullet lists, short fragments, greetings, or meta replies.",
  "The tag controls UI only; you are not running the humanizer yourself.",
  "Do not mention the tag or JSON in the visible response.",
  "Do not add any text after the closing tag.",
].join(" ");

type HumanizerCtaDecision = {
  show: boolean;
  reason?: string;
};

const parseCtaDecision = (payload: unknown): HumanizerCtaDecision | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const candidate =
    (record.cta as Record<string, unknown> | undefined) ??
    (record.decision as Record<string, unknown> | undefined) ??
    record;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const show = (candidate as Record<string, unknown>).show;
  if (typeof show !== "boolean") return null;
  const reasonValue = (candidate as Record<string, unknown>).reason;
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : undefined;
  return { show, reason: reason || undefined };
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as DraftRequestBody;
    const prompt = body.prompt?.trim();
    const taskId = body.taskId?.trim();
    const requestStart = Date.now();
    console.info("[human-writing][draft] request received", {
      taskId,
      promptChars: prompt?.length ?? 0,
      ts: requestStart,
    });

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const supabase = await supabaseServer();
    const userId = await requireUserIdServer();
    console.info("[human-writing][draft] user resolved", { userId });

    // Find or create conversation for this task
    const { data: existing, error: findError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("metadata->>agent", "human-writing")
      .eq("metadata->>task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (findError) {
      console.error("[human-writing][draft] conversation lookup error", findError);
      return NextResponse.json({ error: "conversation_lookup_failed" }, { status: 500 });
    }

    let conversationId: string | null = existing?.[0]?.id ?? null;
    if (!conversationId) {
      const { data: created, error: createError } = await supabase
        .from("conversations")
        .insert([
          {
            user_id: userId,
            title: "Human Writing",
            project_id: null,
            metadata: { agent: "human-writing", task_id: taskId },
          },
        ])
        .select("id")
        .single();

      if (createError || !created) {
        console.error("[human-writing][draft] conversation create error", createError);
        return NextResponse.json({ error: "conversation_create_failed" }, { status: 500 });
      }
      conversationId = created.id;
    }

    // Insert user message
    const { error: insertUserError } = await supabase.from("messages").insert([
      {
        user_id: userId,
        conversation_id: conversationId,
        role: "user",
        content: prompt,
        metadata: { agent: "human-writing" },
      },
    ]);
    if (insertUserError) {
      console.error("[human-writing][draft] insert user message error", insertUserError);
      return NextResponse.json({ error: "save_user_message_failed" }, { status: 500 });
    }

    // Load full chat history (after inserting the latest user message)
    const { data: messageRows, error: historyError } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (historyError) {
      console.error("[human-writing][draft] history fetch error", historyError);
      return NextResponse.json({ error: "history_fetch_failed" }, { status: 500 });
    }

    // Build input list and trim/compact from the front if oversized (real token counting)
    const historyItems: ResponseInputItem[] =
      (messageRows ?? []).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content ?? "",
      })) ?? [];

    console.info("[human-writing][draft] start", {
      userId,
      taskId,
      conversationId,
      promptChars: prompt.length,
      historyItems: historyItems.length,
    });

    let inputItems: ResponseInputItem[] = historyItems;

    const client = createOpenAIClient({ apiKey });

    const MAX_TOKENS = 400_000;
    const tokenEncoder = encodingForModel("gpt-4o-mini"); // closest available for GPT-5 Nano tokenization
    const countTokens = (items: ResponseInputItem[]) => {
      const tokens = items.reduce((sum, item) => {
        if (!item || typeof item !== "object") return sum;
        const role = (item as { role?: unknown }).role;
        const content = (item as { content?: unknown }).content;
        if (typeof role !== "string" || typeof content !== "string") return sum;
        const rolePrefix =
          role === "assistant" ? "assistant: " : role === "system" ? "system: " : "user: ";
        const encoded = tokenEncoder.encode(rolePrefix + content);
        return sum + encoded.length;
      }, 0);
      return tokens;
    };

    let tokensBeforeTrim = 0;
    let tokensAfterTrim = 0;
    let trimAttempts = 0;

    try {
      tokensBeforeTrim = countTokens(inputItems);

      if (tokensBeforeTrim > MAX_TOKENS) {
        // Attempt compaction via SDK
        try {
          const { data: compacted, response: rawResponse } = await client.responses
            .compact({
              model: "gpt-5-nano",
              input: inputItems,
              instructions: SYSTEM_PROMPT,
            })
            .withResponse();
          const requestId = getOpenAIRequestId(compacted, rawResponse);
          if (requestId) {
            console.info("[human-writing][compact] OpenAI request id", { requestId });
          }
          if (Array.isArray(compacted?.output) && compacted.output.length) {
            inputItems = compacted.output as any;
          }
        } catch (err) {
          console.warn("[human-writing][compact] failed", err);
        }
      }

      // Hard trim from the oldest until under budget using best-effort token counts
      let tokens = countTokens(inputItems);
      while (tokens > MAX_TOKENS && inputItems.length > 1 && trimAttempts < 200) {
        inputItems = inputItems.slice(1);
        tokens = countTokens(inputItems);
        trimAttempts += 1;
      }
      tokensAfterTrim = tokens;
    } catch (err) {
      console.warn("[human-writing][tokens] counting failed, proceeding without trim", err);
    }

    const requestInput = inputItems as any;
    console.info("[human-writing][draft] calling OpenAI", {
      model: "gpt-5-nano",
      inputItems: requestInput.length,
      tokensBeforeTrim,
      tokensAfterTrim,
      trimAttempts,
    });

    const stream = client.responses.stream({
      model: "gpt-5-nano",
      store: true,
      instructions: SYSTEM_PROMPT,
      input: requestInput as any,
      reasoning: { effort: "low" },
    });

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const textEncoder = new TextEncoder();
    let draftText = "";
    let rawText = "";
    let deltaCount = 0;
    let firstDeltaAt: number | null = null;
    let streamSuppressed = false;
    let pendingTail = "";
    const tagStart = A2UI_TAG_START;
    const tagStartLen = tagStart.length;

    const emitFilteredDelta = async (delta: string) => {
      if (streamSuppressed) return "";
      const combined = pendingTail + delta;
      const tagIndex = combined.indexOf(tagStart);
      if (tagIndex === -1) {
        if (combined.length < tagStartLen) {
          pendingTail = combined;
          return "";
        }
        const safeCut = combined.length - (tagStartLen - 1);
        const visible = combined.slice(0, safeCut);
        pendingTail = combined.slice(safeCut);
        if (visible) {
          await writer.write(textEncoder.encode(JSON.stringify({ token: visible }) + "\n"));
        }
        return visible;
      }
      const visible = combined.slice(0, tagIndex);
      if (visible) {
        await writer.write(textEncoder.encode(JSON.stringify({ token: visible }) + "\n"));
      }
      streamSuppressed = true;
      pendingTail = "";
      return visible;
    };

    (async () => {
      try {
        for await (const event of stream) {
          const typedEvent = event as ResponseStreamEvent;
          if (typedEvent.type === "response.output_text.delta") {
            const delta = typedEvent.delta || "";
            if (delta) {
              deltaCount += 1;
              rawText += delta;
              if (!firstDeltaAt) {
                firstDeltaAt = Date.now();
                console.info("[human-writing][draft] first delta received", { ts: firstDeltaAt });
              }
              const visible = await emitFilteredDelta(delta);
              if (visible) {
                draftText += visible;
              }
            }
          }
        }

        if (!streamSuppressed && pendingTail) {
          await writer.write(textEncoder.encode(JSON.stringify({ token: pendingTail }) + "\n"));
          draftText += pendingTail;
          pendingTail = "";
        }

        const taggedPayload = extractSuggestionPayloadFromText(rawText);
        const hadTag = rawText.includes(A2UI_TAG_START);
        console.info("[human-writing][a2ui] Tag scan", {
          taskId,
          hadTag,
          payloadFound: Boolean(taggedPayload.payload),
          outputLength: rawText.length,
        });
        if (hadTag && !taggedPayload.payload) {
          console.warn("[human-writing][a2ui] Failed to parse tagged payload", { taskId });
        }
        const decision = parseCtaDecision(taggedPayload.payload ?? null);
        if (!decision && taggedPayload.payload) {
          console.warn("[human-writing][a2ui] Payload missing CTA decision", {
            taskId,
            payloadKeys:
              typeof taggedPayload.payload === "object" && taggedPayload.payload
                ? Object.keys(taggedPayload.payload as Record<string, unknown>)
                : [],
          });
        }
        const cleanedDraft = stripSuggestionPayloadFromText(
          taggedPayload.cleanedText,
          taggedPayload.payload,
          taggedPayload.payloadFragment
        );
        const finalDraft = cleanedDraft.trim() ? cleanedDraft : draftText;
        const shouldShowCta = decision?.show ?? false;
        const decisionReason = decision?.reason;
        console.info("[human-writing][a2ui] CTA decision", {
          taskId,
          show: shouldShowCta,
          reason: decisionReason ?? null,
        });

        if (finalDraft.trim()) {
          const { error: insertAssistantError } = await supabase.from("messages").insert([
            {
              user_id: userId,
              conversation_id: conversationId,
              role: "assistant",
              content: finalDraft,
              metadata: { agent: "human-writing", kind: "draft" } as Json,
            },
          ]);
          if (insertAssistantError) {
            console.error("[human-writing][draft] insert assistant message error", insertAssistantError);
            await writer.write(
              textEncoder.encode(JSON.stringify({ error: "save_assistant_message_failed" }) + "\n")
            );
          } else {
            console.info("[human-writing][draft] draft message saved", { conversationId });
            if (shouldShowCta) {
              const ctaCreatedAt = new Date().toISOString();
              const { error: ctaError } = await supabase.from("messages").insert([
                {
                  user_id: userId,
                  conversation_id: conversationId,
                  role: "assistant",
                  content: "Draft ready. Want me to humanize it now? (no detector or loop yet)",
                  metadata: {
                    agent: "human-writing",
                    kind: "cta",
                    draftText: finalDraft,
                    reason: decisionReason,
                    status: "pending",
                    order_ts: ctaCreatedAt,
                  } as Json,
                  created_at: ctaCreatedAt,
                },
              ]);
              if (ctaError) {
                console.warn("[human-writing][draft] failed to insert CTA message", ctaError);
              } else {
                console.info("[human-writing][draft] CTA message saved", { conversationId });
              }
            }
          }
        } else {
          await writer.write(textEncoder.encode(JSON.stringify({ error: "draft_empty" }) + "\n"));
        }

        await writer.write(
          textEncoder.encode(
            JSON.stringify({
              done: true,
              decision: {
                show: shouldShowCta,
                reason: decisionReason,
              },
            }) + "\n"
          )
        );
      } catch (err: any) {
        console.error("[human-writing][draft] stream error", err);
        await writer.write(
          textEncoder.encode(JSON.stringify({ error: err?.message || "draft_failed" }) + "\n")
        );
      } finally {
        console.info("[human-writing][draft] completed", {
          userId,
          taskId,
          conversationId,
          promptChars: prompt.length,
          historyItems: historyItems.length,
          tokensBeforeTrim,
          tokensAfterTrim,
          trimAttempts,
          emittedChars: draftText.length,
          deltaCount,
          firstDeltaMs: firstDeltaAt ? firstDeltaAt - requestStart : null,
        });
        await writer.close();
      }
    })();

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: any) {
    console.error("[human-writing][draft] error:", error);
    return NextResponse.json(
      { error: error?.message || "draft_failed" },
      { status: 500 }
    );
  }
}
