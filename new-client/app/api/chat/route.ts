export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import { getModelAndReasoningConfig } from "@/lib/modelConfig";
import type {
  ModelFamily,
  ReasoningEffort,
  SpeedMode,
} from "@/lib/modelConfig";
import { normalizeModelFamily, normalizeSpeedMode } from "@/lib/modelConfig";
import type { Database, MessageInsert } from "@/lib/supabase/types";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
type OpenAIClient = any;

interface ChatRequestBody {
  conversationId: string;
  projectId?: string;
  message: string;
  modelFamilyOverride?: ModelFamily;
  speedModeOverride?: SpeedMode;
  reasoningEffortOverride?: ReasoningEffort;
  skipUserInsert?: boolean;
}

interface StreamToken {
  token: string;
}

interface StreamMeta {
  meta: {
    assistantMessageRowId: string;
    userMessageRowId?: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    resolvedFamily?: string;
    speedModeUsed?: string;
  };
}

interface StreamDone {
  done: true;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const { conversationId, projectId, message, modelFamilyOverride, speedModeOverride, reasoningEffortOverride, skipUserInsert } = body;

    // Validate and normalize model settings
    const modelFamily = normalizeModelFamily(modelFamilyOverride ?? "auto");
    const speedMode = normalizeSpeedMode(speedModeOverride ?? "auto");
    const reasoningEffortHint = reasoningEffortOverride;

    if (!conversationId || !message?.trim()) {
      return NextResponse.json(
        { error: "conversationId and message are required" },
        { status: 400 }
      );
    }

