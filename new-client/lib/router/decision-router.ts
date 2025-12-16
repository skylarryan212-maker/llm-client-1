import { getModelAndReasoningConfig } from "../modelConfig";
import type { ReasoningEffort } from "../modelConfig";

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
  // Heuristic topic choice: continue active if present, else start new.
  const topicAction = input.activeTopicId ? "continue_active" : "new";
  const primaryTopicId = topicAction === "continue_active" ? input.activeTopicId : null;

  // Heuristic model selection (code-based)
  const modelConfig = getModelAndReasoningConfig(
    input.modelPreference,
    input.speedMode,
    input.userMessage
  );

  // Derive memory types to load from the router decision or availableMemoryTypes fallback.
  const memoryTypesToLoad: string[] = Array.isArray(modelConfig.availableMemoryTypes)
    ? modelConfig.availableMemoryTypes
    : input.availableMemoryTypes ?? [];

  return {
    topicAction,
    primaryTopicId,
    secondaryTopicIds: [],
    newParentTopicId: null,
    model: modelConfig.resolvedFamily,
    effort: (modelConfig.reasoning?.effort as ReasoningEffort) ?? "minimal",
    memoryTypesToLoad,
  };
}
