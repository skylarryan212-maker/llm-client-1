"use server";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

type CTARequest = {
  taskId?: string;
  content?: string;
  draftText?: string;
  reason?: string;
  status?: "pending" | "done";
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as CTARequest;
    const taskId = body.taskId?.trim();
    const content = body.content?.trim() || "Draft ready. Want me to humanize it now? (no detector or loop yet)";
    const draftText = body.draftText?.trim() || "";
    const reason = body.reason;
    const status = body.status === "done" ? "done" : "pending";

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
      console.error("[human-writing][cta] conversation lookup error", convoError);
      return NextResponse.json({ error: "conversation_lookup_failed" }, { status: 500 });
    }

    const conversationId = convo?.[0]?.id;
    if (!conversationId) {
      return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
    }

    const { data: existingCTA } = await supabase
      .from("messages")
      .select("id, created_at")
      .eq("conversation_id", conversationId)
      .eq("metadata->>kind", "cta")
      .order("created_at", { ascending: false })
      .limit(1);

    const existingCtaId = existingCTA?.[0]?.id as string | undefined;

    if (status === "done" && existingCtaId) {
      const { error: updateError } = await supabase
        .from("messages")
        .update({
          content,
          metadata: { agent: "human-writing", kind: "cta", draftText, reason, status },
        })
        .eq("id", existingCtaId);

      if (updateError) {
        console.error("[human-writing][cta] update error", updateError);
        return NextResponse.json({ error: "update_cta_failed" }, { status: 500 });
      }

      return NextResponse.json({ ok: true, messageId: existingCtaId });
    }

    // For new or pending CTAs, replace any prior CTA to keep a single record but let created_at set ordering.
    await supabase
      .from("messages")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("metadata->>kind", "cta");

    const { data: inserted, error: insertError } = await supabase
      .from("messages")
      .insert([
        {
          user_id: userId,
          conversation_id: conversationId,
          role: "assistant",
          content,
          metadata: { agent: "human-writing", kind: "cta", draftText, reason, status },
        },
      ])
      .select("id")
      .single();

    if (insertError) {
      console.error("[human-writing][cta] insert error", insertError);
      return NextResponse.json({ error: "save_cta_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, messageId: inserted?.id });
  } catch (error: any) {
    console.error("[human-writing][cta] error:", error);
    return NextResponse.json(
      { error: error?.message || "cta_failed" },
      { status: 500 }
    );
  }
}
