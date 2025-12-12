"use server";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

type LogRequest = {
  taskId: string;
  title?: string | null;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    openaiResponseId?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LogRequest;
    const { taskId, title, messages } = body;

    if (!taskId || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "taskId and messages required" }, { status: 400 });
    }

    const userId = await requireUserIdServer();
    const supabase = await supabaseServer();

    // Find or create conversation
    const { data: existing, error: findError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("metadata->>agent", "human-writing")
      .eq("metadata->>task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (findError) {
      throw findError;
    }

    let conversationId: string | null = existing?.[0]?.id ?? null;

    if (!conversationId) {
      const { data: created, error: createError } = await supabase
        .from("conversations")
        .insert([
          {
            user_id: userId,
            title: title ?? "Human Writing",
            project_id: null,
            metadata: { task_id: taskId, agent: "human-writing" },
          },
        ])
        .select("id")
        .single();

      if (createError || !created) {
        throw createError ?? new Error("Failed to create conversation");
      }
      conversationId = created.id;
    }

    // Insert messages
    const rows = messages.map((msg) => ({
      user_id: userId,
      conversation_id: conversationId,
      role: msg.role,
      content: msg.content,
      openai_response_id: msg.openaiResponseId ?? null,
      metadata: msg.metadata ?? {},
    }));

    const { error: insertError } = await supabase.from("messages").insert(rows);
    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({ conversationId });
  } catch (error: any) {
    console.error("[human-writing][log] error:", error);
    return NextResponse.json(
      { error: error?.message || "log_failed" },
      { status: 500 }
    );
  }
}
