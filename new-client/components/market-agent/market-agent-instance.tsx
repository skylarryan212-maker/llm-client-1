"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  LineChart,
  List,
  MessageCircle,
  Newspaper,
  Pause,
  Play,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MarketAgentFeedEvent, MarketAgentInstanceWithWatchlist, MarketAgentChatMessage, MarketAgentThesis } from "@/lib/data/market-agent";
import type { Database } from "@/lib/supabase/types";
import { type MarketSuggestionEvent } from "@/types/market-suggestion";
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
  initialSuggestionEvents?: MarketSuggestionEvent[];
  initialSuggestionEventIds?: string[];
};

type ReportDepth = "short" | "standard" | "deep";
type WorkspaceView = "timeline" | "charts" | "news" | "report";
type MobileNavButtonId = WorkspaceView | "chat";

const WATCHLIST_LIMIT = 25;
const MAX_SUGGESTION_CARDS = 5;

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

const formatCadenceLabelForHeader = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return `${seconds}s`;
  }
  if (seconds === 60) return "1m";
  if (seconds === 300) return "5m";
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${seconds}s`;
};

const getSuggestionHeader = (event: MarketSuggestionEvent) => {
  const parts: string[] = [];
  if (event.cadence) {
    parts.push(`${formatCadenceLabelForHeader(event.cadence.intervalSeconds)} cadence`);
  }
  if (event.watchlist) {
    parts.push("+ watchlist update");
  }
  return parts.join(" ").trim() || "Suggestion";
};
type AgentChatMessage = MarketAgentChatMessage;
export function MarketAgentInstanceView({
  instance,
  events,
  thesis: _thesis,
  state: _state,
  initialSelectedEventId,
  initialSuggestionEvents = [],
  initialSuggestionEventIds = [],
}: Props) {
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
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>("timeline");
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [isMobileView, setIsMobileView] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<MobileNavButtonId>("timeline");
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
  const [suggestionEvents, setSuggestionEvents] = useState<MarketSuggestionEvent[]>(initialSuggestionEvents ?? []);
  const [suggestionActionState, setSuggestionActionState] = useState<Record<string, { applying?: boolean; dismissing?: boolean }>>({});
  const [isRefreshingSuggestions, setIsRefreshingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const lastEventIdsRef = useRef<string[]>(initialSuggestionEventIds ?? []);
  const lastEventIdsSetRef = useRef(new Set(initialSuggestionEventIds ?? []));
  const suggestionRequestInFlightRef = useRef(false);
  const userTimezone = useMemo(() => {
    if (typeof Intl === "undefined") return "UTC";
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }, []);
  const cadenceMode: "market_hours" | "always_on" = useMemo(() => {
    const config = instance.config;
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const mode = (config as Record<string, unknown>).cadence_mode;
      if (mode === "market_hours") {
        return "market_hours";
      }
    }
    return "always_on";
  }, [instance.config]);
  const stateRow = _state;
  const addEventIdToCache = useCallback((eventId: string) => {
    if (lastEventIdsSetRef.current.has(eventId)) return;
    lastEventIdsSetRef.current.add(eventId);
    lastEventIdsRef.current.push(eventId);
    if (lastEventIdsRef.current.length > 50) {
      const removed = lastEventIdsRef.current.shift();
      if (removed) {
        lastEventIdsSetRef.current.delete(removed);
      }
    }
  }, []);
  const appendSuggestionEvents = useCallback(
    (events: MarketSuggestionEvent[]) => {
      if (!events.length) return;
      setSuggestionEvents((prev) => {
        const unique = events.filter((event) => !lastEventIdsSetRef.current.has(event.eventId));
        if (!unique.length) return prev;
        unique.forEach((event) => addEventIdToCache(event.eventId));
        const next = [...unique, ...prev];
        return next.slice(0, MAX_SUGGESTION_CARDS);
      });
    },
    [addEventIdToCache]
  );
  const [bottomSpacerPx, setBottomSpacerPx] = useState(baseBottomSpacerPx);
  const [timelineEvents, setTimelineEvents] = useState<MarketAgentFeedEvent[]>(events ?? []);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
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
  void _thesis;

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
  const timelineExpanded = activeWorkspace === "timeline" && timelineOpen;
  const selectedEventIndex = selectedEventId ? timelineEvents.findIndex((evt) => evt.id === selectedEventId) : -1;
  const timelineEmpty = timelineEvents.length === 0;
  const isTimelineMode = activeWorkspace === "timeline";
  const isReportMode = activeWorkspace === "report";
  const showTimelineColumn = isTimelineMode;
  const showReportColumn = !isMobileView ? isTimelineMode : isReportMode;
  const timelinePanelMaxWidth = timelineExpanded ? (isMobileView ? "100%" : 420) : 0;
  const timelinePanelTransitionClass = isMobileView ? "transition-none" : "transition-all duration-300 ease-out";
  const timelinePanelOrderClass = isMobileView ? "order-2 md:order-none" : "";
  const reportPanelOrderClass = isMobileView ? "order-1 md:order-none" : "";
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
    if (!iso) return "-";
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

  const getReportLabel = (index: number, total: number) => {
    if (!total || index < 0) return "Report";
    return `Report ${Math.max(1, total - index)}`;
  };
  const reportFallbackBodies = [
    "## Market recap\n- Semis led risk-on flows; momentum concentrated in NVDA and QQQ.\n- Breadth remains narrow; avoid over-sizing.\n- Watching macro catalyst for regime confirmation.",
    "## Focus update\n- Buyers defended key support; short-term bias intact.\n- Tighten stops near recent lows.\n- Wait for breakouts before adding risk.",
    "## Risk check\n- Volatility bid into the close; watch for gap risk.\n- Reduce exposure into catalyst windows.\n- Favor liquid tickers for faster exits.",
  ];

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
    setTimelineEvents(events ?? []);
  }, [events]);

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
    setSuggestionEvents(initialSuggestionEvents ?? []);
    setSuggestionActionState({});
    setSuggestionError(null);
    lastEventIdsRef.current = initialSuggestionEventIds ?? [];
    lastEventIdsSetRef.current = new Set(initialSuggestionEventIds ?? []);
  }, [instance.id, initialSuggestionEvents, initialSuggestionEventIds]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [instance.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsMobileView(window.innerWidth < 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const handleTimelineNavClick = () => {
    setActiveWorkspace("timeline");
    setTimelineOpen(true);
  };

  const handleMobileNavSelect = (selection: MobileNavButtonId) => {
    setMobileActiveTab(selection);
    if (selection === "chat") {
      setIsChatOpen(true);
      return;
    }
    setIsChatOpen(false);
    setActiveWorkspace(selection);
    setTimelineOpen(selection === "timeline");
  };
  const closeChatOverlay = () => {
    setIsChatOpen(false);
    setMobileActiveTab("timeline");
  };

  useEffect(() => {
    if (mobileActiveTab !== "chat") {
      setIsChatOpen(false);
    }
  }, [mobileActiveTab]);

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

  const triggerSuggestionRefresh = useCallback(
    async (userMessage: string) => {
      if (!instance.id || suggestionRequestInFlightRef.current) return;
      suggestionRequestInFlightRef.current = true;
      setIsRefreshingSuggestions(true);
      setSuggestionError(null);
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 25_000);
      try {
        const lastEvent = timelineEvents[0];
        const lastRunAt = lastEvent?.ts ?? lastEvent?.created_at ?? new Date().toISOString();
        const agentStatePayload = {
          status: instance.status === "running" ? "running" : "paused",
          cadenceSeconds: cadenceSecondsState,
          cadenceMode,
          watchlistTickers: watchlistState,
          timezone: userTimezone,
          lastRunAt,
        };
        const marketSnapshot = {
          timestamp: lastRunAt,
          summary: lastEvent?.summary ?? "",
          tickers: lastEvent?.tickers ?? [],
          state: stateRow?.state ?? {},
        };
        const payload = {
          agentInstanceId: instance.id,
          userMessage,
          agentState: agentStatePayload,
          marketSnapshot,
          lastAnalysisSummary: lastEvent?.summary ?? "",
          lastUiEventIds: [...lastEventIdsRef.current],
        };
        console.debug("[a2ui] triggerSuggestionRefresh -> POST", payload);
        const response = await fetch("/api/agents/market-agent/a2ui-suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          throw new Error(errorBody?.error ?? "Failed to refresh suggestions");
        }
        const data = (await response.json().catch(() => null)) as { events?: MarketSuggestionEvent[] } | null;
        const events = Array.isArray(data?.events) ? data.events : [];
        console.debug("[a2ui] triggerSuggestionRefresh <- response", { count: events.length });
        appendSuggestionEvents(events);
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        setSuggestionError(
          aborted ? "Suggestion refresh timed out. Please try again." : error instanceof Error ? error.message : "Failed to refresh suggestions"
        );
        console.error("[a2ui] triggerSuggestionRefresh error", error);
      } finally {
        window.clearTimeout(timeoutId);
        suggestionRequestInFlightRef.current = false;
        setIsRefreshingSuggestions(false);
      }
    },
    [
      cadenceMode,
      instance.id,
      instance.status,
      cadenceSecondsState,
      watchlistState,
      timelineEvents,
      stateRow,
      userTimezone,
      appendSuggestionEvents,
    ],
  );

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
    try {
      const controller = new AbortController();
      streamingAbortRef.current = controller;
      streamingResponseIdRef.current = null;
      streamingAgentTempIdRef.current = null;
      setIsStreamingAgent(true);
      setShowThinkingIndicator(true);
      hasStreamedTokenRef.current = false;

      const requestPayload: Record<string, unknown> = { role: "user", content };
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
      void triggerSuggestionRefresh(content);
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

  const handleApplySuggestion = useCallback(
    async (event: MarketSuggestionEvent) => {
      setSuggestionActionState((prev) => ({ ...prev, [event.eventId]: { applying: true } }));
      setSuggestionError(null);
      try {
        if (event.cadence) {
          const response = await fetch("/api/agents/market-agent/apply-cadence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentInstanceId: instance.id,
              eventId: event.eventId,
              intervalSeconds: event.cadence.intervalSeconds,
              mode: cadenceMode,
            }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error ?? "Failed to apply cadence");
          }
          const payload = await response.json().catch(() => null);
          setCadenceSecondsState(
            typeof payload?.cadenceSeconds === "number" ? payload.cadenceSeconds : event.cadence!.intervalSeconds
          );
        }
        if (event.watchlist) {
          const response = await fetch("/api/agents/market-agent/apply-watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentInstanceId: instance.id,
              eventId: event.eventId,
              tickers: event.watchlist.tickers,
              action: "add",
            }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error ?? "Failed to apply watchlist");
          }
          const payload = await response.json().catch(() => null);
          if (Array.isArray(payload?.watchlist)) {
            setWatchlistState(payload.watchlist);
          }
        }
        const statusResponse = await fetch("/api/agents/market-agent/update-suggestion-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentInstanceId: instance.id, eventId: event.eventId, status: "applied" }),
        });
        if (!statusResponse.ok) {
          const payload = await statusResponse.json().catch(() => null);
          throw new Error(payload?.error ?? "Failed to finalize suggestion");
        }
        addEventIdToCache(event.eventId);
        setSuggestionEvents((prev) => prev.filter((item) => item.eventId !== event.eventId));
      } catch (error) {
        setSuggestionError(error instanceof Error ? error.message : "Failed to apply suggestion");
      } finally {
        setSuggestionActionState((prev) => {
          const next = { ...prev };
          delete next[event.eventId];
          return next;
        });
      }
    },
    [addEventIdToCache, instance.id, cadenceMode]
  );

  const handleDismissSuggestion = useCallback(
    async (eventId: string) => {
      setSuggestionActionState((prev) => ({ ...prev, [eventId]: { dismissing: true } }));
      setSuggestionError(null);
      try {
        const response = await fetch("/api/agents/market-agent/update-suggestion-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentInstanceId: instance.id, eventId, status: "dismissed" }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? "Failed to dismiss suggestion");
        }
        addEventIdToCache(eventId);
        setSuggestionEvents((prev) => prev.filter((item) => item.eventId !== eventId));
      } catch (error) {
        setSuggestionError(error instanceof Error ? error.message : "Failed to dismiss suggestion");
      } finally {
        setSuggestionActionState((prev) => {
          const next = { ...prev };
          delete next[eventId];
          return next;
        });
      }
    },
    [addEventIdToCache, instance.id]
  );


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
      <div className="min-h-screen md:h-screen md:overflow-hidden bg-[#050505] text-foreground pb-20 md:pb-0">
        <div className="flex min-h-screen md:h-full flex-col">
          <header className="sticky top-0 z-30 flex flex-wrap md:flex-nowrap items-center gap-3 md:gap-4 border-b border-white/10 bg-black/80 px-4 py-2 backdrop-blur md:static md:z-auto">
          <div className="flex w-full md:w-auto items-center gap-3">
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
          <div className="hidden md:flex flex-1 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80">
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
          <div className="flex w-full md:w-auto flex-wrap items-center gap-2 md:justify-end">
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
              className="gap-1 hidden md:flex"
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

            <div className="flex flex-1 min-h-0 h-full flex-col md:flex-row overflow-hidden gap-0 items-stretch">
            <div className="hidden md:flex h-full w-[76px] flex-col items-center gap-2 border-r border-white/10 bg-[#050505] px-2 py-3">
              <button
                type="button"
                className={cn(
                  "relative flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition md:w-full",
                  activeWorkspace === "timeline" ? "bg-white/5 text-white" : "text-white/60 hover:text-white"
                )}
                onClick={() => {
                  setActiveWorkspace("timeline");
                  setTimelineOpen((prev) => (activeWorkspace === "timeline" ? !prev : true));
                }}
              >
                <List className="h-5 w-5" />
                <span>Timeline</span>
                <span className="hidden md:block absolute right-1 top-1 text-white/60">
                  {timelineExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </span>
              </button>
              <button
                type="button"
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition md:w-full",
                  activeWorkspace === "charts" ? "bg-white/5 text-white" : "text-white/60 hover:text-white"
                )}
                onClick={() => {
                  setActiveWorkspace("charts");
                  setTimelineOpen(false);
                }}
              >
                <LineChart className="h-5 w-5" />
                <span>Charts</span>
              </button>
              <button
                type="button"
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition md:w-full",
                  activeWorkspace === "news" ? "bg-white/5 text-white" : "text-white/60 hover:text-white"
                )}
                onClick={() => {
                  setActiveWorkspace("news");
                  setTimelineOpen(false);
                }}
              >
                <Newspaper className="h-5 w-5" />
                <span>News</span>
              </button>
            </div>
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden px-1 sm:px-3 py-3">
              {isTimelineMode || isReportMode ? (
                <div className="flex h-full flex-col gap-4">
                  <div className="flex flex-1 min-h-0 flex-col md:flex-row gap-4">
                    {showTimelineColumn && (
                      <div
                        className={cn(
                          "flex flex-col gap-2 overflow-hidden",
                          timelinePanelTransitionClass,
                          timelineExpanded ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2",
                          timelinePanelOrderClass
                        )}
                        style={{ maxWidth: timelinePanelMaxWidth }}
                      >
                        <div className="w-full md:w-fit md:min-w-[280px] md:max-w-[420px] flex-none flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
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
                                </ul>
                              </div>
                            ) : (
                              timelineEvents.map((evt, index) => {
                                const isActive = evt.id === selectedEventId;
                                const reportLabel = getReportLabel(index, timelineEvents.length);
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
                                      <div className="space-y-1">
                                        <p className="text-sm font-semibold text-white">{reportLabel}</p>
                                        <p className="text-[11px] text-muted-foreground">
                                          {formatTimestamp(evt.created_at || evt.ts)}
                                        </p>
                                      </div>
                                      {evt.tickers && evt.tickers.length ? (
                                        <div className="flex flex-nowrap items-center gap-1 text-[11px] whitespace-nowrap">
                                          {evt.tickers.map((ticker) => (
                                            <span
                                              key={ticker}
                                              className="rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-white/80"
                                            >
                                              {ticker}
                                            </span>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {showReportColumn && (
                      <div
                        className={cn(
                          "flex-1 min-h-0 rounded-2xl border border-border/60 bg-background/60 p-4 overflow-y-auto",
                          reportPanelOrderClass
                        )}
                      >
                        {selectedEvent ? (
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <p className="text-xs uppercase tracking-[0.3em] text-white/60">Report</p>
                                <p className="text-xl font-semibold text-white">
                                  {selectedEventIndex >= 0 ? getReportLabel(selectedEventIndex, timelineEvents.length) : "Report"}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {formatTimestamp(selectedEvent.created_at || selectedEvent.ts)}
                                </p>
                              </div>
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
                              <MarkdownContent
                                content={
                                  selectedEvent.body_md ||
                                  selectedEvent.summary ||
                                  reportFallbackBodies[
                                    Math.max(0, selectedEventIndex) % reportFallbackBodies.length
                                  ]
                                }
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/60 bg-black/20 p-6 text-sm text-muted-foreground">
                            Select a report to view details.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/60 bg-black/20 p-6 text-sm text-muted-foreground">
                  {activeWorkspace === "charts" ? "Charts coming soon." : "News coming soon."}
                </div>
              )}
            </div>
            <AgentChatSidebar
              open={isChatOpen}
              onClose={closeChatOverlay}
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
              suggestionEvents={suggestionEvents}
              suggestionActionState={suggestionActionState}
              onApplySuggestion={handleApplySuggestion}
              onDismissSuggestion={handleDismissSuggestion}
              isRefreshingSuggestions={isRefreshingSuggestions}
              suggestionError={suggestionError}
              chatListRef={chatListRef}
              showScrollToBottom={showScrollToBottom}
              onScroll={handleChatScroll}
              onScrollToBottom={handleScrollToBottomClick}
              pinSpacerHeight={pinSpacerHeight}
              bottomSpacerPx={bottomSpacerPx}
              prefillValue={chatPrefill}
              isMobileView={isMobileView}
              onPrefillUsed={() => setChatPrefill(null)}
              onApplyStarter={(text) => setChatPrefill(text)}
            />
          </div>
      </div>
      <div
        className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#050505]/90 backdrop-blur px-4 pt-2"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          {[
            { id: "timeline" as MobileNavButtonId, label: "Timeline", Icon: List },
            { id: "report" as MobileNavButtonId, label: "Report", Icon: FileText },
            { id: "charts" as MobileNavButtonId, label: "Charts", Icon: LineChart },
            { id: "news" as MobileNavButtonId, label: "News", Icon: Newspaper },
            { id: "chat" as MobileNavButtonId, label: "Chat", Icon: MessageCircle },
          ].map((item) => {
            const isActive = mobileActiveTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex flex-col items-center gap-1 rounded-full px-3 py-2 text-[11px] font-medium transition",
                  isActive ? "bg-white/5 text-white" : "text-white/60 hover:text-white"
                )}
                onClick={() => handleMobileNavSelect(item.id)}
              >
                <item.Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
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
  suggestionEvents: MarketSuggestionEvent[];
  suggestionActionState: Record<string, { applying?: boolean; dismissing?: boolean }>;
  onApplySuggestion: (event: MarketSuggestionEvent) => void;
  onDismissSuggestion: (eventId: string) => void;
  isRefreshingSuggestions: boolean;
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
  isMobileView: boolean;
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
  suggestionEvents,
  suggestionActionState,
  onApplySuggestion,
  onDismissSuggestion,
  isRefreshingSuggestions,
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
  isMobileView,
}: AgentChatSidebarProps) {
  const composerWrapperClass = cn(
    "agent-chat-composer-wrapper border-t border-border/60 space-y-3",
    isMobileView ? "sticky left-0 right-0 z-20 bg-[#050505]/95 px-4 pt-3" : "px-2 pt-2"
  );
  const composerStickyStyle = isMobileView
    ? { bottom: `calc(4rem + env(safe-area-inset-bottom, 0px))`, paddingBottom: "1rem" }
    : undefined;
  const baseScrollBottom = 96;
  const scrollTipBottom = baseScrollBottom;
  const scrollTipBottomPosition = isMobileView
    ? `calc(${scrollTipBottom}px + 4rem + env(safe-area-inset-bottom,0px))`
    : `calc(${scrollTipBottom}px + env(safe-area-inset-bottom,0px))`;

  const showStarterPrompts = !isLoading && !error && messages.length === 0;
  const starterPrompts = [
    "Refine the current thesis for these tickers.",
    "What would invalidate this bias today?",
    "Tighten alerts around key levels and volatility.",
  ];
  const sidebarShellClass = cn(
    "flex-shrink-0 min-h-0 overflow-hidden transition-[width] duration-300",
    open
      ? "fixed inset-0 z-40 h-full w-full md:relative md:z-auto md:h-full md:w-[440px] md:max-w-[440px]"
      : "hidden md:block md:w-0"
  );

  return (
    <div className={sidebarShellClass} aria-hidden={!open}>
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
          <Button variant="ghost" size="icon" onClick={onClose} className="hidden md:inline-flex">
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
                  style={{ bottom: scrollTipBottomPosition }}
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

          <div className={composerWrapperClass} style={composerStickyStyle}>
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
              <div className="space-y-2 rounded-2xl border border-emerald-500/20 bg-white/5 p-4 text-sm text-foreground">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-200">Suggestions</p>
                    <p className="text-[11px] text-muted-foreground">
                      Cards are based on agent insights and snapshot.
                    </p>
                  </div>
                  {isRefreshingSuggestions ? (
                    <p className="text-[11px] text-emerald-200">Refreshing suggestions…</p>
                  ) : null}
                </div>
                {suggestionError ? (
                  <p className="text-xs text-rose-300">{suggestionError}</p>
                ) : null}
                {suggestionEvents.length ? (
                  suggestionEvents.map((event) => {
                    const actionState = suggestionActionState[event.eventId] ?? {};
                    return (
                      <div
                        key={event.eventId}
                        className="space-y-2 rounded-2xl border border-white/15 bg-black/30 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-white">{getSuggestionHeader(event)}</p>
                          {actionState.applying ? (
                            <span className="text-[11px] text-muted-foreground">Applying…</span>
                          ) : actionState.dismissing ? (
                            <span className="text-[11px] text-muted-foreground">Dismissing…</span>
                          ) : null}
                        </div>
                        {event.watchlist ? (
                          <p className="text-xs uppercase text-muted-foreground tracking-[0.2em]">
                            WATCHLIST: {event.watchlist.tickers.join(", ")}
                          </p>
                        ) : null}
                        {event.cadence ? (
                          <p className="text-[11px] text-muted-foreground">
                            Cadence reason: {event.cadence.reason}
                          </p>
                        ) : null}
                        {event.watchlist ? (
                          <p className="text-[11px] text-muted-foreground">
                            Watchlist reason: {event.watchlist.reason}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onDismissSuggestion(event.eventId)}
                            disabled={isStreaming || actionState.dismissing}
                          >
                            Dismiss
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => onApplySuggestion(event)}
                            disabled={isStreaming || actionState.applying}
                          >
                            Apply
                          </Button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No suggestions right now. Ask the agent or wait for new insights.
                  </p>
                )}
              </div>
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
