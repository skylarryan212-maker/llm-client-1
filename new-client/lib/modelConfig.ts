export type SpeedMode = "auto" | "instant" | "thinking";
export type ModelFamily =
  | "auto"
  | "gpt-5.1"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-5-pro-2025-10-06";
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface ModelConfig {
  model: string;
  resolvedFamily: Exclude<ModelFamily, "auto">;
  reasoning?: {
    effort: ReasoningEffort;
  };
  routedBy?: "llm" | "code" | "code-fallback";
}

const MODEL_ID_MAP: Record<Exclude<ModelFamily, "auto">, string> = {
  "gpt-5.1": "gpt-5.1-2025-11-13",
  "gpt-5-mini": "gpt-5-mini-2025-08-07",
  "gpt-5-nano": "gpt-5-nano-2025-08-07",
  "gpt-5-pro-2025-10-06": "gpt-5-pro-2025-10-06",
};

const LIGHT_REASONING_KEYWORDS = [
  "step by step",
  "analyze",
  "analysis",
  "explain",
  "break down",
  "derive",
  "prove",
  "detailed",
  "strategy",
  "plan",
  "evaluate",
  "compare",
  "contrast",
  "investigate",
  "why",
  "how",
  "improve",
];

const HIGH_COMPLEXITY_KEYWORDS = [
  "research",
  "comprehensive",
  "in-depth",
  "long-form",
  "whitepaper",
  "architecture",
  "roadmap",
  "algorithm",
  "implementation",
  "financial model",
];

const EXTREME_COMPLEXITY_PHRASES = [
  "step-by-step proof",
  "academic thesis",
  "full proposal",
  "enterprise rollout",
  "investment memorandum",
  "system architecture",
  "risk assessment",
];

const LONG_PROMPT_THRESHOLD = 360;
const MEDIUM_PROMPT_THRESHOLD = 640;
const HIGH_PROMPT_THRESHOLD = 900;

export function shouldUseLightReasoning(promptText: string) {
  const normalized = promptText.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.length >= LONG_PROMPT_THRESHOLD) {
    return true;
  }
  return LIGHT_REASONING_KEYWORDS.some((keyword) =>
    normalized.includes(keyword)
  );
}

export function pickMediumOrHigh(promptText: string): "medium" | "high" {
  const normalized = promptText.trim().toLowerCase();
  if (normalized.length >= HIGH_PROMPT_THRESHOLD) {
    return "high";
  }
  if (
    HIGH_COMPLEXITY_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
    normalized.split(/[.!?]/).some((segment) => segment.trim().length > 200)
  ) {
    return "high";
  }
  return "medium";
}

function autoReasoningForModelAndPrompt(
  promptText: string,
  modelFamily: Exclude<ModelFamily, "auto">
): ReasoningEffort | null {
  const normalized = promptText.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length >= HIGH_PROMPT_THRESHOLD * 1.2) {
    return "high";
  }
  if (normalized.length >= MEDIUM_PROMPT_THRESHOLD) {
    return "medium";
  }
  if (shouldUseLightReasoning(normalized)) {
    return "low";
  }
  if (/\b(plan|roadmap|design|strategy|debug)\b/i.test(normalized)) {
    return "medium";
  }
  if (modelFamily === "gpt-5.1" && normalized.length >= LONG_PROMPT_THRESHOLD) {
    return "low";
  }
  return null;
}

function ensureMiniNanoEffort(
  effort: ReasoningEffort | null
): Exclude<ReasoningEffort, "none"> {
  if (!effort || effort === "none") {
    return "low";
  }
  return effort === "high" || effort === "medium" ? effort : "low";
}

