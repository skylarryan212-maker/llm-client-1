"use server";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserIdServer();
    const supabase = await supabaseServer();

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId")?.trim();
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("metadata->>agent", "human-writing")
      .eq("metadata->>task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (convoError) {
      throw convoError;
    }

    const conversationId: string | null = convo?.[0]?.id ?? null;
    if (!conversationId) {
      return NextResponse.json({ conversationId: null, messages: [] });
    }

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("role, content, created_at, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (messagesError) {
      throw messagesError;
    }

    return NextResponse.json({
      conversationId,
      messages: (messages ?? []).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content ?? "",
        metadata: m.metadata ?? {},
        created_at: m.created_at ?? null,
      })),
    });
  } catch (error: any) {
    const message = error?.message || "history_failed";
    const status = message === "Not authenticated" ? 401 : 500;
    console.error("[human-writing][history] error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}

