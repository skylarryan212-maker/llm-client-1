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

    // Generate title using GPT 5 Nano
    console.log(
      `[titleDebug] generating quick title for conversation ${conversationId}`
    );

    const response = await openai.responses.create({
      model: "gpt-5-nano-2025-08-07",
      input: [
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
      reasoning: {
        effort: "low",
      },
    });

    const rawTitle = response.output_text?.trim() || null;
    const normalizedTitle = normalizeGeneratedTitle(rawTitle);

    if (!normalizedTitle) {
      console.warn(
        `[titleDebug] title generation failed or produced invalid result: ${rawTitle}`
      );
      return NextResponse.json(
        { error: "Title generation failed" },
        { status: 500 }
      );
    }

    // Update conversation title
    const { error: updateError } = await supabaseAny
      .from("conversations")
      .update({ title: normalizedTitle })
      .eq("id", conversationId)
      .eq("user_id", userId);

    if (updateError) {
      console.error(`[titleDebug] failed to update title:`, updateError);
      return NextResponse.json(
        { error: "Failed to update title" },
        { status: 500 }
      );
    }

    console.log(
      `[titleDebug] successfully updated conversation ${conversationId} with title: ${normalizedTitle}`
    );

    return NextResponse.json({ title: normalizedTitle }, { status: 200 });
  } catch (error) {
    console.error("Generate title error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
