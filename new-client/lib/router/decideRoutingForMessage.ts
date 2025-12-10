import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  Database,
  ConversationTopic,
  ConversationTopicInsert,
  ConversationTopicUpdate,
  Artifact,
  Message,
} from "@/lib/supabase/types";
import type { RouterDecision } from "@/lib/router/types";
import { logUsageRecord } from "@/lib/usage";
import { callDeepInfraGemma } from "@/lib/deepInfraGemma";

const TOPIC_ROUTER_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo";
const ALLOWED_ROUTER_MODELS = new Set(["meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"]);
const MAX_RECENT_MESSAGES = 10;
const MAX_ARTIFACTS = 10;

interface DecideRoutingParams {
  supabase: SupabaseClient<Database>;
  conversationId: string;
  userMessage: string;
  projectId?: string | null;
  userId: string;
  conversationTitle?: string | null;
  projectName?: string | null;
}

interface RouterContextPayload {
  topics: Array<
    ConversationTopic & {
      conversation_title?: string | null;
      project_id?: string | null;
      is_cross_conversation?: boolean;
    }
  >;
  artifacts: Artifact[];
  recentMessages: Pick<Message, "id" | "role" | "content" | "created_at" | "topic_id">[];
  projectId?: string | null;
  projectName?: string | null;
  conversationTitle?: string | null;
}

const baseRouterFields = {
  primaryTopicId: z.union([z.string().uuid(), z.null()]).optional(),
  secondaryTopicIds: z.array(z.string().uuid()).optional().default([]),
  newParentTopicId: z.union([z.string().uuid(), z.null()]).optional(),
  artifactsToLoad: z.array(z.string().uuid()).optional().default([]),
};

const newTopicPayload = z.object({
  topicAction: z.literal("new"),
  ...baseRouterFields,
  newTopicLabel: z.string().min(1).max(240),
  newTopicDescription: z.string().max(500).optional().default(""),
  newTopicSummary: z.string().max(500).optional().default(""),
});

const existingTopicPayload = z.object({
  topicAction: z.enum(["continue_active", "reopen_existing"]),
  ...baseRouterFields,
  newTopicLabel: z.string().max(240).nullable().optional().default(""),
  newTopicDescription: z.string().max(500).nullable().optional().default(""),
  newTopicSummary: z.string().max(500).nullable().optional().default(""),
});

const routerDecisionSchema = z.union([newTopicPayload, existingTopicPayload]);

export async function decideRoutingForMessage(
  params: DecideRoutingParams
): Promise<RouterDecision> {
  const { supabase, conversationId, userMessage, projectId, userId, conversationTitle, projectName } = params;
  const payload = await loadRouterContextPayload(
    supabase,
    conversationId,
    userMessage,
    projectId,
    userId,
    conversationTitle,
    projectName
  );

  const routerPrompt = buildRouterPrompt(payload, userMessage);

  try {
    const parsed = await callRouterWithSchema(routerPrompt, {
      userId,
      conversationId,
    });
    const resolvedDecision = await ensureTopicAssignment({
      supabase,
      conversationId,
      decision: parsed,
      userMessage,
    });

    // Sanity-check against actual topics/artifacts
    const topicIds = new Set(payload.topics.map((topic) => topic.id));
    if (resolvedDecision.primaryTopicId) {
      topicIds.add(resolvedDecision.primaryTopicId);
    }
    if (resolvedDecision.primaryTopicId && !topicIds.has(resolvedDecision.primaryTopicId)) {
      throw new Error("[topic-router] Router referenced unknown topic id");
    }
    resolvedDecision.secondaryTopicIds = resolvedDecision.secondaryTopicIds.filter((id) =>
      topicIds.has(id)
    );

    const artifactIds = new Set(payload.artifacts.map((artifact) => artifact.id));
    resolvedDecision.artifactsToLoad = resolvedDecision.artifactsToLoad.filter((id) =>
      artifactIds.has(id)
    );

    return resolvedDecision;
  } catch (error) {
    console.error("[topic-router] Routing failed, using fallback:", error);
    const lastTopicId =
      payload.recentMessages
        .map((msg) => msg.topic_id)
        .filter((id): id is string => Boolean(id))
        .pop() ?? null;
    const fallbackDecision: RouterDecision = {
      topicAction: "continue_active",
      primaryTopicId: lastTopicId,
      secondaryTopicIds: [],
      newTopicLabel: "",
      newTopicDescription: "",
      newParentTopicId: null,
      newTopicSummary: "",
      artifactsToLoad: [],
    };
    return await ensureTopicAssignment({
      supabase,
      conversationId,
      decision: fallbackDecision,
      userMessage,
    });
  }
}

