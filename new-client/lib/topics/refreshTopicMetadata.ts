import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logUsageRecord } from "@/lib/usage";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type TopicRow = Database["public"]["Tables"]["conversation_topics"]["Row"];

type QueryResult<T> = { data: T | null; error: unknown } | null | undefined;

interface RefreshTopicMetadataParams {
  supabase: SupabaseClient<Database>;
  openai: any;
  topicId: string;
  conversationId: string;
  model?: string;
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

function withQueryTimeout<T>(builder: any, ms = 5000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  if (typeof builder?.abortSignal === "function") {
    builder.abortSignal(controller.signal);
  }

  return (builder as Promise<T>).finally(() => clearTimeout(timer));
}

export async function refreshTopicMetadata({
  supabase,
  openai,
  topicId,
  conversationId,
  model = "gpt-5-nano-2025-08-07",
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
    "Given prior description/summary and the ordered messages for this topic, produce a refreshed description (1-2 sentences) " +
    "and a rolling summary (concise but retaining earlier meaning). Do not invent details. " +
    "Output JSON with keys: description, summary.";

  const userPayload = buildUserPayload(topicRow as TopicRow, (messages ?? []) as MessageRow[]);

  let responseText = "";
  try {
    const completion = await openai.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      max_output_tokens: 400,
    });
    const usage = (completion as any)?.usage;
    if (userId && usage) {
      await logUsageRecord({
        userId,
        conversationId,
        model,
        inputTokens: usage.input_tokens ?? 0,
        cachedTokens: usage.cached_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
      });
    }
    responseText = completion.output_text || "";
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
