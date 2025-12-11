import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logUsageRecord } from "@/lib/usage";
import { callDeepInfraLlama } from "@/lib/deepInfraLlama";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type TopicRow = Database["public"]["Tables"]["conversation_topics"]["Row"];

type QueryResult<T> = { data: T | null; error: unknown } | null | undefined;

interface RefreshTopicMetadataParams {
  supabase: SupabaseClient<Database>;
  topicId: string;
  conversationId: string;
  userId?: string | null;
}

function buildUserPayload(topic: TopicRow, messages: MessageRow[]) {
  return {
    label: topic.label,
    priorDescription: topic.description ?? "",
    priorSummary: topic.summary ?? "",
    messages: messages.map((m) => ({
      role: m.role,
      created_at: m.created_at,
      content: (m.content || "").slice(0, 2000),
    })),
  };
}

function parseJsonObject(text: string): { description?: string; summary?: string } | null {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      return parsed as { description?: string; summary?: string };
    }
  } catch (err) {
    console.warn("[topic-refresh] Failed to parse JSON output:", err, cleaned);
  }
  return null;
}

function withQueryTimeout<T>(builder: any, ms = 20000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  if (typeof builder?.abortSignal === "function") {
    builder.abortSignal(controller.signal);
  }

  return Promise.resolve(builder as Promise<T>).finally(() => clearTimeout(timer));
}

export async function refreshTopicMetadata({
  supabase,
  topicId,
  conversationId,
  userId,
}: RefreshTopicMetadataParams): Promise<void> {
  if (!topicId) return;

  let topicResult;
  try {
    topicResult = await withQueryTimeout(
      supabase
        .from("conversation_topics")
        .select("id, label, description, summary")
        .eq("id", topicId)
        .maybeSingle(),
    );
  } catch (topicErr) {
    console.warn("[topic-refresh] Topic fetch failed:", topicErr);
    return;
  }

  const topicResponse = topicResult as QueryResult<TopicRow>;
  const topicRow = topicResponse?.data;
  const topicErr = topicResponse?.error;

  if (topicErr || !topicRow) {
    console.warn("[topic-refresh] Topic fetch failed:", topicErr);
    return;
  }

  let messagesResult;
  try {
    messagesResult = await withQueryTimeout(
      supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .eq("topic_id", topicId)
        .order("created_at", { ascending: true })
        .limit(40),
    );
  } catch (msgErr) {
    console.warn("[topic-refresh] Message fetch failed:", msgErr);
    return;
  }

  const messagesResponse = messagesResult as QueryResult<MessageRow[]>;
  const messages = messagesResponse?.data;
  const msgErr = messagesResponse?.error;

  if (msgErr) {
    console.warn("[topic-refresh] Message fetch failed:", msgErr);
    return;
  }

  const systemPrompt =
    "You are updating metadata for a conversation topic. Keep the label stable. " +
    "Use the ordered messages plus the prior description/summary to generate:\n" +
    "- description: 1–2 sentences that clearly state the topic scope and what the user is trying to achieve (not just 'hi'). Mention key entities/dates/goals if present.\n" +
    "- summary: a compact but informative recap (2–4 sentences) capturing key decisions, requests, facts, and next steps. Include names, dates/times, and tasks when present. Do not fabricate.\n" +
    "Keep both fields concise, avoid fluff, and do not invent details. Output JSON with keys: description, summary.";

  const userPayload = buildUserPayload(topicRow as TopicRow, (messages ?? []) as MessageRow[]);

  const MODEL_ID = "google/gemma-3-4b-it";
  let responseText = "";
  try {
    const { text, usage } = await callDeepInfraLlama({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      schemaName: "topic_refresh",
      schema: {
        type: "object",
        properties: {
          description: { type: "string" },
          summary: { type: "string" },
        },
        additionalProperties: false,
      },
      maxTokens: 400,
    });
    if (userId && usage) {
      await logUsageRecord({
        userId,
        conversationId,
        model: MODEL_ID,
        inputTokens: usage.input_tokens ?? 0,
        cachedTokens: 0,
        outputTokens: usage.output_tokens ?? 0,
      });
    }
    responseText = text || "";
  } catch (err) {
    console.error("[topic-refresh] LLM call failed:", err);
    return;
  }

  const parsed = parseJsonObject(responseText);
  if (!parsed) {
    return;
  }

  const updates: Partial<TopicRow> = {};
  if (parsed.description && parsed.description.trim()) {
    updates.description = parsed.description.trim().slice(0, 500);
  }
  if (parsed.summary && parsed.summary.trim()) {
    updates.summary = parsed.summary.trim().slice(0, 1500);
  }
  if (!Object.keys(updates).length) {
    return;
  }
  updates.updated_at = new Date().toISOString();

  const { error: updateErr } = await (supabase as SupabaseClient<any>)
    .from("conversation_topics")
    .update(updates)
    .eq("id", topicId);

  if (updateErr) {
    console.error("[topic-refresh] Failed to update topic metadata:", updateErr);
  }
}
