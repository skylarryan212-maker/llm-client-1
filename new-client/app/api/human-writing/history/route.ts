"use server";

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId") ?? null;

  return NextResponse.json({
    conversationId: taskId,
    messages: [],
    mock: true,
  });
}

