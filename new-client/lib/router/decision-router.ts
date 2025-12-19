import { getModelAndReasoningConfig } from "../modelConfig";
import type { ReasoningEffort } from "../modelConfig";
import { callDeepInfraLlama } from "../deepInfraLlama";

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

  const systemPrompt = `You are a single decision router. All inputs are provided as JSON. You MUST output ONE JSON object with a "labels" field only, matching the schema below. Do not include the input in your response.

Output shape:
{
  "labels": {
    "topicAction": "continue_active" | "new" | "reopen_existing",
    "primaryTopicId": string | null,
    "secondaryTopicIds": string[],         // array, never null
    "newParentTopicId": string | null,
    "model": "gpt-5-nano" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro",
    "effort": "none" | "minimal" | "low" | "medium" | "high" | "xhigh",
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
- secondaryTopicIds: subset of provided topic ids, exclude primary; may be empty.
- newParentTopicId: null or a provided topic id.
- Model selection:
  * Strongly prefer gpt-5-nano when the ask is short/straightforward: greetings/acknowledgements, short factual Q/A, short rewrites/summaries, classification/tagging, simple comparisons or 1-2 step instructions, no code or only trivial code edits (<10 lines), and user text length under ~120 words. Default to nano unless there is a clear reason to upgrade.
  * Use gpt-5-mini when the request needs multi-step reasoning (3-5 steps), small but non-trivial code (single file, short functions, small bug fixes), moderate math, medium-length writing/planning, or the user text is moderately long/ambiguous (~120-400 words) and needs reasoning. If unsure between nano vs mini, choose nano.
  * Use gpt-5.2 only for clearly complex/long tasks: multi-file or large code changes, refactors, debugging with stack traces, long-form writing (>400 words), deep planning/architecture, heavy math/proofs, or high-stakes domains (legal/financial/safety/security/privacy). If unsure between mini vs 5.2, choose mini.
  * ONLY use gpt-5.2-pro if the user explicitly prefers it AND the task is extremely high-stakes + complex. Otherwise downgrade to gpt-5.2/mini/nano.
- Effort selection:
  * Effort is for the downstream chat model's response (not for routing).
  * Default to minimal/low; use medium only when strong complexity indicators are present.
  * Guidance (speedMode="auto"):
    - minimal: greetings/small-talk, short factual Q/A, simple rewrites, short summaries, straightforward instructions.
    - low: most normal requests (2-5 simple steps), short coding, simple comparisons, light planning.
    - medium: debugging, non-trivial code, math/proofs, multi-constraint planning, long-form outputs, high-stakes domains.
  * If unsure between low vs medium, choose low.
  * High or xhigh only when the request is clearly rare, intricate, or high-stakes, and you are confident it needs extra depth.
  * For gpt-5-nano/gpt-5-mini: never emit "none"/"high"/"xhigh"; stay at minimal/low/medium. If a task would need high/xhigh, escalate the model instead of effort on nano/mini.
  * Speed mode:
    - instant -> effort MUST be one of: none, minimal, low (choose the lowest that fits the task).
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

  const userPrompt = `Input JSON:
${JSON.stringify(inputPayload, null, 2)}

Memory summary:
${memorySection}

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
          effort: { type: "string", enum: ["none", "minimal", "low", "medium", "high", "xhigh"] },
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
      effort: (modelConfig.reasoning?.effort as ReasoningEffort) ?? "minimal",
      memoryTypesToLoad,
    };
  };

  if (!allowLLM) {
    console.log("[decision-router] Skipping LLM router (disabled); using fallback.");
    return fallback();
  }

  try {
    const { text } = await callDeepInfraLlama({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      schemaName: "decision_router",
      schema,
      temperature: 0.2,
    });
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

    const validEfforts: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];
    const effort: ReasoningEffort = validEfforts.includes(labels.effort) ? labels.effort : "minimal";

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
        ? labels.secondaryTopicIds.filter((id: string) => topicIds.has(id) && id !== primaryTopicId).slice(0, 3)
        : [];
    let newParentTopicId =
      labels.newParentTopicId && topicIds.has(labels.newParentTopicId) ? labels.newParentTopicId : null;
    const topicAction: DecisionRouterOutput["topicAction"] = labels.topicAction;
    if (topicAction === "new") {
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
    return fallback();
  }
}
