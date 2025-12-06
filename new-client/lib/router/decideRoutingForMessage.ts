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
const MAX_RECENT_MESSAGES = 10;
const MAX_ARTIFACTS = 10;

interface DecideRoutingParams {
  supabase: SupabaseClient<Database>;
  conversationId: string;
  userMessage: string;
}

interface RouterContextPayload {
  topics: ConversationTopic[];
  artifacts: Artifact[];
  recentMessages: Pick<Message, "id" | "role" | "content" | "created_at" | "topic_id">[];
}

const routerDecisionSchema = z.object({
  topicAction: z.enum(["continue_active", "new", "reopen_existing"]),
  primaryTopicId: z.union([z.string().uuid(), z.null()]).optional(),
  secondaryTopicIds: z.array(z.string().uuid()).optional().default([]),
  newTopicLabel: z.string().min(1).max(240).optional(),
  newTopicDescription: z.string().min(1).max(500).optional(),
  newParentTopicId: z.union([z.string().uuid(), z.null()]).optional(),
  newTopicSummary: z.string().min(1).max(500).optional(),
  artifactsToLoad: z.array(z.string().uuid()).optional().default([]),
});

export async function decideRoutingForMessage(
  params: DecideRoutingParams
): Promise<RouterDecision> {
  const { supabase, conversationId, userMessage } = params;
  const payload = await loadRouterContextPayload(supabase, conversationId, userMessage);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("[topic-router] OPENAI_API_KEY missing");
  }

  const routerPrompt = buildRouterPrompt(payload, userMessage);

  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model: TOPIC_ROUTER_MODEL,
      input: [
        { role: "system", type: "message", content: TOPIC_ROUTER_SYSTEM_PROMPT },
        { role: "user", type: "message", content: routerPrompt },
      ],
      reasoning: { effort: "low" },
    });

    const outputText = Array.isArray(response.output_text) ? response.output_text.join("\n") : "";
    const parsed = safeJsonParse(outputText);
    const resolvedDecision = await ensureTopicAssignment({
      supabase,
      conversationId,
      decision: validateRouterDecision(parsed),
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
    console.error("[topic-router] Routing failed:", error);
    throw error;
  }
}

function validateRouterDecision(input: unknown): RouterDecision {
  const parsed = routerDecisionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("[topic-router] Router returned invalid JSON");
  }
  const value = parsed.data;
  return {
    topicAction: value.topicAction,
    primaryTopicId: value.primaryTopicId ?? null,
    secondaryTopicIds: value.secondaryTopicIds ?? [],
    newTopicLabel: value.newTopicLabel,
    newTopicDescription: value.newTopicDescription,
    newParentTopicId: value.newParentTopicId ?? null,
    newTopicSummary: value.newTopicSummary,
    artifactsToLoad: value.artifactsToLoad ?? [],
  };
}

async function loadRouterContextPayload(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  userMessage: string
): Promise<RouterContextPayload> {
  const [{ data: topics }, { data: recent }, artifacts] = await Promise.all([
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
  ]);

  return {
    topics: Array.isArray(topics) ? topics : [],
    artifacts,
    recentMessages: Array.isArray(recent) ? recent.reverse() : [],
  };
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
            return `- [${topic.id}] ${topic.label}${parent}${updated}: ${desc} | Summary: ${summary}`;
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
- A topic captures a cohesive subject within the conversation (e.g., “Billing API refactor”).
- A subtopic is nested beneath one topic when a narrower thread emerges (e.g., “Billing API refactor -> data model”).
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
1. Continue the latest topic when the message clearly follows the same thread.
2. Reopen an older topic when the user references its subject directly.
3. Create a new topic when the message clearly starts a distinct project, incident, or task. You may optionally set newParentTopicId to nest under an existing topic.
4. ALWAYS select artifacts that materially help answer the message (reuse existing specs or schemas rather than re-creating them).
5. Use secondaryTopicIds when information from another topic will clearly be referenced.
6. Never invent IDs—only choose from the provided metadata.
7. Name topics in ≤5 title-case words that describe the subject (“Hair Styling Routine”, “Dry Finish Spray Tips”) rather than repeating the literal question text. Subtopics should be equally short and reflect the narrower scope.
8. Always include or update the topic description when the user reframes the objective. Descriptions should be 1–2 sentences explaining the goal, and newTopicSummary must be a concise synopsis (no transcripts).
9. Only request new parent/subtopic IDs when users truly shift focus; otherwise reuse the current topic.`;

function safeJsonParse(text: string): unknown {
  if (!text) return null;
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

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

  if (working.primaryTopicId) {
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
