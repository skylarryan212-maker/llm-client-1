import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { RouterDecision } from "@/lib/router/types";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type TopicRow = Database["public"]["Tables"]["conversation_topics"]["Row"];
type ArtifactRow = Database["public"]["Tables"]["artifacts"]["Row"];

type ContextMessage = {
  role: "user" | "assistant";
  content: string;
  type: "message";
};

export interface BuildContextParams {
  supabase: SupabaseClient<Database>;
  conversationId: string;
  routerDecision: RouterDecision;
  contextStrategy?: "minimal" | "recent" | "full";
  maxContextTokens?: number;
}

export interface BuildContextResult {
  messages: ContextMessage[];
  source: "topic" | "fallback";
  includedTopicIds: string[];
}

const DEFAULT_MAX_TOKENS = 400_000;
const FALLBACK_TOKEN_CAP = 200_000;
const SECONDARY_TOPIC_TAIL = 3;

export async function buildContextForMainModel({
  supabase,
  conversationId,
  routerDecision,
  contextStrategy = "recent",
  maxContextTokens = DEFAULT_MAX_TOKENS,
}: BuildContextParams): Promise<BuildContextResult> {
  if (!routerDecision.primaryTopicId) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, contextStrategy);
    return { messages: fallbackMessages, source: "fallback", includedTopicIds: [] };
  }

  const { data: topics, error: topicError } = await supabase
    .from("conversation_topics")
    .select("*")
    .eq("conversation_id", conversationId);

  if (topicError || !Array.isArray(topics)) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, contextStrategy);
    return { messages: fallbackMessages, source: "fallback", includedTopicIds: [] };
  }

  const topicRows: TopicRow[] = Array.isArray(topics) ? topics : [];
  const topicMap = new Map<string, TopicRow>(topicRows.map((topic) => [topic.id, topic]));
  const primaryTopic = topicMap.get(routerDecision.primaryTopicId);
  if (!primaryTopic) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, contextStrategy);
    return { messages: fallbackMessages, source: "fallback", includedTopicIds: [] };
  }

  const contextMessages: ContextMessage[] = [];
  let tokenBudgetRemaining = maxContextTokens;
  const includedTopics = new Set<string>([primaryTopic.id]);

  const pushMessage = (message: ContextMessage) => {
    const tokens = estimateTokens(message.content);
    if (tokens > tokenBudgetRemaining) {
      return false;
    }
    contextMessages.push(message);
    tokenBudgetRemaining -= tokens;
    return true;
  };

  // Add primary topic summary if present
  if (primaryTopic.summary?.trim()) {
    pushMessage({
      role: "assistant",
      content: `[Topic summary: ${primaryTopic.label}] ${primaryTopic.summary.trim()}`,
      type: "message",
    });
  }

  const primaryMessages = await loadTopicMessages(supabase, conversationId, primaryTopic.id);
  const trimmedPrimary = trimMessagesToBudget(primaryMessages, Math.floor(maxContextTokens * 0.7));
  trimmedPrimary.forEach((msg) => pushMessage(toContextMessage(msg)));

  // Load artifacts selected by router
  if (routerDecision.artifactsToLoad.length) {
    const artifacts = await loadArtifactsByIds(
      supabase,
      routerDecision.artifactsToLoad,
      Math.floor(maxContextTokens * 0.2)
    );
    for (const artifact of artifacts) {
      const label = artifact.title || "Unnamed artifact";
      pushMessage({
        role: "assistant",
        content: `[Artifact: ${label}] ${artifact.content}`,
        type: "message",
      });
      if (artifact.topic_id) {
        includedTopics.add(artifact.topic_id);
      }
    }
  }

  // Include summaries from secondary topics
  const secondaryTopics = (routerDecision.secondaryTopicIds || [])
    .map((id) => topicMap.get(id))
    .filter((topic): topic is TopicRow => Boolean(topic));

  if (secondaryTopics.length) {
    const secondaryMessages = await loadSecondaryTopicMessages(
      supabase,
      conversationId,
      secondaryTopics.map((topic) => topic.id)
    );

    for (const topic of secondaryTopics) {
      includedTopics.add(topic.id);
      if (topic.summary?.trim()) {
        pushMessage({
          role: "assistant",
          content: `[Reference summary: ${topic.label}] ${topic.summary.trim()}`,
          type: "message",
        });
      }

      const tailMessages = secondaryMessages
        .filter((msg) => msg.topic_id === topic.id)
        .slice(-SECONDARY_TOPIC_TAIL);

      tailMessages.forEach((msg) =>
        pushMessage({
          role: msg.role as "user" | "assistant",
          content: `[Earlier ${topic.label}] ${sanitizeMessageContent(msg)}`,
          type: "message",
        })
      );
    }
  }

  if (!contextMessages.length) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, contextStrategy);
    return { messages: fallbackMessages, source: "fallback", includedTopicIds: Array.from(includedTopics) };
  }

  return {
    messages: contextMessages,
    source: "topic",
    includedTopicIds: Array.from(includedTopics),
  };
}

