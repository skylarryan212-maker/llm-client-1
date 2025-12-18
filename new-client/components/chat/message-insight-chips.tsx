"use client";

import { useEffect } from "react";
import type { JSX } from "react";
import type { AssistantMessageMetadata } from "@/lib/chatTypes";
import { StatusBubble } from "@/components/chat/status-bubble";

interface MessageInsightChipsProps {
  messageId?: string;
  animationScopeId?: string;
  metadata?: AssistantMessageMetadata | Record<string, unknown> | null;
  onOpenSidebar?: () => void;
}

const animatedChipKeysByScope = new Map<string, Set<string>>();

function getScopeSet(scopeId: string): Set<string> {
  const existing = animatedChipKeysByScope.get(scopeId);
  if (existing) return existing;
  const next = new Set<string>();
  animatedChipKeysByScope.set(scopeId, next);
  // Prevent unbounded growth if users navigate many chats in one session.
  while (animatedChipKeysByScope.size > 8) {
    const oldestKey = animatedChipKeysByScope.keys().next().value as string | undefined;
    if (!oldestKey) break;
    animatedChipKeysByScope.delete(oldestKey);
  }
  return next;
}

function normalizeMetadata(
  metadata?: AssistantMessageMetadata | Record<string, unknown> | null
): AssistantMessageMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  return metadata as AssistantMessageMetadata;
}

export function MessageInsightChips({
  messageId,
  animationScopeId,
  metadata,
  onOpenSidebar,
}: MessageInsightChipsProps) {
  const typed = normalizeMetadata(metadata);

  const messageKey = typeof messageId === "string" && messageId.trim().length > 0 ? messageId.trim() : null;
  const scopeKey = typeof animationScopeId === "string" && animationScopeId.trim().length > 0 ? animationScopeId.trim() : "__global__";
  const animatedKeys = getScopeSet(scopeKey);

  const hasRouterFallback = typed?.routedBy === "code-fallback";
  const routerFallbackChipKey = messageKey && hasRouterFallback ? `${messageKey}:router-fallback` : null;
  const animateRouterFallback = routerFallbackChipKey ? !animatedKeys.has(routerFallbackChipKey) : true;

  const reasoningEffort = typed?.reasoningEffort || typed?.thinking?.effort;
  const explicitThought =
    typeof typed?.thoughtDurationLabel === "string" && typed.thoughtDurationLabel.trim()
      ? typed.thoughtDurationLabel.trim()
      : null;
  const fallbackThought =
    reasoningEffort === "high"
      ? "Thinking for longer"
      : reasoningEffort === "medium"
      ? "Thinking a bit longer"
      : null;
  const thoughtLabel = explicitThought || fallbackThought;
  const showThought = Boolean(typed && thoughtLabel && (reasoningEffort === "medium" || reasoningEffort === "high"));
  const thoughtChipKey = messageKey && showThought ? `${messageKey}:thought` : null;
  const animateThought = thoughtChipKey ? !animatedKeys.has(thoughtChipKey) : true;

  useEffect(() => {
    if (routerFallbackChipKey) animatedKeys.add(routerFallbackChipKey);
    if (thoughtChipKey) animatedKeys.add(thoughtChipKey);
  }, [animatedKeys, routerFallbackChipKey, thoughtChipKey]);

  if (!typed) return null;

  const chips: JSX.Element[] = [];

  if (hasRouterFallback) {
    chips.push(
      <StatusBubble
        key={`router-fallback:${scopeKey}`}
        label="Smart router unavailable"
        subtext="Using fallback model selection"
        variant="warning"
        animate={animateRouterFallback}
      />
    );
  }

  if (showThought) {
    chips.push(
      <StatusBubble key={`thought:${scopeKey}`} label={thoughtLabel!} onClick={onOpenSidebar} animate={animateThought} />
    );
  }

  if (!chips.length) return null;

  return <div className="flex flex-wrap items-center gap-1.5 pt-1">{chips}</div>;
}
