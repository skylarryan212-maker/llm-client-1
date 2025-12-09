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

const TOPIC_ROUTER_MODEL = process.env.TOPIC_ROUTER_MODEL_ID ?? "gpt-5-nano-2025-08-07";
const ALLOWED_ROUTER_MODELS = new Set(["gpt-5-nano-2025-08-07", "gpt-5-mini-2025-05-28"]);
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
  newTopicDescription: z.string().min(1).max(500),
  newTopicSummary: z.string().min(1).max(500),
});

const existingTopicPayload = z.object({
  topicAction: z.enum(["continue_active", "reopen_existing"]),
  ...baseRouterFields,
  newTopicLabel: z.string().max(240).optional().default(""),
  newTopicDescription: z.string().max(500).optional().default(""),
  newTopicSummary: z.string().max(500).optional().default(""),
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

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("[topic-router] OPENAI_API_KEY missing");
  }

  if (!ALLOWED_ROUTER_MODELS.has(TOPIC_ROUTER_MODEL)) {
    console.warn(
      `[topic-router] Router model ${TOPIC_ROUTER_MODEL} is not nano/mini; defaulting to gpt-5-nano-2025-08-07 for latency control`
    );
  }

  const routerPrompt = buildRouterPrompt(payload, userMessage);

  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const parsed = await callRouterWithSchema(openai, routerPrompt);
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

  return topicRows
    .filter((topic): topic is ConversationTopic => Boolean(topic) && typeof topic === "object")
    .map((topic) => ({
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
    .select("id, conversation_id, topic_id, type, title, summary, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (keywords.length) {
    const clauses = keywords.flatMap((kw) => [
      `title.ilike.%${kw}%`,
      `summary.ilike.%${kw}%`,
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

const TOPIC_ROUTER_SYSTEM_PROMPT = `You organize a single conversation into lightweight topics and subtopics.

Definitions:
- A topic captures a cohesive subject within the conversation (e.g., â€œBilling API refactorâ€).
- A subtopic is nested beneath one topic when a narrower thread emerges (e.g., â€œBilling API refactor -> data modelâ€).
- Artifacts are named resources (schemas, specs, code) that can be reused later.

Outputs must obey this JSON schema (no markdown, no commentary):
{
  "topicAction": "continue_active" | "new" | "reopen_existing",
  "primaryTopicId": "uuid or null",
  "secondaryTopicIds": ["uuid"],
  "newTopicLabel": "string?",
  "newTopicDescription": "string?",
  "newParentTopicId": "uuid|null?",
  "newTopicSummary": "string?",
 "artifactsToLoad": ["artifact-id"]
}

Rules:
1. Topic continuation vs new topic:
   - Use semantic comprehension of the entire conversation to decide whether the latest user message is a follow-up or a new project. Do not rely on superficial keyword overlap.
   - If the user clearly refers back to earlier assistant content (e.g., "what were the API key table values again?", "remind me what you said about X", "what was that schema you wrote before?", "those values you mentioned earlier", "explain that part again/in more detail"), treat it as continuation unless they explicitly request a new, unrelated project.
   - Prefer "continue_active" for these referential follow-ups so the main model retains the existing topic history. Only choose "new" when the user genuinely switches subjects or explicitly says they want a new topic/thread.
   - If the user explicitly names or clearly points to a different existing topic than the active one (e.g., "back to PF schema", "return to the API keys topic"), select that matching topic and use "reopen_existing" rather than continuing the current thread. Only stay "continue_active" if the new message best aligns with the currently active topic.
2. Topic hierarchy:
   - NEVER nest under generic or empty topics ("General chat", single-word greetings, topics with <50 tokens). If the parent is vague or brand new, leave newParentTopicId null so the topic stays top-level.
   - You may create unlimited subtopics under a top-level topic that has meaningful content, but DO NOT create a subtopic under another subtopic. Subtopics must be direct children of a top-level topic only (e.g., "IFR vs VFR" under "Aviation" is allowed; "Deep dive" under "IFR vs VFR" is not).
3. Model-selection constraints:
   - Treat the previous model on a topic as the minimum baseline whenever topicAction is "continue_active". Capability tiers from highest to lowest: gpt-5.1, gpt-5-mini, gpt-5-nano.
   - You may keep the same tier, upgrade, or (only if the new message is extremely simple/low-stakes and does not depend on detailed continuity) downgrade by two tiers (e.g., gpt-5.1 â†’ gpt-5-nano). One-tier downgrades on continuing topics (gpt-5.1 â†’ gpt-5-mini or gpt-5-mini â†’ gpt-5-nano) are forbidden. If you find yourself considering a one-tier drop, override that instinct and stay at the previous tier.
4. Artifacts and cross-topic references:
   - ALWAYS select artifacts that materially help answer the message (reuse existing specs or schemas rather than re-creating them).
   - Use secondaryTopicIds when information from another topic will clearly be referenced.
5. Topic naming and summaries:
   - Name topics in 3-5 title-case words that describe the subject ("Hair Styling Routine", "Dry Finish Spray Tips") rather than repeating the literal question text. Subtopics should be equally short and reflect the narrower scope.
   - Keep outputs ultra-short: newTopicLabel ≤ 60 chars; newTopicDescription ≤ 120 chars (single sentence); newTopicSummary ≤ 160 chars (single-sentence synopsis, no transcript). Shorten further if unsure.
6. Parent/subtopic creation:
   - When you create a new topic, you MAY set newParentTopicId to an existing top-level topic to create a subtopic if the message is clearly a narrower thread of that parent.
   - Never set newParentTopicId on continue/reopen actions.
   - Do NOT create subtopics of subtopics; newParentTopicId must point to a top-level topic.
   - If no obvious parent exists, create a top-level topic (leave newParentTopicId null) rather than forcing a subtopic.
7. No invented IDs:
   - Never invent topic or artifact IDs. Only choose from the provided metadata.`;

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
  "iâ€™d",
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
async function callRouterWithSchema(openai: any, routerPrompt: string): Promise<RouterDecision> {
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await openai.responses.create({
        model: ALLOWED_ROUTER_MODELS.has(TOPIC_ROUTER_MODEL)
          ? TOPIC_ROUTER_MODEL
          : "gpt-5-nano-2025-08-07",
        input: [
          { role: "system", type: "message", content: TOPIC_ROUTER_SYSTEM_PROMPT },
          { role: "user", type: "message", content: routerPrompt },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "router_decision",
            schema,
          },
        },
        reasoning: { effort: "low" },
      });
      const textOutput =
        response?.output?.find((item: any) => item.type === "message")?.content?.[0]?.text ?? "";
      let validatedData: z.infer<typeof routerDecisionSchema>;
      try {
        const cleaned = textOutput.trim();
        console.warn("[topic-router] RAW OUTPUT:", cleaned);
        const parsed = JSON.parse(cleaned);
        validatedData = routerDecisionSchema.parse(parsed);
      } catch (err) {
        console.error("[topic-router] SCHEMA ERROR:", err);
        console.error("[topic-router] RAW OUTPUT THAT FAILED:", textOutput);
        throw new Error("[topic-router] Router output failed schema validation");
      }
      return {
        topicAction: validatedData.topicAction,
        primaryTopicId: validatedData.primaryTopicId ?? null,
        secondaryTopicIds: validatedData.secondaryTopicIds ?? [],
        newTopicLabel: validatedData.newTopicLabel,
        newTopicDescription: validatedData.newTopicDescription,
        newParentTopicId: validatedData.newParentTopicId ?? null,
        newTopicSummary: validatedData.newTopicSummary,
        artifactsToLoad: validatedData.artifactsToLoad ?? [],
      };
    } catch (error) {
      lastError = error;
      console.warn("[topic-router] Router attempt failed:", error);
    }
  }
  throw lastError || new Error("[topic-router] Router failed after retries");
}
