async function loadRouterContextPayload(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  userMessage: string,
  projectId?: string | null,
  userId?: string,
  conversationTitle?: string | null,
  projectName?: string | null
): Promise<RouterContextPayload> {
  const [{ data: topics }, { data: recent }, artifacts, crossChatTopics] = await Promise.all([
    supabase
      .from("conversation_topics")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("messages")
      .select("id, role, content, created_at, topic_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(MAX_RECENT_MESSAGES),
    loadCandidateArtifacts(supabase, conversationId, userMessage),
    loadCrossConversationTopics(supabase, conversationId, projectId, userId),
  ]);

  const mergedTopics = [
    ...(Array.isArray(topics)
      ? (topics as ConversationTopic[]).map((topic) => ({ ...topic, is_cross_conversation: false }))
      : []),
    ...crossChatTopics,
  ];

  return {
    topics: mergedTopics,
    artifacts,
    recentMessages: Array.isArray(recent) ? recent.reverse() : [],
    projectId,
    projectName,
    conversationTitle,
  };
}

const CROSS_CHAT_TOKEN_LIMIT = 200_000;
const MAX_FOREIGN_CONVERSATIONS = 12;
const MAX_FOREIGN_TOPICS = 50;

async function loadCrossConversationTopics(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  projectId?: string | null,
  userId?: string
): Promise<RouterContextPayload["topics"]> {
  const conversationQuery = supabase
    .from("conversations")
    .select("id, title, project_id")
    .neq("id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_FOREIGN_CONVERSATIONS);

  if (projectId) {
    conversationQuery.eq("project_id", projectId);
  }
  if (userId) {
    conversationQuery.eq("user_id", userId);
  }

  const { data: otherConversations } = await conversationQuery;
  const conversationRows = (Array.isArray(otherConversations)
    ? otherConversations
    : []) as Array<Pick<Database["public"]["Tables"]["conversations"]["Row"], "id" | "title" | "project_id">>;

  if (!conversationRows.length) {
    return [];
  }

  const conversationMap = new Map(
    conversationRows.map((row) => [row.id, { title: row.title, project_id: row.project_id }])
  );
  const conversationIds = Array.from(conversationMap.keys());

  const { data: topicRows } = await supabase
    .from("conversation_topics")
    .select("*")
    .in("conversation_id", conversationIds)
    .lte("token_estimate", CROSS_CHAT_TOKEN_LIMIT)
    .order("updated_at", { ascending: false })
    .limit(MAX_FOREIGN_TOPICS);

  if (!Array.isArray(topicRows)) {
    return [];
  }

  const isConversationTopic = (topic: unknown): topic is ConversationTopic =>
    topic !== null &&
    typeof topic === "object" &&
    "id" in topic &&
    "conversation_id" in topic &&
    "label" in topic;

  const validTopics: ConversationTopic[] = topicRows.filter(isConversationTopic);

  return validTopics.map((topic) => ({
    ...topic,
    is_cross_conversation: true,
    conversation_title: conversationMap.get(topic.conversation_id)?.title ?? null,
    project_id: conversationMap.get(topic.conversation_id)?.project_id ?? null,
  }));
}

async function loadCandidateArtifacts(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  userMessage: string
): Promise<Artifact[]> {
  const keywords = buildKeywordList(userMessage);
  let query = supabase
    .from("artifacts")
    .select("id, conversation_id, topic_id, type, title, summary, created_at, keywords")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(60);

  if (keywords.length) {
    const clauses = keywords.flatMap((kw) => [
      `title.ilike.%${kw}%`,
      `summary.ilike.%${kw}%`,
      `keywords.cs.{\"${kw}\"}`,
    ]);
    if (clauses.length) {
      query = query.or(clauses.join(","));
    }
  }

  const { data } = await query;
  const artifacts = Array.isArray(data) ? (data as Artifact[]) : [];
  if (!artifacts.length) {
    return [];
  }

  if (artifacts.length <= MAX_ARTIFACTS) {
    return artifacts;
  }
  return artifacts.slice(0, MAX_ARTIFACTS);
}

function buildKeywordList(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 4 && token.length <= 32)
    .slice(0, 8);
}

function buildRouterPrompt(payload: RouterContextPayload, userMessage: string): string {
  const workspaceContext = [
    payload.projectId
      ? `Project: ${payload.projectName ?? "(unnamed project)"} [${payload.projectId}]`
      : "No active project (global chat).",
    `Current chat: ${payload.conversationTitle ?? "Untitled chat"} [${
      payload.projectId ? "project" : "global"
    }]`,
    "You may reuse topics from other chats listed below if their token estimate is under 200k tokens.",
  ].join("\n");

  const recentSection =
    payload.recentMessages.length > 0
      ? payload.recentMessages
          .map((msg) => {
            const preview = (msg.content || "").replace(/\s+/g, " ").slice(0, 240);
            return `- ${msg.role} @ ${msg.created_at ?? "unknown"}${msg.topic_id ? ` [topic:${msg.topic_id}]` : ""}: ${preview}`;
          })
          .join("\n")
      : "No prior messages.";

  const topicSection =
    payload.topics.length > 0
      ? payload.topics
          .map((topic) => {
            const parent = topic.parent_topic_id
              ? ` (child of ${topic.parent_topic_id})`
              : "";
            const desc = topic.description?.replace(/\s+/g, " ").slice(0, 200) ?? "No description yet.";
            const updated = topic.updated_at ? ` updated ${topic.updated_at}` : "";
            const summary =
              topic.summary?.replace(/\s+/g, " ").slice(0, 180) ?? "No summary yet.";
            const locationLabel = topic.is_cross_conversation
              ? `other chat: ${topic.conversation_title ?? topic.conversation_id}`
              : "current chat";
            const tokenLabel = typeof topic.token_estimate === "number"
              ? ` ~${Math.round(topic.token_estimate)} tokens`
              : "";
            return `- [${topic.id}] ${topic.label}${parent}${updated} (${locationLabel}${tokenLabel}): ${desc} | Summary: ${summary}`;
          })
          .join("\n")
      : "No topics exist yet.";

  const artifactSection =
    payload.artifacts.length > 0
      ? payload.artifacts
          .map((artifact) => {
            const summary = artifact.summary?.replace(/\s+/g, " ").slice(0, 180) ?? "No summary.";
            const topic = artifact.topic_id ? ` (topic ${artifact.topic_id})` : "";
            return `- [${artifact.id}] ${artifact.title}${topic} | ${artifact.type} | ${summary}`;
          })
          .join("\n")
      : "No artifacts found.";

  return [
    "You are the topic router. Review the new user message and metadata below.",
    "Workspace context:",
    workspaceContext,
    "",
    "Recent conversation snippets:",
    recentSection,
    "",
    "Existing topics/subtopics:",
    topicSection,
    "",
    "Candidate artifacts:",
    artifactSection,
    "",
    "User message:",
    userMessage,
    "",
    "Decide which topic/subtopic this belongs to, whether to create or reopen topics, and which artifacts to preload.",
  ].join("\n");
}

const TOPIC_ROUTER_SYSTEM_PROMPT = `You are a topic routing helper for a single conversation.

You are NOT the assistant that replies to the user. You NEVER answer questions, never call tools, and never output explanations or markdown. Your ONLY job is to decide how this message fits into the existing topic tree and which artifacts to load, and to output ONE JSON object.

You receive:
- The active topic id (if any).
- A list of existing topics with ids, labels, parent ids, and summaries.
- A list of artifacts with ids, labels, and linked topic ids.
- A short window of recent messages.

Your job is to decide:
- Whether this message CONTINUES the active topic, OPENS a NEW topic, or REOPENS an existing topic.
- Which topic id is primary.
- Which other topic ids should be treated as secondary (cross-topic context).
- Whether a new topic should be created, with an optional parent.
- Which artifacts (by id) should be loaded as context.

Return EXACTLY one JSON object with these keys and types:
{
  "topicAction": "continue_active" | "new" | "reopen_existing",
  "primaryTopicId": string | null,
  "secondaryTopicIds": string[],        // always an array, may be empty
  "newTopicLabel": string | null,       // 3–5 title-case words when used
  "newTopicDescription": string | null, // <= 120 chars
  "newTopicSummary": string | null,     // <= 160 chars
  "newParentTopicId": string | null,    // existing topic id or null
  "artifactsToLoad": string[]           // artifact ids, array, may be empty
}

Hard invariants:

1) topicAction meanings:
   - "continue_active": user is following up on the active topic or implicitly referring to it.
   - "new": user clearly changes subject or starts a fresh thread that does not match any existing topic.
   - "reopen_existing": user explicitly names or clearly refers back to a prior topic that is not the active one.

2) Field combinations:
   - If topicAction === "continue_active":
     - primaryTopicId MUST equal the active topic id (if one exists).
     - newTopicLabel, newTopicDescription, newTopicSummary, newParentTopicId MUST all be null.
   - If topicAction === "new":
     - primaryTopicId MUST be null.
     - newTopicLabel, newTopicDescription, newTopicSummary MUST be non-empty strings.
     - newParentTopicId MAY be a parent topic id when the new topic is clearly a child of a specific existing top-level topic; otherwise null.
   - If topicAction === "reopen_existing":
     - primaryTopicId MUST be one of the existing topic ids.
     - newTopicLabel, newTopicDescription, newTopicSummary, newParentTopicId MUST all be null.

3) Topic hierarchy rules:
   - Subtopics are allowed only directly under top-level topics.
   - NEVER create subtopic-under-subtopic chains.
   - NEVER use generic/greeting/empty topics as parents for new subtopics.
   - When in doubt about hierarchy, set newParentTopicId to null and create a top-level topic.

4) IDs:
   - primaryTopicId, secondaryTopicIds, newParentTopicId, artifactsToLoad MUST use ONLY ids from the provided lists. NEVER invent ids.

5) secondaryTopicIds:
   - Use only when the user clearly references or depends on content from other specific topics.
   - Must be a list of existing topic ids, excluding the primaryTopicId.
   - At most 3 secondaryTopicIds.

6) artifactsToLoad:
   - Choose at most 3 artifact ids.
   - Prefer artifacts explicitly referenced by name or clearly tied to the chosen primaryTopicId or secondaryTopicIds.
   - Do NOT select artifacts “just in case.”

7) Naming and summaries for new topics:
   - newTopicLabel: 3–5 words, title case, specific (<= 60 chars).
   - newTopicDescription: one concise sentence (<= 120 chars).
   - newTopicSummary: one or two sentences summarizing the topic so far (<= 160 chars).

8) Output rules:
   - Respond with ONE JSON object only.
   - No markdown, no surrounding text, no comments.
   - Do NOT answer the user’s question or generate any content besides the routing JSON.`;

async function ensureTopicAssignment({
  supabase,
  conversationId,
  decision,
  userMessage,
}: {
  supabase: SupabaseClient<Database>;
  conversationId: string;
  decision: RouterDecision;
  userMessage: string;
}): Promise<RouterDecision> {
  const working = { ...decision };
  const needsNewTopic =
    working.topicAction === "new" ||
    (!working.primaryTopicId);

  // Never carry parent IDs forward on non-new actions and guard against self-parenting
  if (working.topicAction !== "new") {
    working.newParentTopicId = null;
  } else if (working.newParentTopicId && working.newParentTopicId === working.primaryTopicId) {
    working.newParentTopicId = null;
  }

  if (needsNewTopic) {
    const rawLabel =
      working.newTopicLabel?.trim() || buildAutoTopicLabel(userMessage) || "Pending topic";
    const label = formatTopicLabel(rawLabel);
    const description =
      working.newTopicDescription?.trim() || buildAutoTopicDescription(userMessage);
    const parentId = working.newParentTopicId ?? null;

    const topicInsert: ConversationTopicInsert = {
      conversation_id: conversationId,
      label: label.slice(0, 120),
      description,
      parent_topic_id: parentId,
      summary: working.newTopicSummary?.trim() || description || null,
    };

    const { data: inserted, error } = await (supabase as SupabaseClient<any>)
      .from("conversation_topics")
      .insert([topicInsert])
      .select()
      .single();

    if (error || !inserted) {
      throw new Error("[topic-router] Failed to insert topic");
    }
    working.primaryTopicId = inserted.id;
    console.log(
      `[topic-router] Created topic ${inserted.id} label="${inserted.label}" parent=${
        inserted.parent_topic_id ?? "none"
      }`
    );
    return working;
  }

  if (working.primaryTopicId && working.topicAction === "reopen_existing") {
    const metaUpdates: Partial<ConversationTopic> = {};
    if (working.newTopicLabel?.trim()) {
      metaUpdates.label = formatTopicLabel(working.newTopicLabel);
    }
    if (working.newTopicDescription?.trim()) {
      metaUpdates.description = working.newTopicDescription.trim().slice(0, 500);
    }
    if (working.newTopicSummary?.trim()) {
      metaUpdates.summary = working.newTopicSummary.trim().slice(0, 500);
    }
    if (Object.keys(metaUpdates).length) {
      metaUpdates.updated_at = new Date().toISOString();
      try {
        await (supabase as SupabaseClient<any>)
          .from("conversation_topics")
          .update(metaUpdates as ConversationTopicUpdate)
          .eq("id", working.primaryTopicId);
        console.log(
          `[topic-router] Updated topic ${working.primaryTopicId} metadata (label: ${
            metaUpdates.label ? `"${metaUpdates.label}"` : "unchanged"
          }, description: ${metaUpdates.description ? "updated" : "unchanged"})`
        );
      } catch (updateErr) {
        console.error("[topic-router] Failed to update topic metadata:", updateErr);
      }
    }
  }

  return working;
}

const LABEL_STOP_WORDS = new Set([
  "hey",
  "hi",
  "hello",
  "i",
  "im",
  "i'm",
  "i’d",
  "need",
  "please",
  "please",
  "can",
  "could",
  "should",
  "would",
  "you",
  "your",
  "me",
  "my",
  "the",
  "and",
  "about",
  "for",
  "with",
  "what",
  "how",
  "need",
  "want",
  "idea",
  "help",
]);

function formatTopicLabel(raw: string): string {
  if (!raw) {
    return "Pending Topic";
  }
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const filtered = words.filter((word) => !LABEL_STOP_WORDS.has(word));
  const source = (filtered.length ? filtered : words).slice(0, 5);
  const label = source
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .trim();
  return label || "Pending Topic";
}

function buildAutoTopicLabel(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return "Pending Topic";
  return formatTopicLabel(clean);
}

function buildAutoTopicDescription(message: string): string | null {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const sentence = clean.slice(0, 280);
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}
async function callRouterWithSchema(
  routerPrompt: string,
  ctx?: { userId?: string; conversationId?: string }
): Promise<RouterDecision> {
  const schema = {
    type: "object",
    properties: {
      topicAction: { type: "string", enum: ["continue_active", "new", "reopen_existing"] },
      primaryTopicId: { type: ["string", "null"], format: "uuid" },
      secondaryTopicIds: {
        type: "array",
        items: { type: "string", format: "uuid" },
        default: [],
      },
      newTopicLabel: { type: "string" },
      newTopicDescription: { type: "string" },
      newParentTopicId: { type: ["string", "null"], format: "uuid" },
      newTopicSummary: { type: "string" },
      artifactsToLoad: {
        type: "array",
        items: { type: "string", format: "uuid" },
        default: [],
      },
    },
    required: [
      "topicAction",
      "primaryTopicId",
      "secondaryTopicIds",
      "newTopicLabel",
      "newTopicDescription",
      "newParentTopicId",
      "newTopicSummary",
      "artifactsToLoad",
    ],
    additionalProperties: false,
  };

  let lastError: unknown = null;
  const forceJsonReminder =
    "CRITICAL: Respond with ONLY raw JSON that matches the schema. Do not add any commentary, markdown, or prose. Start with '{' and end with '}'. One object only.";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const extraNudge =
        attempt === 1
          ? "\n\nSECOND TRY: STRICT JSON ONLY. Begin with { and end with }. No explanations."
          : "";
      const { text, usage } = await callDeepInfraGemma({
        messages: [
          {
            role: "system",
            content: `${TOPIC_ROUTER_SYSTEM_PROMPT}\n\n${forceJsonReminder}${extraNudge}`,
          },
          { role: "user", content: `${routerPrompt}\n\n${forceJsonReminder}${extraNudge}` },
        ],
        schemaName: "router_decision",
        schema,
        model: TOPIC_ROUTER_MODEL,
      });
      const usageInfo = usage;
      if (ctx?.userId && usageInfo) {
        await logUsageRecord({
          userId: ctx.userId,
          conversationId: ctx.conversationId ?? null,
          model: TOPIC_ROUTER_MODEL,
          inputTokens: usageInfo.input_tokens ?? 0,
          cachedTokens: 0,
          outputTokens: usageInfo.output_tokens ?? 0,
        });
      }
      let validatedData: z.infer<typeof routerDecisionSchema>;
      try {
        const cleaned = text.trim();
        console.warn("[topic-router] RAW OUTPUT:", cleaned);
        const parsed = parseJsonLoose(cleaned);
        validatedData = routerDecisionSchema.parse(parsed);
      } catch (err) {
        console.error("[topic-router] SCHEMA ERROR:", err);
        console.error("[topic-router] RAW OUTPUT THAT FAILED:", text);
        // If the model failed to return JSON, fall back to a minimal continue_active decision
        validatedData = routerDecisionSchema.parse({
          topicAction: "continue_active",
          primaryTopicId: null,
          secondaryTopicIds: [],
          newTopicLabel: "",
          newTopicDescription: "",
          newParentTopicId: null,
          newTopicSummary: "",
          artifactsToLoad: [],
        });
      }
      return {
        topicAction: validatedData.topicAction,
        primaryTopicId: validatedData.primaryTopicId ?? null,
        secondaryTopicIds: validatedData.secondaryTopicIds ?? [],
        newTopicLabel: typeof validatedData.newTopicLabel === "string" ? validatedData.newTopicLabel : "",
        newTopicDescription:
          typeof validatedData.newTopicDescription === "string" ? validatedData.newTopicDescription : "",
        newParentTopicId: validatedData.newParentTopicId ?? null,
        newTopicSummary:
          typeof validatedData.newTopicSummary === "string" ? validatedData.newTopicSummary : "",
        artifactsToLoad: validatedData.artifactsToLoad ?? [],
      };
    } catch (error) {
      lastError = error;
      console.warn("[topic-router] Router attempt failed:", error);
    }
  }
  throw lastError || new Error("[topic-router] Router failed after retries");
}

function parseJsonLoose(raw: string) {
  const withoutFences = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(withoutFences);
  } catch {
    const match = withoutFences.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("No JSON object found");
  }
}
















