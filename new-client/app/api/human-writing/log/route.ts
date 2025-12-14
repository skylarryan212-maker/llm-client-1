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
    const body = (await request.json()) as Partial<LogRequest> & {
      chatId?: string;
      task_id?: string;
    };

    const title = body.title;
    const messages = body.messages ?? [];
    let taskId =
      body.taskId ??
      body.chatId ??
      (body.task_id as string | undefined) ??
      request.headers.get("x-task-id") ??
      request.headers.get("x-human-writing-task-id") ??
      undefined;

    if (!taskId) {
      const referer = request.headers.get("referer") || "";
      const match = referer.match(/\/agents\/human-writing\/c\/([^/?#]+)/i);
      if (match?.[1]) {
        taskId = match[1];
        console.warn("[human-writing][log] inferred taskId from referer", { taskId });
      }
    }

    if (!taskId || !Array.isArray(messages) || messages.length === 0) {
      console.warn("[human-writing][log] missing taskId or messages", {
        taskId,
        messagesCount: Array.isArray(messages) ? messages.length : "invalid",
        bodyKeys: body && typeof body === "object" ? Object.keys(body) : "invalid",
      });
      return NextResponse.json({ error: "taskId and messages required" }, { status: 400 });
    }

    const cookieHeader = request.headers.get("cookie") || "";
    console.log("[human-writing][log] request", {
      taskId,
      messages: messages.length,
      hasCookie: cookieHeader.length > 0,
      hasAuthHeader: Boolean(request.headers.get("authorization")),
      hasTokenHeader: Boolean(request.headers.get("x-supabase-token")),
    });

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
        console.warn("[human-writing][log] auth missing", {
          hasSupabaseUrl: Boolean(supabaseUrl),
          hasSupabaseAnonKey: Boolean(supabaseAnonKey),
          hasAccessToken: Boolean(accessToken),
        });
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
        console.warn("[human-writing][log] auth token invalid", { userError });
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      }

      userId = userData.user.id;
      supabase = supabaseWithToken;
    }
    console.log("[human-writing][log] user", userId, "task", taskId, "messages", messages.length);

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
      console.error("[human-writing][log] conversation lookup error", findError);
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
        console.error("[human-writing][log] conversation create error", createError);
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
      console.error("[human-writing][log] insert messages error", insertError);
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
