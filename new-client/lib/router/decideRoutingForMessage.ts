import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ConversationTopic, Artifact, Message } from "@/lib/supabase/types";
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

const routerDecisionDefaults: RouterDecision = {
  topicAction: "continue_active",
  primaryTopicId: null,
  secondaryTopicIds: [],
  artifactsToLoad: [],
};

export function createFallbackTopicDecision(activeTopicId?: string | null): RouterDecision {
  return {
    ...routerDecisionDefaults,
    primaryTopicId: activeTopicId ?? null,
  };
}

export async function decideRoutingForMessage(
  params: DecideRoutingParams
): Promise<RouterDecision> {
  const { supabase, conversationId, userMessage } = params;
  const payload = await loadRouterContextPayload(supabase, conversationId, userMessage);
  const fallback = createFallbackTopicDecision(
    payload.recentMessages.find((msg) => msg.topic_id)?.topic_id ?? null
  );

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[topic-router] OPENAI_API_KEY missing, falling back to defaults");
    return fallback;
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
    let resolvedDecision = await ensureTopicAssignment({
      supabase,
      conversationId,
      decision: validateRouterDecision(parsed, fallback),
      fallback,
      userMessage,
    });

    // Sanity-check against actual topics/artifacts
    const topicIds = new Set(payload.topics.map((topic) => topic.id));
    if (resolvedDecision.primaryTopicId && !topicIds.has(resolvedDecision.primaryTopicId)) {
      // Router referenced unknown topic; treat as fallback/auto topic
      resolvedDecision = await ensureTopicAssignment({
        supabase,
        conversationId,
        decision: { ...resolvedDecision, primaryTopicId: null },
        fallback,
        userMessage,
      });
    }
    resolvedDecision.secondaryTopicIds = resolvedDecision.secondaryTopicIds.filter((id) =>
      topicIds.has(id)
    );

    const artifactIds = new Set(payload.artifacts.map((artifact) => artifact.id));
    resolvedDecision.artifactsToLoad = resolvedDecision.artifactsToLoad.filter((id) =>
      artifactIds.has(id)
    );

    if (!resolvedDecision.primaryTopicId) {
      resolvedDecision.primaryTopicId = fallback.primaryTopicId;
    }

    return resolvedDecision;
  } catch (error) {
    console.error("[topic-router] Routing failed, using fallback:", error);
    return fallback;
  }
}

function validateRouterDecision(input: unknown, fallback: RouterDecision): RouterDecision {
  if (!input || typeof input !== "object") {
    return { ...fallback };
  }
  const value = input as Partial<RouterDecision>;
  if (
    value.topicAction !== "continue_active" &&
    value.topicAction !== "new" &&
    value.topicAction !== "reopen_existing"
  ) {
    return { ...fallback };
  }

  return {
    topicAction: value.topicAction,
    primaryTopicId: typeof value.primaryTopicId === "string" ? value.primaryTopicId : null,
    secondaryTopicIds: Array.isArray(value.secondaryTopicIds)
      ? value.secondaryTopicIds.filter((id): id is string => typeof id === "string")
      : [],
    newTopicLabel: typeof value.newTopicLabel === "string" ? value.newTopicLabel : undefined,
    newTopicDescription:
      typeof value.newTopicDescription === "string" ? value.newTopicDescription : undefined,
    newParentTopicId:
      typeof value.newParentTopicId === "string" ? value.newParentTopicId : null,
    artifactsToLoad: Array.isArray(value.artifactsToLoad)
      ? value.artifactsToLoad.filter((id): id is string => typeof id === "string")
      : [],
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
  const { data } = await supabase
    .from("artifacts")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(30);

  const artifacts = Array.isArray(data) ? (data as Artifact[]) : [];
  if (!artifacts.length) {
    return [];
  }
  if (!keywords.length) {
    return artifacts.slice(0, MAX_ARTIFACTS);
  }

  const filtered = artifacts.filter((artifact) => {
    const haystack = `${artifact.title} ${artifact.summary ?? ""}`.toLowerCase();
    return keywords.some((kw) => haystack.includes(kw));
  });

  if (filtered.length >= MAX_ARTIFACTS) {
    return filtered.slice(0, MAX_ARTIFACTS);
  }

  const seen = new Set(filtered.map((artifact) => artifact.id));
  for (const artifact of artifacts) {
    if (seen.size >= MAX_ARTIFACTS) break;
    if (!seen.has(artifact.id)) {
      filtered.push(artifact);
      seen.add(artifact.id);
    }
  }
  return filtered;
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
            return `- [${topic.id}] ${topic.label}${parent}: ${desc}`;
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
8. Always include or update the topic description when the user reframes the objective. Descriptions should be 1–2 sentences explaining the goal.
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
  fallback,
  userMessage,
}: {
  supabase: SupabaseClient<Database>;
  conversationId: string;
  decision: RouterDecision;
  fallback: RouterDecision;
  userMessage: string;
}): Promise<RouterDecision> {
  const working = { ...decision };
  const needsNewTopic =
    working.topicAction === "new" ||
    (!working.primaryTopicId && !fallback.primaryTopicId);

  if (needsNewTopic) {
    const rawLabel =
      working.newTopicLabel?.trim() || buildAutoTopicLabel(userMessage) || "Pending topic";
    const label = formatTopicLabel(rawLabel);
    const description =
      working.newTopicDescription?.trim() || buildAutoTopicDescription(userMessage);
    const parentId = working.newParentTopicId ?? null;

    const { data: inserted, error } = await (supabase as SupabaseClient<any>)
      .from("conversation_topics")
      .insert({
        conversation_id: conversationId,
        label: label.slice(0, 120),
        description,
        parent_topic_id: parentId,
      })
      .select()
      .single();

    if (error || !inserted) {
      console.error("[topic-router] Failed to insert topic, falling back:", error);
      working.primaryTopicId = fallback.primaryTopicId ?? null;
    } else {
      working.primaryTopicId = inserted.id;
      console.log(
        `[topic-router] Created topic ${inserted.id} label="${inserted.label}" parent=${
          inserted.parent_topic_id ?? "none"
        }`
      );
    }
    return working;
  }

  if (!working.primaryTopicId && fallback.primaryTopicId) {
    working.primaryTopicId = fallback.primaryTopicId;
  }

  if (working.primaryTopicId) {
    const metaUpdates: Partial<ConversationTopic> = {};
    if (working.newTopicLabel?.trim()) {
      metaUpdates.label = formatTopicLabel(working.newTopicLabel);
    }
    if (working.newTopicDescription?.trim()) {
      metaUpdates.description = working.newTopicDescription.trim().slice(0, 500);
    }
    if (Object.keys(metaUpdates).length) {
      metaUpdates.updated_at = new Date().toISOString();
      try {
        await (supabase as SupabaseClient<any>)
          .from("conversation_topics")
          .update(metaUpdates)
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
