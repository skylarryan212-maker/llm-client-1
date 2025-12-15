"use server";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServerAdmin } from "@/lib/supabase/server";
import {
  ensureGuestSession,
  incrementGuestSessionRequest,
  attachGuestCookie,
  shouldResetDailyCounter,
  GUEST_PROMPT_LIMIT_PER_DAY,
} from "@/lib/guest-session";
import type { Tool } from "openai/resources/responses/responses";

export async function POST(request: NextRequest) {
  type GuestChatRequest = {
    message: string;
    model?: string;
    previousResponseId?: string;
    history?: { role: "user" | "assistant"; content: string }[];
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
    const supabase = await supabaseServerAdmin();
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
    const previousResponseId = body.previousResponseId;

    console.log("[guest-chat] Using model:", model);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[guest-chat] Missing OPENAI_API_KEY");
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    console.log("[guest-chat] Creating OpenAI stream");
    const client = new OpenAI({ apiKey });
    const historyInput =
      Array.isArray(body.history) && body.history.length
        ? body.history.filter(
            (item) =>
              item &&
              typeof item === "object" &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string"
          )
        : [];

    // Allow the same built-in tools as authenticated users (web search + file search).
    const tools: Tool[] = [
      { type: "web_search" as any },
      { type: "file_search" as any },
    ];

    const stream = (await client.responses.create({
      model,
      stream: true,
      store: true,
      previous_response_id: previousResponseId,
      instructions:
        "You are a helpful AI assistant. The user is in guest mode; keep answers concise and do not include links.",
      input: [
        ...historyInput,
        { role: "user", content: message },
      ],
      tools,
      tool_choice: "auto",
    } as any)) as any;

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const enqueue = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          console.log("[guest-chat] Starting to stream chunks");
          let responseId: string | undefined;
          let emittedToken = false;
          // Responses SDK stream supports async iteration at runtime; cast to keep TS happy.
          const asyncStream = stream as unknown as AsyncIterable<any>;
          for await (const event of asyncStream) {
            // Capture response id for chaining
            const maybeId = (event as any)?.response?.id ?? (event as any)?.id;
            if (maybeId && !responseId) {
              responseId = maybeId as string;
              enqueue({ response_id: responseId });
            }

            // Stream text deltas
            if ((event as any)?.type === "response.output_text.delta" && (event as any)?.delta) {
              emittedToken = true;
              enqueue({ token: (event as any).delta });
            }

            // Fallback: if completed and we never emitted tokens, send the full text
            if (
              (event as any)?.type === "response.completed" &&
              !emittedToken &&
              (event as any)?.response?.output_text
            ) {
              emittedToken = true;
              enqueue({ token: (event as any).response.output_text });
            }

            if ((event as any)?.type === "response.completed") {
              enqueue({ done: true });
              console.log("[guest-chat] Stream completed successfully");
              return;
            }

            if ((event as any)?.type === "response.error" && (event as any)?.error?.message) {
              enqueue({ error: (event as any).error.message });
            }
          }
          enqueue({ done: true });
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
