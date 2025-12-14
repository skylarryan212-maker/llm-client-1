"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import { encoding_for_model } from "tiktoken";

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

    let inputItems = historyItems;

    const MAX_TOKENS = 400_000;
    const encoder = encoding_for_model("gpt-4o-mini"); // closest available for GPT-5 Nano tokenization
    const countTokens = (items: typeof historyItems) => {
      const tokens = items.reduce((sum, item) => {
        const content = item.content ?? "";
        const rolePrefix = item.role === "assistant" ? "assistant: " : "user: ";
        const encoded = encoder.encode(rolePrefix + content);
        return sum + encoded.length;
      }, 0);
      return tokens;
    };

    try {
      let tokens = await countTokens(inputItems);
      if (tokens > MAX_TOKENS) {
        // Attempt compaction first to preserve latent context
        try {
          const compacted = await client.responses.compact({
            model: "gpt-5-nano",
            input: inputItems,
            instructions: SYSTEM_PROMPT,
          });
          const compactedInput =
            (compacted.output ?? []).map(({ id, ...rest }) => rest as any) ?? [];
          tokens = await countTokens(compactedInput);
          inputItems = compactedInput;
        } catch (err) {
          console.warn("[human-writing][compact] failed, falling back to trim", err);
          // keep inputItems as is; will trim below
        }
      }

      // Hard trim from the oldest until under budget using real token counts
      let attempts = 0;
      while (tokens > MAX_TOKENS && inputItems.length > 1 && attempts < 50) {
        inputItems = inputItems.slice(1);
        tokens = await countTokens(inputItems);
        attempts += 1;
      }
    } catch (err) {
      console.warn("[human-writing][tokens] counting failed, proceeding without trim", err);
    } finally {
      try {
        encoder.free();
      } catch {
        // ignore
      }
    }

    const client = new OpenAI({ apiKey });

    const stream = await client.responses.create({
      model: "gpt-5-nano",
      stream: true,
      store: true,
      instructions: SYSTEM_PROMPT,
      input: inputItems,
    });

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let draftText = "";

    (async () => {
      try {
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            const delta = event.delta || "";
            if (delta) {
              draftText += delta;
              await writer.write(encoder.encode(JSON.stringify({ token: delta }) + "\n"));
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
              encoder.encode(JSON.stringify({ error: "save_assistant_message_failed" }) + "\n")
            );
          }
        } else {
          await writer.write(encoder.encode(JSON.stringify({ error: "draft_empty" }) + "\n"));
        }

        await writer.write(encoder.encode(JSON.stringify({ done: true, decision: { show: true } }) + "\n"));
      } catch (err: any) {
        console.error("[human-writing][draft] stream error", err);
        await writer.write(
          encoder.encode(JSON.stringify({ error: err?.message || "draft_failed" }) + "\n")
        );
      } finally {
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
