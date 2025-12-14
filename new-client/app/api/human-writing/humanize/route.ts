"use server";

import { NextRequest, NextResponse } from "next/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import { supabaseServer } from "@/lib/supabase/server";

const HUMANIZER_URL = "https://v2-humanizer.rephrasy.ai/api";

type HumanizeRequestBody = {
  taskId?: string;
  text?: string;
  model?: string;
  language?: string;
  words?: boolean;
  costs?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = await requireUserIdServer();
    } catch {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as HumanizeRequestBody;
    const text = body.text?.trim();
    const taskId = body.taskId?.trim();

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const apiKey = process.env.REPHRASY_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing REPHRASY_API_KEY" },
        { status: 500 }
      );
    }

    const payload: Record<string, unknown> = {
      text,
      model: body.model?.trim() || "undetectable",
    };

    if (body.language && body.language !== "auto") {
      payload.language = body.language;
    }
    if (body.words) {
      payload.words = true;
    }
    if (body.costs) {
      payload.costs = true;
    }

    const response = await fetch(HUMANIZER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMessage =
        data?.error || data?.message || "humanizer_request_failed";
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    const supabase = await supabaseServer();
    const { data: existing, error: findError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("metadata->>agent", "human-writing")
      .eq("metadata->>task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (findError) {
      console.error("[human-writing][humanize] conversation lookup error", findError);
    } else {
      const conversationId: string | null = existing?.[0]?.id ?? null;
      if (conversationId) {
        const outputText = (data?.output as string) ?? "";
        const { error: insertError } = await supabase.from("messages").insert([
          {
            user_id: userId,
            conversation_id: conversationId,
            role: "assistant",
            content: outputText,
            metadata: { agent: "human-writing", kind: "humanized" },
          },
        ]);
        if (insertError) {
          console.error("[human-writing][humanize] insert message error", insertError);
        }
      }
    }

    return NextResponse.json({
      output: data.output,
      flesch: data.new_flesch_score,
      raw: data,
    });
  } catch (error: any) {
    console.error("[human-writing][humanize] error:", error);
    return NextResponse.json(
      { error: error?.message || "humanize_failed" },
      { status: 500 }
    );
  }
}
