"use server";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import { rephrasyHumanize } from "@/lib/rephrasy";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";

async function reviewAndOptionallyEdit(params: {
  humanizedText: string;
  originalText: string;
}) {
  const { humanizedText, originalText } = params;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { finalText: humanizedText, edited: false };

  const client = createOpenAIClient({ apiKey });
  const instructions = [
    "You are a reviewer. Return the draft unchanged unless you find major, obvious issues.",
    "Only edit for clear grammatical errors, illogical statements, or conflicts with user intent.",
    "Do not change tone, style, or phrasing just to sound different.",
    "If you edit, keep changes minimal. Return only the final draft text.",
  ].join(" ");

  const { data: response, response: raw } = await client.responses
    .create({
      model: "gpt-5-nano",
      instructions,
      input: [
        {
          role: "user",
          content: [
            "Original user text:",
            originalText,
            "",
            "Humanized draft to review:",
            humanizedText,
          ].join("\n"),
        },
      ],
      max_output_tokens: 1200,
      store: false,
    })
    .withResponse();

  const requestId = getOpenAIRequestId(response, raw);
  const rawOutput = response.output_text;
  const outputArray = Array.isArray(rawOutput)
    ? rawOutput
    : typeof rawOutput === "string"
      ? [rawOutput]
      : [];
  const finalText = outputArray.join("").trim() || humanizedText;
  const edited = finalText.trim() !== humanizedText.trim();

  return { finalText, edited, requestId };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string;
      model?: string;
      language?: string;
      taskId?: string;
    };

    const text = body.text?.trim();
    const model = body.model?.trim() || "undetectable";
    const language = body.language?.trim() || "auto";
    const taskId = body.taskId?.trim();
    const runId = `hw-humanize-${taskId || "unknown"}-${Date.now()}`;

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

    try {
      const humanized = await rephrasyHumanize({
        text,
        model,
        language: language === "auto" ? undefined : language,
        costs: true,
        words: true,
      });

      let finalDraft = humanized.output;
      let edited = false;
      try {
        const review = await reviewAndOptionallyEdit({
          humanizedText: humanized.output,
          originalText: text,
        });
        finalDraft = review.finalText;
        edited = review.edited;
      } catch (reviewErr: any) {
        console.warn("[human-writing][humanize][review_failed]", {
          runId,
          taskId,
          message: reviewErr?.message,
        });
      }

      if (conversationId) {
        const { error: insertError } = await supabase.from("messages").insert([
          {
            user_id: userId,
            conversation_id: conversationId,
            role: "assistant",
            content: finalDraft,
            metadata: {
              agent: "human-writing",
              kind: "humanized",
              model,
              language,
              flesch: humanized.flesch,
              reviewed: true,
              edited,
            },
          },
        ]);
        if (insertError) {
          console.error("[human-writing][humanize] insert message error", insertError);
        }
      }

      return NextResponse.json({
        output: finalDraft,
        flesch: humanized.flesch,
        edited,
        raw: humanized.raw,
      });
    } catch (err: any) {
      console.error("[human-writing][humanize][humanize_call_failed]", {
        runId,
        taskId,
        status: err?.status,
        message: err?.message,
        snippet: err?.bodySnippet,
        textLength: text.length,
        model,
        language,
      });
      return NextResponse.json(
        { error: err?.message || "humanize_failed" },
        { status: err?.status || 502 }
      );
    }
  } catch (error: any) {
    console.error("[human-writing][humanize] error:", error);
    return NextResponse.json(
      { error: error?.message || "humanize_failed" },
      { status: 500 }
    );
  }
}
