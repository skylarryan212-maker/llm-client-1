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

  const thoughtLabel = typeof typed.thoughtDurationLabel === "string" ? typed.thoughtDurationLabel : null;
  if (thoughtLabel) {
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

  const citationCount = Array.isArray(typed.citations) ? typed.citations.length : 0;
  if (citationCount > 0) {
    chips.push(
      <StatusBubble
        key="citations"
        label="Reading documents"
        subtext={`Cited ${citationCount} source${citationCount === 1 ? "" : "s"}`}
        variant="reading"
      />
    );
  }

  if (!chips.length) return null;

  return <div className="flex flex-wrap items-center gap-1.5 pt-1">{chips}</div>;
}
