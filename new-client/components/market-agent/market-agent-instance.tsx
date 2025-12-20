"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, MessageCircle, Pause, Play, Settings2, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MarketEventCard } from "@/components/market-agent/market-event-card";
import type { MarketAgentFeedEvent, MarketAgentInstanceWithWatchlist, MarketAgentChatMessage } from "@/lib/data/market-agent";
import type { Database } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type MarketAgentStateRow = Database["public"]["Tables"]["market_agent_state"]["Row"];

type Props = {
  instance: MarketAgentInstanceWithWatchlist;
  events: MarketAgentFeedEvent[];
  state: MarketAgentStateRow | null;
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

type AgentChatMessage = MarketAgentChatMessage;

export function MarketAgentInstanceView({ instance, events, state: _state }: Props) {
  const router = useRouter();
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
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [bottomSpacerPx, setBottomSpacerPx] = useState(baseBottomSpacerPx);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const [alignTrigger, setAlignTrigger] = useState(0);
  const pinnedMessageIdRef = useRef<string | null>(null);
  const [pinSpacerHeight, setPinSpacerHeight] = useState(0);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const mockReplyTimeoutRef = useRef<number | null>(null);
  const pinToPromptRef = useRef(false);
  const pinnedScrollTopRef = useRef<number | null>(null);
  const alignNextUserMessageToTopRef = useRef<string | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
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
      if (mockReplyTimeoutRef.current) {
        window.clearTimeout(mockReplyTimeoutRef.current);
      }
    };
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
    const distance = getEffectiveScrollBottom(viewport) - (scrollTop + clientHeight);
    const tolerance = Math.max(12, bottomSpacerPx / 3);
    const atBottom = distance <= tolerance;
    setShowScrollToBottom(!atBottom);
    if (atBottom) {
      releasePinning();
      setIsAutoScroll(true);
    } else if (!pinToPromptRef.current) {
      setIsAutoScroll(false);
    }
  };

  useEffect(() => {
    if (alignNextUserMessageToTopRef.current) return;
    if (!isChatOpen) {
      releasePinning();
      setShowScrollToBottom(false);
      setIsAutoScroll(true);
      return;
    }
    if (!isAutoScroll) return;
    scrollToBottom("auto");
    setShowScrollToBottom(false);
    releasePinning();
  }, [alignTrigger, chatMessages.length, isChatOpen, isAutoScroll]);

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

  const sendMockReply = (userContent: string) => {
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/market-agent/instances/${instance.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "agent",
            content: "Mock reply: I'll use this when autonomy is live. For now, adjust watchlist/cadence in Settings.",
          }),
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error ?? "Failed to insert mock reply");
        }
        if (payload?.message) {
          upsertChatMessage(payload.message as AgentChatMessage);
        }
      } catch (error) {
        setChatError(error instanceof Error ? error.message : "Failed to send mock reply");
      }
    }, 800);
    mockReplyTimeoutRef.current = timeout;
  };

  const handleSendChat = async (inputContent: string) => {
    const content = inputContent.trim();
    if (!content || isSendingChat) return;
    setIsSendingChat(true);
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
    const viewport = chatListRef.current;
    const currentScrollTop = viewport?.scrollTop ?? 0;
    pinToPromptRef.current = true;
    pinnedScrollTopRef.current = currentScrollTop;
    setPinSpacerHeight(currentScrollTop);
    alignNextUserMessageToTopRef.current = tempId;
    setAlignTrigger((prev) => prev + 1);
    setIsAutoScroll(false);
    setShowScrollToBottom(true);
    try {
      const res = await fetch(`/api/market-agent/instances/${instance.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? "Failed to send message");
      }
      if (payload?.message) {
        upsertChatMessage(payload.message as AgentChatMessage, tempId);
        alignNextUserMessageToTopRef.current = payload.message.id;
        setAlignTrigger((prev) => prev + 1);
      }
      sendMockReply(content);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setIsSendingChat(false);
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

          <div className="flex flex-1 min-h-0 h-full overflow-hidden gap-4 items-stretch">
            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto space-y-6 p-1 sm:p-3">
              <div className="space-y-3">
              {events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
                  No reports yet for this agent.
                </div>
              ) : (
                events.map((event) => (
                  <div key={event.id} id={event.id}>
                    <MarketEventCard
                      event={event}
                      instance={event.instance ?? instance}
                      onOpen={(evt) => router.push(`/agents/market-agent/${evt.instance_id}#${evt.id}`)}
                      showInstanceMeta={false}
                      showPayloadDetails
                    />
                  </div>
                ))
              )}
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
            chatListRef={chatListRef}
            showScrollToBottom={showScrollToBottom}
            onScroll={handleChatScroll}
            onScrollToBottom={handleScrollToBottomClick}
            pinSpacerHeight={pinSpacerHeight}
            bottomSpacerPx={bottomSpacerPx}
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
  chatListRef: MutableRefObject<HTMLDivElement | null>;
  showScrollToBottom: boolean;
  onScroll: () => void;
  onScrollToBottom: () => void;
  pinSpacerHeight: number;
  bottomSpacerPx: number;
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
  chatListRef,
  showScrollToBottom,
  onScroll,
  onScrollToBottom,
  pinSpacerHeight,
  bottomSpacerPx,
}: AgentChatSidebarProps) {
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
            <Badge variant="outline" className={cn("text-[11px] gap-1 border px-2 py-0.5", statusTone)}>
              {statusLabel}
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
          <div className="relative flex-1 min-h-0 overflow-hidden" style={{ minWidth: 0 }}>
            <div
              ref={chatListRef}
              className="h-full min-h-0 overflow-y-auto overflow-x-hidden space-y-3 agent-chat-message-list"
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
              <p className="px-2 text-xs text-muted-foreground">No messages yet. Start the conversation below.</p>
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
            <div aria-hidden className="w-full" style={{ height: bottomSpacerPx }} />
            </div>
            {showScrollToBottom && (
              <div
                className={`scroll-tip pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom,0px))] z-30 transition-opacity duration-200 ${
                  showScrollToBottom ? "opacity-100 scroll-tip-visible" : "opacity-0"
                }`}
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

          <div className="border-t border-border/60 px-2 pt-3 agent-chat-composer-wrapper">
            {error && !isLoading ? (
              <p className="text-xs text-rose-300 mb-2">{error}</p>
            ) : null}
            <div className="mx-auto w-full max-w-3xl">
              <ChatComposer
                onSendMessage={onSendChat}
                placeholder="Ask the agent..."
                disableAccentStyles
                showAttachmentButton={false}
                sendButtonStyle={{
                  backgroundColor: "#ffffff",
                  color: "#050505",
                  border: "1px solid rgba(15, 20, 25, 0.35)",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
                }}
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
