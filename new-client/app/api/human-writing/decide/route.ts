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
      return NextResponse.json({ show: true, reason: "missing_openai_api_key_default_true" });
    }

    const client = new OpenAI({ apiKey });

    const tools = [
      {
        type: "function" as const,
        name: "set_humanizer_visibility",
        description:
          "Decide whether to show the humanizer CTA. Call with show=true if the draft should be humanized; false if it is already human-quality.",
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
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You are deciding whether to show a 'Run humanizer' CTA. Call the tool with show=true if the draft reads AI-like or needs humanizing; show=false if it already reads natural/human.",
        },
        { role: "user", content: draft },
      ],
      tools,
      tool_choice: "auto",
      store: false,
    });

    let show = true;
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
      { error: error?.message || "decide_failed", show: true },
      { status: 500 }
    );
  }
}
