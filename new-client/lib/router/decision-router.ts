import { getModelAndReasoningConfig } from "../modelConfig";
import type { ReasoningEffort } from "../modelConfig";
import { callDeepInfraLlama } from "../deepInfraLlama";
import { computeTopicSemantics } from "../semantic/topicSimilarity";

export type DecisionRouterInput = {
  userMessage: string;
  recentMessages: Array<{ role?: string | null; content?: string | null; topic_id?: string | null }>;
  activeTopicId: string | null;
  currentConversationId: string;
  speedMode: "auto" | "instant" | "thinking";
  modelPreference: "auto" | "gpt-5-nano" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro";
  memories?: Array<{
    id: string;
    type: string;
    title: string;
    content: string;
  }>;
  topics: Array<{
    id: string;
    conversation_id: string;
    label: string;
    summary: string | null;
    description: string | null;
    parent_topic_id: string | null;
    conversation_title?: string | null;
    project_id?: string | null;
    is_cross_conversation?: boolean;
  }>;
  artifacts: Array<{
    id: string;
    conversation_id: string;
    topic_id: string | null;
    type: string;
    title: string;
    summary: string | null;
    keywords: string[];
    snippet: string;
  }>;
};

export type DecisionRouterOutput = {
  topicAction: "continue_active" | "new" | "reopen_existing";
  primaryTopicId: string | null;
  secondaryTopicIds: string[];
  newParentTopicId: string | null;
  model: "gpt-5-nano" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro";
  effort: ReasoningEffort;
  memoryTypesToLoad: string[];
};

