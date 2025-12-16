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
- If topicAction="new": primaryTopicId MUST be null.
- If topicAction="continue_active": primaryTopicId MUST equal activeTopicId (if provided).
- If topicAction="reopen_existing": primaryTopicId MUST be one of the provided topics.
- secondaryTopicIds: subset of provided topic ids, exclude primary; may be empty.
- newParentTopicId: null or a provided topic id.
- Effort "none"/"xhigh" only with models gpt-5.2/gpt-5.2-pro.
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
    } else if (parsed.topicAction === "reopen_existing" && primaryTopicId && !topicIds.has(primaryTopicId)) {
      primaryTopicId = null;
    } else if (parsed.topicAction === "new") {
      primaryTopicId = null;
    }

    let effort: ReasoningEffort = parsed.effort;
    const fullModel = parsed.model === "gpt-5.2" || parsed.model === "gpt-5.2-pro";
    if (!fullModel && (effort === "none" || effort === "xhigh")) {
      effort = effort === "none" ? "minimal" : "high";
    }

    return {
      topicAction: parsed.topicAction,
      primaryTopicId,
      secondaryTopicIds: Array.isArray(parsed.secondaryTopicIds)
        ? parsed.secondaryTopicIds.filter((id: string) => topicIds.has(id) && id !== primaryTopicId).slice(0, 3)
        : [],
      newParentTopicId:
        parsed.newParentTopicId && topicIds.has(parsed.newParentTopicId) ? parsed.newParentTopicId : null,
      model: parsed.model,
      effort,
      memoryTypesToLoad: Array.isArray(parsed.memoryTypesToLoad) ? parsed.memoryTypesToLoad : [],
    };
  } catch (err) {
    console.error("[decision-router] LLM routing failed, using fallback:", err);
    return fallback();
  }
}
