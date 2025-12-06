import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { estimateTokens } from "@/lib/tokens/estimateTokens";
import { sanitizeTopicMessageContent } from "@/lib/topics/messageSanitizer";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type TopicRow = Database["public"]["Tables"]["conversation_topics"]["Row"];

interface UpdateTopicSnapshotParams {
  supabase: SupabaseClient<Database>;
  topicId: string;
  latestMessage?: MessageRow | null;
}


export async function updateTopicSnapshot({
  supabase,
  topicId,
  latestMessage,
}: UpdateTopicSnapshotParams): Promise<void> {
  if (!topicId) {
    return;
  }

  const { data: topicData, error: topicError } = await supabase
    .from("conversation_topics")
    .select("id, token_estimate")
    .eq("id", topicId)
    .limit(1)
    .maybeSingle();

  const topic = (topicData as TopicRow | null) ?? null;
  if (!topic || topicError) {
    return;
  }

  const tokenDelta = latestMessage
    ? estimateTokens(sanitizeTopicMessageContent(latestMessage))
    : 0;
  const nextTokenEstimate = Math.max((topic.token_estimate ?? 0) + tokenDelta, 0);

  const updates: Partial<TopicRow> = {
    token_estimate: nextTokenEstimate,
    updated_at: new Date().toISOString(),
  };

  await (supabase as SupabaseClient<any>)
    .from("conversation_topics")
    .update(updates)
    .eq("id", topicId);
}