export async function runDecisionRouter(params: {
  input: DecisionRouterInput;
  allowLLM?: boolean;
}): Promise<DecisionRouterOutput> {
  const { input, allowLLM = true } = params;
  const totalStart = Date.now();
  let semanticMs = 0;
  let llmMs: number | null = null;

  // Build prompt context
  const memorySection =
    input.memories && input.memories.length
      ? input.memories
          .slice(0, 30)
          .map((m) => `- [${m.type}] ${m.title}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 120)}`)
          .join("\n")
      : "No memories.";
  const memoryTypesFromMemories = Array.from(
    new Set(
      (input.memories || [])
        .map((m) => (m?.type || "").toString().trim())
        .filter((t) => !!t)
    )
  );
  const semanticStart = Date.now();
  const semanticMatches = await computeTopicSemantics(input.userMessage, input.topics, input.artifacts);
  semanticMs = Date.now() - semanticStart;
  const highConfidenceMatches = (semanticMatches || []).filter((m) => typeof m.similarity === "number" && m.similarity >= 0.5);
  const highConfidenceTopicIds = new Set(
    highConfidenceMatches.filter((m) => m.kind === "topic").map((m) => m.topicId)
  );
  const highConfidenceArtifactIds = new Set(
    highConfidenceMatches.filter((m) => m.kind === "artifact").map((m) => m.topicId)
  );
  if (semanticMatches && semanticMatches.length) {
    console.log("[semantic] top topic matches", semanticMatches.slice(0, 4));
  }
  const topicsById = new Map((input.topics || []).map((t) => [t.id, t]));
  const semanticSection =
    highConfidenceMatches && highConfidenceMatches.length
      ? highConfidenceMatches
          .slice(0, 6)
          .map((match) => {
            const flag = match.topicId === input.activeTopicId ? " (active topic)" : "";
            const kindLabel = match.kind === "artifact" ? "artifact" : "topic";
            const preview =
              (match.summary || match.description || "No summary available.")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 160);
            const linkedTopic =
              match.kind === "artifact" && match.relatedTopicId
                ? topicsById.get(match.relatedTopicId)?.label || match.relatedTopicId
                : null;
            const linkNote = linkedTopic ? ` (linked topic: ${linkedTopic})` : "";
            return `- [${kindLabel}:${match.topicId}]${flag} ${match.label}${linkNote} (score ${match.similarity.toFixed(
              3
            )}): ${preview}`;
          })
          .join("\n")
      : "No semantic matches >= 0.50 available.";
  const bestNonActiveMatch = semanticMatches?.find((match) => match.topicId !== input.activeTopicId);
  const bestNonActiveHint = bestNonActiveMatch
    ? `Closest non-active topic: [${bestNonActiveMatch.topicId}] ${bestNonActiveMatch.label} (score ${bestNonActiveMatch.similarity.toFixed(
        3
      )}).`
    : "No strong non-active topic detected.";

  const systemPrompt = `You are a single decision router. All inputs are provided as JSON. You MUST output ONE JSON object with a "labels" field only, matching the schema below. Do not include the input in your response.

Output shape:
{
  "labels": {
    "topicAction": "continue_active" | "new" | "reopen_existing",
    "primaryTopicId": string | null,
    "secondaryTopicIds": string[],         // array, never null
    "newParentTopicId": string | null,
    "model": "gpt-5-nano" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro",
    "effort": "none" | "low" | "medium" | "high" | "xhigh",
    "memoryTypesToLoad": string[]
  }
}
Rules:
- Never invent placeholder strings like "none"/"null" for IDs.
- If topicAction="new": primaryTopicId MUST be null.
- If topicAction="continue_active": primaryTopicId MUST equal activeTopicId (if provided).
- If topicAction="reopen_existing": primaryTopicId MUST be one of the provided topics.
- How to choose topicAction (use recentMessages, topics, artifacts, and the userMessage):
  * continue_active: when the user is clearly continuing the active topic (follow-up, same intent, direct references like "that", "this", "continue", or replies to the last turn) and there is no stronger match elsewhere.
  * reopen_existing: when the user intent best matches a past topic in the provided topics/artifacts (same subject/entity/task), but the active topic is different or stale. Pick the best-matching previous topic as primaryTopicId.
  * new: when the request starts a new subject/task not covered by the active topic or any prior topic (no strong match).
- Use topic summaries/labels/descriptions plus artifacts to judge matching intent; prefer reuse when the fit is strong, otherwise start new.
- Topics may include cross-chat items marked is_cross_conversation=true and conversation_title set.
  * Prefer current-chat topics unless the user clearly refers to another chat or asks about prior messages outside this conversation.
  * If you select a cross-chat topic, use topicAction="reopen_existing" with that topic id.
 - Use the "Semantic similarity to prior topics/artifacts" section (below) as a signal: higher similarity means a stronger candidate to reopen, but you may still choose any provided topic if it best matches the user’s intent.
  * If an artifact is the strongest semantic match and it links to a topic, prefer reopen_existing with that linked topic unless the user explicitly wants a new topic.
- secondaryTopicIds: subset of provided topic ids, exclude primary; may be empty.
- newParentTopicId: null or a provided topic id.
- Model selection:
  * Strongly prefer gpt-5-nano when the ask is short/straightforward: greetings/acknowledgements, short factual Q/A, short rewrites/summaries, classification/tagging, simple comparisons or 1-2 step instructions, no code or only trivial code edits (<10 lines), and user text length under ~120 words. Default to nano unless there is a clear reason to upgrade.
  * Use gpt-5-mini when the request needs multi-step reasoning (3-5 steps), small but non-trivial code (single file, short functions, small bug fixes), moderate math, medium-length writing/planning, or the user text is moderately long/ambiguous (~120-400 words) and needs reasoning. If unsure between nano vs mini, choose nano.
  * Use gpt-5.2 only for clearly complex/long tasks: multi-file or large code changes, refactors, debugging with stack traces, long-form writing (>400 words), deep planning/architecture, heavy math/proofs, or high-stakes domains (legal/financial/safety/security/privacy). If unsure between mini vs 5.2, choose mini.
  * ONLY use gpt-5.2-pro if the user explicitly prefers it AND the task is extremely high-stakes + complex. Otherwise downgrade to gpt-5.2/mini/nano.
- Effort selection:
  * Effort is for the downstream chat model's response (not for routing).
  * Default to low; use medium only when strong complexity indicators are present.
  * Guidance (speedMode="auto"):
    - low: most normal requests (2-5 simple steps), short coding, simple comparisons, light planning.
    - medium: debugging, non-trivial code, math/proofs, multi-constraint planning, long-form outputs, high-stakes domains.
  * If unsure between low vs medium, choose low.
  * High or xhigh only when the request is clearly rare, intricate, or high-stakes, and you are confident it needs extra depth.
  * For gpt-5-nano/gpt-5-mini: never emit "none"/"high"/"xhigh"; stay at low/medium. If a task would need high/xhigh, escalate the model instead of effort on nano/mini.
  * Speed mode:
    - instant -> effort MUST be one of: none, low (choose the lowest that fits the task).
    - thinking -> effort MUST be one of: medium, high, xhigh (choose the lowest that fits the task; prefer medium unless clearly needed).
  * Model preference: if modelPreference is not "auto", you MUST return that exact model.
- Arrays must be arrays (never null). No extra fields. No markdown.`;

  const inputPayload = {
    input: {
      userMessage: input.userMessage,
      recentMessages: input.recentMessages,
      activeTopicId: input.activeTopicId,
      current_conversation_id: input.currentConversationId,
      speedMode: input.speedMode,
      modelPreference: input.modelPreference,
      memories: input.memories ?? [],
      topics: input.topics,
      artifacts: input.artifacts,
    },
  };

  console.log("[decision-router] Input payload:", JSON.stringify(inputPayload.input, null, 2));

  const userPrompt = `Input JSON:
${JSON.stringify(inputPayload, null, 2)}

Memory summary:
${memorySection}

Semantic similarity to prior topics/artifacts (score >= 0.50 only; higher = stronger):
${semanticSection}

Closest non-active topic hint:
${bestNonActiveHint}

Return only the "labels" object matching the output schema.`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      labels: {
        type: "object",
        additionalProperties: false,
        properties: {
          topicAction: { type: "string", enum: ["continue_active", "new", "reopen_existing"] },
          primaryTopicId: { type: ["string", "null"] },
          secondaryTopicIds: { type: "array", items: { type: "string" }, default: [] },
          newParentTopicId: { type: ["string", "null"] },
          model: { type: "string", enum: ["gpt-5-nano", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro"] },
          effort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh"] },
          memoryTypesToLoad: { type: "array", items: { type: "string" }, default: [] },
        },
        required: [
          "topicAction",
          "primaryTopicId",
          "secondaryTopicIds",
          "newParentTopicId",
          "model",
          "effort",
          "memoryTypesToLoad",
        ],
      },
    },
    required: ["labels"],
  };

  const fallback = (): DecisionRouterOutput => {
    const fallbackTopicAction: DecisionRouterOutput["topicAction"] = input.activeTopicId
      ? "continue_active"
      : "new";
    const fallbackPrimary = fallbackTopicAction === "continue_active" ? input.activeTopicId : null;
    const modelConfig = getModelAndReasoningConfig(input.modelPreference, input.speedMode, input.userMessage);
    const memoryTypesToLoad: string[] = Array.isArray(modelConfig.availableMemoryTypes)
      ? modelConfig.availableMemoryTypes
      : memoryTypesFromMemories;
    return {
      topicAction: fallbackTopicAction,
      primaryTopicId: fallbackPrimary,
      secondaryTopicIds: [] as string[],
      newParentTopicId: null,
      model: modelConfig.resolvedFamily,
      effort: (modelConfig.reasoning?.effort as ReasoningEffort) ?? "low",
      memoryTypesToLoad,
    };
  };

  if (!allowLLM) {
    console.log("[decision-router] Skipping LLM router (disabled); using fallback.");
    console.log("[decision-router] timing", {
      semanticMs,
      llmMs,
      totalMs: Date.now() - totalStart,
      allowLLM,
    });
    return fallback();
  }

  try {
    const llmStart = Date.now();
    const { text } = await callDeepInfraLlama({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      schemaName: "decision_router",
      schema,
      temperature: 0.2,
      model: "openai/gpt-oss-20b",
      baseURL: "https://api.deepinfra.com/v1/openai",
      enforceJson: true,
      maxTokens: null,
      extraParams: { reasoning_effort: "low" },
    });
    llmMs = Date.now() - llmStart;
    const cleaned = (text || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const labels = parsed?.labels || {};

    // Basic validation/enforcement
    const topicIds = new Set((input.topics || []).map((t) => t.id));
    let primaryTopicId = labels.primaryTopicId ?? null;
    if (labels.topicAction === "continue_active") {
      primaryTopicId = input.activeTopicId ?? null;
      if (!primaryTopicId) {
        labels.topicAction = "new";
      }
    } else if (labels.topicAction === "reopen_existing" && primaryTopicId && !topicIds.has(primaryTopicId)) {
      primaryTopicId = null;
    } else if (labels.topicAction === "new") {
      primaryTopicId = null;
    }

    const validEfforts: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
    const effort: ReasoningEffort = validEfforts.includes(labels.effort) ? labels.effort : "low";

    // Enforce model preference if provided
    const userForcedModel = input.modelPreference !== "auto";
    let model: DecisionRouterOutput["model"] = userForcedModel
      ? (input.modelPreference as DecisionRouterOutput["model"])
      : (labels.model as DecisionRouterOutput["model"]);

    // Clamp model: never auto-select 5.2-pro unless user explicitly preferred it.
    const userRequestedPro = input.modelPreference === "gpt-5.2-pro";
    if (!userForcedModel && model === "gpt-5.2-pro" && !userRequestedPro) {
      model = "gpt-5.2";
    }
    // Enforce new topic invariants
    let secondaryTopicIds =
      Array.isArray(labels.secondaryTopicIds)
        ? labels.secondaryTopicIds.filter((id: string) => topicIds.has(id) && id !== primaryTopicId)
        : [];
    let newParentTopicId =
      labels.newParentTopicId && topicIds.has(labels.newParentTopicId) ? labels.newParentTopicId : null;
    let topicAction: DecisionRouterOutput["topicAction"] = labels.topicAction;
    if (topicAction === "new") {
      primaryTopicId = null;
      secondaryTopicIds = [];
      newParentTopicId = null;
    }
    if (topicAction === "reopen_existing" && primaryTopicId && !topicIds.has(primaryTopicId)) {
      topicAction = "new";
      primaryTopicId = null;
      secondaryTopicIds = [];
      newParentTopicId = null;
    }

    return {
      topicAction,
      primaryTopicId,
      secondaryTopicIds,
      newParentTopicId,
      model,
      effort,
      memoryTypesToLoad: Array.isArray(labels.memoryTypesToLoad) ? labels.memoryTypesToLoad : [],
    };
  } catch (err) {
    console.error("[decision-router] LLM routing failed, using fallback:", err);
    console.log("[decision-router] timing", {
      semanticMs,
      llmMs,
      totalMs: Date.now() - totalStart,
      allowLLM,
    });
    return fallback();
  }
  finally {
    // Log timing on successful path
    console.log("[decision-router] timing", {
      semanticMs,
      llmMs,
      totalMs: Date.now() - totalStart,
      allowLLM,
    });
  }
}
