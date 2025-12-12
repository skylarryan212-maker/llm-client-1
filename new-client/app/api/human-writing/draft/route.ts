"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

type DraftRequestBody = {
  prompt?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

async function decideCTA(draft: string, apiKey: string) {
  const client = new OpenAI({ apiKey });
  const tools = [
    {
      type: "function" as const,
      name: "set_humanizer_visibility",
      description:
        "Decide whether to show the humanizer CTA. Only set show=true if this text is a real draft (multi-sentence, task-focused writing). If it's a greeting, meta reply, or placeholder, set show=false.",
      parameters: {
        type: "object",
        properties: {
          show: { type: "boolean", description: "Show the humanizer CTA." },
          reason: { type: "string", description: "Short reason for the decision." },
        },
        required: ["show"],
        additionalProperties: false,
      },
      strict: true,
    },
  ];

  const response = await client.responses.create({
    model: "gpt-5-nano",
    input: [
      {
        role: "system",
        content:
          "You decide if a 'Run humanizer' CTA should appear. Only set show=true if the text is a substantive writing draft (e.g., paragraphs/sentences answering a task). If it's short, a greeting, meta text, or not a draft, set show=false.",
      },
      { role: "user", content: draft },
    ],
    tools,
    tool_choice: { type: "function", name: "set_humanizer_visibility" },
    store: false,
  });

  let show = false;
  let reason: string | undefined;

  for (const item of response.output ?? []) {
    if (item.type === "function_call" && item.name === "set_humanizer_visibility") {
      try {
        const args = JSON.parse(item.arguments || "{}");
        if (typeof args.show === "boolean") show = args.show;
        if (typeof args.reason === "string") reason = args.reason;
      } catch {
        // ignore
      }
    }
  }

  return { show, reason };
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
              // After streaming completes, decide CTA
              try {
                const decision = await decideCTA(aggregatedDraft, apiKey);
                enqueue({ decision });
              } catch (err: any) {
                enqueue({ decision: { show: false, reason: err?.message || "decision_failed" } });
              }
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
