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
  availableMemoryTypes: string[];
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

  const systemPrompt = `You are a single decision router. Respond with ONE JSON object only.
Fields must match exactly:
{
  "topicAction": "continue_active" | "new" | "reopen_existing",
  "primaryTopicId": string | null,
  "secondaryTopicIds": string[],         // array, never null
  "newParentTopicId": string | null,
  "model": "gpt-5-nano" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro",
  "effort": "none" | "minimal" | "low" | "medium" | "high" | "xhigh",
  "memoryTypesToLoad": string[]
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
- Arrays must be arrays (never null). No extra fields. No markdown.`;

  const userPrompt = [
    `Active topic: ${input.activeTopicId || "none"}`,
    `Conversation: ${input.currentConversationId}`,
    `Speed mode: ${input.speedMode}`,
    `Model preference: ${input.modelPreference}`,
    `Available memory types: ${input.availableMemoryTypes.join(", ") || "none"}`,
    "",
    "Recent messages (oldest→newest):",
    recentSection,
    "",
    "Topics:",
    topicSection,
    "",
    "Artifacts:",
    artifactSection,
    "",
    "User message:",
    input.userMessage,
  ].join("\n");

  const schema = {
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
  };

  const fallback = (): DecisionRouterOutput => {
    const fallbackTopicAction: DecisionRouterOutput["topicAction"] = input.activeTopicId
      ? "continue_active"
      : "new";
    const fallbackPrimary = fallbackTopicAction === "continue_active" ? input.activeTopicId : null;
    const modelConfig = getModelAndReasoningConfig(input.modelPreference, input.speedMode, input.userMessage);
    const memoryTypesToLoad: string[] = Array.isArray(modelConfig.availableMemoryTypes)
      ? modelConfig.availableMemoryTypes
      : input.availableMemoryTypes ?? [];
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

    // Basic validation/enforcement
    const topicIds = new Set((input.topics || []).map((t) => t.id));
    let primaryTopicId = parsed.primaryTopicId ?? null;
    if (parsed.topicAction === "continue_active") {
      primaryTopicId = input.activeTopicId ?? null;
      if (!primaryTopicId) {
        parsed.topicAction = "new";
      }
    } else if (parsed.topicAction === "reopen_existing" && primaryTopicId && !topicIds.has(primaryTopicId)) {
      primaryTopicId = null;
    } else if (parsed.topicAction === "new") {
      primaryTopicId = null;
    }

    const validEfforts: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];
    let effort: ReasoningEffort = validEfforts.includes(parsed.effort) ? parsed.effort : "minimal";
    const fullModel = parsed.model === "gpt-5.2" || parsed.model === "gpt-5.2-pro";
    if (!fullModel && (effort === "none" || effort === "xhigh")) {
      effort = effort === "none" ? "minimal" : "high";
    }

    // Clamp model: never auto-select 5.2-pro unless user explicitly preferred it.
    let model = parsed.model as DecisionRouterOutput["model"];
    const userRequestedPro = input.modelPreference === "gpt-5.2-pro";
    if (model === "gpt-5.2-pro" && !userRequestedPro) {
      model = "gpt-5.2";
    }

    // Downgrade for simple/low-stakes tasks.
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

      // Effort sanity for small models
      if ((model === "gpt-5-nano" || model === "gpt-5-mini") && effort === "high") {
        effort = "medium";
      }
    }
    // Enforce new topic invariants
    let secondaryTopicIds =
      Array.isArray(parsed.secondaryTopicIds)
        ? parsed.secondaryTopicIds.filter((id: string) => topicIds.has(id) && id !== primaryTopicId).slice(0, 3)
        : [];
    let newParentTopicId =
      parsed.newParentTopicId && topicIds.has(parsed.newParentTopicId) ? parsed.newParentTopicId : null;
    let topicAction: DecisionRouterOutput["topicAction"] = parsed.topicAction;
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
      memoryTypesToLoad: Array.isArray(parsed.memoryTypesToLoad) ? parsed.memoryTypesToLoad : [],
    };
  } catch (err) {
    console.error("[decision-router] LLM routing failed, using fallback:", err);
    return fallback();
  }
}
