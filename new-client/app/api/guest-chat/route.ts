"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase/server";
import {
  ensureGuestSession,
  incrementGuestSessionRequest,
  attachGuestCookie,
  shouldResetDailyCounter,
  GUEST_PROMPT_LIMIT_PER_DAY,
} from "@/lib/guest-session";

export async function POST(request: NextRequest) {
  type GuestChatRequest = {
    message: string;
    model?: string;
  };

  try {
    console.log("[guest-chat] Received request");
    const body = (await request.json()) as GuestChatRequest;
    const message = body.message?.trim();
    if (!message) {
      console.log("[guest-chat] No message provided");
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    console.log("[guest-chat] Message:", message.substring(0, 50));
    const supabase = await supabaseServer();
    const { session, cookieValue } = await ensureGuestSession(request, supabase);
    let requestCount = session.request_count ?? 0;
    if (shouldResetDailyCounter(session)) {
      requestCount = 0;
    }
    if (requestCount >= GUEST_PROMPT_LIMIT_PER_DAY) {
      const limitResponse = NextResponse.json(
        {
          error: "Guest limit reached",
          message: `Guests can send ${GUEST_PROMPT_LIMIT_PER_DAY} prompts per day. Please sign in or wait until tomorrow.`,
        },
        { status: 429 }
      );
      attachGuestCookie(limitResponse, cookieValue);
      return limitResponse;
    }

    await incrementGuestSessionRequest(supabase, session.id, requestCount + 1);

    const model =
      !body.model || body.model.toLowerCase() === "auto" ? "gpt-4o-mini" : body.model;

    console.log("[guest-chat] Using model:", model);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[guest-chat] Missing OPENAI_API_KEY");
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    console.log("[guest-chat] Creating OpenAI stream");
    const client = new OpenAI({ apiKey });
    const stream = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful AI assistant. The user is in guest mode; keep answers concise and do not include links.",
        },
        { role: "user", content: message },
      ],
      stream: true,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const enqueue = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          console.log("[guest-chat] Starting to stream chunks");
          for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) enqueue({ token: delta });
          }
          enqueue({ done: true });
          console.log("[guest-chat] Stream completed successfully");
        } catch (err: any) {
          console.error("[guest-chat] Stream error:", err);
          enqueue({ error: err?.message || "guest_chat_error" });
        } finally {
          controller.close();
        }
      },
    });

    const response = new NextResponse(readable, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
    attachGuestCookie(response, cookieValue);
    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "guest_chat_internal_error" },
      { status: 500 }
    );
  }
}
