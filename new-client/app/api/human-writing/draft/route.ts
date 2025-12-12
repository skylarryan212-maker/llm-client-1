"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

type DraftRequestBody = {
  prompt?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

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

    const readable = new ReadableStream({
      async start(controller) {
        const enqueue = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          for await (const event of responseStream) {
            if (event.type === "response.output_text.delta") {
              const delta = (event.delta as string) ?? "";
              if (delta) enqueue({ token: delta });
            }
            if (event.type === "response.completed") {
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
