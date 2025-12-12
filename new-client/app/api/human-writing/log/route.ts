"use server";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

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

    // Try cookie-based auth first
    let userId: string | null = null;
    let supabase = await supabaseServer();

    try {
      userId = await requireUserIdServer();
    } catch {
      userId = null;
    }

    // Fallback: accept a bearer token header for Supabase auth (client sends access token)
    if (!userId) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const authHeader = request.headers.get("authorization");
      const tokenHeader = request.headers.get("x-supabase-token");
      const accessToken =
        (authHeader?.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7)
          : undefined) || tokenHeader || "";

      if (!supabaseUrl || !supabaseAnonKey || !accessToken) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      }

      const supabaseWithToken = createClient<Database>(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });

      const { data: userData, error: userError } = await supabaseWithToken.auth.getUser();
      if (userError || !userData?.user?.id) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      }

      userId = userData.user.id;
      supabase = supabaseWithToken;
    }

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
