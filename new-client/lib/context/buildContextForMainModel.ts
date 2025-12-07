import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { RouterDecision } from "@/lib/router/types";
import { estimateTokens } from "@/lib/tokens/estimateTokens";
import { sanitizeTopicMessageContent } from "@/lib/topics/messageSanitizer";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type TopicRow = Database["public"]["Tables"]["conversation_topics"]["Row"];
type ArtifactRow = Database["public"]["Tables"]["artifacts"]["Row"];

export type ContextMessage = {
  role: "user" | "assistant";
  content: string;
  type: "message";
};

export interface BuildContextParams {
  supabase: SupabaseClient<Database>;
  conversationId: string;
  routerDecision: RouterDecision;
  maxContextTokens?: number;
}

export interface BuildContextResult {
  messages: ContextMessage[];
  source: "topic" | "fallback";
  includedTopicIds: string[];
  summaryCount: number;
  artifactCount: number;
}

const DEFAULT_MAX_TOKENS = 350_000;
const FALLBACK_TOKEN_CAP = 200_000;
const SECONDARY_TOPIC_TAIL = 3;
const PRIMARY_TOPIC_FULL_THRESHOLD = 280_000;
const PRIMARY_TOPIC_RECENT_TARGET = 200_000;

export async function buildContextForMainModel({
  supabase,
  conversationId,
  routerDecision,
  maxContextTokens = DEFAULT_MAX_TOKENS,
}: BuildContextParams): Promise<BuildContextResult> {
  if (!routerDecision.primaryTopicId) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    return {
      messages: fallbackMessages,
      source: "fallback",
      includedTopicIds: [],
      summaryCount: 0,
      artifactCount: 0,
    };
  }

  const { data: topics, error: topicError } = await supabase
    .from("conversation_topics")
    .select("*")
    .eq("conversation_id", conversationId);

  if (topicError || !Array.isArray(topics)) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    return {
      messages: fallbackMessages,
      source: "fallback",
      includedTopicIds: [],
      summaryCount: 0,
      artifactCount: 0,
    };
  }

  const topicRows: TopicRow[] = topics ?? [];
  const topicMap = new Map<string, TopicRow>(topicRows.map((topic) => [topic.id, topic]));
  const primaryTopic = topicMap.get(routerDecision.primaryTopicId);
  if (!primaryTopic) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    return {
      messages: fallbackMessages,
      source: "fallback",
      includedTopicIds: [],
      summaryCount: 0,
      artifactCount: 0,
    };
  }

  const summaryMessages: ContextMessage[] = [];
  const artifactMessages: ContextMessage[] = [];
  const conversationMessages: ContextMessage[] = [];
  let tokenBudgetRemaining = maxContextTokens;
  const includedTopics = new Set<string>([primaryTopic.id]);
  let summaryCount = 0;
  let artifactCount = 0;

  const pushMessage = (target: ContextMessage[], message: ContextMessage) => {
    const tokens = estimateTokens(message.content);
    if (tokens > tokenBudgetRemaining) {
      return false;
    }
    target.push(message);
    tokenBudgetRemaining -= tokens;
    return true;
  };

  if (primaryTopic.summary?.trim()) {
    if (
      pushMessage(summaryMessages, {
        role: "assistant",
        content: `[Topic summary: ${primaryTopic.label}] ${primaryTopic.summary.trim()}`,
        type: "message",
      })
    ) {
      summaryCount += 1;
    }
  }

  const primaryMessages = await loadTopicMessages(supabase, conversationId, primaryTopic.id);

  const secondaryTopics = (routerDecision.secondaryTopicIds || [])
    .map((id) => topicMap.get(id))
    .filter((topic): topic is TopicRow => Boolean(topic));

  const secondaryTailText = secondaryTopics.length
    ? await buildSecondaryTailSnippets(supabase, conversationId, secondaryTopics.map((topic) => topic.id))
    : {};

  for (const topic of secondaryTopics) {
    includedTopics.add(topic.id);
    const summaryParts: string[] = [];
    if (topic.summary?.trim()) {
      summaryParts.push(topic.summary.trim());
    }
    if (secondaryTailText[topic.id]) {
      summaryParts.push(`Recent notes: ${secondaryTailText[topic.id]}`);
    }
    if (!summaryParts.length) {
      continue;
    }
    if (
      pushMessage(summaryMessages, {
        role: "assistant",
        content: `[Reference summary: ${topic.label}] ${summaryParts.join(" | ")}`,
        type: "message",
      })
    ) {
      summaryCount += 1;
    }
  }

  if (routerDecision.artifactsToLoad.length && tokenBudgetRemaining > 0) {
    const artifactBudget = Math.min(Math.floor(maxContextTokens * 0.2), tokenBudgetRemaining);
    const artifacts = await loadArtifactsByIds(
      supabase,
      routerDecision.artifactsToLoad,
      artifactBudget
    );
    for (const artifact of artifacts) {
      const label = artifact.title || "Unnamed artifact";
      if (
        pushMessage(artifactMessages, {
          role: "assistant",
          content: `[Artifact: ${label}] ${artifact.content}`,
          type: "message",
        })
      ) {
        artifactCount += 1;
        if (artifact.topic_id) {
          includedTopics.add(artifact.topic_id);
        }
      }
    }
  }

  if (tokenBudgetRemaining > 0) {
    const totalPrimaryTokens = estimateTopicMessagesTokens(primaryMessages);
    const allowFullTopic = totalPrimaryTokens <= PRIMARY_TOPIC_FULL_THRESHOLD;
    const topicBudget = allowFullTopic
      ? tokenBudgetRemaining
      : Math.min(PRIMARY_TOPIC_RECENT_TARGET, tokenBudgetRemaining);
    const { trimmed, tokensUsed } = trimMessagesToBudget(primaryMessages, topicBudget);
    tokenBudgetRemaining = Math.max(tokenBudgetRemaining - tokensUsed, 0);
    trimmed.forEach((msg) => conversationMessages.push(toContextMessage(msg)));
  }

  // Place the chronological conversation messages first to keep the prefix as stable as possible
  // for prompt caching. Summaries/artifacts are appended after to avoid shifting the leading tokens.
  const combinedMessages = [...conversationMessages, ...summaryMessages, ...artifactMessages];
  if (!combinedMessages.length) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    return {
      messages: fallbackMessages,
      source: "fallback",
      includedTopicIds: Array.from(includedTopics),
      summaryCount,
      artifactCount,
    };
  }

  const finalMessages = trimContextMessages(
    combinedMessages,
    Math.min(maxContextTokens, DEFAULT_MAX_TOKENS)
  ).trimmed;
  if (!finalMessages.length) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    return {
      messages: fallbackMessages,
      source: "fallback",
      includedTopicIds: Array.from(includedTopics),
      summaryCount,
      artifactCount,
    };
  }

  return {
    messages: finalMessages,
    source: "topic",
    includedTopicIds: Array.from(includedTopics),
    summaryCount,
    artifactCount,
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

async function buildSecondaryTailSnippets(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  topicIds: string[]
): Promise<Record<string, string>> {
  if (!topicIds.length) {
    return {};
  }
  const { data } = await supabase
    .from("messages")
    .select("role, content, metadata, topic_id, created_at")
    .eq("conversation_id", conversationId)
    .in("topic_id", topicIds)
    .order("created_at", { ascending: true });

  const rows: MessageRow[] = Array.isArray(data) ? (data as MessageRow[]) : [];
  if (!rows.length) {
    return {};
  }

  const grouped = new Map<string, MessageRow[]>();
  for (const msg of rows) {
    if (!msg.topic_id) continue;
    if (!grouped.has(msg.topic_id)) {
      grouped.set(msg.topic_id, []);
    }
    grouped.get(msg.topic_id)!.push(msg);
  }

  const snippets: Record<string, string> = {};
  for (const [topicId, messages] of grouped.entries()) {
    const tail = messages.slice(-SECONDARY_TOPIC_TAIL).map((msg) => {
      const label = msg.role === "assistant" ? "Assistant" : "User";
      const snippet = sanitizeTopicMessageContent(msg)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 140);
      return snippet ? `${label}: ${snippet}` : "";
    });
    const summary = tail.filter(Boolean).join(" | ");
    if (summary) {
      snippets[topicId] = summary;
    }
  }
  return snippets;
}

