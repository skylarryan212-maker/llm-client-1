"use client";

import type { JSX } from "react";
import type { AssistantMessageMetadata } from "@/lib/chatTypes";
import { formatSearchedDomainsLine } from "@/lib/metadata";
import { StatusBubble } from "@/components/chat/status-bubble";

interface MessageInsightChipsProps {
  metadata?: AssistantMessageMetadata | Record<string, unknown> | null;
}

function normalizeMetadata(
  metadata?: AssistantMessageMetadata | Record<string, unknown> | null
): AssistantMessageMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  return metadata as AssistantMessageMetadata;
}

export function MessageInsightChips({ metadata }: MessageInsightChipsProps) {
  const typed = normalizeMetadata(metadata);
  if (!typed) return null;

  const chips: JSX.Element[] = [];

  // Show warning if router fell back to code-based logic
  if (typed.routedBy === "code-fallback") {
    chips.push(
      <StatusBubble
        key="router-fallback"
        label="Smart router unavailable"
        subtext="Using fallback model selection"
        variant="warning"
      />
    );
  }

  const thoughtLabel = typeof typed.thoughtDurationLabel === "string" ? typed.thoughtDurationLabel : null;
  const reasoningEffort = typed.reasoningEffort || typed.thinking?.effort;
  // Only show thought label if reasoning effort is medium or high
  if (thoughtLabel && (reasoningEffort === "medium" || reasoningEffort === "high")) {
    chips.push(<StatusBubble key="thought" label={thoughtLabel} />);
  }

  const searchLine = formatSearchedDomainsLine(typed.searchedDomains);
  if (searchLine) {
    chips.push(
      <StatusBubble
        key="search"
        label={searchLine}
        subtext={typed.searchedSiteLabel || undefined}
        variant="search"
      />
    );
  }

  if (!chips.length) return null;

  return <div className="flex flex-wrap items-center gap-1.5 pt-1">{chips}</div>;
}