export function suggestSmallerModelForEffort(
  promptText: string,
  effort: ReasoningEffort | null
): "gpt-5-mini" | "gpt-5-nano" | null {
  if (!effort || effort === "low" || effort === "none") {
    return null;
  }
  const normalized = promptText.trim().toLowerCase();
  if (!normalized) {
    return "gpt-5-mini";
  }
  const characterCount = normalized.length;
  const sentenceCount = normalized
    .split(/[.!?]+/)
    .map((segment) => segment.trim())
    .filter(Boolean).length;

  const hasExtremeComplexity =
    EXTREME_COMPLEXITY_PHRASES.some((phrase) => normalized.includes(phrase)) ||
    HIGH_COMPLEXITY_KEYWORDS.some((keyword) => normalized.includes(keyword));

  if (hasExtremeComplexity) {
    return null;
  }

  if (effort === "medium") {
    if (characterCount < 600 && sentenceCount <= 6) {
      return "gpt-5-nano";
    }
    if (characterCount < 1700) {
      return "gpt-5-mini";
    }
    return null;
  }

  if (characterCount < 900 && sentenceCount <= 8) {
    return "gpt-5-nano";
  }
  if (characterCount < 2300) {
    return "gpt-5-mini";
  }
  return null;
}

function selectGpt51AutoFamily(
  promptText: string,
  effort: ReasoningEffort | null
): Exclude<ModelFamily, "auto"> {
  const normalized = promptText.trim().toLowerCase();
  const length = normalized.length;
  const mentionsComplexity =
    HIGH_COMPLEXITY_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
    EXTREME_COMPLEXITY_PHRASES.some((phrase) => normalized.includes(phrase)) ||
    /\b(debug|optimize|architecture|roadmap|financial|legal|proof|algorithm|analysis)\b/.test(
      normalized
    );

  if (!effort || effort === "none") {
    return length < 320 ? "gpt-5-nano" : "gpt-5-mini";
  }

  if (effort === "low") {
    if (length < 600 && !mentionsComplexity) {
      return "gpt-5-nano";
    }
    return "gpt-5-mini";
  }

  if (effort === "medium") {
    if (length < 400 && !mentionsComplexity) {
      return "gpt-5-nano";
    }
    if (length < 1600 || !mentionsComplexity) {
      return "gpt-5-mini";
    }
    return "gpt-5.1";
  }

  // effort === "high"
  if (length < 900 && !mentionsComplexity) {
    return "gpt-5-mini";
  }
  return "gpt-5.1";
}

export function getModelAndReasoningConfig(
  modelFamily: ModelFamily,
  speedMode: SpeedMode,
  promptText: string,
  reasoningEffortHint?: ReasoningEffort
): ModelConfig {
  let resolvedFamily: Exclude<ModelFamily, "auto"> =
    modelFamily === "auto" ? "gpt-5-mini" : modelFamily;
  const trimmedPrompt = promptText.trim();

  let chosenEffort: ReasoningEffort | null = null;
  const isFullFamily =
    resolvedFamily === "gpt-5.1" || resolvedFamily === "gpt-5-pro-2025-10-06";

  // If reasoning effort is explicitly provided, use it
  if (reasoningEffortHint) {
    chosenEffort = reasoningEffortHint;
  } else if (resolvedFamily === "gpt-5-pro-2025-10-06") {
    chosenEffort = "high";
  } else if (speedMode === "instant") {
    chosenEffort = isFullFamily ? "none" : "low";
  } else if (speedMode === "thinking") {
    chosenEffort = pickMediumOrHigh(trimmedPrompt);
  } else {
    const autoEffort = autoReasoningForModelAndPrompt(
      trimmedPrompt,
      resolvedFamily
    );
    if (isFullFamily) {
      chosenEffort = autoEffort ?? "none";
    } else {
      chosenEffort = ensureMiniNanoEffort(autoEffort);
    }
  }

  // Auto-route across families when the user selected Auto model family
  // This applies to all speed modes (auto, instant, thinking)
  if (modelFamily === "auto") {
    resolvedFamily = selectGpt51AutoFamily(trimmedPrompt, chosenEffort);
  }

  const model = MODEL_ID_MAP[resolvedFamily];

  const config: ModelConfig = { model, resolvedFamily };

  // If auto-routing moved us onto Mini/Nano, ensure effort is valid (no 'none' for small models)
  if ((resolvedFamily === "gpt-5-mini" || resolvedFamily === "gpt-5-nano")) {
    chosenEffort = ensureMiniNanoEffort(chosenEffort);
  }

  if (chosenEffort) {
    config.reasoning = { effort: chosenEffort };
  }

  if (typeof window === "undefined") {
    const effortLabel = config.reasoning?.effort ?? "none/omitted";
    console.log(
      `[modelConfigDebug] model=${model} family=${resolvedFamily} speedMode=${speedMode} effort=${effortLabel}`
    );
  }

  return config;
}

