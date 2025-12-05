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

const SUMMARY_TAIL_LIMIT = 8;
const SUMMARY_MAX_LENGTH = 900;

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
  const summaryParts = tail
    .map((msg) => {
      const roleLabel = msg.role === "assistant" ? "Assistant" : "User";
      const snippet = sanitizeTopicMessageContent(msg as MessageRow)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);
      return snippet ? `${roleLabel}: ${snippet}` : "";
    })
    .filter(Boolean);

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
