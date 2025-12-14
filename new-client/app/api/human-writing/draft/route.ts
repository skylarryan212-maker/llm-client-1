"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { callDeepInfraLlama } from "@/lib/deepInfraLlama";
import { requireUserIdServer } from "@/lib/supabase/user";
import { supabaseServer } from "@/lib/supabase/server";

type DraftRequestBody = {
  prompt?: string;
  taskId?: string;
};

async function decideCTAWithLlama(draft: string, userPrompt: string) {
  const schema = {
    type: "object",
    properties: {
      show: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["show"],
    additionalProperties: false,
  };

  const prompt = [
    {
      role: "system" as const,
      content:
        "Return JSON {\"show\": boolean, \"reason\": string?}. Decide whether to show a 'Run humanizer now?' CTA. Be conservative: default to show=false unless the assistant text is clearly a substantive writing draft that fulfills the user's request (e.g., an essay, email, post, summary, etc.). Set show=false for greetings, brief replies, menus, clarifying questions, meta commentary about what you can do, or anything that is not the actual draft.",
    },
    {
      role: "user" as const,
      content: `User request: ${userPrompt || "(none)"}\n\nAssistant text:\n${draft}`,
    },
  ];

  try {
    const { text } = await callDeepInfraLlama({
      messages: prompt,
      schemaName: "HumanizerDecision",
      schema,
      enforceJson: true,
      maxTokens: 120,
    });
    const parsed = JSON.parse(text || "{}");
    const show = typeof parsed.show === "boolean" ? parsed.show : false;
    const reason = typeof parsed.reason === "string" ? parsed.reason : undefined;
    return { show, reason };
  } catch (err: any) {
    return { show: false, reason: err?.message || "decision_failed" };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DraftRequestBody;
    const prompt = body.prompt?.trim();
    const taskId = body.taskId?.trim() || `hw-${Date.now()}`;

    if (!prompt) {
      console.error("[human-writing][draft] missing prompt");
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    // taskId is generated if missing; returned in stream metadata for transparency.

    const supabase = await supabaseServer();
    let userId: string;
    try {
      userId = await requireUserIdServer();
      console.log("[human-writing][draft] user", userId, "task", taskId, "promptChars", prompt.length);
    } catch {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Ensure a dedicated conversation exists for this human-writing task.
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
      const title = prompt.slice(0, 120);
      const { data: created, error: createError } = await supabase
        .from("conversations")
        .insert([
          {
            user_id: userId,
            title: title || "Human Writing",
            project_id: null,
            metadata: { task_id: taskId, agent: "human-writing" },
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

    // Persist the user's prompt immediately so it always shows up in Supabase.
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

    const apiKey = process.env.OPENAI_API_KEY;
    const encoder = new TextEncoder();

    // Load full conversation history for simple context injection.
    const { data: history, error: historyError } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (historyError) {
      console.error("[human-writing][draft] history load error", historyError);
      return NextResponse.json({ error: "history_load_failed" }, { status: 500 });
    }

    const input = [
      {
        role: "system" as const,
        content:
          "You are a writing assistant. Follow the user's request precisely (including word count/format/tone). Return only the draft itself—no meta commentary, no preface, no follow-up questions unless explicitly asked.",
      },
      ...(history ?? []).map((m) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
        content: m.content ?? "",
      })),
    ];

    // No key: stream a demo draft so the client still gets tokens.
    if (!apiKey) {
      console.error("[human-writing][draft] Missing OPENAI_API_KEY");
      const demoDraft = `Draft (demo, no OPENAI_API_KEY set):\n\n${prompt}`;
      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify({ token: demoDraft }) + "\n"));
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                decision: { show: true, reason: "demo" },
                conversationId,
              }) + "\n"
            )
          );
          controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + "\n"));
          controller.close();
        },
      });

      return new NextResponse(readable, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache",
        },
      });
    }

    const client = new OpenAI({ apiKey });
    const responseStream = await client.responses.stream({
      model: "gpt-5-nano",
      input,
      max_output_tokens: 2400,
      store: false,
    });

    let aggregatedDraft = "";
    const eventTypeCounts: Record<string, number> = {};
    let openaiResponseId: string | null = null;

    const readable = new ReadableStream({
      async start(controller) {
        const enqueue = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

        try {
          for await (const event of responseStream) {
            eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;

            if (event.type === "response.output_text.delta") {
              const delta = (event.delta as string) ?? "";
              if (delta) {
                enqueue({ token: delta });
                aggregatedDraft += delta;
              }
            }
          }

          let finalText = "";
          let finalResponseId: string | null = null;
          try {
            const finalResponse = await responseStream.finalResponse();
            finalText = (finalResponse as any)?.output_text ?? "";
            finalResponseId = (finalResponse as any)?.id ?? null;
          } catch (err: any) {
            console.error("[human-writing][draft] finalResponse() failed:", err);
          }
          openaiResponseId = finalResponseId;

          if (!aggregatedDraft.trim() && finalText.trim()) {
            aggregatedDraft = finalText;
            enqueue({ token: finalText });
          }

          console.log("[human-writing][draft] completed", {
            promptChars: prompt.length,
            aggregatedChars: aggregatedDraft.length,
            finalChars: finalText.length,
            eventTypes: eventTypeCounts,
          });

          if (!aggregatedDraft.trim()) {
            console.error("[human-writing][draft] draft_empty", {
              eventTypes: eventTypeCounts,
              finalChars: finalText.length,
            });
            enqueue({ error: "draft_empty" });
            enqueue({ debug: { eventTypes: eventTypeCounts, finalChars: finalText.length } });
            enqueue({ decision: { show: false, reason: "draft_empty" } });
            enqueue({ done: true });
            return;
          }

          try {
            const decision = await decideCTAWithLlama(aggregatedDraft, prompt);
            enqueue({ decision, conversationId, openaiResponseId });
          } catch (err: any) {
            console.error("[human-writing][draft][decision] error:", err);
            enqueue({ decision: { show: false, reason: err?.message || "decision_failed" } });
          }

          // Persist assistant draft after successful generation.
          const { error: insertAssistantError } = await supabase.from("messages").insert([
            {
              user_id: userId,
              conversation_id: conversationId,
              role: "assistant",
              content: aggregatedDraft,
              openai_response_id: openaiResponseId,
              metadata: { agent: "human-writing", kind: "draft" },
            },
          ]);
          if (insertAssistantError) {
            console.error("[human-writing][draft] insert assistant message error", insertAssistantError);
          }

          enqueue({ done: true });
        } catch (err: any) {
          console.error("[human-writing][draft][stream] error:", err);
          enqueue({ error: err?.message || "draft_stream_error" });
          enqueue({ decision: { show: false, reason: err?.message || "draft_stream_error" } });
          enqueue({ done: true });
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
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
