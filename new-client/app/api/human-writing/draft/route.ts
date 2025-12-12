"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { callDeepInfraLlama } from "@/lib/deepInfraLlama";

type DraftRequestBody = {
  prompt?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

async function decideCTAWithLlama(draft: string) {
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
        "Return JSON {\"show\": boolean, \"reason\": string?}. show=true only if this text is a substantive writing draft (multi-sentence, task-focused). If it's short, a greeting, meta text, or not a draft, set show=false.",
    },
    { role: "user" as const, content: draft },
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
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const encoder = new TextEncoder();

    const history =
      Array.isArray(body.history) && body.history.length
        ? body.history
            .filter((msg) => msg?.role && typeof msg.content === "string")
            .map((msg) => ({ role: msg.role, content: msg.content.trim() }))
        : [];

    const input = [
      {
        role: "system" as const,
        content:
          "You are a concise writing assistant. Write in a natural human tone, avoid heavy formality, and deliver a single clean draft without meta commentary.",
      },
      ...history.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: "user" as const, content: prompt },
    ];

    // No key: stream a demo draft so the client still gets tokens.
    if (!apiKey) {
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
      temperature: 0.7,
      max_output_tokens: 800,
      store: false,
    });

    let aggregatedDraft = "";
    const readable = new ReadableStream({
      async start(controller) {
        const enqueue = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          for await (const event of responseStream) {
            if (event.type === "response.output_text.delta") {
              const delta = (event.delta as string) ?? "";
              if (delta) enqueue({ token: delta });
              aggregatedDraft += delta;
            }
              if (event.type === "response.completed") {
                // If the stream produced no text, fall back to a non-streaming call
                if (!aggregatedDraft.trim()) {
                  try {
                    const fallback = await client.responses.create({
                      model: "gpt-5-nano",
                      input,
                    temperature: 0.7,
                    max_output_tokens: 800,
                    store: false,
                  });
                  const text = fallback.output_text || "";
                  if (text) {
                    aggregatedDraft = text;
                    enqueue({ token: text });
                  } else {
                    // Try again with prompt only (no history) as a secondary fallback
                    const promptOnly = await client.responses.create({
                      model: "gpt-5-nano",
                      input: input.slice(-2), // system + latest user
                      temperature: 0.7,
                      max_output_tokens: 800,
                      store: false,
                    });
                    const text2 = promptOnly.output_text || "";
                    if (text2) {
                      aggregatedDraft = text2;
                      enqueue({ token: text2 });
                    }
                  }
                } catch (err: any) {
                  enqueue({ error: err?.message || "draft_fallback_error" });
                }
              }

              // If still empty, emit an error and stop
              if (!aggregatedDraft.trim()) {
                enqueue({ error: "draft_empty" });
                enqueue({ decision: { show: false, reason: "draft_empty" } });
                enqueue({ done: true });
                return;
              }

              // After streaming completes, decide CTA using llama
              const decision = await decideCTAWithLlama(aggregatedDraft);
              enqueue({ decision });
              enqueue({ done: true });
            }
          }
        } catch (err: any) {
          enqueue({ error: err?.message || "draft_stream_error" });
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
