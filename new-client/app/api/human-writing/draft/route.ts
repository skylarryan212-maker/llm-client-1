"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { callDeepInfraLlama } from "@/lib/deepInfraLlama";
import { requireUserIdServer } from "@/lib/supabase/user";

type DraftRequestBody = {
  prompt?: string;
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

    if (!prompt) {
      console.error("[human-writing][draft] missing prompt");
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    try {
      const userId = await requireUserIdServer();
      console.log("[human-writing][draft] user", userId, "promptChars", prompt.length);
    } catch (err) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const encoder = new TextEncoder();

    const input = [
      {
        role: "system" as const,
        content:
          "You are a concise writing assistant. Write in a natural human tone, avoid heavy formality, and deliver a single clean draft without meta commentary.",
      },
      { role: "user" as const, content: prompt },
    ];

    // No key: stream a demo draft so the client still gets tokens.
    if (!apiKey) {
      console.error("[human-writing][draft] Missing OPENAI_API_KEY");
      const demoDraft = `Draft (demo, no OPENAI_API_KEY set):\n\n${prompt}`;
      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify({ token: demoDraft }) + "\n"));
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
      max_output_tokens: 800,
      store: false,
    });

    let aggregatedDraft = "";
    const eventTypeCounts: Record<string, number> = {};

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
          try {
            const finalResponse = await responseStream.finalResponse();
            finalText = (finalResponse as any)?.output_text ?? "";
          } catch (err: any) {
            console.error("[human-writing][draft] finalResponse() failed:", err);
          }

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
            enqueue({ error: "draft_empty" });
            enqueue({ decision: { show: false, reason: "draft_empty" } });
            enqueue({ done: true });
            return;
          }

          try {
            const decision = await decideCTAWithLlama(aggregatedDraft, prompt);
            enqueue({ decision });
          } catch (err: any) {
            console.error("[human-writing][draft][decision] error:", err);
            enqueue({ decision: { show: false, reason: err?.message || "decision_failed" } });
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
