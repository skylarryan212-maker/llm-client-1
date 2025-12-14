"use server";

import { NextRequest, NextResponse } from "next/server";

type DraftRequestBody = {
  prompt?: string;
  taskId?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as DraftRequestBody;
  const prompt = body.prompt?.trim() || "";
  const taskId = body.taskId?.trim() || `hw-${Date.now()}`;

  const encoder = new TextEncoder();
  const draftText =
    prompt.length > 0
      ? `Mock draft for "${prompt}" (task ${taskId}). This is placeholder text only.`
      : `Mock draft (no prompt provided) for task ${taskId}.`;

  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ token: draftText }) + "\n"));
      controller.enqueue(
        encoder.encode(
          JSON.stringify({ decision: { show: true, reason: "mock", taskId }, taskId }) + "\n"
        )
      );
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

