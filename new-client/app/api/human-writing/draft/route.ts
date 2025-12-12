"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

type DraftRequestBody = {
  prompt?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DraftRequestBody;
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Fallback for local testing without an API key.
      const demoDraft = `Draft (demo, no OPENAI_API_KEY set):\n\n${prompt}`;
      return NextResponse.json({
        draft: demoDraft,
        model: "demo-no-api-key",
      });
    }

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 800,
      messages: [
        {
          role: "system",
          content:
            "You are a concise writing assistant. Write in a natural human tone, avoid heavy formality, and deliver a single clean draft without meta commentary.",
        },
        { role: "user", content: prompt },
      ],
    });

    const draft = completion.choices[0]?.message?.content?.trim();
    if (!draft) {
      throw new Error("No draft returned from model");
    }

    return NextResponse.json({
      draft,
      model: completion.model || "gpt-4o-mini",
    });
  } catch (error: any) {
    console.error("[human-writing][draft] error:", error);
    return NextResponse.json(
      { error: error?.message || "draft_failed" },
      { status: 500 }
    );
  }
}
