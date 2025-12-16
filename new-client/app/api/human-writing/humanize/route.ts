"use server";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

const REPHRASY_URL = "https://v2-humanizer.rephrasy.ai/api";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string;
      model?: string;
      language?: string;
      taskId?: string;
    };

    const text = body.text?.trim();
    const taskId = body.taskId?.trim();
    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const userId = await requireUserIdServer();

    // Lookup conversation
    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("metadata->>agent", "human-writing")
      .eq("metadata->>task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (convoError) {
      console.error("[human-writing][humanize] conversation lookup error", convoError);
      return NextResponse.json({ error: "conversation_lookup_failed" }, { status: 500 });
    }

    const conversationId = convo?.[0]?.id ?? null;
    const apiKey = process.env.REPHRASY_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "missing_rephrasy_api_key" }, { status: 500 });
    }

    const payload = {
      text,
      model: body.model || "undetectable",
      language: body.language || undefined,
      words: true,
      costs: true,
    };

    const response = await fetch(REPHRASY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      const message = errorJson?.error || errorJson?.message || `rephrasy_http_${response.status}`;
      throw new Error(message);
    }

    const json = (await response.json().catch(() => ({}))) as {
      output?: string;
      new_flesch_score?: number;
      costs?: unknown;
    };
    const output = json.output || text || "";

    if (conversationId) {
      const { error: insertError } = await supabase.from("messages").insert([
        {
          user_id: userId,
          conversation_id: conversationId,
          role: "assistant",
          content: output,
          metadata: { agent: "human-writing", kind: "humanized" },
        },
      ]);
      if (insertError) {
        console.error("[human-writing][humanize] insert message error", insertError);
      }
    }

    return NextResponse.json({
      output,
      flesch: json.new_flesch_score,
      raw: { rephrasy: true, costs: json.costs },
    });
  } catch (error: any) {
    console.error("[human-writing][humanize] error:", error);
    return NextResponse.json(
      { error: error?.message || "humanize_failed" },
      { status: 500 }
    );
  }
}