/**
 * Enhanced version that uses LLM-based routing with code-based fallback
 */
export async function getModelAndReasoningConfigWithLLM(
  modelFamily: ModelFamily,
  speedMode: SpeedMode,
  promptText: string,
  reasoningEffortHint?: ReasoningEffort,
  usagePercentage?: number,
  userId?: string
): Promise<ModelConfig> {
  // Don't use LLM router if user explicitly selected a specific model (not "auto")
  const shouldUseLLMRouter = modelFamily === "auto";

  if (shouldUseLLMRouter) {
    try {
      const { routeWithLLM } = await import("./llm-router");
      const { getMemoryTypes } = await import("./memory");
      
      console.log("[modelConfig] Attempting LLM-based routing");
      
      // Get available memory types for this user
      let availableMemoryTypes: string[] = [];
      if (userId) {
        try {
          availableMemoryTypes = await getMemoryTypes(userId);
        } catch (err) {
          console.error("[modelConfig] Failed to get memory types:", err);
        }
      }
      
      const decision = await routeWithLLM(promptText, {
        userModelPreference: modelFamily,
        speedMode,
        usagePercentage,
        availableMemoryTypes,
      });

      if (decision) {
        console.log(`[modelConfig] LLM router decided: ${decision.model} with ${decision.effort} effort, context: ${decision.contextStrategy}, webSearch: ${decision.webSearchStrategy}, memoryStrategy:`, JSON.stringify(decision.memoryStrategy));
        
        const MODEL_ID_MAP_LOCAL: Record<Exclude<ModelFamily, "auto">, string> = {
          "gpt-5.1": "gpt-5.1-2025-11-13",
          "gpt-5-mini": "gpt-5-mini-2025-08-07",
          "gpt-5-nano": "gpt-5-nano-2025-08-07",
          "gpt-5-pro-2025-10-06": "gpt-5-pro-2025-10-06",
        };

        let finalEffort = decision.effort;
        
        // Apply speed mode overrides if needed
        if (speedMode === "instant") {
          const isFullModel = decision.model === "gpt-5.1" || decision.model === "gpt-5-pro-2025-10-06";
          finalEffort = isFullModel ? "none" : "low";
          console.log(`[modelConfig] Speed mode override: instant → ${finalEffort}`);
        } else if (speedMode === "thinking") {
          // For thinking mode, ensure at least medium effort
          if (finalEffort === "none" || finalEffort === "low") {
            finalEffort = pickMediumOrHigh(promptText);
            console.log(`[modelConfig] Speed mode override: thinking → ${finalEffort}`);
          }
        }

        // Ensure Mini/Nano always have reasoning effort
        if ((decision.model === "gpt-5-mini" || decision.model === "gpt-5-nano") && finalEffort === "none") {
          finalEffort = "low";
          console.log(`[modelConfig] Enforcing minimum effort for ${decision.model}: low`);
        }

        return {
          model: MODEL_ID_MAP_LOCAL[decision.model],
          resolvedFamily: decision.model,
          reasoning: finalEffort ? { effort: finalEffort } : undefined,
          routedBy: "llm",
          contextStrategy: decision.contextStrategy,      // Pass through for chat route
          webSearchStrategy: decision.webSearchStrategy,  // Pass through for chat route
          memoryStrategy: decision.memoryStrategy,        // Pass through for chat route
        } as ModelConfig & { contextStrategy?: string; webSearchStrategy?: string; memoryStrategy?: any };
      }

      console.warn("[modelConfig] LLM routing failed, falling back to code-based logic");
    } catch (error) {
      console.error("[modelConfig] Error during LLM routing:", error);
    }
  }

  // Fallback to original code-based logic
  const config = getModelAndReasoningConfig(modelFamily, speedMode, promptText, reasoningEffortHint);
  
  // Mark as fallback if we tried LLM routing
  if (shouldUseLLMRouter) {
    config.routedBy = "code-fallback";
  } else {
    config.routedBy = "code";
  }
  
  return config;
}