    const userId = getCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }

    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;

    // Validate conversation exists and belongs to current user
    const { data: conversation, error: convError } = await supabaseAny
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (convError || !conversation) {
      console.error("Conversation validation error:", convError);
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Validate projectId if provided
    if (projectId && conversation.project_id !== projectId) {
      return NextResponse.json(
        { error: "Project ID mismatch" },
        { status: 400 }
      );
    }

    // Load recent messages for context (up to 50)
    const { data: recentMessages, error: messagesError } = await supabaseAny
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(50);

    if (messagesError) {
      console.error("Failed to load messages:", messagesError);
      return NextResponse.json(
        { error: "Failed to load conversation history" },
        { status: 500 }
      );
    }

    // Optionally insert the user message unless the client indicates it's already persisted (e.g., first send via server action, or retry)
    let userMessageRow: MessageRow | null = null;
    if (!skipUserInsert) {
      const insertResult = await supabaseAny
        .from("messages")
        .insert({
          user_id: userId,
          conversation_id: conversationId,
          role: "user",
          content: message,
          metadata: {},
        })
        .select()
        .single();

      if (insertResult.error || !insertResult.data) {
        console.error("Failed to insert user message:", insertResult.error);
        return NextResponse.json(
          { error: "Failed to save user message" },
          { status: 500 }
        );
      }
      userMessageRow = insertResult.data as MessageRow;
    }

    // Get model config with optional reasoning effort override
    const modelConfig = getModelAndReasoningConfig(modelFamily, speedMode, message, reasoningEffortHint);
    const reasoningEffort = modelConfig.reasoning?.effort ?? "none";

    // Build message history for API call
    const systemPrompt =
      "You are a helpful, accurate, and thoughtful AI assistant. Provide clear, concise, and well-structured responses.";

    const messagesForAPI = [
      ...(recentMessages || []).map((msg: any) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      {
        role: "user" as const,
        content: message,
      },
    ];

    // Initialize OpenAI client - use dynamic import to avoid hard dependency at build time
    let openai: OpenAIClient;
    
    // Debug: Check if API key is set
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set in environment");
      return NextResponse.json(
        {
          error: "OpenAI API key not configured",
          details: "OPENAI_API_KEY environment variable is missing",
        },
        { status: 500 }
      );
    }
    
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const OpenAIModule = require("openai");
      const OpenAIClass = OpenAIModule.default || OpenAIModule;
      openai = new OpenAIClass({
        apiKey: process.env.OPENAI_API_KEY,
      });
      console.log("OpenAI client initialized successfully");
    } catch (importError) {
      console.error(
        "OpenAI SDK not installed. Please run: npm install openai",
        importError
      );
      return NextResponse.json(
        {
          error:
            "OpenAI SDK not configured. Please install the openai package and set OPENAI_API_KEY.",
        },
        { status: 500 }
      );
    }

    // Call OpenAI Responses API with streaming
    const stream = await openai.responses.stream({
      model: modelConfig.model,
      input: [
        {
          role: "system",
          content: systemPrompt,
          type: "message",
        },
        ...messagesForAPI.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          type: "message",
        })),
      ],
      stream: true,
      ...(modelConfig.reasoning && { reasoning: modelConfig.reasoning }),
    });
    console.log("OpenAI stream started for model:", modelConfig.model);

    // Stream the response back as NDJSON
    const encoder = new TextEncoder();
    let assistantContent = "";

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          // Stream tokens from responses API
          for await (const event of stream) {
            if (event.type === "response.output_text.delta" && event.delta) {
              const token = event.delta;
              assistantContent += token;
              const tokenLine = JSON.stringify({ token } as StreamToken);
              controller.enqueue(encoder.encode(tokenLine + "\n"));
            }
          }

          // Get final response
          const finalResponse = await stream.finalResponse();
          if (finalResponse.output_text) {
            assistantContent = finalResponse.output_text;
          }

          // Save assistant message to Supabase
          const { data: assistantMessageRow, error: assistantError } =
            await supabaseAny
              .from("messages")
              .insert({
                user_id: userId,
                conversation_id: conversationId,
                role: "assistant",
                content: assistantContent,
                metadata: {
                  modelUsed: modelConfig.model,
                  reasoningEffort,
                  resolvedFamily: modelConfig.resolvedFamily,
                  speedModeUsed: speedMode,
                  userRequestedFamily: modelFamily,
                  userRequestedSpeedMode: speedMode,
                },
              })
              .select()
              .single();

          if (assistantError || !assistantMessageRow) {
            console.error(
              "Failed to save assistant message:",
              assistantError
            );
            // Still send done, but without row ID
            const metaLine = JSON.stringify({
              meta: {
                assistantMessageRowId: `error-${Date.now()}`,
                userMessageRowId: userMessageRow?.id,
                model: modelConfig.model,
                reasoningEffort,
                resolvedFamily: modelConfig.resolvedFamily,
                speedModeUsed: speedMode,
              },
            } as StreamMeta);
            controller.enqueue(encoder.encode(metaLine + "\n"));
          } else {
            // Send metadata with persisted IDs
            const metaLine = JSON.stringify({
              meta: {
                assistantMessageRowId: assistantMessageRow.id,
                userMessageRowId: userMessageRow?.id,
                model: modelConfig.model,
                reasoningEffort,
                resolvedFamily: modelConfig.resolvedFamily,
                speedModeUsed: speedMode,
              },
            } as StreamMeta);
            controller.enqueue(encoder.encode(metaLine + "\n"));
          }

          // Send done signal
          const doneLine = JSON.stringify({ done: true } as StreamDone);
          controller.enqueue(encoder.encode(doneLine + "\n"));

          controller.close();
        } catch (error) {
          console.error("Stream error:", error);
          controller.error(error);
        }
      },
    });

    return new NextResponse(readableStream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    console.error("Chat API error:", {
      message: errorMessage,
      stack: errorStack,
      error,
    });
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { messageId: string };
    const { messageId } = body;

    if (!messageId) {
      return NextResponse.json(
        { error: "messageId is required" },
        { status: 400 }
      );
    }

    const userId = getCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;

    // Delete the message from Supabase
    // First verify the message belongs to the current user's conversation
    const { data: message, error: fetchError } = await supabaseAny
      .from("messages")
      .select("id, conversation_id")
      .eq("id", messageId)
      .single();

    if (fetchError || !message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    // Verify conversation belongs to user
    const { data: conversation, error: convError } = await supabaseAny
      .from("conversations")
      .select("id, user_id")
      .eq("id", message.conversation_id)
      .single();

    if (convError || !conversation || conversation.user_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    // Delete the message
    const { error: deleteError } = await supabaseAny
      .from("messages")
      .delete()
      .eq("id", messageId);

    if (deleteError) {
      console.error("Error deleting message:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete message" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Delete API error:", errorMessage);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
