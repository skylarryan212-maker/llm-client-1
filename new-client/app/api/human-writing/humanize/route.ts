"use server";

import { NextRequest, NextResponse } from "next/server";
import { requireUserIdServer } from "@/lib/supabase/user";

const HUMANIZER_URL = "https://v2-humanizer.rephrasy.ai/api";

type HumanizeRequestBody = {
  text?: string;
  model?: string;
  language?: string;
  words?: boolean;
  costs?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    try {
      await requireUserIdServer();
    } catch {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as HumanizeRequestBody;
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const apiKey = process.env.REPHRASY_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing REPHRASY_API_KEY" },
        { status: 500 }
      );
    }

    const payload: Record<string, unknown> = {
      text,
      model: body.model?.trim() || "undetectable",
    };

    if (body.language && body.language !== "auto") {
      payload.language = body.language;
    }
    if (body.words) {
      payload.words = true;
    }
    if (body.costs) {
      payload.costs = true;
    }

    const response = await fetch(HUMANIZER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMessage =
        data?.error || data?.message || "humanizer_request_failed";
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    return NextResponse.json({
      output: data.output,
      flesch: data.new_flesch_score,
      raw: data,
    });
  } catch (error: any) {
    console.error("[human-writing][humanize] error:", error);
    return NextResponse.json(
      { error: error?.message || "humanize_failed" },
      { status: 500 }
    );
  }
}
