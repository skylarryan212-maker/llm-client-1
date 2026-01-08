"use server";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import { rephrasyHumanize } from "@/lib/rephrasy";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";
import type { Json, MessageInsert } from "@/lib/supabase/types";

async function reviewOnly(params: { humanizedText: string; originalText: string }) {
  const { humanizedText, originalText } = params;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { needsEdits: false, notes: "", requestId: null };

  const client = createOpenAIClient({ apiKey });
  const instructions = [
    "You are a careful reviewer. Inspect the 'Humanized draft' against the 'Original user text'.",
    "If the draft requires changes (grammar, factual inconsistencies, or clear errors),",
    "return a JSON object ONLY with keys: `needsEdits` (true/false) and `notes` (string) where `notes` briefly explains what should change.",
    "If no changes are needed, return `{\"needsEdits\": false, \"notes\": \"Looks good\"}`.",
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
            "",
            "Respond with strict JSON: {\"needsEdits\": true|false, \"notes\": \"...\"}",
          ].join("\n"),
        },
      ],
      max_output_tokens: 600,
      store: false,
    })
    .withResponse();

  const requestId = getOpenAIRequestId(response, raw);
  const usage = response.usage as any;
  const usageSummary = usage
    ? {
        totalCost: usage.total_cost ?? usage.totalCost ?? null,
        totalTokens: usage.total_tokens ?? usage.totalTokens ?? null,
        promptTokens: usage.prompt_tokens ?? usage.promptTokens ?? null,
        completionTokens: usage.completion_tokens ?? usage.completionTokens ?? null,
      }
    : null;
  console.info("[human-writing][review][cost]", { requestId, usage: usageSummary });

  // Log reviewer response (truncated) for auditing
  const rawOutput = response.output_text;
  const outputText = Array.isArray(rawOutput) ? rawOutput.join("") : String(rawOutput || "");
  try {
    console.info("[human-writing][review][response]", { requestId, raw: outputText.slice(0, 2000) });
  } catch (err) {
    console.info("[human-writing][review][response]", { requestId, raw: String(outputText).slice(0, 2000) });
  }
  let parsed: { needsEdits: boolean; notes: string } | null = null;
  try {
    // Try to extract JSON blob from output
    const jsonStart = outputText.indexOf("{");
    const jsonEnd = outputText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const maybe = outputText.slice(jsonStart, jsonEnd + 1);
      parsed = JSON.parse(maybe) as { needsEdits: boolean; notes: string };
    }
  } catch (e) {
    parsed = null;
  }

  if (!parsed) {
    // Fallback heuristics
    const lower = outputText.toLowerCase();
    const needs = /true|yes|edit|change|fix/.test(lower);
    parsed = { needsEdits: needs, notes: outputText.trim().slice(0, 1000) };
  }

  return {
    needsEdits: Boolean(parsed.needsEdits),
    notes: String(parsed.notes || ""),
    requestId,
    raw: outputText,
    usage: usageSummary,
  } as any;
}

