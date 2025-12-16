"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import { encodingForModel } from "js-tiktoken";

type DraftRequestBody = {
  prompt?: string;
  taskId?: string;
};

const SYSTEM_PROMPT = [
  "You are a concise human writing assistant.",
  "Write directly to the user's request with clear, natural language.",
  "Do not talk about being an AI. Do not add meta comments.",
  "Keep it focused, readable, and practical.",
].join(" ");

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
    const historyItems =
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

    let inputItems: Array<{ role: string; content: any }> = historyItems;

    const client = new OpenAI({ apiKey });

    const MAX_TOKENS = 400_000;
    const tokenEncoder = encodingForModel("gpt-4o-mini"); // closest available for GPT-5 Nano tokenization
    const countTokens = (items: Array<{ role: string; content: any }>) => {
      const tokens = items.reduce((sum, item) => {
        const text = typeof item.content === "string" ? item.content : "";
        const rolePrefix = item.role === "assistant" ? "assistant: " : "user: ";
        const encoded = tokenEncoder.encode(rolePrefix + text);
        return sum + encoded.length;
      }, 0);
      return tokens;
    };

    let tokensBeforeTrim = 0;
    let tokensAfterTrim = 0;
    let trimAttempts = 0;
    let compactApplied = false;

    try {
      tokensBeforeTrim = countTokens(inputItems);

      if (tokensBeforeTrim > MAX_TOKENS) {
        // Attempt compaction via raw fetch (SDK typing doesn't expose compact)
        try {
          const compactRes = await fetch("https://api.openai.com/v1/responses/compact", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-5-nano",
              input: inputItems.map((i) => ({ role: i.role, content: i.content })),
              instructions: SYSTEM_PROMPT,
            }),
          });
          if (compactRes.ok) {
            const compactJson = await compactRes.json();
            if (Array.isArray(compactJson?.output) && compactJson.output.length) {
              inputItems = compactJson.output as any;
              compactApplied = true;
            }
          } else {
            console.warn("[human-writing][compact] non-200", await compactRes.text());
          }
        } catch (err) {
          console.warn("[human-writing][compact] fetch failed", err);
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

    const stream = await client.responses.create({
      model: "gpt-5-nano",
      stream: true,
      store: true,
      instructions: SYSTEM_PROMPT,
      input: requestInput as any,
    });

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const textEncoder = new TextEncoder();
    let draftText = "";
    let deltaCount = 0;
    let firstDeltaAt: number | null = null;

    (async () => {
      try {
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            const delta = event.delta || "";
            if (delta) {
              deltaCount += 1;
              draftText += delta;
              if (!firstDeltaAt) {
                firstDeltaAt = Date.now();
                console.info("[human-writing][draft] first delta received", { ts: firstDeltaAt });
              }
              await writer.write(textEncoder.encode(JSON.stringify({ token: delta }) + "\n"));
            }
          }
        }

        if (draftText.trim()) {
          const { error: insertAssistantError } = await supabase.from("messages").insert([
            {
              user_id: userId,
              conversation_id: conversationId,
              role: "assistant",
              content: draftText,
              metadata: { agent: "human-writing", kind: "draft" },
            },
          ]);
          if (insertAssistantError) {
            console.error("[human-writing][draft] insert assistant message error", insertAssistantError);
            await writer.write(
              textEncoder.encode(JSON.stringify({ error: "save_assistant_message_failed" }) + "\n")
            );
          } else {
            console.info("[human-writing][draft] draft message saved", { conversationId });
          }
        } else {
          await writer.write(textEncoder.encode(JSON.stringify({ error: "draft_empty" }) + "\n"));
        }

        await writer.write(
          textEncoder.encode(JSON.stringify({ done: true, decision: { show: false } }) + "\n")
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