export function describeModelFamily(family: ModelFamily) {
  switch (family) {
    case "gpt-5.1":
      return "GPT 5.1";
    case "gpt-5-mini":
      return "GPT 5 Mini";
    case "gpt-5-nano":
      return "GPT 5 Nano";
    case "gpt-5-pro-2025-10-06":
      return "GPT 5 Pro";
    default:
      return "Auto";
  }
}

// Validation utilities
export const VALID_MODEL_FAMILIES: ModelFamily[] = [
  "auto",
  "gpt-5.1",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-pro-2025-10-06",
];

export const VALID_SPEED_MODES: SpeedMode[] = ["auto", "instant", "thinking"];

export function isValidModelFamily(val: any): val is ModelFamily {
  return VALID_MODEL_FAMILIES.includes(val);
}

export function isValidSpeedMode(val: any): val is SpeedMode {
  return VALID_SPEED_MODES.includes(val);
}

export function normalizeModelFamily(val: any): ModelFamily {
  return isValidModelFamily(val) ? val : "auto";
}

export function normalizeSpeedMode(val: any): SpeedMode {
  return isValidSpeedMode(val) ? val : "auto";
}

// Model selection mapping: display name -> { modelFamily, speedMode, reasoningEffort }
export interface ModelSettings {
  modelFamily: ModelFamily;
  speedMode: SpeedMode;
  reasoningEffort?: ReasoningEffort;
}

export function getModelSettingsFromDisplayName(displayName: string): ModelSettings {
  // GPT 5.1 options
  if (displayName === "Auto") return { modelFamily: "auto", speedMode: "auto" };
  if (displayName === "Instant") return { modelFamily: "auto", speedMode: "instant", reasoningEffort: "low" };
  if (displayName === "Thinking") return { modelFamily: "auto", speedMode: "thinking", reasoningEffort: "medium" };
  
  // GPT 5 Nano options
  if (displayName === "GPT 5 Nano Auto") return { modelFamily: "gpt-5-nano", speedMode: "auto" };
  if (displayName === "GPT 5 Nano Instant") return { modelFamily: "gpt-5-nano", speedMode: "instant", reasoningEffort: "low" };
  if (displayName === "GPT 5 Nano Thinking") return { modelFamily: "gpt-5-nano", speedMode: "thinking", reasoningEffort: "medium" };
  
  // GPT 5 Mini options
  if (displayName === "GPT 5 Mini Auto") return { modelFamily: "gpt-5-mini", speedMode: "auto" };
  if (displayName === "GPT 5 Mini Instant") return { modelFamily: "gpt-5-mini", speedMode: "instant", reasoningEffort: "low" };
  if (displayName === "GPT 5 Mini Thinking") return { modelFamily: "gpt-5-mini", speedMode: "thinking", reasoningEffort: "medium" };
  
  // GPT 5.1 options (explicit)
  if (displayName === "GPT 5.1 Auto") return { modelFamily: "gpt-5.1", speedMode: "auto" };
  if (displayName === "GPT 5.1 Instant") return { modelFamily: "gpt-5.1", speedMode: "instant", reasoningEffort: "low" };
  if (displayName === "GPT 5.1 Thinking") return { modelFamily: "gpt-5.1", speedMode: "thinking", reasoningEffort: "medium" };
  
  // GPT 5 Pro (straight forward)
  if (displayName === "GPT 5 Pro") return { modelFamily: "gpt-5-pro-2025-10-06", speedMode: "auto" };
  
  // Default
  return { modelFamily: "auto", speedMode: "auto" };
}
