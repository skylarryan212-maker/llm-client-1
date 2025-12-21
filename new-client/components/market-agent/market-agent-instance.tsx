"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ChevronDown, ChevronRight, MessageCircle, Pause, Play, Settings2, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MarketAgentFeedEvent, MarketAgentInstanceWithWatchlist, MarketAgentChatMessage, MarketAgentThesis } from "@/lib/data/market-agent";
import type { Database } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "@/components/markdown-content";
import { useUserPlan } from "@/lib/hooks/use-user-plan";

type MarketAgentStateRow = Database["public"]["Tables"]["market_agent_state"]["Row"];

type Props = {
  instance: MarketAgentInstanceWithWatchlist;
  events: MarketAgentFeedEvent[];
  thesis: MarketAgentThesis | null;
  state: MarketAgentStateRow | null;
  initialSelectedEventId?: string | null;
};

type ReportDepth = "short" | "standard" | "deep";

const WATCHLIST_LIMIT = 25;

const SCHEDULE_OPTIONS = [
  { label: "1m", value: 60 },
  { label: "2m", value: 120 },
  { label: "5m", value: 300 },
  { label: "10m", value: 600 },
  { label: "30m", value: 1800 },
  { label: "60m", value: 3600 },
] as const;

const CUSTOM_CADENCE_UNITS = [
  { label: "Minutes", value: "min", multiplier: 60 },
  { label: "Hours", value: "hour", multiplier: 3600 },
] as const;

type CustomCadenceUnit = (typeof CUSTOM_CADENCE_UNITS)[number]["value"];

const REPORT_DEPTH_OPTIONS: Array<{ value: ReportDepth; label: string; description: string }> = [
  { value: "short", label: "Short", description: "Fast, lightweight" },
  { value: "standard", label: "Standard", description: "Balanced coverage" },
  { value: "deep", label: "Deep", description: "More thorough" },
];

const baseBottomSpacerPx = 28;
const DEFAULT_INDICATOR_LABEL = "Thinking";

type ToolStatusEvent = {
  type: "search-start" | "search-complete";
  query?: string;
};

type CombinedSuggestion = {
  suggestionId?: string;
  cadenceSeconds?: number;
  cadenceReason?: string;
  watchlistSymbols?: string[];
  watchlistReason?: string;
};

type SuggestionOutcome = {
  decision: "accepted" | "declined";
  cadenceSeconds: number;
  watchlistSymbols?: string[];
  reason?: string;
};

const formatCadence = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return `${seconds} sec`;
  }
  const normalized = Math.round(seconds);
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const secs = normalized % 60;
  const parts: string[] = [];
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (minutes) {
    parts.push(`${minutes}m`);
  }
  if (!hours && secs) {
    parts.push(`${secs}s`);
  }
  return parts.length ? parts.join(" ") : `${seconds}s`;
};
type AgentChatMessage = MarketAgentChatMessage;

