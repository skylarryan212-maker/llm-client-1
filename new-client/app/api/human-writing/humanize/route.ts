"use server";

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    model?: string;
    language?: string;
    taskId?: string;
  };

  const text = body.text?.trim() || "";
  const output = text
    ? `Mock humanized: ${text}`
    : "Mock humanized output (no text provided).";

  return NextResponse.json({
    output,
    flesch: 70,
    raw: { mock: true, model: body.model || "undetectable", language: body.language || "auto" },
  });
}

