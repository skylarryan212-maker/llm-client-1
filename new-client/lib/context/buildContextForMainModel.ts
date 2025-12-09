import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { RouterDecision } from "@/lib/router/types";
import { estimateTokens } from "@/lib/tokens/estimateTokens";
import { sanitizeTopicMessageContent } from "@/lib/topics/messageSanitizer";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type TopicRow = Database["public"]["Tables"]["conversation_topics"]["Row"];
type ArtifactRow = Database["public"]["Tables"]["artifacts"]["Row"];
type ConversationMeta = {
  id: string;
  title: string | null;
  project_id: string | null;
  project_name: string | null;
};

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
const CROSS_CHAT_TOKEN_LIMIT = 200_000;

export async function buildContextForMainModel({
  supabase,
  conversationId,
  routerDecision,
  maxContextTokens = DEFAULT_MAX_TOKENS,
}: BuildContextParams): Promise<BuildContextResult> {
  const requestedTopicIds = [
    routerDecision.primaryTopicId,
    ...(routerDecision.secondaryTopicIds || []),
  ].filter(Boolean) as string[];

  let topicRows: TopicRow[] = [];
  if (requestedTopicIds.length) {
    const { data: topics, error: topicError } = await supabase
      .from("conversation_topics")
      .select("*")
      .in("id", requestedTopicIds);

    if (!topicError && Array.isArray(topics)) {
      topicRows = topics;
    }
  }

  const topicMap = new Map<string, TopicRow>(topicRows.map((topic) => [topic.id, topic]));
  let primaryTopic = routerDecision.primaryTopicId
    ? topicMap.get(routerDecision.primaryTopicId)
    : null;

  if (!primaryTopic && routerDecision.primaryTopicId) {
    // Fallback: attempt to fetch the primary topic directly if not returned above
    const { data: fallbackTopic } = await supabase
      .from("conversation_topics")
      .select("*")
      .eq("id", routerDecision.primaryTopicId)
      .maybeSingle();
    if (fallbackTopic) {
      primaryTopic = fallbackTopic as TopicRow;
      topicRows.push(primaryTopic);
      topicMap.set(primaryTopic.id, primaryTopic);
    }
  }

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

  const involvedConversationIds = new Set<string>([
    conversationId,
    primaryTopic.conversation_id,
    ...topicRows.map((t) => t.conversation_id),
  ]);

  const conversationMeta = await loadConversationMetadata(supabase, Array.from(involvedConversationIds));

  const blockedTopics: TopicRow[] = [];
  if (
    primaryTopic.conversation_id !== conversationId &&
    typeof primaryTopic.token_estimate === "number" &&
    primaryTopic.token_estimate > CROSS_CHAT_TOKEN_LIMIT
  ) {
    blockedTopics.push(primaryTopic);
    primaryTopic = null;
  }

  let secondaryTopics = (routerDecision.secondaryTopicIds || [])
    .map((id) => topicMap.get(id))
    .filter((topic): topic is TopicRow => Boolean(topic));

  secondaryTopics = secondaryTopics.filter((topic) => {
    if (topic.conversation_id === conversationId) return true;
    if (typeof topic.token_estimate !== "number") return true;
    if (topic.token_estimate <= CROSS_CHAT_TOKEN_LIMIT) return true;
    blockedTopics.push(topic);
    return false;
  });

  if (!primaryTopic) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    const blockedNotices = buildBlockedTopicNotices(blockedTopics, conversationMeta, conversationId);
    return {
      messages: blockedNotices.length ? blockedNotices.concat(fallbackMessages) : fallbackMessages,
      source: "fallback",
      includedTopicIds: [],
      summaryCount: blockedNotices.length,
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

  const blockedNotices = buildBlockedTopicNotices(blockedTopics, conversationMeta, conversationId);
  for (const notice of blockedNotices) {
    if (pushMessage(summaryMessages, notice)) {
      summaryCount += 1;
    }
  }
  const primaryOrigin = formatTopicOrigin(primaryTopic, conversationMeta, conversationId);

  if (primaryTopic.summary?.trim()) {
    if (
      pushMessage(summaryMessages, {
        role: "assistant",
        content: `[Topic summary: ${primaryTopic.label} from ${primaryOrigin}] ${primaryTopic.summary.trim()}`,
        type: "message",
      })
    ) {
      summaryCount += 1;
    }
  }

  const primaryMessages = await loadTopicMessages(
    supabase,
    primaryTopic.conversation_id,
    primaryTopic.id
  );

  const secondaryTailText = secondaryTopics.length
    ? await buildSecondaryTailSnippets(
        supabase,
        secondaryTopics.map((topic) => ({ topicId: topic.id, conversationId: topic.conversation_id }))
      )
    : {};

  for (const topic of secondaryTopics) {
    includedTopics.add(topic.id);
    const summaryParts: string[] = [];
    const originLabel = formatTopicOrigin(topic, conversationMeta, conversationId);
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
        content: `[Reference summary: ${topic.label} from ${originLabel}] ${summaryParts.join(" | ")}`,
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

async function loadConversationMetadata(
  supabase: SupabaseClient<Database>,
  conversationIds: string[]
): Promise<Map<string, ConversationMeta>> {
  if (!conversationIds.length) {
    return new Map();
  }

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, title, project_id")
    .in("id", conversationIds);

  const conversationRows: ConversationMeta[] = Array.isArray(conversations)
    ? (conversations as any[]).map((c) => ({
        id: c.id,
        title: c.title ?? null,
        project_id: c.project_id ?? null,
        project_name: null,
      }))
    : [];

  const projectIds = Array.from(
    new Set(conversationRows.map((c) => c.project_id).filter(Boolean))
  );
  const projectNameMap = new Map<string, string | null>();
  if (projectIds.length) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name")
      .in("id", projectIds);
    if (Array.isArray(projects)) {
      projects.forEach((p) => {
        projectNameMap.set(p.id, p.name ?? null);
      });
    }
  }

  const metaMap = new Map<string, ConversationMeta>();
  for (const convo of conversationRows) {
    metaMap.set(convo.id, {
      ...convo,
      project_name: convo.project_id ? projectNameMap.get(convo.project_id) ?? null : null,
    });
  }
  return metaMap;
}

function formatTopicOrigin(
  topic: TopicRow,
  conversationMeta: Map<string, ConversationMeta>,
  activeConversationId: string
): string {
  if (topic.conversation_id === activeConversationId) {
    return "this chat";
  }
  const meta = conversationMeta.get(topic.conversation_id);
  const chatLabel = meta?.title || "another chat";
  if (meta?.project_name) {
    return `${chatLabel} in project ${meta.project_name}`;
  }
  return chatLabel;
}

function buildBlockedTopicNotices(
  blockedTopics: TopicRow[],
  conversationMeta: Map<string, ConversationMeta>,
  activeConversationId: string
): ContextMessage[] {
  if (!blockedTopics.length) return [];
  return blockedTopics.map((topic) => ({
    role: "assistant",
    type: "message",
    content: `[Cross-chat notice] Skipped topic "${topic.label}" from ${formatTopicOrigin(
      topic,
      conversationMeta,
      activeConversationId
    )} because it exceeds the 200k-token cross-chat limit. Inform the user you could not load it.`,
  }));
}

async function loadTopicMessages(
  supabase: SupabaseClient<Database>,
  topicConversationId: string,
  topicId: string
): Promise<MessageRow[]> {
  const { data } = await supabase
    .from("messages")
    .select("id, role, content, metadata, topic_id, created_at")
    .eq("conversation_id", topicConversationId)
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true });
  return Array.isArray(data) ? data : [];
}

async function buildSecondaryTailSnippets(
  supabase: SupabaseClient<Database>,
  topics: Array<{ topicId: string; conversationId: string }>
): Promise<Record<string, string>> {
  if (!topics.length) {
    return {};
  }
  const snippets: Record<string, string> = {};

  for (const topic of topics) {
    const { data } = await supabase
      .from("messages")
      .select("role, content, metadata, topic_id, created_at")
      .eq("conversation_id", topic.conversationId)
      .eq("topic_id", topic.topicId)
      .order("created_at", { ascending: true });

    const rows: MessageRow[] = Array.isArray(data) ? (data as MessageRow[]) : [];
    if (!rows.length) {
      continue;
    }

    const tail = rows.slice(-SECONDARY_TOPIC_TAIL).map((msg) => {
      const label = msg.role === "assistant" ? "Assistant" : "User";
      const snippet = sanitizeTopicMessageContent(msg)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 140);
      return snippet ? `${label}: ${snippet}` : "";
    });
    const summary = tail.filter(Boolean).join(" | ");
    if (summary) {
      snippets[topic.topicId] = summary;
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
