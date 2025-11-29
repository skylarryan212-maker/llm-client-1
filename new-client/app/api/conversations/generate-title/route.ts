// app/api/conversations/generate-title/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import {
  isPlaceholderTitle,
  normalizeGeneratedTitle,
} from "@/lib/conversation-utils";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { conversationId, userMessage } = await req.json();

    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 }
      );
    }

    if (!userMessage || typeof userMessage !== "string") {
      return NextResponse.json(
        { error: "userMessage is required" },
        { status: 400 }
      );
    }

    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;
    const userId = await getCurrentUserId();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: conversation, error: convError } = await supabaseAny
      .from("conversations")
      .select("id, title, user_id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Check if title is still a placeholder
    if (!isPlaceholderTitle(conversation.title)) {
      return NextResponse.json(
        { message: "Title already set", title: conversation.title },
        { status: 200 }
      );
    }

    // Generate title using GPT 5 Nano with streaming
    console.log(
      `[titleDebug] generating quick title for conversation ${conversationId}`
    );

    const stream = await openai.chat.completions.create({
      model: "gpt-5-nano-2025-08-07",
      messages: [
        {
          role: "system",
          content:
            "You create short chat titles (3-8 words) from a single user prompt. Avoid punctuation, emojis, and filler words. Respond with the title only.",
        },
        {
          role: "user",
          content: `User message:\n${userMessage}\n\nTitle:`,
        },
      ],
      stream: true,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        let fullTitle = "";
        
        try {
          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content || "";
            if (token) {
              fullTitle += token;
              // Send each token as it arrives
              controller.enqueue(
                encoder.encode(JSON.stringify({ token, fullTitle }) + "\n")
              );
            }
          }

          const normalizedTitle = normalizeGeneratedTitle(fullTitle.trim());

          if (!normalizedTitle) {
            console.warn(
              `[titleDebug] title generation failed or produced invalid result: ${fullTitle}`
            );
            controller.enqueue(
              encoder.encode(JSON.stringify({ error: "Title generation failed" }) + "\n")
            );
            controller.close();
            return;
          }

          // Update conversation title in database
          const { error: updateError } = await supabaseAny
            .from("conversations")
            .update({ title: normalizedTitle })
            .eq("id", conversationId)
            .eq("user_id", userId);

          if (updateError) {
            console.error(`[titleDebug] failed to update title:`, updateError);
            controller.enqueue(
              encoder.encode(JSON.stringify({ error: "Failed to update title" }) + "\n")
            );
          } else {
            console.log(
              `[titleDebug] successfully updated conversation ${conversationId} with title: ${normalizedTitle}`
            );
            controller.enqueue(
              encoder.encode(JSON.stringify({ done: true, title: normalizedTitle }) + "\n")
            );
          }
        } catch (error) {
          console.error("Streaming error:", error);
          controller.enqueue(
            encoder.encode(JSON.stringify({ error: "Streaming failed" }) + "\n")
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Generate title error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
