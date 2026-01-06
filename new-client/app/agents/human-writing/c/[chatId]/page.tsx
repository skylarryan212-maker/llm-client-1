"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, Loader2, X } from "lucide-react";

import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { Button } from "@/components/ui/button";

interface PageProps {
  params: { chatId: string };
}

type MessageKind = "text" | "cta" | "drafting";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: MessageKind;
  status?: "pending" | "done";
  draftText?: string;
}

type HumanizerModel = "undetectable" | "seo" | "custom";

type HumanizerSettings = {
  model: HumanizerModel;
  language: string;
  customStyleId?: string;
};

const baseBottomSpacerPx = 28;

function ChatInner({ params }: PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlParams = useParams();
  const prompt = searchParams.get("prompt")?.trim() || "";
  const taskId =
    (typeof urlParams?.chatId === "string" && urlParams.chatId) ||
    params.chatId ||
    "unknown";

  const [messages, setMessages] = useState<Message[]>([]);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isHumanizing, setIsHumanizing] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const sidebarDismissedRef = useRef(false);
  const [humanizerSettings, setHumanizerSettings] = useState<HumanizerSettings>({
    model: "undetectable",
    language: "auto",
    customStyleId: "",
  });
  const [initialized, setInitialized] = useState(false);
  const startInitializedRef = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);
  const hasStartedRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [bottomSpacerPx, setBottomSpacerPx] = useState(baseBottomSpacerPx);
  const [pinSpacerHeight, setPinSpacerHeight] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [alignTrigger, setAlignTrigger] = useState(0);
  const pinnedMessageIdRef = useRef<string | null>(null);
  const initialScrollDoneRef = useRef(false);
  const pinToPromptRef = useRef(false);
  const pinnedScrollTopRef = useRef<number | null>(null);
  const alignNextUserMessageToTopRef = useRef<string | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const hasStreamedTokenRef = useRef(false);
  const lockedScrollHeightRef = useRef<number | null>(null);
  const lockScrollAfterStreamRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const initialPromptRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialized) return;

    const init = async () => {
      // Pull initial prompt from session storage (set on landing page)
      if (typeof window !== "undefined") {
        const stored = sessionStorage.getItem(`hw-init-${taskId}`);
        if (stored) {
          initialPromptRef.current = stored;
          try {
            sessionStorage.removeItem(`hw-init-${taskId}`);
          } catch {
            // ignore
          }
        }
        const settings = sessionStorage.getItem(`hw-settings-${taskId}`);
        if (settings) {
          try {
            const parsed = JSON.parse(settings) as Partial<HumanizerSettings>;
            setHumanizerSettings((prev) => ({
              model: (parsed.model as HumanizerModel) || prev.model,
              language: parsed.language || prev.language,
              customStyleId: parsed.customStyleId || prev.customStyleId,
            }));
            try {
              sessionStorage.removeItem(`hw-settings-${taskId}`);
            } catch {
              // ignore
            }
          } catch {
            // ignore invalid settings
          }
        }
      }

      try {
        const res = await fetch(`/api/human-writing/history?taskId=${encodeURIComponent(taskId)}`);
        if (res.ok) {
          const data = await res.json();
          const loaded = (data?.messages || []) as Array<{
            role: "user" | "assistant";
            content: string;
            metadata?: any;
          }>;
          if (loaded.length) {
            const mapped: Message[] = loaded.map((m, idx) => ({
              id: `h-${idx}`,
              role: m.role,
              content: m.content,
              kind: m.metadata?.kind === "cta" ? "cta" : undefined,
              draftText: m.metadata?.draftText,
              status: m.metadata?.status,
            }));
            setMessages(mapped);
            messagesRef.current = mapped;
          }
        }
      } catch {
        // ignore
      }

      const bootPrompt = initialPromptRef.current || prompt;
      if (bootPrompt && !startInitializedRef.current) {
        setHasStarted(true);
        hasStartedRef.current = true;
        startInitializedRef.current = true;
        void startDraftFlow(bootPrompt);
      } else if (!hasStartedRef.current && messagesRef.current.length === 0) {
        const initial: Message[] = [
          {
            id: "init-assistant",
            role: "assistant",
            content: "Tell me what to write. I'll draft it and, once you approve, I'll run the humanizer.",
          },
        ];
        setMessages(initial);
        messagesRef.current = initial;
      }

      setInitialized(true);
    };

    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, initialized, taskId, hasStarted]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [taskId]);

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

  const getLockedMaxScrollTop = (viewport: HTMLDivElement) => {
    const lockedHeight = lockedScrollHeightRef.current;
    if (!lockedHeight) return null;
    return Math.max(0, lockedHeight - viewport.clientHeight);
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const bottom = getEffectiveScrollBottom(viewport);
    const targetTop = Math.max(0, bottom - viewport.clientHeight);
    isProgrammaticScrollRef.current = true;
    viewport.scrollTo({ top: targetTop, behavior });
    scheduleProgrammaticScrollReset();
  }, [getEffectiveScrollBottom]);

  const releasePinning = () => {
    pinToPromptRef.current = false;
    pinnedScrollTopRef.current = null;
    setPinSpacerHeight(0);
  };

  const computeRequiredSpacerForMessage = useCallback(
    (messageId: string) => {
      const viewport = scrollRef.current;
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
    [bottomSpacerPx]
  );

  const handleChatScroll = () => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    if (isProgrammaticScrollRef.current) return;
    if (pinToPromptRef.current) {
      pinToPromptRef.current = false;
      pinnedScrollTopRef.current = null;
      setPinSpacerHeight(0);
    }
    const { scrollTop, clientHeight } = viewport;
    const lockedMax = getLockedMaxScrollTop(viewport);
    if (lockedMax !== null && !isDrafting && scrollTop > lockedMax + 2) {
      isProgrammaticScrollRef.current = true;
      viewport.scrollTop = lockedMax;
      scheduleProgrammaticScrollReset();
      return;
    }
    const effectiveBottom = getEffectiveScrollBottom(viewport);
    const distanceFromBottom = effectiveBottom - (scrollTop + clientHeight);
    const tolerance = Math.max(16, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;
    setShowScrollToBottom(!atBottom);
    if (!pinToPromptRef.current) {
      setIsAutoScroll(atBottom);
    }
  };

  const recomputeScrollFlags = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const { scrollTop, clientHeight } = viewport;
    const effectiveBottom = getEffectiveScrollBottom(viewport);
    const distanceFromBottom = effectiveBottom - (scrollTop + clientHeight);
    const tolerance = Math.max(16, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;
    setShowScrollToBottom(!atBottom);
  }, [bottomSpacerPx, getEffectiveScrollBottom]);

  useEffect(() => {
    if (isAutoScroll) {
      setShowScrollToBottom(false);
    } else {
      recomputeScrollFlags();
    }
  }, [isAutoScroll, recomputeScrollFlags, messages.length]);

  useEffect(() => {
    const targetMessageId = alignNextUserMessageToTopRef.current;
    if (!targetMessageId) return;
    pinnedMessageIdRef.current = targetMessageId;

    let cancelled = false;
    let retryRaf: number | null = null;
    let scrollTimer: number | null = null;
    const startMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const deadlineMs = startMs + 2500;

    const doScroll = () => {
      if (cancelled) return;
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (nowMs > deadlineMs) return;

      const viewport = scrollRef.current;
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
      isProgrammaticScrollRef.current = false;
    };
  }, [
    alignTrigger,
    messages.length,
    bottomSpacerPx,
    computeRequiredSpacerForMessage,
    getEffectiveScrollBottom,
  ]);

  useEffect(() => {
    if (lockedScrollHeightRef.current) return;
    if (pinToPromptRef.current) return;
    pinnedScrollTopRef.current = null;
    const pinnedId = pinnedMessageIdRef.current;
    if (!pinnedId) return;
    const desiredSpacer = computeRequiredSpacerForMessage(pinnedId);
    if (typeof desiredSpacer !== "number") return;
    const nextSpacer = Math.max(baseBottomSpacerPx, desiredSpacer);
    if (nextSpacer > bottomSpacerPx) {
      setBottomSpacerPx(nextSpacer);
    }
  }, [messages.length, bottomSpacerPx, computeRequiredSpacerForMessage]);

  useEffect(() => {
    if (!lockScrollAfterStreamRef.current) return;
    if (isDrafting) return;
    const viewport = scrollRef.current;
    if (!viewport) return;
    const pinnedId = pinnedMessageIdRef.current;
    const requiredSpacer = pinnedId ? computeRequiredSpacerForMessage(pinnedId) : null;
    const nextSpacer = Math.max(
      baseBottomSpacerPx,
      typeof requiredSpacer === "number" ? Math.round(requiredSpacer) : baseBottomSpacerPx
    );
    const contentHeight = viewport.scrollHeight - bottomSpacerPx;
    lockedScrollHeightRef.current = contentHeight + nextSpacer;
    if (nextSpacer !== bottomSpacerPx) {
      setBottomSpacerPx(nextSpacer);
    }
    lockScrollAfterStreamRef.current = false;
  }, [bottomSpacerPx, computeRequiredSpacerForMessage, isDrafting, messages.length]);

  useEffect(() => {
    if (isDrafting) return;
    const lockedHeight = lockedScrollHeightRef.current;
    if (!lockedHeight) return;
    const viewport = scrollRef.current;
    if (!viewport) return;
    const contentHeight = viewport.scrollHeight - bottomSpacerPx;
    const desiredSpacer = Math.max(baseBottomSpacerPx, Math.round(lockedHeight - contentHeight));
    if (!Number.isFinite(desiredSpacer)) return;
    if (desiredSpacer !== bottomSpacerPx) {
      setBottomSpacerPx(desiredSpacer);
    }
  }, [bottomSpacerPx, messages.length, isDrafting]);

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
  }, [messages.length]);

  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (alignNextUserMessageToTopRef.current || pinToPromptRef.current) {
      initialScrollDoneRef.current = true;
      return;
    }
    scrollToBottom("auto");
    setShowScrollToBottom(false);
    initialScrollDoneRef.current = true;
  }, [messages.length, scrollToBottom]);

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

  const handleSubmit = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isDrafting || isHumanizing) return;
    setHasStarted(true);
    hasStartedRef.current = true;
    setIsAutoScroll(false);
    void startDraftFlow(trimmed);
  };

  const startDraftFlow = async (userText: string) => {
    const userId = `u-${Date.now()}`;
    const draftMsgId = `draft-${Date.now()}`;

    lockedScrollHeightRef.current = null;
    hasStreamedTokenRef.current = false;

    setMessages((prev) => {
      const withoutCTA = prev.filter((m) => m.kind !== "cta");
      const next: Message[] = [
        ...withoutCTA,
        { id: userId, role: "user", content: userText },
        {
          id: draftMsgId,
          role: "assistant",
          content: "Drafting with the model...",
          kind: "drafting",
        },
      ];
      messagesRef.current = next;
      return next;
    });

    pinToPromptRef.current = true;
    pinnedMessageIdRef.current = userId;
    pinnedScrollTopRef.current = null;
    setPinSpacerHeight(0);
    alignNextUserMessageToTopRef.current = userId;
    setAlignTrigger((prev) => prev + 1);
    setShowScrollToBottom(true);
    setIsAutoScroll(false);

    setIsDrafting(true);
    let draft = "";
    let shouldShowCTA = false;
    let debugInfo: any = null;
    let decisionReason: string | undefined;
    try {
      const response = await fetch("/api/human-writing/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userText, taskId }),
      });

      if (!response.ok) {
        const data = response.headers.get("content-type")?.includes("application/json")
          ? await response.json()
          : null;
        throw new Error(data?.error || "draft_failed");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";

          for (const rawLine of parts) {
            const line = rawLine.trim();
            if (!line) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.error) throw new Error(obj.error);
              if (obj.token) {
                draft += obj.token;
                const currentDraft = draft;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === draftMsgId ? { ...msg, content: currentDraft, kind: undefined } : msg
                  )
                );
                if (!hasStreamedTokenRef.current) {
                  hasStreamedTokenRef.current = true;
                }
              }
              if (obj.decision && typeof obj.decision.show === "boolean") {
                shouldShowCTA = obj.decision.show;
              }
              if (obj.decision && typeof obj.decision.reason === "string") {
                decisionReason = obj.decision.reason;
              }
              if (obj.done) {
                done = true;
              }
            } catch {
              console.warn("[draft-stream] failed to parse line", line);
            }
          }
        }

        const leftover = buffer.trim();
        if (leftover) {
          try {
            const obj = JSON.parse(leftover);
            if (obj.error) throw new Error(obj.error);
            if (obj.token) {
              draft += obj.token;
            }
            if (obj.decision && typeof obj.decision.show === "boolean") {
              shouldShowCTA = obj.decision.show;
            }
            if (obj.decision && typeof obj.decision.reason === "string") {
              decisionReason = obj.decision.reason;
            }
          } catch {
            console.warn("[draft-stream] failed to parse trailing buffer", leftover);
          }
        }
      } else {
        const data = await response.json().catch(() => null);
        draft = data?.draft || "";
        debugInfo = data?.debug ?? null;
        shouldShowCTA = typeof data?.decision?.show === "boolean" ? data.decision.show : false;
        decisionReason = typeof data?.decision?.reason === "string" ? data.decision.reason : decisionReason;
      }

      if (!draft.trim()) {
        const suffix = debugInfo ? ` (debug: ${JSON.stringify(debugInfo)})` : "";
        throw new Error(`draft_empty${suffix}`);
      }

      setMessages((prev) => {
        const updated = prev.map((msg) =>
          msg.id === draftMsgId ? { ...msg, content: draft, kind: undefined } : msg
        );
        const next =
          shouldShowCTA && !updated.some((m) => m.kind === "cta")
            ? [
                ...updated,
                {
                  id: `cta-${Date.now()}`,
                  role: "assistant",
                  content: "Draft ready. Want me to humanize it now?",
                  kind: "cta" as MessageKind,
                  draftText: draft,
                  status: "pending",
                } as Message,
              ]
            : updated;
        messagesRef.current = next;
        return next;
      });

      // Persist CTA state if shown
      if (shouldShowCTA) {
        const ctaCreatedAt = new Date().toISOString();
        try {
          await fetch("/api/human-writing/cta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskId,
              draftText: draft,
              content: "Draft ready. Want me to humanize it now?",
              reason: decisionReason,
              status: "pending",
              createdAt: ctaCreatedAt,
            }),
          });
        } catch (err) {
          console.warn("[human-writing][cta][persist] failed", err);
        }
      }
    } catch (error: any) {
      const message = error?.message || "Unable to draft right now.";
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === draftMsgId
            ? { ...msg, content: `Drafting failed: ${message}` }
            : msg
        )
      );
    } finally {
      lockScrollAfterStreamRef.current = true;
      setIsDrafting(false);
    }
  };

  const handleRunHumanizer = async (draftText: string, actionId: string) => {
    if (!draftText || isHumanizing) return;

    sidebarDismissedRef.current = false;
    const runId = `humanize-${Date.now()}`;
    setIsHumanizing(true);
    setActiveActionId(actionId);
    setMessages((prev) => [
      ...prev,
      { id: runId, role: "assistant", content: "Running Rephrasy Humanizer..." },
    ]);

    try {
      const resolvedModel =
        humanizerSettings.model === "custom" && humanizerSettings.customStyleId?.trim()
          ? humanizerSettings.customStyleId.trim()
          : humanizerSettings.model;
      const response = await fetch("/api/human-writing/humanize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          text: draftText,
          model: resolvedModel || "undetectable",
          language: humanizerSettings.language || "auto",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "humanizer_failed");
      }

      const output = (data?.output as string) || "Humanizer returned no output.";
      const humanScore =
        typeof data?.humanScore === "number" ? Math.round(Number(data.humanScore)) : null;
      const iterations = typeof data?.iterations === "number" ? data.iterations : null;
      const summaryParts = [
        humanScore !== null ? `Human score: ${humanScore}%` : null,
        iterations ? `Iterations: ${iterations}` : null,
        resolvedModel ? `Model: ${resolvedModel}` : null,
        humanizerSettings.language ? `Language: ${humanizerSettings.language}` : null,
      ].filter(Boolean);
      const summaryLine = summaryParts.length ? `\n\n_${summaryParts.join(" • ")}_` : "";
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === actionId) {
            return { ...msg, status: "done" };
          }
          if (msg.id === runId) {
            return {
              ...msg,
              content: `**Humanized draft**\n\n${output}${summaryLine}`,
            };
          }
          return msg;
        })
      );

      // Persist CTA state as completed
      try {
        const ctaMessage =
          messagesRef.current.find((m) => m.id === actionId) ||
          messagesRef.current.find((m) => m.kind === "cta");
        await fetch("/api/human-writing/cta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId,
            draftText: ctaMessage?.draftText || draftText,
            content: ctaMessage?.content || "Draft ready. Want me to humanize it now?",
            status: "done",
          }),
        });
      } catch (err) {
        console.warn("[human-writing][cta][persist-status] failed", err);
      }
    } catch (error: any) {
      const message = error?.message || "Humanizer failed.";
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === runId ? { ...msg, content: `Humanizer error: ${message}` } : msg
        )
      );
    } finally {
      setIsHumanizing(false);
      setActiveActionId(null);
      messagesRef.current = messagesRef.current.map((m) =>
        m.id === actionId ? { ...m, status: "done" } : m
      );
    }
  };

  useEffect(() => {
    if (isSidebarOpen) return;
    const hasCompletedCTA = messages.some((m) => m.kind === "cta" && m.status === "done");
    if (hasCompletedCTA && !sidebarDismissedRef.current) {
      setIsSidebarOpen(true);
    }
  }, [messages, isSidebarOpen]);

  return (
    <div className="flex h-screen flex-col bg-[#0f0d12] text-foreground">
      <header className="flex h-[56px] items-center gap-3 border-b border-white/10 bg-black/60 px-4 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/80 hover:text-white"
          onClick={() => router.push("/agents/human-writing")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-col">
          <p className="text-xs uppercase tracking-[0.25em] text-white/40">Human Writing Agent</p>
          <p className="text-sm text-white/80 truncate">Session: {taskId}</p>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 min-h-0 flex-col">
          <main className="flex flex-1 min-h-0 flex-col overflow-hidden">
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto"
              onScroll={handleChatScroll}
              style={{ overflowAnchor: "none" }}
            >
              {pinSpacerHeight > 0 && (
                <div aria-hidden className="w-full" style={{ height: pinSpacerHeight }} />
              )}
              <div className="py-4">
                <div className="w-full px-4 sm:px-6 lg:px-12">
                  <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                    {messages.map((msg) => {
                      if (msg.kind === "drafting") {
                        return <DraftingMessage key={msg.id} text={msg.content} />;
                      }

                      if (msg.kind === "cta") {
                        return (
                          <PipelineActionMessage
                            key={msg.id}
                            content={msg.content}
                            status={msg.status}
                            disabled={isHumanizing || !msg.draftText}
                            isRunning={isHumanizing && activeActionId === msg.id}
                            onConfirm={() => msg.draftText && handleRunHumanizer(msg.draftText, msg.id)}
                          />
                        );
                      }

                      return (
                        <ChatMessage
                          key={msg.id}
                          messageId={msg.id}
                          role={msg.role}
                          content={msg.content}
                          showInsightChips={false}
                          showModelActions={false}
                          enableEntryAnimation={false}
                          suppressPreStreamAnimation
                        />
                      );
                    })}
                    <div aria-hidden className="w-full" style={{ height: bottomSpacerPx }} />
                  </div>
                </div>
              </div>
              {showScrollToBottom && (
                <div className="pointer-events-none fixed inset-x-0 bottom-[120px] z-20">
                  <div className="flex w-full justify-center">
                    <Button
                      type="button"
                      size="icon"
                      className="pointer-events-auto h-10 w-10 rounded-full border border-white/15 bg-black/60 text-white shadow-md backdrop-blur hover:bg-black/80"
                      onClick={handleScrollToBottomClick}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </main>

          <div className="flex-none bg-[#0f0d12] px-4 pb-4 pt-3 sm:px-6 lg:px-12">
            <div className="mx-auto w-full max-w-3xl">
              <ChatComposer
                conversationId={taskId}
                onSendMessage={handleSubmit}
                placeholder="Send a prompt, I'll draft, then ask before running the humanizer..."
                isStreaming={isDrafting || isHumanizing}
              />
            </div>
          </div>
        </div>

        {isSidebarOpen && (
          <aside className="hidden w-[380px] flex-none flex-col border-l border-white/10 bg-black/50 px-5 py-6 text-white/60 shadow-[0_12px_40px_rgba(0,0,0,0.45)] animate-[hw-sidebar-in_260ms_cubic-bezier(0.16,1,0.3,1)] md:flex">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.25em] text-white/35">Sidebar</div>
                <p className="text-sm text-white/70">Placeholder — coming soon</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/70 hover:text-white"
                onClick={() => {
                  sidebarDismissedRef.current = true;
                  setIsSidebarOpen(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4 flex-1 rounded-xl border border-dashed border-white/10 bg-white/5" />
          </aside>
        )}
      </div>
    </div>
  );
}

function PipelineActionMessage({
  content,
  status,
  disabled,
  isRunning,
  onConfirm,
}: {
  content: string;
  status?: "pending" | "done";
  disabled?: boolean;
  isRunning?: boolean;
  onConfirm: () => void;
}) {
  const isDone = status === "done";
  const headline = isDone ? "Humanizer completed" : "Run the humanizer now?";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white/80 shadow-inner shadow-black/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{headline}</p>
          <p className="text-xs text-white/60">
            {isDone ? "Completed" : content || "No detector or loop yet - just humanize the draft and show it."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDone ? (
            <span className="text-xs font-semibold text-emerald-300">Completed</span>
          ) : (
            <Button
              type="button"
              size="sm"
              className="bg-gradient-to-r from-amber-400 via-pink-500 to-rose-500 text-white shadow-lg shadow-rose-500/30 hover:shadow-rose-500/50"
              onClick={onConfirm}
              disabled={disabled}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running
                </>
              ) : (
                "Run humanizer"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HumanWritingChatPage(props: PageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0f0d12]" />}>
      <ChatInner {...props} />
      <style jsx global>{`
        @keyframes shimmer {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 200% 50%;
          }
        }

        @keyframes hw-sidebar-in {
          0% {
            opacity: 0;
            transform: translateX(24px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </Suspense>
  );
}

function DraftingMessage({ text }: { text: string }) {
  return (
    <div className="py-4 sm:py-6">
      <div className="mx-auto w-full max-w-3xl px-1.5 sm:px-0">
        <p className="text-sm sm:text-base font-semibold leading-relaxed text-white/60">
          <span className="inline-block bg-[linear-gradient(90deg,rgba(120,126,140,0.9),rgba(255,255,255,0.95),rgba(120,126,140,0.9))] bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_1.4s_linear_infinite]">
            {text}
          </span>
        </p>
      </div>
    </div>
  );
}
