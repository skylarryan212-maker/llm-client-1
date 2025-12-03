import type { ReasoningEffort, SpeedMode } from "@/lib/modelConfig";

export type CitationMetadata = {
  url: string;
  title?: string | null;
  domain?: string | null;
  snippet?: string | null;
};

export type AssistantMessageMetadata = {
  modelUsed?: string;
  reasoningEffort?: ReasoningEffort;
  resolvedFamily?: string;
  speedModeUsed?: SpeedMode;
  userRequestedFamily?: string;
  userRequestedSpeedMode?: SpeedMode;
  userRequestedReasoningEffort?: ReasoningEffort;
  routedBy?: "llm" | "code" | "code-fallback" | "cache";
  thinkingDurationMs?: number;
  thinkingDurationSeconds?: number;
  thoughtDurationLabel?: string;
  thinking?: {
    effort?: ReasoningEffort | null;
    durationMs?: number;
    durationSeconds?: number;
  };
  searchedDomains?: string[];
  searchedSiteLabel?: string;
  citations?: CitationMetadata[];
};
