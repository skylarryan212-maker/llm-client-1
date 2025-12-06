import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { estimateTokens } from "@/lib/tokens/estimateTokens";
import { sanitizeTopicMessageContent } from "@/lib/topics/messageSanitizer";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type TopicRow = Database["public"]["Tables"]["conversation_topics"]["Row"];

interface UpdateTopicSnapshotParams {
  supabase: SupabaseClient<Database>;
  conversationId: string;
  topicId: string;
  latestMessage?: MessageRow | null;
}

const SUMMARY_TAIL_LIMIT = 6;
const SUMMARY_MAX_LENGTH = 480;

export async function updateTopicSnapshot({
  supabase,
  conversationId,
  topicId,
  latestMessage,
}: UpdateTopicSnapshotParams): Promise<void> {
  if (!topicId) {
    return;
  }

  const [{ data: topicData }, { data: tailMessages, error: tailError }] = await Promise.all([
    supabase
      .from("conversation_topics")
      .select("id, token_estimate")
      .eq("id", topicId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("role, content, metadata")
      .eq("conversation_id", conversationId)
      .eq("topic_id", topicId)
      .order("created_at", { ascending: false })
      .limit(SUMMARY_TAIL_LIMIT),
  ]);

  const topic = (topicData as TopicRow | null) ?? null;
  if (!topic || tailError) {
    return;
  }

  const tailRows: MessageRow[] = Array.isArray(tailMessages)
    ? (tailMessages as MessageRow[])
    : [];
  const tail = tailRows.slice().reverse();
  const latestUser = [...tail].reverse().find((msg) => msg.role === "user");
  const latestAssistant = [...tail].reverse().find((msg) => msg.role === "assistant");
  const previousAssistant = tail
    .filter((msg) => msg.role === "assistant" && msg !== latestAssistant)
    .pop();

  const pickSnippet = (msg?: MessageRow) => {
    if (!msg) return "";
    return sanitizeTopicMessageContent(msg)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  };

  const summaryParts = [
    latestUser ? `User: ${pickSnippet(latestUser)}` : "",
    latestAssistant ? `Assistant: ${pickSnippet(latestAssistant)}` : "",
    previousAssistant ? `Assistant (earlier): ${pickSnippet(previousAssistant)}` : "",
  ].filter(Boolean);

  const summary = summaryParts.join(" | ").slice(0, SUMMARY_MAX_LENGTH);
  const tokenDelta = latestMessage
    ? estimateTokens(sanitizeTopicMessageContent(latestMessage))
    : 0;
  const nextTokenEstimate = Math.max((topic.token_estimate ?? 0) + tokenDelta, 0);

  const updates: Partial<TopicRow> = {
    token_estimate: nextTokenEstimate,
    updated_at: new Date().toISOString(),
  };

  if (summary) {
    updates.summary = summary;
  }

  await (supabase as SupabaseClient<any>)
    .from("conversation_topics")
    .update(updates)
    .eq("id", topicId);
}