export function MarketAgentInstanceView({ instance, events, thesis, state: _state, initialSelectedEventId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { plan } = useUserPlan();
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const isDraft = instance.status === "draft";
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [watchlistState, setWatchlistState] = useState(instance.watchlist);
  const [cadenceSecondsState, setCadenceSecondsState] = useState(instance.cadence_seconds);
  const initialReportDepth = (() => {
    const depth = instance.report_depth ?? "standard";
    return REPORT_DEPTH_OPTIONS.some((option) => option.value === depth) ? (depth as ReportDepth) : "standard";
  })();
  const [reportDepthState, setReportDepthState] = useState<ReportDepth>(initialReportDepth);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<AgentChatMessage[]>([]);
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isStreamingAgent, setIsStreamingAgent] = useState(false);
  const [showThinkingIndicator, setShowThinkingIndicator] = useState(false);
  const [indicatorLabel, setIndicatorLabel] = useState(DEFAULT_INDICATOR_LABEL);
  const [chatError, setChatError] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [combinedSuggestion, setCombinedSuggestion] = useState<CombinedSuggestion | null>(null);
  const [suggestionProcessing, setSuggestionProcessing] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [pendingSuggestionOutcome, setPendingSuggestionOutcome] = useState<SuggestionOutcome | null>(null);
  const [bottomSpacerPx, setBottomSpacerPx] = useState(baseBottomSpacerPx);
  const [workspaceThesis, setWorkspaceThesis] = useState<MarketAgentThesis | null>(null);
  const thesisContentRef = useRef<HTMLDivElement | null>(null);
  const [thesisContentHeight, setThesisContentHeight] = useState(0);
  const [timelineEvents, setTimelineEvents] = useState<MarketAgentFeedEvent[]>(events ?? []);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [thesisCollapsed, setThesisCollapsed] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const [alignTrigger, setAlignTrigger] = useState(0);
  const pinnedMessageIdRef = useRef<string | null>(null);
  const initialScrollDoneRef = useRef(false);
  const [pinSpacerHeight, setPinSpacerHeight] = useState(0);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const pinToPromptRef = useRef(false);
  const pinnedScrollTopRef = useRef<number | null>(null);
  const alignNextUserMessageToTopRef = useRef<string | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const hasStreamedTokenRef = useRef(false);
  const streamingAbortRef = useRef<AbortController | null>(null);
  const streamingResponseIdRef = useRef<string | null>(null);
  const streamingAgentTempIdRef = useRef<string | null>(null);
  void _state;

  const tickerHighlights = [
    { symbol: "NVDA", detail: "+2.3% today", value: "$835.50" },
    { symbol: "AAPL", detail: "-0.8% today", value: "$195.10" },
    { symbol: "SPY", detail: "+0.5% today", value: "$513.20" },
    { symbol: "BTC", detail: "+1.1% today", value: "$90.5k" },
  ];
  const loopedTickers = [...tickerHighlights, ...tickerHighlights];
  const statusLabel = statusError
    ? "Error"
    : instance.status === "running"
      ? "Running"
      : instance.status === "paused"
        ? "Paused"
        : "Not running";
  const statusTone =
    statusError
      ? "border-rose-400/50 bg-rose-500/10 text-rose-100"
      : instance.status === "running"
        ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
        : instance.status === "paused"
          ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
          : "border-slate-400/40 bg-slate-500/10 text-slate-100";
  const selectedEvent =
    selectedEventId && timelineEvents.length
      ? timelineEvents.find((evt) => evt.id === selectedEventId) ?? null
      : null;
  const timelineEmpty = timelineEvents.length === 0;
  const isDev = process.env.NODE_ENV !== "production";
  const canSeedDemo = isDev || plan === "max";

  const handleSelectEvent = (eventId: string) => {
    setSelectedEventId(eventId);
  };

  const handleGenerateDemoEvents = async () => {
    if (!canSeedDemo) {
      setStatusError("Demo seeding is unavailable for this plan.");
      return;
    }
    setSeedLoading(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/market-agent/instances/${instance.id}/workspace/seed`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error ?? "Failed to generate demo events");
      }
      setWorkspaceThesis(payload?.thesis ?? null);
      if (Array.isArray(payload?.events)) {
        setTimelineEvents(payload.events);
        if (payload.events[0]?.id) {
          setSelectedEventId(payload.events[0].id);
        }
      }
    } catch (err: any) {
      setStatusError(err?.message ?? "Failed to generate demo data");
    } finally {
      setSeedLoading(false);
    }
  };

  const formatTimestamp = (iso?: string | null) => {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const handleStatusChange = async (next: "running" | "paused") => {
    try {
      setIsBusy(true);
      const res = await fetch(`/api/market-agent/instances/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      setStatusError(null);
      router.refresh();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this market agent and its data?")) return;
    try {
      setIsBusy(true);
      const res = await fetch(`/api/market-agent/instances/${instance.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete agent");
      router.push("/agents/market-agent");
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/market-agent/instances/${instance.id}/messages`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "Failed to load chat");
        if (!cancelled) {
          const items: AgentChatMessage[] = Array.isArray(payload?.messages) ? payload.messages : [];
          items.sort((a, b) => new Date(a.created_at || "").getTime() - new Date(b.created_at || "").getTime());
          setChatMessages(items);
        }
      } catch (error) {
        if (!cancelled) {
          setChatError(error instanceof Error ? error.message : "Failed to load chat");
        }
      } finally {
        if (!cancelled) setIsLoadingMessages(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [instance.id]);

  useEffect(() => {
    setWorkspaceThesis(thesis ?? null);
    setTimelineEvents(events ?? []);
  }, [events, thesis]);

  useEffect(() => {
    const node = thesisContentRef.current;
    if (!node) return;
    const updateHeight = () => setThesisContentHeight(node.scrollHeight);
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [workspaceThesis]);

  useEffect(() => {
    if (selectedEventId) return;
    const initialId =
      initialSelectedEventId && timelineEvents.some((evt) => evt.id === initialSelectedEventId)
        ? initialSelectedEventId
        : timelineEvents[0]?.id ?? null;
    if (initialId) {
      setSelectedEventId(initialId);
    }
  }, [initialSelectedEventId, selectedEventId, timelineEvents]);

  const searchParamsString = searchParams?.toString() ?? "";
  useEffect(() => {
    const params = new URLSearchParams(searchParamsString);
    const current = params.get("event");
    if (selectedEventId) {
      if (current === selectedEventId) return;
      params.set("event", selectedEventId);
    } else {
      if (!current) return;
      params.delete("event");
    }
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [pathname, router, searchParamsString, selectedEventId]);

  useEffect(() => {
    setCombinedSuggestion(null);
    setSuggestionError(null);
    setSuggestionProcessing(false);
  }, [instance.id]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [instance.id]);

  const scheduleProgrammaticScrollReset = () => {
    if (typeof window === "undefined") return;
    if (programmaticScrollTimeoutRef.current) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, 160);
  };

  const getEffectiveScrollBottom = useCallback(
    (viewport: HTMLDivElement) => {
      const extraSpacer = Math.max(0, bottomSpacerPx - baseBottomSpacerPx);
      return Math.max(0, viewport.scrollHeight - extraSpacer);
    },
    [bottomSpacerPx]
  );

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const viewport = chatListRef.current;
    if (!viewport) return;
    const bottom = getEffectiveScrollBottom(viewport);
    const targetTop = Math.max(0, bottom - viewport.clientHeight);
    isProgrammaticScrollRef.current = true;
    viewport.scrollTo({ top: targetTop, behavior });
    scheduleProgrammaticScrollReset();
  };

  const releasePinning = () => {
    pinToPromptRef.current = false;
    pinnedScrollTopRef.current = null;
    setPinSpacerHeight(0);
  };

  const alignMessageToTop = (messageId: string) => {
    const viewport = chatListRef.current;
    if (!viewport) return;
    const messageEl = viewport.querySelector(`[data-agent-message-id="${messageId}"]`) as HTMLElement | null;
    if (!messageEl) return;
    isProgrammaticScrollRef.current = true;
    viewport.scrollTop = messageEl.offsetTop;
    scheduleProgrammaticScrollReset();
  };

  const computeRequiredSpacerForMessage = useCallback(
    (messageId: string) => {
      const viewport = chatListRef.current;
      if (!viewport) return null;
      const messageEl = viewport.querySelector(`[data-agent-message-id="${messageId}"]`) as HTMLElement | null;
      if (!messageEl) return null;
      const viewportRect = viewport.getBoundingClientRect();
      const elRect = messageEl.getBoundingClientRect();
      const desiredPadding = 14;
      const elContentTop = viewport.scrollTop + (elRect.top - viewportRect.top);
      const requiredScrollTop = Math.max(0, Math.round(elContentTop - desiredPadding));
      const contentWithoutSpacer = viewport.scrollHeight - bottomSpacerPx;
      const maxScrollTopWithBase = Math.max(
        0,
        contentWithoutSpacer + baseBottomSpacerPx - viewport.clientHeight
      );
      const extraNeeded = Math.max(0, requiredScrollTop - maxScrollTopWithBase);
      return baseBottomSpacerPx + extraNeeded;
    },
    [baseBottomSpacerPx, bottomSpacerPx]
  );

  const handleChatScroll = () => {
    const viewport = chatListRef.current;
    if (!viewport) return;
    if (isProgrammaticScrollRef.current) return;
    const { scrollTop, clientHeight } = viewport;
    if (pinToPromptRef.current && pinnedScrollTopRef.current !== null) {
      const maxAllowed = pinnedScrollTopRef.current;
      if (scrollTop > maxAllowed + 2) {
        isProgrammaticScrollRef.current = true;
        viewport.scrollTop = maxAllowed;
        scheduleProgrammaticScrollReset();
        return;
      }
    }
    const effectiveBottom = getEffectiveScrollBottom(viewport);
    const maxScrollTop = Math.max(0, effectiveBottom - clientHeight);
    if (scrollTop > maxScrollTop) {
      isProgrammaticScrollRef.current = true;
      viewport.scrollTop = maxScrollTop;
      scheduleProgrammaticScrollReset();
      return;
    }
    const distanceFromBottom = effectiveBottom - (scrollTop + clientHeight);
    const tolerance = Math.max(16, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;
    setShowScrollToBottom(!atBottom);
    if (!pinToPromptRef.current) {
      setIsAutoScroll(atBottom);
    }
  };

  const recomputeScrollFlags = useCallback(() => {
    const viewport = chatListRef.current;
    if (!viewport) return;
    const { scrollTop, clientHeight } = viewport;
    const effectiveBottom = getEffectiveScrollBottom(viewport);
    const distanceFromBottom = effectiveBottom - (scrollTop + clientHeight);
    const tolerance = Math.max(16, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;
    setShowScrollToBottom(!atBottom);
  }, [bottomSpacerPx, getEffectiveScrollBottom]);

  useEffect(() => {
    if (!isChatOpen) {
      releasePinning();
      setShowScrollToBottom(false);
      setIsAutoScroll(true);
      return;
    }
    if (isAutoScroll) {
      setShowScrollToBottom(false);
    } else {
      recomputeScrollFlags();
    }
  }, [isChatOpen, isAutoScroll, recomputeScrollFlags]);

  useEffect(() => {
    const targetMessageId = alignNextUserMessageToTopRef.current;
    if (!isChatOpen || !targetMessageId) return;
    pinnedMessageIdRef.current = targetMessageId;

    let cancelled = false;
    let retryRaf: number | null = null;
    let scrollTimer: number | null = null;
    let guardTimer: number | null = null;
    const startMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const deadlineMs = startMs + 2500;

    const doScroll = () => {
      if (cancelled) return;
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (nowMs > deadlineMs) return;

      const viewport = chatListRef.current;
      if (!viewport) return;

      const el = viewport.querySelector(
        `[data-agent-message-id="${targetMessageId}"]`
      ) as HTMLElement | null;
      if (!el) {
        if (typeof requestAnimationFrame !== "undefined") {
          retryRaf = requestAnimationFrame(doScroll);
        }
        return;
      }

      const minimumSpacerForAlign = baseBottomSpacerPx + viewport.clientHeight + 80;
      if (bottomSpacerPx < minimumSpacerForAlign) {
        setBottomSpacerPx((prev) => Math.max(prev, minimumSpacerForAlign));
        if (typeof requestAnimationFrame !== "undefined") {
          retryRaf = requestAnimationFrame(doScroll);
        }
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const desiredPadding = 14;
      const nextTop = viewport.scrollTop + (elRect.top - viewportRect.top) - desiredPadding;
      const targetTop = Math.max(0, Math.round(nextTop));
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (targetTop > maxScrollTop) {
        const desiredSpacer = computeRequiredSpacerForMessage(targetMessageId);
        if (typeof desiredSpacer === "number") {
          setBottomSpacerPx((prev) => Math.max(prev, desiredSpacer));
        }
        if (typeof requestAnimationFrame !== "undefined") {
          retryRaf = requestAnimationFrame(doScroll);
        }
        return;
      }

      isProgrammaticScrollRef.current = true;
      pinnedScrollTopRef.current = targetTop;
      setIsAutoScroll(false);
      const effectiveBottom = getEffectiveScrollBottom(viewport);
      const distanceFromBottom = effectiveBottom - (targetTop + viewport.clientHeight);
      const tolerance = Math.max(12, bottomSpacerPx / 3);
      setShowScrollToBottom(!(distanceFromBottom <= tolerance));
      alignNextUserMessageToTopRef.current = null;

      scrollTimer = window.setTimeout(() => {
        viewport.scrollTo({ top: targetTop, behavior: "smooth" });
      }, 80);

      guardTimer = window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        pinToPromptRef.current = false;
        pinnedScrollTopRef.current = null;
      }, 900);
    };

    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => requestAnimationFrame(doScroll));
    } else {
      doScroll();
    }

    return () => {
      cancelled = true;
      if (retryRaf && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(retryRaf);
      }
      if (scrollTimer) clearTimeout(scrollTimer);
      if (guardTimer) clearTimeout(guardTimer);
      isProgrammaticScrollRef.current = false;
    };
  }, [
    alignTrigger,
    baseBottomSpacerPx,
    chatMessages.length,
    bottomSpacerPx,
    computeRequiredSpacerForMessage,
    getEffectiveScrollBottom,
    isChatOpen,
  ]);

  useEffect(() => {
    if (pinToPromptRef.current) return;
    pinnedScrollTopRef.current = null;
    const pinnedId = pinnedMessageIdRef.current;
    if (!pinnedId) return;
    const desiredSpacer = computeRequiredSpacerForMessage(pinnedId);
    if (typeof desiredSpacer !== "number") return;
    const nextSpacer = Math.max(baseBottomSpacerPx, desiredSpacer);
    if (nextSpacer >= bottomSpacerPx) return;
    const viewport = chatListRef.current;
    if (!viewport) return;
    const contentWithoutSpacer = viewport.scrollHeight - bottomSpacerPx;
    const nextMaxScrollTop = Math.max(0, contentWithoutSpacer + nextSpacer - viewport.clientHeight);
    const shouldClampScrollTop = viewport.scrollTop > nextMaxScrollTop + 1;
    setBottomSpacerPx(nextSpacer);
    if (shouldClampScrollTop && typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => {
        const v = chatListRef.current;
        if (!v) return;
        const maxTop = Math.max(0, v.scrollHeight - v.clientHeight);
        if (v.scrollTop > maxTop) v.scrollTop = maxTop;
      });
    }
    if (nextSpacer === baseBottomSpacerPx) {
      pinnedMessageIdRef.current = null;
    }
  }, [chatMessages.length, bottomSpacerPx, baseBottomSpacerPx, computeRequiredSpacerForMessage]);

  useEffect(() => {
    const ensureSpacer = () => {
      setBottomSpacerPx((prev) => Math.max(baseBottomSpacerPx, prev));
    };
    ensureSpacer();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", ensureSpacer);
    return () => {
      window.removeEventListener("resize", ensureSpacer);
    };
  }, [baseBottomSpacerPx, chatMessages.length]);

  useEffect(() => {
    if (!isChatOpen) return;
    if (isLoadingMessages) return;
    if (initialScrollDoneRef.current) return;
    if (alignNextUserMessageToTopRef.current || pinToPromptRef.current) {
      initialScrollDoneRef.current = true;
      return;
    }
    scrollToBottom("auto");
    setShowScrollToBottom(false);
    initialScrollDoneRef.current = true;
  }, [chatMessages.length, isChatOpen, isLoadingMessages]);

  const handleScrollToBottomClick = () => {
    releasePinning();
    setIsAutoScroll(true);
    setShowScrollToBottom(false);
    scrollToBottom("smooth");
  };

  useEffect(() => {
    return () => {
      if (programmaticScrollTimeoutRef.current) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
    };
  }, []);

  const upsertChatMessage = (message: AgentChatMessage, replaceId?: string) => {
    setChatMessages((prev) => {
      const next = replaceId
        ? prev.map((msg) => (msg.id === replaceId ? message : msg))
        : prev.some((msg) => msg.id === message.id)
          ? prev
          : [...prev, message];
      next.sort((a, b) => new Date(a.created_at || "").getTime() - new Date(b.created_at || "").getTime());
      return next;
    });
  };

  const handleToolStatus = useCallback((status: ToolStatusEvent) => {
    if (status.type === "search-start") {
      setIndicatorLabel("Searching the web");
      setShowThinkingIndicator(true);
    } else {
      setIndicatorLabel(DEFAULT_INDICATOR_LABEL);
    }
  }, []);

  const handleSendChat = async (inputContent: string) => {
    const content = inputContent.trim();
    if (!content || isSendingChat || isStreamingAgent) return;
    setIsSendingChat(true);
    setIndicatorLabel(DEFAULT_INDICATOR_LABEL);
    setChatError(null);
    const tempId = `temp-${Date.now()}`;
    const optimistic: AgentChatMessage = {
      id: tempId,
      role: "user",
      content,
      created_at: new Date().toISOString(),
      metadata: { agent: "market-agent", market_agent_instance_id: instance.id },
    };
    upsertChatMessage(optimistic);
    pinToPromptRef.current = true;
    pinnedMessageIdRef.current = tempId;
    pinnedScrollTopRef.current = null;
    setPinSpacerHeight(0);
    alignNextUserMessageToTopRef.current = tempId;
    setAlignTrigger((prev) => prev + 1);
    setIsAutoScroll(false);
    setShowScrollToBottom(true);
    const suggestionOutcomeForRequest = pendingSuggestionOutcome;
    try {
      const controller = new AbortController();
      streamingAbortRef.current = controller;
      streamingResponseIdRef.current = null;
      streamingAgentTempIdRef.current = null;
      setIsStreamingAgent(true);
      setShowThinkingIndicator(true);
      hasStreamedTokenRef.current = false;

      const requestPayload: Record<string, unknown> = { role: "user", content };
      if (suggestionOutcomeForRequest) {
        requestPayload.suggestionOutcome = suggestionOutcomeForRequest;
      }
      const res = await fetch(`/api/market-agent/instances/${instance.id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      if (!res.ok) {
        let payload: any = null;
        try {
          payload = await res.json();
        } catch {
          // ignore
        }
        if (payload?.message) {
          upsertChatMessage(payload.message as AgentChatMessage, tempId);
          pinnedMessageIdRef.current = payload.message.id;
          alignNextUserMessageToTopRef.current = payload.message.id;
          setAlignTrigger((prev) => prev + 1);
        }
        throw new Error(payload?.error ?? `Request failed (${res.status})`);
      }

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamingContent = "";
      let tempAgentId: string | null = null;

      const pushAgentDelta = (delta: string) => {
        if (!tempAgentId) {
          tempAgentId = `agent-temp-${Date.now()}`;
          streamingAgentTempIdRef.current = tempAgentId;
          const placeholder: AgentChatMessage = {
            id: tempAgentId,
            role: "agent",
            content: "",
            created_at: new Date().toISOString(),
            metadata: {
              agent: "market-agent",
              market_agent_instance_id: instance.id,
              modelUsed: "gpt-5-nano",
              resolvedFamily: "gpt-5-nano",
            } as any,
          };
          upsertChatMessage(placeholder);
        }
        streamingContent += delta;
        if (tempAgentId) {
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.id === tempAgentId
                ? { ...msg, content: streamingContent }
                : msg
            )
          );
        }
        if (!hasStreamedTokenRef.current) {
          hasStreamedTokenRef.current = true;
          setShowThinkingIndicator(false);
          setIndicatorLabel(DEFAULT_INDICATOR_LABEL);
        }
      };

      const replaceAgentMessage = (finalMsg: AgentChatMessage) => {
        upsertChatMessage(finalMsg, tempAgentId ?? undefined);
        streamingAgentTempIdRef.current = null;
        streamingResponseIdRef.current = null;
      };

      const handlePayload = (payload: any) => {
        if (!payload || typeof payload !== "object") return;
        if (payload.message) {
          const saved = payload.message as AgentChatMessage;
          upsertChatMessage(saved, tempId);
          pinnedMessageIdRef.current = saved.id;
          alignNextUserMessageToTopRef.current = saved.id;
          setAlignTrigger((prev) => prev + 1);
        }
        if (payload.response_id && typeof payload.response_id === "string") {
          streamingResponseIdRef.current = payload.response_id;
        }
        if (payload.token) {
          pushAgentDelta(String(payload.token));
        }
        if (payload.toolStatus && typeof payload.toolStatus.type === "string") {
          handleToolStatus(payload.toolStatus as ToolStatusEvent);
        }
        if (payload.suggestion && typeof payload.suggestion === "object") {
          setCombinedSuggestion({
            cadenceSeconds: typeof payload.suggestion.cadenceSeconds === "number" ? payload.suggestion.cadenceSeconds : undefined,
            cadenceReason: typeof payload.suggestion.cadenceReason === "string" ? payload.suggestion.cadenceReason : undefined,
            watchlistSymbols: Array.isArray(payload.suggestion.watchlistSymbols)
              ? payload.suggestion.watchlistSymbols
              : undefined,
            watchlistReason: typeof payload.suggestion.watchlistReason === "string" ? payload.suggestion.watchlistReason : undefined,
            suggestionId: typeof payload.suggestion.suggestionId === "string" ? payload.suggestion.suggestionId : undefined,
          });
          setSuggestionProcessing(false);
          setSuggestionError(null);
        }
        if (payload.agentMessage) {
          replaceAgentMessage(payload.agentMessage as AgentChatMessage);
        }
        if (payload.error) {
          setChatError(typeof payload.error === "string" ? payload.error : "Request failed");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            handlePayload(JSON.parse(trimmed));
          } catch {
            // ignore malformed chunks
          }
        }
      }

      if (buffer.trim()) {
        try {
          handlePayload(JSON.parse(buffer.trim()));
        } catch {
          // ignore trailing parse errors
        }
      }

      if (tempAgentId && streamingContent) {
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempAgentId
              ? { ...msg, content: streamingContent }
              : msg
            )
          );
      }
      if (suggestionOutcomeForRequest) {
        setPendingSuggestionOutcome(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send message";
      setChatError(message);
      const tempIdToClear = streamingAgentTempIdRef.current;
      if (tempIdToClear) {
        setChatMessages((prev) => prev.filter((msg) => msg.id !== tempIdToClear));
        streamingAgentTempIdRef.current = null;
      }
      setShowThinkingIndicator(false);
      setIndicatorLabel(DEFAULT_INDICATOR_LABEL);
    } finally {
      setIsSendingChat(false);
      setIsStreamingAgent(false);
      streamingAbortRef.current = null;
      streamingResponseIdRef.current = null;
      streamingAgentTempIdRef.current = null;
      setShowThinkingIndicator(false);
      setIndicatorLabel(DEFAULT_INDICATOR_LABEL);
    }
  };

  const handleSuggestionDecision = async (choice: "accepted" | "declined") => {
    const suggestion = combinedSuggestion;
    if (!suggestion || suggestionProcessing) return;
    setSuggestionProcessing(true);
    setSuggestionError(null);
    try {
      if (choice === "accepted") {
        if (typeof suggestion.cadenceSeconds === "number") {
          const res = await fetch(`/api/market-agent/instances/${instance.id}/settings`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "schedule", cadenceSeconds: suggestion.cadenceSeconds }),
          });
          const payload = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(payload?.error ?? `Failed to update schedule (${res.status})`);
          }
          setCadenceSecondsState(
            typeof payload?.cadenceSeconds === "number" ? payload.cadenceSeconds : suggestion.cadenceSeconds
          );
        }
        if (Array.isArray(suggestion.watchlistSymbols) && suggestion.watchlistSymbols.length) {
          const res = await fetch(`/api/market-agent/instances/${instance.id}/settings`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "watchlist", watchlist: suggestion.watchlistSymbols }),
          });
          const payload = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(payload?.error ?? `Failed to update watchlist (${res.status})`);
          }
          const savedList = Array.isArray(payload?.watchlist)
            ? payload.watchlist
            : suggestion.watchlistSymbols;
          setWatchlistState(savedList);
        }
      }
      setPendingSuggestionOutcome({
        decision: choice,
        cadenceSeconds: suggestion.cadenceSeconds ?? 0,
        watchlistSymbols: suggestion.watchlistSymbols,
        reason: suggestion.cadenceReason || suggestion.watchlistReason,
      });
      setCombinedSuggestion(null);
    } catch (error) {
      setSuggestionError(error instanceof Error ? error.message : "Failed to process suggestion");
    } finally {
      setSuggestionProcessing(false);
    }
  };

  const handleAcceptSuggestion = () => {
    void handleSuggestionDecision("accepted");
  };

  const handleDeclineSuggestion = () => {
    void handleSuggestionDecision("declined");
  };

  const handleStopStreaming = () => {
    try {
      streamingAbortRef.current?.abort();
    } catch {
      // ignore
    } finally {
      streamingAbortRef.current = null;
      setIsStreamingAgent(false);
      setShowThinkingIndicator(false);
      setIndicatorLabel(DEFAULT_INDICATOR_LABEL);
    }
  };

  return (
    <>
      <div className="h-screen overflow-hidden bg-[#050505] text-foreground">
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-4 border-b border-white/10 bg-black/80 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/80 hover:text-white"
              onClick={() => router.push("/agents/market-agent")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex flex-col">
              <p className="text-xs uppercase tracking-[0.25em] text-white/40">Market Agent</p>
              <div className="flex items-center gap-2 text-sm text-white/80">
                <span className="truncate">{instance.label || "Market Agent"}</span>
                <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">&middot;</span>
                <Badge variant="outline" className={cn("border px-2 py-0.5 text-[11px] font-semibold", statusTone)}>
                  {statusLabel}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80">
            <div className="ticker-strip relative flex-1 overflow-hidden">
              <div className="ticker-track flex gap-8 whitespace-nowrap px-4">
                {loopedTickers.map((ticker, idx) => (
                  <div
                    key={`${ticker.symbol}-${idx}`}
                    className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em]"
                  >
                    <span className="font-semibold text-white">{ticker.symbol}</span>
                    <span className="text-muted-foreground">{ticker.detail}</span>
                    <span className="text-emerald-300">{ticker.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={instance.status === "running" ? "ghost" : "secondary"}
              size="sm"
              className="gap-1"
              disabled={isBusy || isDraft}
              onClick={async () => {
                const nextStatus = instance.status === "running" ? "paused" : "running";
                await handleStatusChange(nextStatus);
              }}
            >
              {instance.status === "running" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {instance.status === "running" ? "Pause" : instance.status === "paused" ? "Resume" : "Start"}
            </Button>
            <Button
              variant={isChatOpen ? "secondary" : "outline"}
              size="sm"
              className="gap-1"
              onClick={() => setIsChatOpen((prev) => !prev)}
            >
              <MessageCircle className="h-4 w-4" />
              {isChatOpen ? "Hide chat" : "Chat"}
            </Button>
            <Button variant="outline" size="sm" className="gap-1" disabled={isBusy} onClick={() => setIsSettingsOpen(true)}>
              <Settings2 className="h-4 w-4" />
              Settings
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-rose-300 hover:text-rose-100"
              onClick={handleDelete}
              disabled={isBusy}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          </header>

          <div className="flex flex-1 min-h-0 h-full overflow-hidden gap-0 items-stretch">
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden px-1 sm:px-3 py-3">
              <div className="flex h-full flex-col gap-4">
                <section className="rounded-2xl border border-border/60 bg-background/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-[0.3em] text-white/60">Current thesis</p>
                      <p className="text-[11px] text-muted-foreground">
                        {workspaceThesis?.updated_at ? `Last updated ${formatTimestamp(workspaceThesis.updated_at)}` : "Pinned context for this agent"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs gap-1"
                        onClick={() => setThesisCollapsed((prev) => !prev)}
                      >
                        {thesisCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {thesisCollapsed ? "Expand" : "Collapse"}
                      </Button>
                    </div>
                  </div>
                  <div
                    ref={thesisContentRef}
                    className="mt-2 overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
                    style={{
                      maxHeight: thesisCollapsed ? 0 : thesisContentHeight ? `${thesisContentHeight}px` : "999px",
                      opacity: thesisCollapsed ? 0 : 1,
                    }}
                    aria-hidden={thesisCollapsed}
                  >
                    {workspaceThesis ? (
                      <div className="grid gap-2 md:grid-cols-2 text-sm">
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">Bias</p>
                          <p className="text-sm text-muted-foreground">{workspaceThesis.bias || "None"}</p>
                          <p className="text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">Invalidation</p>
                          <p className="text-sm text-muted-foreground">{workspaceThesis.invalidation || "None"}</p>
                          <p className="text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">Next check</p>
                          <p className="text-sm text-muted-foreground">{workspaceThesis.next_check || "None"}</p>
                        </div>
                        <div className="space-y-2 text-sm">
                          <p className="text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">Watched tickers</p>
                          <div className="flex flex-wrap gap-1">
                            {(workspaceThesis.watched ?? []).map((sym) => (
                              <span key={sym} className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-white/80">
                                {sym}
                              </span>
                            ))}
                            {!workspaceThesis.watched?.length ? (
                              <span className="text-sm text-muted-foreground">None</span>
                            ) : null}
                          </div>
                          <p className="text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">Key levels</p>
                          <div className="space-y-1 text-sm text-muted-foreground">
                            {workspaceThesis.key_levels && typeof workspaceThesis.key_levels === "object"
                              ? Object.entries(workspaceThesis.key_levels as Record<string, any>).map(([ticker, levels]) => (
                                  <div key={ticker} className="rounded-lg border border-border/50 px-2 py-1 text-xs">
                                    <p className="text-xs text-white/80">{ticker}</p>
                                    <p className="text-xs text-muted-foreground">
                                      Support: {levels?.support ?? "N/A"} | Resistance: {levels?.resistance ?? "N/A"}
                                    </p>
                                  </div>
                                ))
                              : <p className="text-sm text-muted-foreground">None</p>}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/60 bg-black/30 p-3 text-sm text-muted-foreground">
                        No thesis yet. Use the dev button below to generate demo data or update the thesis from the agent.
                      </div>
                    )}
                  </div>
                </section>

                <div className="flex flex-1 min-h-0 gap-4">
                  <div className="w-[44%] min-w-[280px] flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-white/60">Timeline</p>
                        <p className="text-[11px] text-muted-foreground">Newest first</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {canSeedDemo ? (
                          <Button size="sm" variant="outline" onClick={handleGenerateDemoEvents} disabled={seedLoading}>
                            {seedLoading ? "Generating..." : "Generate demo"}
                          </Button>
                        ) : null}
                        {statusError ? (
                          <p className="text-[11px] text-rose-300">{statusError}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                      {timelineEmpty ? (
                        <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                          <p className="font-semibold text-white">No reports yet. Start the agent to generate your first report.</p>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            <li>Reports</li>
                            <li>Alerts</li>
                            <li>State changes</li>
                          </ul>
                        </div>
                      ) : (
                        timelineEvents.map((evt) => {
                          const isActive = evt.id === selectedEventId;
                          const kind = evt.kind || evt.event_type || "report";
                          return (
                            <button
                              key={evt.id}
                              type="button"
                              className={cn(
                                "relative w-full text-left rounded-2xl border px-3 py-2 transition",
                                "hover:border-white/25 hover:bg-white/[0.03]",
                                isActive
                                  ? "border-white/35 bg-white/[0.07] shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
                                  : "border-border/60 bg-black/25"
                              )}
                              onClick={() => handleSelectEvent(evt.id)}
                              >
                              {isActive ? (
                                <span
                                  aria-hidden
                                  className="absolute left-0 top-0 h-full w-1 rounded-l-2xl bg-emerald-400/80"
                                />
                              ) : null}
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className="border px-2 py-0.5 text-[11px] uppercase tracking-wide"
                                    >
                                      {kind}
                                    </Badge>
                                    <span className="text-[11px] text-muted-foreground">
                                      {formatTimestamp(evt.created_at || evt.ts)}
                                    </span>
                                  </div>
                                  <p className="text-sm font-semibold text-white line-clamp-1">{evt.title || "Untitled event"}</p>
                                </div>
                                {(evt.tickers && evt.tickers.length) || evt.severity_label ? (
                                  <div className="flex flex-wrap items-center gap-1 text-[11px]">
                                    {evt.tickers &&
                                      evt.tickers.length &&
                                      evt.tickers.map((ticker) => (
                                        <span
                                          key={ticker}
                                          className="rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-white/80"
                                        >
                                          {ticker}
                                        </span>
                                      ))}
                                    {evt.severity_label ? (
                                      <Badge
                                        variant="outline"
                                        className="border border-amber-400/50 text-[11px] text-amber-200"
                                      >
                                        {evt.severity_label}
                                      </Badge>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 rounded-2xl border border-border/60 bg-background/60 p-4 overflow-y-auto">
                    {selectedEvent ? (
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-xs uppercase tracking-[0.3em] text-white/60">{selectedEvent.kind || selectedEvent.event_type || "Report"}</p>
                            <p className="text-xl font-semibold text-white">{selectedEvent.title || selectedEvent.summary || "Report detail"}</p>
                            <p className="text-sm text-muted-foreground">{formatTimestamp(selectedEvent.created_at || selectedEvent.ts)}</p>
                          </div>
                          {selectedEvent.severity_label ? (
                            <Badge variant="outline" className="border border-amber-400/50 text-[11px] text-amber-200">
                              {selectedEvent.severity_label}
                            </Badge>
                          ) : null}
                        </div>
                        {selectedEvent.tickers && selectedEvent.tickers.length ? (
                          <div className="flex flex-wrap gap-1">
                            {selectedEvent.tickers.map((ticker) => (
                              <span key={ticker} className="rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-white/80">
                                {ticker}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-2 rounded-xl border border-border/50 bg-black/20 p-4">
                          <MarkdownContent content={selectedEvent.body_md || selectedEvent.summary || "No content"} />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/60 bg-black/20 p-6 text-sm text-muted-foreground">
                        Select a report to view details.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <AgentChatSidebar
              open={isChatOpen}
              onClose={() => setIsChatOpen(false)}
              instance={instance}
              statusLabel={statusLabel}
              statusTone={statusTone}
              messages={chatMessages}
              isLoading={isLoadingMessages}
              error={chatError}
              onSendChat={handleSendChat}
              onStopStreaming={handleStopStreaming}
              isStreaming={isStreamingAgent}
              showThinkingIndicator={showThinkingIndicator}
              indicatorLabel={indicatorLabel}
              onAcceptSuggestion={handleAcceptSuggestion}
              onDeclineSuggestion={handleDeclineSuggestion}
              suggestion={combinedSuggestion}
              suggestionProcessing={suggestionProcessing}
              suggestionError={suggestionError}
              chatListRef={chatListRef}
              showScrollToBottom={showScrollToBottom}
              onScroll={handleChatScroll}
              onScrollToBottom={handleScrollToBottomClick}
              pinSpacerHeight={pinSpacerHeight}
              bottomSpacerPx={bottomSpacerPx}
              prefillValue={chatPrefill}
              onPrefillUsed={() => setChatPrefill(null)}
              onApplyStarter={(text) => setChatPrefill(text)}
            />
          </div>
      </div>
    </div>
      <SettingsSidebar
        instance={instance}
        open={isSettingsOpen}
        watchlist={watchlistState}
        cadenceSeconds={cadenceSecondsState}
        reportDepth={reportDepthState}
        onClose={() => setIsSettingsOpen(false)}
        onWatchlistSaved={(symbols) => setWatchlistState(symbols)}
        onCadenceSaved={(seconds) => setCadenceSecondsState(seconds)}
        onReportDepthSaved={(depth) => setReportDepthState(depth)}
      />
    </>
  );
}

type SettingsSidebarProps = {
  open: boolean;
  onClose: () => void;
  instance: MarketAgentInstanceWithWatchlist;
  watchlist: string[];
  cadenceSeconds: number;
  reportDepth: ReportDepth;
  onWatchlistSaved: (symbols: string[]) => void;
  onCadenceSaved: (seconds: number) => void;
  onReportDepthSaved: (depth: ReportDepth) => void;
};

type AgentChatSidebarProps = {
  open: boolean;
  onClose: () => void;
  instance: MarketAgentInstanceWithWatchlist;
  statusLabel: string;
  statusTone: string;
  messages: AgentChatMessage[];
  isLoading: boolean;
  error: string | null;
  onSendChat: (message: string) => void;
  onStopStreaming: () => void;
  isStreaming: boolean;
  showThinkingIndicator: boolean;
  indicatorLabel: string;
  suggestion: CombinedSuggestion | null;
  onAcceptSuggestion: () => void;
  onDeclineSuggestion: () => void;
  suggestionProcessing: boolean;
  suggestionError: string | null;
  chatListRef: MutableRefObject<HTMLDivElement | null>;
  showScrollToBottom: boolean;
  onScroll: () => void;
  onScrollToBottom: () => void;
  pinSpacerHeight: number;
  bottomSpacerPx: number;
  prefillValue?: string | null;
  onPrefillUsed?: () => void;
  onApplyStarter?: (text: string) => void;
};

function AgentChatSidebar({
  open,
  onClose,
  instance,
  statusLabel,
  statusTone,
  messages,
  isLoading,
  error,
  onSendChat,
  onStopStreaming,
  isStreaming,
  showThinkingIndicator,
  indicatorLabel,
  suggestion,
  onAcceptSuggestion,
  onDeclineSuggestion,
  suggestionProcessing,
  suggestionError,
  chatListRef,
  showScrollToBottom,
  onScroll,
  onScrollToBottom,
  pinSpacerHeight,
  bottomSpacerPx,
  prefillValue,
  onPrefillUsed,
  onApplyStarter,
}: AgentChatSidebarProps) {
  const cadenceValue = suggestion?.cadenceSeconds;
  const hasCadenceSuggestion =
    typeof cadenceValue === "number" && Number.isFinite(cadenceValue) && cadenceValue > 0;
  const hasWatchlistSuggestion =
    Array.isArray(suggestion?.watchlistSymbols) && suggestion.watchlistSymbols.length > 0;
  const suggestionTitle = (() => {
    if (hasCadenceSuggestion && hasWatchlistSuggestion && cadenceValue !== undefined) {
      return `${formatCadence(cadenceValue)} cadence + watchlist update`;
    }
    if (hasCadenceSuggestion && cadenceValue !== undefined) {
      return `${formatCadence(cadenceValue)} cadence`;
    }
    if (hasWatchlistSuggestion) {
      return "Watchlist update";
    }
    return "Agent suggestion";
  })();
  const suggestionRef = useRef<HTMLDivElement | null>(null);
  const [suggestionHeight, setSuggestionHeight] = useState(0);
  const baseScrollBottom = 96;
  const scrollTipBottom = baseScrollBottom + (suggestion ? suggestionHeight : 0);

  useEffect(() => {
    const node = suggestionRef.current;
    if (!suggestion || !node) {
      setSuggestionHeight(0);
      return;
    }
    const updateHeight = () => {
      setSuggestionHeight(node.offsetHeight);
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [suggestion]);
  const showStarterPrompts = !isLoading && !error && messages.length === 0;
  const starterPrompts = [
    "Refine the current thesis for these tickers.",
    "What would invalidate this bias today?",
    "Tighten alerts around key levels and volatility.",
  ];
  return (
    <div
      className={cn(
        "relative flex-shrink-0 h-full min-h-0 overflow-hidden transition-[width] duration-300 max-w-[440px]",
        open ? "w-[440px]" : "w-0"
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-col border-l border-white/10 bg-[#050505] px-0 text-foreground backdrop-blur-xl transition-opacity duration-300",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      >
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-white/60">Agent Chat</p>
              <p className="text-lg font-semibold text-white">{instance.label || "Market Agent"}</p>
              <p className="text-[11px] text-muted-foreground">
                Talk to the agent, refine focus, or request a report.
              </p>
            </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
          <div className="relative flex-1 min-h-0 overflow-hidden" style={{ minWidth: 0 }}>
            <div
              ref={chatListRef}
              className="h-full min-h-0 overflow-y-auto overflow-x-hidden space-y-1 agent-chat-message-list agent-chat-scroll-area"
              onScroll={onScroll}
            >
              {pinSpacerHeight > 0 && (
                <div aria-hidden className="w-full" style={{ height: pinSpacerHeight }} />
              )}
              {isLoading ? (
                <p className="px-2 text-xs text-muted-foreground">Loading chat...</p>
              ) : error ? (
                <p className="px-2 text-xs text-rose-300">{error}</p>
              ) : messages.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">
                  Use chat to refine the thesis, adjust alerts, or request a report.
                </p>
              ) : (
                messages.map((msg) => {
                  const metadata =
                    msg.metadata && typeof msg.metadata === "object" && !Array.isArray(msg.metadata)
                      ? (msg.metadata as Record<string, unknown>)
                      : null;
                  return (
                    <ChatMessage
                      key={msg.id}
                      messageId={msg.id}
                      role={msg.role === "agent" ? "assistant" : "user"}
                      content={msg.content}
                      metadata={metadata}
                      forceFullWidth
                      forceStaticBubble
                    />
                  );
                })
              )}
              {isStreaming && showThinkingIndicator && !isLoading && (
                <div className="px-1 pb-1 text-white/80">
                  <p className="text-base leading-relaxed">
                    <span className="inline-block thinking-shimmer-text">{indicatorLabel}</span>
                  </p>
                </div>
              )}
            <div aria-hidden className="w-full" style={{ height: bottomSpacerPx }} />
            </div>
            {showScrollToBottom && (
              <div
                className={`scroll-tip pointer-events-none fixed inset-x-0 z-30 transition-opacity duration-200 ${
                  showScrollToBottom ? "opacity-100 scroll-tip-visible" : "opacity-0"
                }`}
                style={{ bottom: `calc(${scrollTipBottom}px + env(safe-area-inset-bottom,0px))` }}
              >
                <div className="flex w-full justify-center">
                  <Button
                    type="button"
                    size="icon"
                    className={`${showScrollToBottom ? "scroll-tip-button" : ""} pointer-events-auto h-10 w-10 rounded-full border border-border bg-card/90 text-foreground shadow-md backdrop-blur hover:bg-background`}
                    onClick={onScrollToBottom}
                  >
                    <ArrowDown className="h-4 w-4 text-foreground" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border/60 px-2 pt-2 agent-chat-composer-wrapper space-y-3">
            {showStarterPrompts ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-white/[0.02] px-3 py-3">
                <p className="text-xs text-muted-foreground">
                  Use chat to refine the thesis, adjust alerts, or request a report.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {starterPrompts.map((prompt) => (
                    <Button
                      key={prompt}
                      size="sm"
                      variant="secondary"
                      className="bg-white/5 text-xs text-white/90 hover:bg-white/10"
                      onClick={() => onApplyStarter?.(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            {error && !isLoading ? (
              <p className="text-xs text-rose-300 mb-1">{error}</p>
            ) : null}
              {suggestion ? (
                <div
                  className="rounded-2xl border border-emerald-500/20 bg-white/5 p-4 text-sm text-foreground"
                  ref={suggestionRef}
                >
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-200">
                      Agent suggestion
                    </p>
                    <div className="space-y-1 text-white">
                      <p className="text-base font-semibold">{suggestionTitle}</p>
                      {hasWatchlistSuggestion ? (
                        <p className="text-xs uppercase text-muted-foreground tracking-wide">
                          Watchlist: {suggestion.watchlistSymbols?.join(", ")}
                        </p>
                      ) : null}
                      {suggestion.cadenceReason ? (
                        <p className="text-[11px] text-muted-foreground">
                          Cadence reason: {suggestion.cadenceReason}
                        </p>
                      ) : null}
                      {suggestion.watchlistReason ? (
                        <p className="text-[11px] text-muted-foreground">
                          Watchlist reason: {suggestion.watchlistReason}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onDeclineSuggestion}
                      disabled={suggestionProcessing || isStreaming}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      onClick={onAcceptSuggestion}
                      disabled={suggestionProcessing || isStreaming}
                    >
                      Accept suggestion
                    </Button>
                  </div>
                  {suggestionProcessing && !suggestionError ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">Processing...</p>
                  ) : null}
                  {suggestionError ? (
                    <p className="mt-2 text-xs text-rose-300">{suggestionError}</p>
                  ) : null}
                </div>
              ) : null}
            <div className="mx-auto w-full max-w-3xl">
              <ChatComposer
                onSendMessage={onSendChat}
                isStreaming={isStreaming}
                onStop={onStopStreaming}
                placeholder="Ask the agent..."
                disableAccentStyles
                showAttachmentButton={false}
                sendButtonStyle={{
                  backgroundColor: "#ffffff",
                  color: "#050505",
                  border: "1px solid rgba(15, 20, 25, 0.35)",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
                }}
                prefillValue={prefillValue}
                onPrefillUsed={onPrefillUsed}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function SettingsSidebar({
  open,
  onClose,
  instance,
  watchlist,
  cadenceSeconds,
  reportDepth,
  onWatchlistSaved,
  onCadenceSaved,
  onReportDepthSaved,
}: SettingsSidebarProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  const [watchlistInput, setWatchlistInput] = useState(watchlist.join(", "));
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [watchlistStatus, setWatchlistStatus] = useState<string | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  const [scheduleSelection, setScheduleSelection] = useState<number | null>(() => {
    return SCHEDULE_OPTIONS.find((option) => option.value === cadenceSeconds)?.value ?? null;
  });
  const [customCadenceValue, setCustomCadenceValue] = useState(() =>
    scheduleSelection === null ? String(Math.max(Math.round(cadenceSeconds / 60), 1)) : ""
  );
  const [customCadenceUnit, setCustomCadenceUnit] = useState<CustomCadenceUnit>(CUSTOM_CADENCE_UNITS[0].value);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const [depthSelection, setDepthSelection] = useState<ReportDepth>(reportDepth);
  const [reportDepthError, setReportDepthError] = useState<string | null>(null);
  const [reportDepthStatus, setReportDepthStatus] = useState<string | null>(null);
  const [reportDepthLoading, setReportDepthLoading] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const statusLabel =
    instance.status === "running"
      ? "Running"
      : instance.status === "paused"
        ? "Paused"
        : "Not running";
  const statusTone =
    instance.status === "running"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
      : instance.status === "paused"
        ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
        : "border-slate-400/40 bg-slate-500/10 text-slate-100";
  const runningNote = instance.status === "running" ? "Changes apply on the next run." : null;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      const animation = window.setTimeout(() => setVisible(true), 20);
      return () => window.clearTimeout(animation);
    }
    setVisible(false);
    const timeout = window.setTimeout(() => setMounted(false), 260);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  useEffect(() => {
    setWatchlistInput(watchlist.join(", "));
    setWatchlistError(null);
  }, [watchlist, open]);

  useEffect(() => {
    const preset = SCHEDULE_OPTIONS.find((option) => option.value === cadenceSeconds)?.value ?? null;
    setScheduleSelection(preset);
    setScheduleError(null);
    setCustomCadenceValue(
      preset === null ? String(Math.max(Math.round(cadenceSeconds / 60), 1)) : ""
    );
  }, [cadenceSeconds]);

  useEffect(() => {
    setDepthSelection(reportDepth);
    setReportDepthError(null);
  }, [reportDepth]);

  useEffect(() => {
    if (!open) {
      setWatchlistStatus(null);
      setScheduleStatus(null);
      setReportDepthStatus(null);
      setSaveNotice(null);
      setWatchlistError(null);
      setScheduleError(null);
      setReportDepthError(null);
    }
  }, [open]);

  if (!mounted) return null;

  const parseWatchlistInput = (value: string) => {
    const tokens = value
      .split(/[\n,]+/)
      .map((token) => token.trim().toUpperCase())
      .filter(Boolean);
    const unique = Array.from(new Set(tokens));
    if (unique.length > WATCHLIST_LIMIT) {
      return { error: `Watchlist can contain up to ${WATCHLIST_LIMIT} tickers.` };
    }
    const invalidSymbol = unique.find((symbol) => !/^[A-Z0-9.\-]+$/.test(symbol));
    if (invalidSymbol) {
      return { error: `Ticker "${invalidSymbol}" contains invalid characters.` };
    }
    return { symbols: unique };
  };

  const normalizeWatchlistSymbols = (symbols: string[]) =>
    Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))).sort();

  const watchlistCandidate = parseWatchlistInput(watchlistInput);
  const normalizedCurrentWatchlist = normalizeWatchlistSymbols(watchlist);
  const normalizedCandidateWatchlist = watchlistCandidate.symbols
    ? [...watchlistCandidate.symbols].sort()
    : null;
  const isWatchlistDirty =
    normalizedCandidateWatchlist !== null &&
    normalizedCandidateWatchlist.join(",") !== normalizedCurrentWatchlist.join(",");

  const handleSaveWatchlist = async () => {
    if (watchlistCandidate.error) {
      setWatchlistError(watchlistCandidate.error);
      setWatchlistStatus(null);
      return;
    }
    setWatchlistError(null);
    setWatchlistStatus(null);
    setWatchlistLoading(true);
    try {
      const res = await fetch(`/api/market-agent/instances/${instance.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "watchlist", watchlist: watchlistCandidate.symbols }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? "Failed to save watchlist");
      }
      const saved = Array.isArray(payload?.watchlist) ? payload.watchlist : watchlistCandidate.symbols;
      onWatchlistSaved(saved);
      setWatchlistInput(saved.join(", "));
      setWatchlistStatus("Watchlist updated");
      setSaveNotice("Watchlist saved");
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : "Failed to save watchlist");
    } finally {
      setWatchlistLoading(false);
    }
  };

  const handleWatchlistReset = () => {
    setWatchlistInput(watchlist.join(", "));
    setWatchlistError(null);
    setWatchlistStatus(null);
  };

  const deriveCustomCadenceCandidate = (value: string) => {
    const parsed = Number(value);
    if (!parsed || parsed <= 0) {
      return null;
    }
    const unit = CUSTOM_CADENCE_UNITS.find((item) => item.value === customCadenceUnit) ?? CUSTOM_CADENCE_UNITS[0];
    const candidate = Math.round(parsed * unit.multiplier);
    if (!SCHEDULE_OPTIONS.some((option) => option.value === candidate)) {
      return null;
    }
    return candidate;
  };

  const computeCustomCadence = () => {
    const candidate = deriveCustomCadenceCandidate(customCadenceValue);
    if (candidate === null) {
      setScheduleError("Cadence must match one of the supported values.");
      return null;
    }
    return candidate;
  };

  const scheduleCandidate = scheduleSelection ?? deriveCustomCadenceCandidate(customCadenceValue);
  const isScheduleDirty = scheduleCandidate !== null && scheduleCandidate !== cadenceSeconds;
  const isReportDepthDirty = depthSelection !== reportDepth;

  const handleSaveSchedule = async () => {
    setScheduleError(null);
    setScheduleStatus(null);
    const targetSeconds =
      scheduleSelection ?? computeCustomCadence();
    if (!targetSeconds) return;
    if (targetSeconds === cadenceSeconds) {
      setScheduleStatus("Already up to date");
      return;
    }
    setScheduleLoading(true);
    try {
      const res = await fetch(`/api/market-agent/instances/${instance.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "schedule", cadenceSeconds: targetSeconds }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? "Failed to save schedule");
      }
      const nextCadence = payload?.cadenceSeconds ?? targetSeconds;
      onCadenceSaved(nextCadence);
      setScheduleStatus("Schedule saved");
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : "Failed to save schedule");
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleSaveReportDepth = async () => {
    setReportDepthError(null);
    setReportDepthStatus(null);
    if (depthSelection === reportDepth) {
      setReportDepthStatus("Already selected");
      return;
    }
    setReportDepthLoading(true);
    try {
      const res = await fetch(`/api/market-agent/instances/${instance.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reportDepth", reportDepth: depthSelection }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? "Failed to save report depth");
      }
      const nextDepth = payload?.reportDepth ?? depthSelection;
      onReportDepthSaved(nextDepth);
      setReportDepthStatus("Report depth saved");
    } catch (error) {
      setReportDepthError(error instanceof Error ? error.message : "Failed to save report depth");
    } finally {
      setReportDepthLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80]">
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 flex w-full justify-end">
        <div
          className={`flex h-full w-full max-w-[480px] flex-col bg-[#050505] px-0 text-foreground backdrop-blur-xl transition-transform duration-300 ${
            visible ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-white/60">Settings</p>
              <p className="text-lg font-semibold text-white">{instance.label || "Market Agent"}</p>
              <Badge variant="outline" className={cn("text-[11px] gap-1 border px-2 py-0.5", statusTone)}>
                {statusLabel}
              </Badge>
              {saveNotice ? (
                <p className="text-xs text-emerald-300">{saveNotice}</p>
              ) : null}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-6 px-6 py-4">
            <section className="space-y-3 rounded-2xl border border-border/40 bg-background/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Watchlist</h3>
                  <p className="text-[11px] text-muted-foreground">Keep your focus tickers handy.</p>
                </div>
                {runningNote ? (
                  <p className="text-[11px] text-muted-foreground">{runningNote}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {watchlist.length ? (
                  watchlist.map((symbol) => (
                    <Badge
                      key={symbol}
                      variant="outline"
                      className="border-border/60 px-3 py-1 text-[11px] uppercase tracking-[0.35em]"
                    >
                      {symbol}
                    </Badge>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">No tickers defined yet.</p>
                )}
              </div>
              <Textarea
                value={watchlistInput}
                onChange={(event) => setWatchlistInput(event.target.value)}
                placeholder="Add tickers (comma or newline separated)"
                className="min-h-[90px]"
              />
              <p className="text-[11px] text-muted-foreground">Examples: NVDA, AAPL, SPY</p>
              <div className="flex flex-wrap items-center gap-2">
                {!isWatchlistDirty ? (
                  <p className="text-[11px] text-muted-foreground">No changes</p>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleSaveWatchlist}
                    disabled={watchlistLoading || Boolean(watchlistCandidate.error)}
                  >
                    Save watchlist
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={handleWatchlistReset} disabled={watchlistLoading}>
                  Reset
                </Button>
              </div>
              {watchlistCandidate.error ? (
                <p className="text-xs text-rose-300">{watchlistCandidate.error}</p>
              ) : watchlistError ? (
                <p className="text-xs text-rose-300">{watchlistError}</p>
              ) : watchlistStatus ? (
                <p className="text-xs text-emerald-300">{watchlistStatus}</p>
              ) : null}
            </section>

            <section className="space-y-3 rounded-2xl border border-border/40 bg-background/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Schedule</h3>
                  <p className="text-[11px] text-muted-foreground">Choose how often the agent checks the market.</p>
                </div>
                {runningNote ? (
                  <p className="text-[11px] text-muted-foreground">{runningNote}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {SCHEDULE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setScheduleSelection(option.value)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition",
                      scheduleSelection === option.value
                        ? "border-foreground bg-foreground/10 text-foreground"
                        : "border-border/60 text-muted-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setScheduleSelection(null);
                    setCustomCadenceValue(String(Math.max(Math.round(cadenceSeconds / 60), 1)));
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition",
                    scheduleSelection === null
                      ? "border-foreground bg-foreground/10 text-foreground"
                      : "border-border/60 text-muted-foreground"
                  )}
                >
                  Custom
                </button>
              </div>
              {scheduleSelection === null ? (
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={customCadenceValue}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    onChange={(event) => setCustomCadenceValue(event.target.value)}
                    placeholder="Minutes"
                    className="w-full min-w-[140px] bg-transparent"
                  />
                  <select
                    className="h-10 rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                    value={customCadenceUnit}
                    onChange={(event) => setCustomCadenceUnit(event.target.value as typeof CUSTOM_CADENCE_UNITS[number]["value"])}
                  >
                    {CUSTOM_CADENCE_UNITS.map((unit) => (
                      <option key={unit.value} value={unit.value}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                {!isScheduleDirty ? (
                  <p className="text-xs text-muted-foreground">No changes</p>
                ) : (
                  <Button size="sm" onClick={handleSaveSchedule} disabled={scheduleLoading}>
                    Save schedule
                  </Button>
                )}
                {scheduleError ? (
                  <p className="text-xs text-rose-300">{scheduleError}</p>
                ) : scheduleStatus ? (
                  <p className="text-xs text-emerald-300">{scheduleStatus}</p>
                ) : null}
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-border/40 bg-background/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Report depth</h3>
                  <p className="text-[11px] text-muted-foreground">Control how deep each report goes.</p>
                </div>
                {runningNote ? (
                  <p className="text-[11px] text-muted-foreground">{runningNote}</p>
                ) : null}
              </div>
              <div className="grid gap-3">
                {REPORT_DEPTH_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDepthSelection(option.value)}
                    className={cn(
                      "w-full rounded-2xl border px-3 py-2 text-left transition",
                      depthSelection === option.value
                        ? "border-foreground bg-foreground/10 text-white"
                        : "border-border/60 text-muted-foreground"
                    )}
                  >
                    <p className="text-sm font-semibold">{option.label}</p>
                    <p className="text-[11px]">{option.description}</p>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                {!isReportDepthDirty ? (
                  <p className="text-xs text-muted-foreground">No changes</p>
                ) : (
                  <Button size="sm" onClick={handleSaveReportDepth} disabled={reportDepthLoading}>
                    Save report depth
                  </Button>
                )}
                {reportDepthError ? (
                  <p className="text-xs text-rose-300">{reportDepthError}</p>
                ) : reportDepthStatus ? (
                  <p className="text-xs text-emerald-300">{reportDepthStatus}</p>
                ) : null}
              </div>
            </section>

            <section className="space-y-2 rounded-2xl border border-border/40 bg-background/60 p-4">
              <h3 className="text-sm font-semibold text-white">Alerts & triggers</h3>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </section>

            <section className="space-y-2 rounded-2xl border border-border/40 bg-background/60 p-4">
              <h3 className="text-sm font-semibold text-white">Budget caps</h3>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