async function loadTopicMessages(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  topicId: string
): Promise<MessageRow[]> {
  const { data } = await supabase
    .from("messages")
    .select("id, role, content, metadata, topic_id, created_at")
    .eq("conversation_id", conversationId)
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true });
  return Array.isArray(data) ? data : [];
}

async function loadSecondaryTopicMessages(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  topicIds: string[]
): Promise<MessageRow[]> {
  if (!topicIds.length) {
    return [];
  }
  const { data } = await supabase
    .from("messages")
    .select("id, role, content, metadata, topic_id, created_at")
    .eq("conversation_id", conversationId)
    .in("topic_id", topicIds)
    .order("created_at", { ascending: true });
  return Array.isArray(data) ? data : [];
}

async function loadArtifactsByIds(
  supabase: SupabaseClient<Database>,
  ids: string[],
  tokenBudget: number
): Promise<ArtifactRow[]> {
  if (!ids.length) {
    return [];
  }
  const { data } = await supabase
    .from("artifacts")
    .select("*")
    .in("id", ids);
  const artifacts = Array.isArray(data) ? (data as ArtifactRow[]) : [];
  if (!artifacts.length) {
    return [];
  }

  const selected: ArtifactRow[] = [];
  let budget = tokenBudget;
  for (const artifact of artifacts) {
    const tokens = estimateTokens(artifact.content ?? "");
    if (tokens > budget) {
      continue;
    }
    selected.push(artifact);
    budget -= tokens;
  }
  return selected;
}

async function loadFallbackMessages(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  contextStrategy: "minimal" | "recent" | "full"
): Promise<ContextMessage[]> {
  const limit =
    contextStrategy === "minimal" ? 2 : contextStrategy === "recent" ? 20 : 400;

  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, metadata, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !Array.isArray(data)) {
    return [];
  }

  const sanitized = data.map((msg) => toContextMessage(msg));

  if (contextStrategy === "full") {
    return trimContextMessages(sanitized, FALLBACK_TOKEN_CAP);
  }

  return sanitized;
}

function trimMessagesToBudget(messages: MessageRow[], tokenCap: number): MessageRow[] {
  if (!messages.length) return [];
  let remaining = tokenCap;
  const trimmed: MessageRow[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(sanitizeMessageContent(msg));
    if (tokens > remaining) break;
    trimmed.push(msg);
    remaining -= tokens;
  }
  return trimmed.reverse();
}

function trimContextMessages(messages: ContextMessage[], tokenCap: number): ContextMessage[] {
  let remaining = tokenCap;
  const trimmed: ContextMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content);
    if (tokens > remaining) break;
    trimmed.push(msg);
    remaining -= tokens;
  }
  return trimmed.reverse();
}

function toContextMessage(msg: MessageRow): ContextMessage {
  return {
    role: (msg.role === "assistant" ? "assistant" : "user") as ContextMessage["role"],
    content: sanitizeMessageContent(msg),
    type: "message",
  };
}

function sanitizeMessageContent(msg: MessageRow): string {
  let content = msg.content ?? "";
  if (msg.role === "user") {
    const metadata = msg.metadata as Record<string, unknown> | null | undefined;
    if (metadata && Array.isArray((metadata as { files?: unknown[] }).files)) {
      const attachmentPattern = /\n\nAttachment: [^\n]+ \([^)]+\)(?:\n|$)/g;
      content = content.replace(attachmentPattern, "").trim();
      if (content && !content.includes("[Files attached]")) {
        content = `${content} [Files attached]`;
      }
    }
  }
  return content;
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4) + 4;
}