async function applyPatches(params: { humanizedText: string; reviewerNotes: string }) {
  const { humanizedText, reviewerNotes } = params;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { finalText: humanizedText, requestId: null };

  const client = createOpenAIClient({ apiKey });
  const instructions = [
    "You are an editor. Apply minimal, careful edits to the provided 'Humanized draft' following the reviewer's notes.",
    "Keep tone and phrasing intact; only make changes that fix clear issues. Return only the final edited draft text.",
  ].join(" ");

  const { data: response, response: raw } = await client.responses
    .create({
      model: "gpt-5-nano",
      instructions,
      input: [
        {
          role: "user",
          content: [
            "Humanized draft:",
            humanizedText,
            "",
            "Reviewer notes (apply these changes):",
            reviewerNotes,
          ].join("\n"),
        },
      ],
      max_output_tokens: 1200,
      store: false,
    })
    .withResponse();

  const requestId = getOpenAIRequestId(response, raw);
  const usage = response.usage as any;
  const usageSummary = usage
    ? {
        totalCost: usage.total_cost ?? usage.totalCost ?? null,
        totalTokens: usage.total_tokens ?? usage.totalTokens ?? null,
        promptTokens: usage.prompt_tokens ?? usage.promptTokens ?? null,
        completionTokens: usage.completion_tokens ?? usage.completionTokens ?? null,
      }
    : null;
  console.info("[human-writing][apply-patches][cost]", { requestId, usage: usageSummary });

  const rawOutput = response.output_text;
  const rawStr = Array.isArray(rawOutput) ? rawOutput.join("") : String(rawOutput || "");
  try {
    console.info("[human-writing][apply-patches][response]", { requestId, raw: rawStr.slice(0, 2000) });
  } catch (err) {
    console.info("[human-writing][apply-patches][response]", { requestId, raw: String(rawStr).slice(0, 2000) });
  }

  const finalText = Array.isArray(rawOutput) ? rawOutput.join("").trim() : String(rawOutput || "").trim();
  return { finalText: finalText || humanizedText, requestId, raw: rawOutput, usage: usageSummary } as any;
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
    const rawLanguage = body.language?.trim() || "auto";
    const language = rawLanguage === "auto" ? "English" : rawLanguage;
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
      const payload = {
        text,
        model,
        language,
        costs: true,
        words: true,
      };
      console.info("[human-writing][humanize][request]", {
        runId,
        taskId,
        payload,
      });
      const humanized = await rephrasyHumanize(payload);

      // Log Rephrasy cost if present and persist to DB
      const humanizeCosts = (humanized.raw as any)?.costs ?? (humanized.raw as any)?.cost ?? null;
      if (humanizeCosts) {
        console.info("[human-writing][humanize][cost]", {
          runId,
          taskId,
          model,
          language,
          costs: humanizeCosts,
        });
      }
      // Log rephrasy/raw response for auditing (truncated)
      let humanizeRawStr = "";
      try {
        humanizeRawStr = typeof humanized.raw === "string" ? humanized.raw : JSON.stringify(humanized.raw);
        console.info("[human-writing][humanize][response]", { runId, taskId, raw: humanizeRawStr.slice(0, 2000) });
      } catch (err) {
        humanizeRawStr = String(humanized.raw);
        console.info("[human-writing][humanize][response]", { runId, taskId, raw: humanizeRawStr.slice(0, 2000) });
      }

      // Persist humanize call usage to `user_api_usage`
      try {
        const insert = await supabase.from("user_api_usage").insert([
          {
            user_id: userId,
            conversation_id: conversationId,
            task_id: taskId,
            run_id: runId,
            step: "humanize",
            model: model,
            request_id: (humanized.raw as any)?._request_id ?? null,
            total_cost: humanizeCosts ?? null,
            total_tokens: (humanized.raw as any)?.total_tokens ?? null,
            raw: humanizeRawStr.slice(0, 2000),
            created_at: new Date().toISOString(),
          },
        ]);
        if (insert?.error) {
          console.error("[human-writing][humanize][persist_cost] humanize insert error", insert.error);
        }
      } catch (e) {
        console.error("[human-writing][humanize][persist_cost] humanize insert failed", e);
      }

      let finalDraft = humanized.output;
      let edited = false;
      let reviewNotes = "";
      let reviewRequestId: string | null = null;
      let applyRequestId: string | null = null;
      try {
        const review = await reviewOnly({ humanizedText: humanized.output, originalText: text });
        reviewNotes = review.notes || "";
        reviewRequestId = review.requestId ?? null;
        // Persist review usage
        try {
          const reviewRaw = String(review.raw ?? "");
          const insert = await supabase.from("user_api_usage").insert([
            {
              user_id: userId,
              conversation_id: conversationId,
              task_id: taskId,
              run_id: runId,
              step: "review",
              model: "gpt-5-nano",
              request_id: reviewRequestId,
              total_cost: (review as any)?.usage?.totalCost ?? null,
              total_tokens: (review as any)?.usage?.totalTokens ?? null,
              prompt_tokens: (review as any)?.usage?.promptTokens ?? null,
              completion_tokens: (review as any)?.usage?.completionTokens ?? null,
              raw: reviewRaw.slice(0, 2000),
              created_at: new Date().toISOString(),
            },
          ]);
          if (insert?.error) {
            console.error("[human-writing][humanize][persist_cost] review insert error", insert.error);
          }
        } catch (e) {
          console.error("[human-writing][humanize][persist_cost] review insert failed", e);
        }

        if (review.needsEdits) {
          // If reviewer indicates edits needed, call a separate patching call to apply edits.
          const patched = await applyPatches({ humanizedText: humanized.output, reviewerNotes: reviewNotes });
          finalDraft = patched.finalText;
          applyRequestId = patched.requestId ?? null;
          edited = finalDraft.trim() !== (humanized.output || "").trim();

          // Persist patch usage
          try {
            const patchRaw = String(patched.raw ?? "");
            const insert = await supabase.from("user_api_usage").insert([
              {
                user_id: userId,
                conversation_id: conversationId,
                task_id: taskId,
                run_id: runId,
                step: "patch",
                model: "gpt-5-nano",
                request_id: applyRequestId,
                total_cost: (patched as any)?.usage?.totalCost ?? null,
                total_tokens: (patched as any)?.usage?.totalTokens ?? null,
                prompt_tokens: (patched as any)?.usage?.promptTokens ?? null,
                completion_tokens: (patched as any)?.usage?.completionTokens ?? null,
                raw: patchRaw.slice(0, 2000),
                created_at: new Date().toISOString(),
              },
            ]);
            if (insert?.error) {
              console.error("[human-writing][humanize][persist_cost] patch insert error", insert.error);
            }
          } catch (e) {
            console.error("[human-writing][humanize][persist_cost] patch insert failed", e);
          }
        } else {
          // No edits needed
          finalDraft = "Looks good — no changes needed.";
          edited = false;
        }
      } catch (reviewErr: any) {
        console.warn("[human-writing][humanize][review_failed]", {
          runId,
          taskId,
          message: reviewErr?.message,
        });
        // fallback: keep finalDraft as humanized output and edited=false
        finalDraft = humanized.output;
        edited = false;
      }

      if (conversationId) {
        const inserts: MessageInsert[] = [
          {
            user_id: userId,
            conversation_id: conversationId,
            role: "assistant",
            content: humanized.output,
            metadata: {
              agent: "human-writing",
              kind: "humanized",
              model,
              language,
              flesch: humanized.flesch,
            } as Json,
          },
          {
            user_id: userId,
            conversation_id: conversationId,
            role: "assistant",
            content: edited ? finalDraft : "Looks good — no changes needed.",
            metadata: {
              agent: "human-writing",
              kind: "humanized_review",
              model,
              language,
              edited,
              source: "review",
            } as Json,
          },
        ];

        const { error: insertError } = await supabase
          .from("messages")
          .insert(inserts, { defaultToNull: false });
        if (insertError) {
          console.error("[human-writing][humanize] insert message error", insertError);
        }
      }

      return NextResponse.json({
        humanized: humanized.output,
        reviewed: finalDraft,
        edited,
        flesch: humanized.flesch,
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
