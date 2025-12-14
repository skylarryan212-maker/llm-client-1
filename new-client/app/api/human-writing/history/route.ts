"use server";

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("taskId") ?? null;
  const taskId = raw && raw !== "unknown" ? raw : null;

  return NextResponse.json({
    conversationId: taskId,
    messages: [],
    mock: true,
  });
}
