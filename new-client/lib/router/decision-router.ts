import { decideRoutingForMessage } from "./decideRoutingForMessage";
import { getModelAndReasoningConfigWithLLM } from "../modelConfig";
import type { Database } from "../supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  supabase: SupabaseClient<Database>;
  input: DecisionRouterInput;
  userId: string;
}): Promise<DecisionRouterOutput> {
  const { supabase, input, userId } = params;
  // Use existing topic router to resolve topic decision.
  const topicDecision = await decideRoutingForMessage({
    supabase,
    conversationId: input.currentConversationId,
    userMessage: input.userMessage,
    projectId: null,
    userId,
    conversationTitle: null,
    projectName: null,
  });

  // Use existing model router to pick model/effort and memory types.
  const modelConfig = await getModelAndReasoningConfigWithLLM(
    input.modelPreference,
    input.speedMode,
    input.userMessage,
    undefined,
    undefined,
    userId,
    input.currentConversationId,
    {
      permanentInstructionSummary: "",
      permanentInstructions: [],
    },
    input.recentMessages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    true
  );

  // Derive memory types to load from the router decision or availableMemoryTypes fallback.
  const memoryTypesToLoad: string[] = Array.isArray(modelConfig.availableMemoryTypes)
    ? modelConfig.availableMemoryTypes
    : input.availableMemoryTypes ?? [];

  // Enforce minimal invariants
  let primaryTopicId = topicDecision.primaryTopicId ?? null;
  if (topicDecision.topicAction === "continue_active" && input.activeTopicId) {
    primaryTopicId = input.activeTopicId;
  }
  if (topicDecision.topicAction === "new") {
    primaryTopicId = null;
  }

  return {
    topicAction: topicDecision.topicAction,
    primaryTopicId,
    secondaryTopicIds: topicDecision.secondaryTopicIds ?? [],
    newParentTopicId: topicDecision.newParentTopicId ?? null,
    model: modelConfig.resolvedFamily,
    effort: (modelConfig.reasoning?.effort as ReasoningEffort) ?? "minimal",
    memoryTypesToLoad,
  };
}
