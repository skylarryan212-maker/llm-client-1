"use server";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId")?.trim();
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const userId = await requireUserIdServer();

    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("metadata->>agent", "human-writing")
      .eq("metadata->>task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (convoError) {
      console.error("[human-writing][history] conversation lookup error", convoError);
      return NextResponse.json({ error: "conversation_lookup_failed" }, { status: 500 });
    }

    const conversationId = convo?.[0]?.id ?? null;
    if (!conversationId) {
      return NextResponse.json({ conversationId: null, messages: [] });
    }

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("role, content, created_at, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("[human-writing][history] messages fetch error", messagesError);
      return NextResponse.json({ error: "messages_fetch_failed" }, { status: 500 });
    }

    let hydrated = (messages ?? []).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content ?? "",
      created_at: m.created_at,
      metadata: m.metadata ?? {},
    }));

    // Fallback: if no CTA found, attempt to fetch the latest CTA message explicitly
    const hasCTA = hydrated.some((m) => (m.metadata as any)?.kind === "cta");
    if (!hasCTA) {
      const { data: ctaRows } = await supabase
        .from("messages")
        .select("role, content, created_at, metadata")
        .eq("conversation_id", conversationId)
        .eq("metadata->>kind", "cta")
        .order("created_at", { ascending: true });
      if (ctaRows && ctaRows.length) {
        hydrated = hydrated.concat(
          ctaRows.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content ?? "",
            created_at: m.created_at,
            metadata: m.metadata ?? {},
          }))
        );
        // Keep chronological order
        hydrated.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
      }
    }

    return NextResponse.json({
      conversationId,
      messages: hydrated,
    });
  } catch (error: any) {
    console.error("[human-writing][history] error:", error);
    return NextResponse.json(
      { error: error?.message || "history_failed" },
      { status: 500 }
    );
  }
}
