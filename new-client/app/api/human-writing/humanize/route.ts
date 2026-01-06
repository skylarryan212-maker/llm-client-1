"use server";

import { NextRequest, NextResponse } from "next/server";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";
import { computeHumanScore, rephrasyDetect, rephrasyHumanize } from "@/lib/rephrasy";

const MAX_ITERATIONS = 6;
const TARGET_HUMAN_SCORE = 75;
const EDIT_PROMPT =
  "You are polishing a draft that was already humanized. Fix only obvious errors, clarity issues, and awkward phrasing. Keep meaning, citations, and length roughly the same. Do not add new ideas.";

async function runLightEdit(text: string): Promise<{ text: string; requestId?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const client = createOpenAIClient({ apiKey });
  const { data: response, response: raw } = await client.responses
    .create({
      model: "gpt-5-nano",
      instructions: EDIT_PROMPT,
      input: [{ role: "user", content: text }],
      max_output_tokens: 1200,
      store: false,
    })
    .withResponse();

  const requestId = getOpenAIRequestId(response, raw);

  const outputArray = Array.isArray((response as OpenAIResponse).output_text)
    ? (response as OpenAIResponse).output_text
    : [];
  const outputText = outputArray.join("").trim();

  if (outputText.length === 0) {
    throw new Error("Model returned no text");
  }

  return { text: outputText, requestId };
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
    let currentDraft = text;
    let finalDraft = text;
    let finalHumanScore: number | null = null;
    let iterationsRun = 0;
    const audit: Array<{
      iteration: number;
      humanized: string;
      edited: string;
      flesch: number | null;
      detectorOverall: number | null;
      humanScore: number | null;
    }> = [];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterationsRun = i + 1;

      const humanized = await rephrasyHumanize({
        text: currentDraft,
        model,
        language: language === "auto" ? undefined : language,
        costs: true,
      });

      const edited = await runLightEdit(humanized.output);

      const detector = await rephrasyDetect({
        text: edited.text,
        mode: "depth",
      });

      const humanScore = computeHumanScore(detector.rawOverall, "depth");

      audit.push({
        iteration: iterationsRun,
        humanized: humanized.output,
        edited: edited.text,
        flesch: humanized.flesch,
        detectorOverall: detector.rawOverall,
        humanScore,
      });

      finalDraft = edited.text;
      finalHumanScore = humanScore;

      if (typeof humanScore === "number" && humanScore >= TARGET_HUMAN_SCORE) {
        break;
      }

      currentDraft = edited.text;
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
            human_score: finalHumanScore,
            iterations: iterationsRun,
            audit: audit.map((item) => ({
              iteration: item.iteration,
              humanScore: item.humanScore,
              detectorOverall: item.detectorOverall,
              flesch: item.flesch,
            })),
            model,
            language,
          },
        },
      ]);
      if (insertError) {
        console.error("[human-writing][humanize] insert message error", insertError);
      }
    }

    return NextResponse.json({
      output: finalDraft,
      humanScore: finalHumanScore,
      iterations: iterationsRun,
      audit,
    });
  } catch (error: any) {
    console.error("[human-writing][humanize] error:", error);
    return NextResponse.json(
      { error: error?.message || "humanize_failed" },
      { status: 500 }
    );
  }
}
