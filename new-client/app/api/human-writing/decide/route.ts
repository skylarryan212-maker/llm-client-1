"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

type DecideRequest = {
  draft?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DecideRequest;
    const draft = body.draft?.trim();

    if (!draft) {
      return NextResponse.json({ error: "draft is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ show: false, reason: "missing_openai_api_key_default_false" });
    }

    const client = new OpenAI({ apiKey });

    const tools = [
      {
        type: "function" as const,
        name: "set_humanizer_visibility",
        description:
          "Decide whether to show the humanizer CTA. Set show=true only when the text is an essay: multi-sentence, paragraph-style, task-focused writing (not bullets/outline). If it's short, a greeting, meta reply, bullet list, placeholder, or otherwise not an essay, set show=false.",
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
            [
              "You gate the 'Run humanizer' CTA.",
              "Set show=true only when the text is an essay: multi-sentence, paragraph-form, task-focused writing that answers the user's ask.",
              "Always set show=false for greetings, meta/status replies, placeholders, instructions to the model, outlines, bullet lists, fragments, or anything that is not essay-style prose.",
              "If it clearly is an essay, respond with show=true; otherwise show=false.",
            ].join(" "),
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
          // ignore parse errors, keep defaults
        }
      }
    }

    return NextResponse.json({ show, reason });
  } catch (error: any) {
    console.error("[human-writing][decide] error:", error);
    return NextResponse.json(
      { error: error?.message || "decide_failed", show: false },
      { status: 500 }
    );
  }
}