async function loadArtifactsByIds(
  supabase: SupabaseClient<Database>,
  ids: string[],
  tokenBudget: number
): Promise<ArtifactRow[]> {
  if (!ids.length || tokenBudget <= 0) {
    return [];
  }
  const { data } = await supabase.from("artifacts").select("*").in("id", ids);
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
  maxContextTokens: number
): Promise<ContextMessage[]> {
  const FALLBACK_LIMIT = 400;

  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, metadata, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(FALLBACK_LIMIT);

  if (error || !Array.isArray(data)) {
    return [];
  }

  const sanitized = data.map((msg) => toContextMessage(msg as MessageRow));
  return trimContextMessages(
    sanitized,
    Math.min(FALLBACK_TOKEN_CAP, maxContextTokens)
  ).trimmed;
}

function estimateTopicMessagesTokens(messages: MessageRow[]): number {
  return messages.reduce((total, message) => {
    return total + estimateTokens(sanitizeTopicMessageContent(message));
  }, 0);
}

function trimMessagesToBudget(
  messages: MessageRow[],
  tokenCap: number
): { trimmed: MessageRow[]; tokensUsed: number } {
  if (!messages.length || tokenCap <= 0) {
    return { trimmed: [], tokensUsed: 0 };
  }
  let remaining = tokenCap;
  const trimmed: MessageRow[] = [];
  let consumed = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(sanitizeTopicMessageContent(msg));
    if (tokens > remaining) {
      break;
    }
    trimmed.push(msg);
    remaining -= tokens;
    consumed += tokens;
  }
  return { trimmed: trimmed.reverse(), tokensUsed: consumed };
}

function trimContextMessages(
  messages: ContextMessage[],
  tokenCap: number
): { trimmed: ContextMessage[]; tokensUsed: number } {
  if (!messages.length || tokenCap <= 0) {
    return { trimmed: [], tokensUsed: 0 };
  }
  let remaining = tokenCap;
  const trimmed: ContextMessage[] = [];
  let consumed = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content);
    if (tokens > remaining) {
      break;
    }
    trimmed.push(msg);
    remaining -= tokens;
    consumed += tokens;
  }
  return { trimmed: trimmed.reverse(), tokensUsed: consumed };
}

function toContextMessage(msg: MessageRow): ContextMessage {
  return {
    role: (msg.role === "assistant" ? "assistant" : "user") as ContextMessage["role"],
    content: sanitizeTopicMessageContent(msg),
    type: "message",
  };
}
