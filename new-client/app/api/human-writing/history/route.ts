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
      .select("id, role, content, created_at, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("[human-writing][history] messages fetch error", messagesError);
      return NextResponse.json({ error: "messages_fetch_failed" }, { status: 500 });
    }

    const baseMessages = (messages ?? []).map((m) => {
      const meta = m.metadata ?? {};
      const orderTs =
        (meta as any)?.order_ts ||
        m.created_at ||
        "";
      return {
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content ?? "",
        created_at: m.created_at,
        metadata: meta,
        order_ts: orderTs,
      };
    });

    // Always pull any CTA messages explicitly and merge (prevents loss if not in main list)
    const { data: ctaRows } = await supabase
      .from("messages")
      .select("id, role, content, created_at, metadata")
      .eq("conversation_id", conversationId)
      .eq("metadata->>kind", "cta")
      .order("created_at", { ascending: true });

    const mergedMap = new Map<string, typeof baseMessages[number]>();
    baseMessages.forEach((m) => mergedMap.set(m.id, m));
    (ctaRows ?? []).forEach((m) => {
      const meta = m.metadata ?? {};
      const orderTs =
        (meta as any)?.order_ts ||
        m.created_at ||
        "";
      mergedMap.set(m.id, {
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content ?? "",
        created_at: m.created_at,
        metadata: meta,
        order_ts: orderTs,
      });
    });

    const hydrated = Array.from(mergedMap.values()).sort((a, b) => {
      const aKey = a.order_ts || a.created_at || "";
      const bKey = b.order_ts || b.created_at || "";
      const cmp = aKey.localeCompare(bKey);
      if (cmp !== 0) return cmp;
      return (a.created_at || "").localeCompare(b.created_at || "");
    });

    return NextResponse.json({
      conversationId,
      messages: hydrated.map(({ id: _id, order_ts: _order, ...rest }) => rest),
    });
  } catch (error: any) {
    console.error("[human-writing][history] error:", error);
    return NextResponse.json(
      { error: error?.message || "history_failed" },
      { status: 500 }
    );
  }
}
