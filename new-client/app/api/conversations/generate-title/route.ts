// app/api/conversations/generate-title/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import {
  isPlaceholderTitle,
  normalizeGeneratedTitle,
} from "@/lib/conversation-utils";
import { calculateCost } from "@/lib/pricing";
import { logUsageRecord } from "@/lib/usage";
import { callDeepInfraLlama } from "@/lib/deepInfraLlama";

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
    const userId = await getCurrentUserIdServer();
    
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

    // Generate title using Cloudflare llama (non-streaming single call)
    console.log(
      `[titleDebug] generating quick title for conversation ${conversationId}`
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const { text, usage } = await callDeepInfraLlama({
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
            enforceJson: false,
            maxTokens: 100,
          });

          const normalizedTitle = normalizeGeneratedTitle(text.trim());

          if (!normalizedTitle) {
            console.warn(
              `[titleDebug] title generation failed or produced invalid result: ${text}`
            );
            controller.enqueue(
              encoder.encode(JSON.stringify({ error: "Title generation failed" }) + "\n")
            );
            controller.close();
            return;
          }

          // Log usage to database
          if (usage) {
            try {
              const inputTokens = usage.input_tokens || 0;
              const outputTokens = usage.output_tokens || 0;
              const cachedTokens = 0;

              const cost = calculateCost(
                "google/gemma-3-4b-it",
                inputTokens,
                cachedTokens,
                outputTokens
              );

              await logUsageRecord({
                userId,
                conversationId,
                model: "google/gemma-3-4b-it",
                inputTokens,
                cachedTokens,
                outputTokens,
                estimatedCost: cost,
              });

              console.log(`[titleDebug] logged usage: $${cost.toFixed(6)}`);
            } catch (usageErr) {
              console.error("[titleDebug] failed to log usage:", usageErr);
            }
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
