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
}): Promise<DecisionRouterOutput> {
  const { input } = params;

  const cleanMessage = (input.userMessage || "").toLowerCase();
  const isSimple =
    cleanMessage.length < 200 &&
    !/\b(code|debug|optimize|architecture|legal|financial|contract|regulation|compliance|safety|medical|diagnosis|research|analysis|proof|algorithm|design|strategy|roadmap)\b/i.test(
      input.userMessage || ""
    );
  const isHighStakes =
    /\b(legal|contract|financial|investment|trading|tax|regulation|compliance|safety|security|privacy|medical|diagnosis|clinical|pharma|liability|risk)\b/i.test(
      input.userMessage || ""
    );
  const isHeavyReasoning =
    cleanMessage.length > 500 ||
    /\b(system design|architecture|performance|optimi[sz]e|scalability|benchmark|proof|algorithm|research|whitepaper|longform|multi-step|debug|stack\s?trace|crash)\b/i.test(
      input.userMessage || ""
    );

  // Build prompt context
  const recentSection =
    input.recentMessages && input.recentMessages.length
      ? input.recentMessages
          .slice(-6)
          .map((m) => `- ${m.role || "user"}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 240)}`)
          .join("\n")
      : "No prior messages.";

  const topicSection =
    input.topics && input.topics.length
      ? input.topics
          .slice(0, 30)
          .map((t) => `- [${t.id}] ${t.label} ${t.summary ? "| " + t.summary.slice(0, 160) : ""}`)
          .join("\n")
      : "No topics.";

  const artifactSection =
    input.artifacts && input.artifacts.length
      ? input.artifacts
          .slice(0, 30)
          .map((a) => `- [${a.id}] ${a.title} ${a.summary ? "| " + a.summary.slice(0, 160) : ""}`)
          .join("\n")
      : "No artifacts.";

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
- secondaryTopicIds: subset of provided topic ids, exclude primary; may be empty.
- newParentTopicId: null or a provided topic id.
- Model selection:
  * Default to the cheapest safe model: gpt-5-nano for greetings, short factual answers, quick rewrites/classifications, short summaries, or yes/no/definition questions.
  * Use gpt-5-mini for typical multi-step reasoning, moderate code/math, and medium-length writing/editing.
  * Use gpt-5.2 only for clearly complex/long tasks (heavy code/debugging, research, system design) OR high-stakes domains (legal/financial/safety/security/privacy).
  * ONLY use gpt-5.2-pro if the user explicitly prefers it AND the task is extremely high-stakes + complex. Otherwise downgrade to gpt-5.2/mini/nano.
  * When unsure, choose the cheaper model.
- Effort selection:
  * Higher reasoning efforts are for uncommon, highly nuanced tasks only.
  * Default to minimal/low; use medium for normal multi-step work.
  * High or xhigh only when the request is clearly rare, intricate, or high-stakes, and you are confident it needs extra depth.
  * For gpt-5-nano/gpt-5-mini: never emit "none"/"high"/"xhigh"; stay at minimal/low/medium.
  * Speed mode:
    - instant → effort MUST be one of: none, minimal, low (choose the lowest that fits the task).
    - thinking → effort MUST be one of: medium, high, xhigh (choose the lowest that fits the task).
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

  try {
    const { text } = await callDeepInfraLlama({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      schemaName: "decision_router",
      schema,
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
    let effort: ReasoningEffort = validEfforts.includes(labels.effort) ? labels.effort : "minimal";
    const fullModel = labels.model === "gpt-5.2" || labels.model === "gpt-5.2-pro";
    if (!fullModel && (effort === "none" || effort === "xhigh")) {
      effort = effort === "none" ? "minimal" : "high";
    }

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

    // Downgrade for simple/low-stakes tasks only when user didn't force a model.
    if (!userForcedModel) {
      if (isSimple) {
        model = cleanMessage.length < 120 ? "gpt-5-nano" : "gpt-5-mini";
        effort = effort === "high" || effort === "xhigh" ? "minimal" : effort;
        if (effort === "none") effort = "minimal";
      } else {
        // If not explicitly high-stakes/heavy, bias to mini unless complexity is clear.
        const allowHeavyModel = isHighStakes || isHeavyReasoning;
        if (!allowHeavyModel && model === "gpt-5.2-pro" && !userRequestedPro) {
          model = "gpt-5.2";
        }
        if (!allowHeavyModel && model === "gpt-5.2" && input.modelPreference === "auto") {
          model = "gpt-5-mini";
        }
        if (!allowHeavyModel && model === "gpt-5-mini" && cleanMessage.length < 140) {
          model = "gpt-5-nano";
        }
      }
    }

    // Force effort ranges by speed mode
    if (input.speedMode === "instant") {
      if (!["none", "minimal", "low"].includes(effort)) {
        effort = "minimal";
      }
    } else if (input.speedMode === "thinking") {
      if (!["medium", "high", "xhigh"].includes(effort)) {
        effort = "medium";
      }
    }

    // Effort sanity for small models
    if ((model === "gpt-5-nano" || model === "gpt-5-mini")) {
      if (effort === "none") effort = "minimal";
      if (effort === "high" || effort === "xhigh") effort = "medium";
    }
    // Enforce new topic invariants
    let secondaryTopicIds =
      Array.isArray(labels.secondaryTopicIds)
        ? labels.secondaryTopicIds.filter((id: string) => topicIds.has(id) && id !== primaryTopicId).slice(0, 3)
        : [];
    let newParentTopicId =
      labels.newParentTopicId && topicIds.has(labels.newParentTopicId) ? labels.newParentTopicId : null;
    let topicAction: DecisionRouterOutput["topicAction"] = labels.topicAction;
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
