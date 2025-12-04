"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUserIdentity } from "@/components/user-identity-provider";

import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatMessage } from "@/components/chat-message";
import { ChatComposer } from "@/components/chat-composer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowDown, Check, ChevronDown, Menu, Plus } from "lucide-react";
import { SettingsModal } from "@/components/settings-modal";
import { StatusBubble } from "@/components/chat/status-bubble";
import { ApiUsageBadge } from "@/components/api-usage-badge";
import { UsageLimitModal } from "@/components/usage-limit-modal";
import {
  startGlobalConversationAction,
  startProjectConversationAction,
} from "@/app/actions/chat-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjects } from "@/components/projects/projects-provider";
import { NewProjectModal } from "@/components/projects/new-project-modal";
import { StoredMessage, useChatStore } from "@/components/chat/chat-provider";
import { usePersistentSidebarOpen } from "@/lib/hooks/use-sidebar-open";
import { getModelAndReasoningConfig, getModelSettingsFromDisplayName } from "@/lib/modelConfig";
import type { ModelFamily, SpeedMode, ReasoningEffort } from "@/lib/modelConfig";
import { isPlaceholderTitle } from "@/lib/conversation-utils";
import { requestAutoNaming } from "@/lib/autoNaming";
import type { AssistantMessageMetadata } from "@/lib/chatTypes";
import { formatSearchedDomainsLine, formatThoughtDurationLabel } from "@/lib/metadata";
import { MessageInsightChips } from "@/components/chat/message-insight-chips";

interface ShellConversation {
  id: string;
  title: string;
  timestamp: string;
  projectId?: string;
}

interface ServerMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown> | null;
}

type SearchStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string }
  | { type: "file-search-start"; query: string }
  | { type: "file-search-complete"; query: string }
  | { type: "file-reading-start" }
  | { type: "file-reading-complete" }
  | { type: "file-reading-error"; message?: string };

interface ChatPageShellProps {
  conversations: ShellConversation[];
  activeConversationId: string | null; // allow null for "/"
  messages: ServerMessage[];
  searchParams: Record<string, string | string[] | undefined>;
  projectId?: string;
}

type ThinkingTimingInfo = {
  durationMs: number;
  durationSeconds: number;
  label: string;
  effort?: ReasoningEffort | null;
};

const AUTO_STREAM_KEY_PREFIX = "llm-client-auto-stream:";
const getAutoStreamKey = (conversationId: string) =>
  `${AUTO_STREAM_KEY_PREFIX}${conversationId}`;

function mergeThinkingTimingIntoMetadata(
  metadata: AssistantMessageMetadata | null,
  timing: ThinkingTimingInfo | null
): AssistantMessageMetadata | null {
  if (!timing) {
    return metadata;
  }
  const skipEfforts = new Set<ReasoningEffort | "minimal">(["low", "none", "minimal"]);
  if (metadata && skipEfforts.has(metadata.reasoningEffort as ReasoningEffort | "minimal")) {
    return metadata;
  }
  if (timing.effort && skipEfforts.has(timing.effort as ReasoningEffort | "minimal")) {
    return metadata;
  }
  // CRITICAL: Only merge if metadata has absolutely NO timing information
  // Once timing is set (either from client or server), it should NEVER be overwritten
  const hasAnyTiming = metadata && 
    (typeof metadata.thinkingDurationMs === 'number' || 
     typeof metadata.thinkingDurationSeconds === 'number' ||
     (typeof metadata.thoughtDurationLabel === 'string' && metadata.thoughtDurationLabel.includes('Thought for')));
  
  if (hasAnyTiming) {
    return metadata;
  }
  
  const base = (metadata && typeof metadata === "object" ? metadata : {}) as AssistantMessageMetadata;
  const nextThinking: AssistantMessageMetadata["thinking"] = {
    ...(base.thinking || {}),
    durationMs: timing.durationMs,
    durationSeconds: timing.durationSeconds,
  };
  if (typeof timing.effort !== "undefined") {
    nextThinking.effort = timing.effort;
  }
  return {
    ...base,
    thinkingDurationMs: timing.durationMs,
    thinkingDurationSeconds: timing.durationSeconds,
    thoughtDurationLabel: timing.label,
    thinking: nextThinking,
  };
}

export default function ChatPageShell({
  conversations: initialConversations,
  activeConversationId,
  messages: initialMessages,
  projectId,
  searchParams,
}: ChatPageShellProps) {
  const router = useRouter();
  const { projects, addProject, refreshProjects } = useProjects();
  const {
    chats,
    globalChats,
    createChat,
    appendMessages,
    updateMessage,
    updateChatTitle,
    removeMessage,
    ensureChat,
    refreshChats,
  } = useChatStore();
  const { isGuest } = useUserIdentity();
  const [guestWarning, setGuestWarning] = useState<string | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = usePersistentSidebarOpen(true);
  const [currentModel, setCurrentModel] = useState("Auto");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    activeConversationId ?? null
  );

  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'personalization'>('personalization');
  const [usageLimitModal, setUsageLimitModal] = useState<{
    isOpen: boolean;
    currentSpending: number;
    limit: number;
    planType: string;
  }>({ isOpen: false, currentSpending: 0, limit: 0, planType: 'free' });
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [bottomSpacerPx, setBottomSpacerPx] = useState(220);
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState<{ variant: "thinking" | "extended"; label: string } | null>(null);
  // Force re-render while thinking so a live duration chip can update
  const [, setThinkingTick] = useState(0);
  const [searchIndicator, setSearchIndicator] = useState<
    | {
        message: string;
        variant: "running" | "complete" | "error";
        domains: string[];
        subtext?: string;
      }
    | null
  >(null);
  const searchDomainListRef = useRef<string[]>([]);
  const searchDomainSetRef = useRef(new Set<string>());
  const [fileReadingIndicator, setFileReadingIndicator] = useState<"running" | "error" | null>(null);
  const [activeIndicatorMessageId, setActiveIndicatorMessageId] = useState<string | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const autoStreamedConversations = useRef<Set<string>>(new Set());
  const inFlightRequests = useRef<Set<string>>(new Set());
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const responseTimingRef = useRef({
    start: null as number | null,
    firstToken: null as number | null,
    assistantMessageId: null as string | null,
  });
  const pendingThinkingInfoRef = useRef<ThinkingTimingInfo | null>(null);
  const searchIndicatorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fileIndicatorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasSessionAutoStream = useCallback((conversationId: string) => {
    return (
      typeof window !== "undefined" &&
      sessionStorage.getItem(getAutoStreamKey(conversationId)) === "1"
    );
  }, []);

  const markConversationAsAutoStreamed = useCallback((conversationId: string) => {
    autoStreamedConversations.current.add(conversationId);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(getAutoStreamKey(conversationId), "1");
    }
  }, []);

  const clearConversationAutoStreamed = useCallback((conversationId: string) => {
    autoStreamedConversations.current.delete(conversationId);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(getAutoStreamKey(conversationId));
    }
  }, []);

  const isConversationAutoStreamed = useCallback(
    (conversationId: string) => {
      if (!conversationId) return false;
      return (
        autoStreamedConversations.current.has(conversationId) ||
        hasSessionAutoStream(conversationId)
      );
    },
    [hasSessionAutoStream]
  );

  const autoStreamHandled =
    searchParams?.autoStreamHandled?.toString() === "true";

  const hideThinkingIndicator = useCallback(() => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setThinkingStatus(null);
  }, []);

  const resetThinkingIndicator = useCallback(() => {
    hideThinkingIndicator();
    responseTimingRef.current = {
      start: null,
      firstToken: null,
      assistantMessageId: null,
    };
    pendingThinkingInfoRef.current = null;
  }, [hideThinkingIndicator]);

  const showThinkingIndicator = useCallback((effort?: ReasoningEffort | null) => {
    const normalizedEffort: ReasoningEffort = effort ?? "low";
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    if (normalizedEffort === "medium" || normalizedEffort === "high") {
      setThinkingStatus({ variant: "extended", label: "Thinking for longer…" });
      return;
    }
    setThinkingStatus({ variant: "thinking", label: "Thinking" });
    // No extended indicator for low/minimal/none efforts
  }, []);

  const startResponseTiming = useCallback(() => {
    resetThinkingIndicator();
    responseTimingRef.current = {
      start: typeof performance !== "undefined" ? performance.now() : Date.now(),
      firstToken: null,
      assistantMessageId: null,
    };
    pendingThinkingInfoRef.current = null;
  }, [resetThinkingIndicator]);

  // While thinking is active and before first token, tick to update live duration label
  useEffect(() => {
    const hasLiveStart = Boolean(responseTimingRef.current.start);
    const shouldTick = !!thinkingStatus && hasLiveStart && !!activeIndicatorMessageId;
    if (!shouldTick) return;
    const id = setInterval(() => setThinkingTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [thinkingStatus, activeIndicatorMessageId]);

  const recordFirstTokenTiming = useCallback(
    (
      chatId: string,
      messageId: string,
      metadata: AssistantMessageMetadata | null,
      reasoningEffort?: ReasoningEffort | null
    ) => {
      const timing = responseTimingRef.current;
      // Only record timing once - if firstToken is already set or start is null, skip
      if (!timing.start || timing.firstToken !== null) {
        return metadata;
      }
      
      // Also check if metadata already has timing - never recalculate
      const hasExistingTiming = metadata && 
        (typeof metadata.thinkingDurationMs === 'number' ||
         (typeof metadata.thoughtDurationLabel === 'string' && metadata.thoughtDurationLabel.includes('Thought for')));
      
      if (hasExistingTiming) {
        return metadata;
      }
      
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsedMs = Math.max(0, now - timing.start);
      timing.firstToken = now;
      timing.start = null; // Clear start so we never calculate again
      hideThinkingIndicator();
      const seconds = elapsedMs / 1000;
      const label = formatThoughtDurationLabel(seconds);
      const thinkingInfo: ThinkingTimingInfo = {
        durationMs: elapsedMs,
        durationSeconds: seconds,
        label,
        effort: reasoningEffort ?? null,
      };
      // Store client timing for display immediately (used for live chips on streaming messages)
      pendingThinkingInfoRef.current = thinkingInfo;
      // Merge timing into metadata so downstream callers can persist/display immediately.
      const merged = mergeThinkingTimingIntoMetadata(metadata, thinkingInfo);
      return merged ?? metadata;
    },
    [hideThinkingIndicator]
  );

  const clearSearchIndicator = useCallback(() => {
    if (searchIndicatorTimerRef.current) {
      clearTimeout(searchIndicatorTimerRef.current);
    }
    searchIndicatorTimerRef.current = null;
    setSearchIndicator(null);
    searchDomainSetRef.current.clear();
    searchDomainListRef.current = [];
  }, []);

  const showSearchCompleteIndicator = useCallback(
    (
      domains: string[],
      siteLabel?: string | null,
      options?: { variant?: "complete" | "error"; message?: string }
    ) => {
      const variant = options?.variant === "error" ? "error" : "complete";
      const summary = formatSearchedDomainsLine(domains);
      const fallbackMessage = variant === "error" ? "Web search failed" : "Searched the web";
      const message = options?.message ?? summary ?? fallbackMessage;
      if (!message && !siteLabel) {
        return;
      }
      if (searchIndicatorTimerRef.current) {
        clearTimeout(searchIndicatorTimerRef.current);
      }
      setSearchIndicator({
        message,
        variant,
        domains,
        subtext: siteLabel && siteLabel !== summary ? siteLabel : undefined,
      });
      searchIndicatorTimerRef.current = setTimeout(() => {
        setSearchIndicator(null);
        searchIndicatorTimerRef.current = null;
      }, 6000);
    },
    []
  );

  const addSearchDomain = useCallback((domain?: string | null) => {
    const label = domain?.trim();
    if (!label) {
      return;
    }
    const normalized = label.toLowerCase();
    if (searchDomainSetRef.current.has(normalized)) {
      return;
    }
    searchDomainSetRef.current.add(normalized);
    searchDomainListRef.current = [...searchDomainListRef.current, label];
    setSearchIndicator((prev) => {
      // If indicator isn't running yet but we got domains, start it as "Reading results"
      if (!prev) {
        return {
          message: "Reading results…",
          variant: "running",
          domains: searchDomainListRef.current,
        };
      }
      if (prev.variant === "running") {
        const baseMessage = prev.message?.toLowerCase().includes("searching")
          ? "Reading results…"
          : prev.message;
        return { ...prev, domains: searchDomainListRef.current, message: baseMessage };
      }
      return prev;
    });
  }, []);

  const clearFileReadingIndicator = useCallback(() => {
    if (fileIndicatorTimerRef.current) {
      clearTimeout(fileIndicatorTimerRef.current);
    }
    fileIndicatorTimerRef.current = null;
    setFileReadingIndicator(null);
  }, []);

  const showFileReadingIndicator = useCallback((variant: "running" | "error" = "running") => {
    if (fileIndicatorTimerRef.current) {
      clearTimeout(fileIndicatorTimerRef.current);
    }
    setFileReadingIndicator(variant);
    fileIndicatorTimerRef.current = setTimeout(() => {
      setFileReadingIndicator(null);
      fileIndicatorTimerRef.current = null;
    }, 4500);
  }, []);

  const handleStatusEvent = useCallback(
    (status: SearchStatusEvent) => {
      switch (status.type) {
        case "search-start":
          setSearchIndicator({
            message: "Searching the web...",
            variant: "running",
            domains: [],
          });
          break;
        case "search-complete":
          showSearchCompleteIndicator(searchDomainListRef.current);
          break;
        case "search-error":
          showSearchCompleteIndicator(searchDomainListRef.current, undefined, {
            variant: "error",
            message: status.message ?? "Web search failed",
          });
          break;
        case "file-search-start":
          showFileReadingIndicator("running");
          break;
        case "file-search-complete":
          clearFileReadingIndicator();
          break;
        case "file-reading-start":
          showFileReadingIndicator("running");
          break;
        case "file-reading-complete":
          clearFileReadingIndicator();
          break;
        case "file-reading-error":
          showFileReadingIndicator("error");
          break;
      }
    },
    [clearFileReadingIndicator, showFileReadingIndicator, showSearchCompleteIndicator]
  );

  useEffect(() => {
    if (
      activeIndicatorMessageId &&
      !searchIndicator &&
      !fileReadingIndicator &&
      !thinkingStatus
    ) {
      setActiveIndicatorMessageId(null);
    }
  }, [activeIndicatorMessageId, searchIndicator, fileReadingIndicator, thinkingStatus]);

  useEffect(() => {
    setSelectedChatId(activeConversationId ?? null);
    // Reset timing refs when conversation changes to prevent stale data
    responseTimingRef.current = {
      start: null,
      firstToken: null,
      assistantMessageId: null,
    };
    pendingThinkingInfoRef.current = null;
    resetThinkingIndicator();
  }, [activeConversationId, resetThinkingIndicator]);

  useEffect(() => {
    if (!initialConversations.length) return;

    initialConversations.forEach((conversation) => {
      const isActive = conversation.id === activeConversationId;
      const messagesForConversation = isActive
        ? initialMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            metadata: m.metadata ?? null,
          }))
        : [];

      ensureChat({
        id: conversation.id,
        title: conversation.title,
        timestamp: conversation.timestamp ?? new Date().toISOString(),
        projectId: projectId ?? conversation.projectId,
        messages: messagesForConversation,
      });
    });
  }, [
    activeConversationId,
    ensureChat,
    initialConversations,
    initialMessages,
    projectId,
  ]);

  const currentChat = chats.find((c) => c.id === selectedChatId);
  const messages = useMemo<StoredMessage[]>(() => currentChat?.messages ?? [], [currentChat]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const viewport = scrollViewportRef.current;
      if (!viewport) return;

      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() =>
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" })
        );
      }
    },
    []
  );

  const recomputeScrollFlags = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const tolerance = Math.max(12, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;
    setShowScrollToBottom(!atBottom);
  }, [bottomSpacerPx]);

  // Dynamically size the bottom spacer to provide room below messages
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    const compute = () => {
      if (!viewport) return;
      const desired = 28;
      setBottomSpacerPx((prev) => (prev === desired ? prev : desired));
    };
    compute();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", compute);
      return () => window.removeEventListener("resize", compute);
    }
  }, [messages.length]);

  // Listen for usage limit exceeded events
  useEffect(() => {
    const handleUsageLimitExceeded = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { currentSpending, limit, planType } = customEvent.detail || {};
      if (typeof currentSpending !== "number" || typeof limit !== "number" || !planType) {
        return;
      }
      // Persist the modal open state until the user closes it manually
      setUsageLimitModal(() => ({
        isOpen: true,
        currentSpending,
        limit,
        planType
      }));
    };

    window.addEventListener('usage-limit-exceeded', handleUsageLimitExceeded);
    return () => {
      window.removeEventListener('usage-limit-exceeded', handleUsageLimitExceeded);
    };
  }, []);

  // Auto-scroll during streaming when message content changes
  useEffect(() => {
    if (!isStreaming || !isAutoScroll) return;
    
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    
    // Use requestAnimationFrame to ensure DOM is fully rendered before scrolling
    // Double-RAF for better reliability with dynamic content
    const scrollToEnd = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
          }
        });
      });
    };
    
    scrollToEnd();
  }, [messages, isAutoScroll, isStreaming]);

  useEffect(() => {
    setIsAutoScroll(true);
    setShowScrollToBottom(false);
    scrollToBottom("auto");
  }, [selectedChatId, scrollToBottom]);

  useEffect(() => {
    if (currentChat?.projectId) {
      setSelectedProjectId(currentChat.projectId);
    } else if (selectedChatId) {
      setSelectedProjectId("");
    }
  }, [currentChat, selectedChatId]);

  type UploadedFragment = { id: string; name: string; dataUrl: string; mime?: string };

  const streamGuestResponse = async (
    assistantId: string,
    chatId: string,
    userMessage: string
  ) => {
    setIsStreaming(true);
    setActiveIndicatorMessageId(assistantId);
    responseTimingRef.current.assistantMessageId = assistantId;
    startResponseTiming();
    showThinkingIndicator(null);
    try {
      const response = await fetch("/api/guest-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, model: currentModel }),
      });
      if (!response.ok || !response.body) {
        let warning = "Guest mode: failed to reach model. Sign in for full access.";
        try {
          const data = await response.json();
          if (data?.message) {
            warning = data.message;
          } else if (data?.error) {
            warning = data.error;
          }
        } catch {
          // ignore JSON parse errors
        }
        setGuestWarning(warning);
        setIsStreaming(false);
        setActiveIndicatorMessageId(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let messageMetadata: AssistantMessageMetadata | null = { isGuest: true } as AssistantMessageMetadata;
      let firstTokenSeen = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const textChunk = decoder.decode(value, { stream: true });
        const lines = textChunk.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.token) {
              assistantContent += parsed.token;
              if (!firstTokenSeen) {
                firstTokenSeen = true;
                messageMetadata = recordFirstTokenTiming(
                  chatId,
                  assistantId,
                  messageMetadata,
                  null
                );
                // Preserve guest flag when timing was merged
                if (messageMetadata && !(messageMetadata as any).isGuest) {
                  messageMetadata = { ...messageMetadata, isGuest: true } as AssistantMessageMetadata;
                }
                // As soon as first token hits, drop transient indicators (thinking/search/file) without clearing timing.
                hideThinkingIndicator();
                clearSearchIndicator();
                clearFileReadingIndicator();
              }
              const mergedMeta = mergeThinkingTimingIntoMetadata(messageMetadata, pendingThinkingInfoRef.current as ThinkingTimingInfo | null);
              messageMetadata = mergedMeta ?? messageMetadata;
              updateMessage(chatId, assistantId, {
                content: assistantContent,
                metadata: messageMetadata,
              });
            }
            if (parsed.done) {
              if (assistantContent.length > 0) {
                const finalMeta = mergeThinkingTimingIntoMetadata(
                  messageMetadata,
                  pendingThinkingInfoRef.current as ThinkingTimingInfo | null
                );
                messageMetadata = finalMeta ?? messageMetadata;
                updateMessage(chatId, assistantId, {
                  content: assistantContent,
                  metadata: messageMetadata,
                });
              }
              setIsStreaming(false);
              setActiveIndicatorMessageId(null);
              return;
            }
          } catch (e) {
            console.warn("guest-chat parse error", e);
          }
        }
      }
    } catch (e) {
      console.error("guest chat error", e);
      setGuestWarning("Guest mode: model call failed. Please sign in.");
    } finally {
      resetThinkingIndicator();
      setIsStreaming(false);
      setActiveIndicatorMessageId(null);
    }
  };

  const handleSubmit = async (message: string, attachments?: UploadedFragment[]) => {
    console.log("[chatDebug] handleSubmit called with message:", message.substring(0, 50));
    const now = new Date().toISOString();
    const userMessage: StoredMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: now,
      metadata: attachments && attachments.length ? { files: attachments.map(a => ({ name: a.name, mimeType: a.mime, dataUrl: a.dataUrl })) } : undefined,
    };

    if (isGuest) {
      // Local-only guest chat; not persisted.
      let chatId = selectedChatId;
      if (!chatId) {
        chatId = createChat({
          id: `guest-${Date.now()}`,
          initialMessages: [userMessage],
          title: "Guest chat",
        });
        setSelectedChatId(chatId);
        setSelectedProjectId("");
      } else {
        appendMessages(chatId, [userMessage]);
      }

      const assistantId = `assistant-${Date.now()}`;
      const assistantMessage: StoredMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        metadata: {
          isGuest: true,
        } as any,
      };
      appendMessages(chatId, [assistantMessage]);
      await streamGuestResponse(assistantId, chatId, message);
      return;
    }

    if (!selectedChatId) {
      console.log("[chatDebug] Creating new conversation");
      const targetProjectId = selectedProjectId || projectId;
      if (targetProjectId) {
        const { conversationId, message: createdMessage, conversation } =
          await startProjectConversationAction({
            projectId: targetProjectId,
            firstMessageContent: message,
          });

        const mappedMessage: StoredMessage = {
          id: createdMessage.id,
          role: "user",
          content: createdMessage.content ?? message,
          timestamp: createdMessage.created_at ?? now,
          metadata:
            attachments && attachments.length
              ? {
                  files: attachments.map((a) => ({
                    name: a.name,
                    mimeType: a.mime,
                    dataUrl: a.dataUrl,
                  })),
                }
              : undefined,
        };

        const newChatId = createChat({
          id: conversationId,
          projectId: targetProjectId,
          initialMessages: [mappedMessage],
          title: conversation.title ?? "New chat",
        });
        setSelectedChatId(newChatId);
        setSelectedProjectId(targetProjectId);
        
        // Mark this conversation as already auto-streamed to prevent duplicate in useEffect
        console.log("[chatDebug] Marking conversation as auto-streamed:", conversationId);
        markConversationAsAutoStreamed(conversationId);
        
        // Trigger auto-naming immediately (in parallel with streaming)
        triggerAutoNaming(conversationId, message, conversation.title ?? undefined);
        
        // Stream the model response fully BEFORE navigation to preserve streaming state
        await streamModelResponse(conversationId, targetProjectId, message, newChatId, true, attachments);
        
        // Navigate after streaming completes (only if not already there)
        const targetUrl = `/projects/${targetProjectId}/c/${newChatId}`;
        if (typeof window !== "undefined" && !window.location.pathname.includes(`/c/${newChatId}`)) {
          router.push(`${targetUrl}?autoStreamHandled=true`);
        }
      } else {
        const { conversationId, message: createdMessage, conversation } =
          await startGlobalConversationAction(message);

        const mappedMessage: StoredMessage = {
          id: createdMessage.id,
          role: "user",
          content: createdMessage.content ?? message,
          timestamp: createdMessage.created_at ?? now,
          metadata:
            attachments && attachments.length
              ? {
                  files: attachments.map((a) => ({
                    name: a.name,
                    mimeType: a.mime,
                    dataUrl: a.dataUrl,
                  })),
                }
              : undefined,
        };

        const newChatId = createChat({
          id: conversationId,
          initialMessages: [mappedMessage],
          title: conversation.title ?? "New chat",
        });
        setSelectedChatId(newChatId);
        setSelectedProjectId("");
        
        // Mark this conversation as already auto-streamed to prevent duplicate in useEffect
        console.log("[chatDebug] Marking conversation as auto-streamed:", conversationId);
        markConversationAsAutoStreamed(conversationId);
        
        // Trigger auto-naming immediately (in parallel with streaming)
        triggerAutoNaming(conversationId, message, conversation.title ?? undefined);
        
        // Stream the model response fully BEFORE navigation to preserve streaming state
        await streamModelResponse(conversationId, undefined, message, newChatId, true, attachments);
        
        // Navigate after streaming completes (only if not already there)
        if (typeof window !== "undefined" && !window.location.pathname.includes(`/c/${newChatId}`)) {
          router.push(`/c/${newChatId}?autoStreamHandled=true`);
        }
      }
    } else {
      console.log("[chatDebug] Adding message to existing chat:", selectedChatId);
      // For existing chats, just append the user message to UI
      // (The /api/chat endpoint will persist it to the database)
      appendMessages(selectedChatId, [userMessage]);
      
        // Stream the model response and insert the user message on server
        await streamModelResponse(selectedChatId, selectedProjectId || undefined, message, selectedChatId, false, attachments);
    }
  };

  const triggerAutoNaming = async (
    conversationId: string,
    userMessage: string,
    conversationTitle: string | undefined
  ) => {
    console.log(`[titleDebug] triggerAutoNaming called for ${conversationId}, title: "${conversationTitle}"`);
  
    // Only generate title if this is a new conversation with placeholder title
    if (!isPlaceholderTitle(conversationTitle)) {
      console.log(`[titleDebug] skipping auto-naming - title is not a placeholder: "${conversationTitle}"`);
      return;
    }

    console.log(`[titleDebug] initiating auto-naming for conversation ${conversationId}`);
  
    const data = await requestAutoNaming(conversationId, userMessage, (partialTitle) => {
      // Stream each word update to the sidebar
      updateChatTitle(conversationId, partialTitle);
    });
    
    if (data?.title) {
      console.log(`[titleDebug] auto-naming succeeded with title: ${data.title}`);
      // Final title update
      updateChatTitle(conversationId, data.title);
    }
  };

  const streamModelResponse = useCallback(async (
    conversationId: string,
    projectId: string | undefined,
    message: string,
    chatId: string,
    skipUserInsert: boolean = false,
    attachments?: UploadedFragment[]
  ) => {
    const requestKey = `${conversationId}:${message}`;
    if (inFlightRequests.current.has(requestKey)) {
      console.log("[chatDebug] Duplicate streamModelResponse skipped for", requestKey);
      return;
    }
    inFlightRequests.current.add(requestKey);
    const controller = new AbortController();
    streamAbortControllerRef.current = controller;
    setIsStreaming(true);

    console.log("[chatDebug] streamModelResponse start", { conversationId, chatId, skipUserInsert, shortMessage: message.slice(0,40) });

    try {
      // Get model settings from current display selection
      const {
        modelFamily,
        speedMode,
        reasoningEffort: reasoningEffortOverride,
      } = getModelSettingsFromDisplayName(currentModel);
      const previewFamilyForReasoning: ModelFamily =
        currentModel === "Auto" ? "gpt-5-mini" : modelFamily;
      const previewModelConfig = getModelAndReasoningConfig(
        previewFamilyForReasoning,
        speedMode,
        message,
        reasoningEffortOverride
      );
      const indicatorEffort = previewModelConfig.reasoning?.effort ?? null;
      startResponseTiming();
      showThinkingIndicator(indicatorEffort);
      clearSearchIndicator();
      clearFileReadingIndicator();

      // Do not show a file-reading indicator unless prompted by server status events

      // Get location data if available
      let locationData = null;
      try {
        const locationStr = localStorage.getItem("location_data");
        if (locationStr) {
          const parsed = JSON.parse(locationStr);
          locationData = {
            lat: parsed.lat,
            lng: parsed.lng,
            city: parsed.city,
          };
        }
      } catch (e) {
        console.error("[Location] Failed to parse location data:", e);
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          projectId,
          message,
          modelFamilyOverride: modelFamily,
          speedModeOverride: speedMode,
          reasoningEffortOverride: reasoningEffortOverride,
          skipUserInsert,
          attachments,
          location: locationData,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Stop streaming state and indicators on error
        resetThinkingIndicator();
        setIsStreaming(false);
        setActiveIndicatorMessageId(null);

        // Check if it's a usage limit error
        if (response.status === 429) {
          try {
            const errorData = await response.json();
            if (errorData.error === "Usage limit exceeded") {
              window.dispatchEvent(new CustomEvent("usage-limit-exceeded", {
                detail: {
                  currentSpending: errorData.currentSpending,
                  limit: errorData.limit,
                  planType: errorData.planType,
                  message: errorData.message
                }
              }));
              return;
            }
          } catch (e) {
            console.error("Failed to parse error response:", e);
          }
        }
        // Non-429 or unparsed error: surface a warning instead of noisy error
        console.warn("Chat API error:", response.status, response.statusText);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        console.error("No response body reader");
        return;
      }

      const decoder = new TextDecoder();
      let assistantContent = "";
      const assistantMessageId = `assistant-streaming-${Date.now()}`;
      let messageMetadata: AssistantMessageMetadata | null = {};

      // Set active indicator BEFORE adding message so indicators show
      setActiveIndicatorMessageId(assistantMessageId);

      // Add the initial empty assistant message
      appendMessages(chatId, [
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
        },
      ]);
      responseTimingRef.current.assistantMessageId = assistantMessageId;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((l) => l.trim());

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);

              if (parsed.token) {
                assistantContent += parsed.token;
                const currentMessageId =
                  responseTimingRef.current.assistantMessageId ?? assistantMessageId;
                messageMetadata = recordFirstTokenTiming(
                  chatId,
                  currentMessageId,
                  messageMetadata,
                  indicatorEffort
                );
                // On first token, clear transient indicators without wiping timing
                if (responseTimingRef.current.firstToken !== null) {
                  hideThinkingIndicator();
                  clearSearchIndicator();
                  clearFileReadingIndicator();
                }
                // Clear the search indicator bubble on first token so it doesn't persist
                clearSearchIndicator();
                // If we have accumulated search domains, push them into metadata immediately
                if (searchDomainListRef.current.length > 0 && messageMetadata) {
                  const updatedMetadata: AssistantMessageMetadata = {
                    ...messageMetadata,
                    searchedDomains: [...searchDomainListRef.current],
                  };
                  messageMetadata = updatedMetadata;
                }
                // Update the assistant message with new content and metadata
                updateMessage(chatId, currentMessageId, {
                  content: assistantContent,
                  metadata: messageMetadata,
                });
              } else if (parsed.status) {
                handleStatusEvent(parsed.status as SearchStatusEvent);
              } else if (parsed.type === "web_search_domain" && typeof parsed.domain === "string") {
                addSearchDomain(parsed.domain);
                // Immediately update message metadata with accumulated domains so chip appears at top
                const currentMessageId =
                  responseTimingRef.current.assistantMessageId ?? assistantMessageId;
                if (messageMetadata) {
                  const updatedMetadata: AssistantMessageMetadata = {
                    ...messageMetadata,
                    searchedDomains: [...searchDomainListRef.current],
                  };
                  messageMetadata = updatedMetadata;
                  updateMessage(chatId, currentMessageId, {
                    metadata: messageMetadata,
                  });
                }
              } else if (parsed.model_info) {
                // Update model metadata early so model tag switches from unknown immediately
                const currentMessageId =
                  responseTimingRef.current.assistantMessageId ?? assistantMessageId;
                if (messageMetadata) {
                  // Preserve existing timing if it exists - only update model info
                  const updatedMetadata: AssistantMessageMetadata = {
                    ...messageMetadata,
                    modelUsed: parsed.model_info.model,
                    resolvedFamily: parsed.model_info.resolvedFamily,
                    speedModeUsed: parsed.model_info.speedModeUsed,
                    reasoningEffort: parsed.model_info.reasoningEffort,
                    // Keep existing timing fields
                    thinkingDurationMs: messageMetadata.thinkingDurationMs,
                    thinkingDurationSeconds: messageMetadata.thinkingDurationSeconds,
                    thoughtDurationLabel: messageMetadata.thoughtDurationLabel,
                    thinking: messageMetadata.thinking,
                  };
                  messageMetadata = updatedMetadata;
                  updateMessage(chatId, currentMessageId, {
                    metadata: messageMetadata,
                  });
                }
              } else if (parsed.meta) {
                const fallbackMeta: AssistantMessageMetadata = {
                  modelUsed: parsed.meta.model,
                  reasoningEffort: parsed.meta.reasoningEffort,
                  resolvedFamily: parsed.meta.resolvedFamily,
                  speedModeUsed: parsed.meta.speedModeUsed,
                  userRequestedFamily: modelFamily,
                  userRequestedSpeedMode: speedMode,
                  userRequestedReasoningEffort: reasoningEffortOverride,
                };
                const resolvedMetadata: AssistantMessageMetadata =
                  (parsed.meta.metadata as AssistantMessageMetadata | null) ?? fallbackMeta;
                
                // CRITICAL: If we already have timing in the message (from client calculation on first token),
                // preserve it and only update non-timing fields from server
                const hasClientTiming = messageMetadata && 
                  (typeof messageMetadata.thinkingDurationMs === 'number' ||
                   (typeof messageMetadata.thoughtDurationLabel === 'string' && messageMetadata.thoughtDurationLabel.includes('Thought for')));
                
                let metadataWithTiming: AssistantMessageMetadata;
                if (hasClientTiming) {
                  // Client timing exists and is correct - keep it, only merge other server fields
                  metadataWithTiming = {
                    ...resolvedMetadata,
                    // Override with client timing
                    thinkingDurationMs: messageMetadata!.thinkingDurationMs,
                    thinkingDurationSeconds: messageMetadata!.thinkingDurationSeconds,
                    thoughtDurationLabel: messageMetadata!.thoughtDurationLabel,
                    thinking: messageMetadata!.thinking || resolvedMetadata.thinking,
                  };
                } else {
                  // No client timing yet, use server's or pending
                  metadataWithTiming = mergeThinkingTimingIntoMetadata(
                    resolvedMetadata,
                    pendingThinkingInfoRef.current
                  ) || resolvedMetadata;
                }
                
                pendingThinkingInfoRef.current = null;
                messageMetadata = metadataWithTiming;
                const newId = parsed.meta.assistantMessageRowId;
                setActiveIndicatorMessageId(newId);
                // Clear thinking indicator when metadata arrives
                resetThinkingIndicator();
                // Replace the temporary ID with the persisted row ID and store metadata
                updateMessage(chatId, assistantMessageId, {
                  id: newId,
                  metadata: metadataWithTiming,
                });
                responseTimingRef.current.assistantMessageId = newId;
                
                // Emit usage update event for live counter
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('api-usage-updated'));
                }
                
                // CRITICAL: If we used client timing (which is more accurate due to network latency),
                // save it back to the database to overwrite the server's timing
                if (hasClientTiming && metadataWithTiming) {
                  fetch("/api/messages/update-metadata", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      messageId: newId,
                      metadata: metadataWithTiming,
                    }),
                  }).catch((err) => {
                    console.error("Failed to update message metadata with client timing:", err);
                  });
                }
                // Do not persist file-reading indicator based on citations; it's ephemeral.
              } else if (parsed.done) {
                // Streaming complete
                break;
              }
            } catch {
              // Skip lines that aren't valid JSON
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      const isAbortError =
        error instanceof DOMException
          ? error.name === "AbortError"
          : (error as { name?: string })?.name === "AbortError";
      if (!isAbortError) {
        console.error("Error streaming model response:", error);
      }
    } finally {
      if (streamAbortControllerRef.current === controller) {
        streamAbortControllerRef.current = null;
      }
      inFlightRequests.current.delete(requestKey);
      setIsStreaming(false);
      resetThinkingIndicator();
      // Clear active indicator so buttons appear after streaming completes
      setActiveIndicatorMessageId(null);
    }
  }, [
    addSearchDomain,
    appendMessages,
    clearFileReadingIndicator,
    clearSearchIndicator,
    currentModel,
    handleStatusEvent,
    hideThinkingIndicator,
    recordFirstTokenTiming,
    resetThinkingIndicator,
    showThinkingIndicator,
    startResponseTiming,
    updateMessage,
  ]);

  const handleStopGeneration = useCallback(() => {
    const controller = streamAbortControllerRef.current;
    if (!controller) return;
    controller.abort();
    streamAbortControllerRef.current = null;
    setIsStreaming(false);
    resetThinkingIndicator();
  }, [resetThinkingIndicator]);

  // Check if we need to auto-start streaming for a new chat with only a user message
  // This handles the case where a chat was created from the project page and redirected here
  useEffect(() => {
    if (!activeConversationId || !initialMessages.length || autoStreamHandled) return;
    
    // Skip if we've already auto-streamed this conversation (e.g., from handleSubmit)
    if (isConversationAutoStreamed(activeConversationId)) {
      console.log("[chatDebug] Skipping auto-stream - already processed:", activeConversationId);
      clearConversationAutoStreamed(activeConversationId);
      return;
    }
    
    // Only trigger if there's exactly 1 message and it's a user message
    if (initialMessages.length === 1 && initialMessages[0].role === "user") {
      const userMessage = initialMessages[0];
      console.log("[chatDebug] Detected new chat with only user message, triggering stream");
      
      // Mark as auto-streamed before triggering
      autoStreamedConversations.current.add(activeConversationId);
      
      streamModelResponse(
        activeConversationId,
        projectId,
        userMessage.content,
        activeConversationId,
        true // skipUserInsert since message is already in DB
      ).catch((err: unknown) => {
        console.error("Failed to stream initial message:", err);
      });
    }
  }, [
    activeConversationId,
    autoStreamHandled,
    clearConversationAutoStreamed,
    initialMessages,
    isConversationAutoStreamed,
    projectId,
    streamModelResponse,
  ]); // Run when conversation changes or message count changes

  const handleRetryWithModel = async (retryModelName: string, messageId: string) => {
    if (!selectedChatId) return;

    // Find the user message that precedes this assistant message
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex <= 0) return;

    const userMessage = messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== "user") return;

    // Map retry model name to model settings (without changing the UI dropdown)
    let retryModelFamily: ModelFamily = "gpt-5-mini";
    let retrySpeedMode: SpeedMode | undefined = "auto";
     if (retryModelName === "GPT 5 Nano") {
       retryModelFamily = "gpt-5-nano";
       retrySpeedMode = "auto";
     } else if (retryModelName === "GPT 5 Mini") {
       retryModelFamily = "gpt-5-mini";
       retrySpeedMode = "auto";
     } else if (retryModelName === "GPT 5.1") {
       retryModelFamily = "gpt-5.1";
       retrySpeedMode = "auto";
     } else if (retryModelName === "GPT 5 Pro") {
       retryModelFamily = "gpt-5-pro-2025-10-06";
       retrySpeedMode = "auto";
     }

    // Start timing and show thinking indicator BEFORE removing message
    const retryPreviewConfig = getModelAndReasoningConfig(
      retryModelFamily,
      retrySpeedMode ?? "auto",
      userMessage.content
    );
    const retryIndicatorEffort = retryPreviewConfig.reasoning?.effort ?? null;
    startResponseTiming();
    showThinkingIndicator(retryIndicatorEffort);
    clearSearchIndicator();
    clearFileReadingIndicator();

    // Generate the new assistant message ID immediately so the timer can attach
    const assistantMessageId = `assistant-streaming-${Date.now()}`;
    setActiveIndicatorMessageId(assistantMessageId);

    // Remove the assistant message from UI immediately (no lag)
    removeMessage(selectedChatId, messageId);

    // Delete the old assistant message from Supabase in the background
    fetch("/api/chat", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    }).catch((error) => {
      console.error("Error deleting old assistant message:", error);
    });

    // Wait for React to process the removal before adding new message
    await new Promise(resolve => setTimeout(resolve, 0));

     // Re-stream with the specific retry model (not changing currentModel)
     try {
       // Get location data if available
       let locationData = null;
       try {
         const locationStr = localStorage.getItem("location_data");
         if (locationStr) {
           const parsed = JSON.parse(locationStr);
           locationData = {
             lat: parsed.lat,
             lng: parsed.lng,
             city: parsed.city,
           };
         }
       } catch (e) {
         console.error("[Location] Failed to parse location data:", e);
       }

       const response = await fetch("/api/chat", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           conversationId: selectedChatId,
           projectId: selectedProjectId || undefined,
           message: userMessage.content,
           modelFamilyOverride: retryModelFamily,
           speedModeOverride: retrySpeedMode,
            reasoningEffortOverride: undefined, // Let API auto-calculate
            skipUserInsert: true,
            location: locationData,
         }),
       });

       if (!response.ok) {
         console.error("Chat API error:", response.status, response.statusText);
         return;
       }

       const reader = response.body?.getReader();
       if (!reader) {
         console.error("No response body reader");
         return;
       }

       const decoder = new TextDecoder();
       let assistantContent = "";
       // assistantMessageId already generated and set above
       let messageMetadata: AssistantMessageMetadata | null = {};

       // Add the initial empty assistant message
       appendMessages(selectedChatId, [
         {
           id: assistantMessageId,
           role: "assistant",
           content: "",
           timestamp: new Date().toISOString(),
         },
       ]);
       responseTimingRef.current.assistantMessageId = assistantMessageId;

       try {
         while (true) {
           const { done, value } = await reader.read();
           if (done) break;

           const chunk = decoder.decode(value, { stream: true });
           const lines = chunk.split("\n").filter((l) => l.trim());

           for (const line of lines) {
             try {
               const parsed = JSON.parse(line);

              if (parsed.token) {
                assistantContent += parsed.token;
                const currentMessageId =
                  responseTimingRef.current.assistantMessageId ?? assistantMessageId;
                messageMetadata = recordFirstTokenTiming(
                  selectedChatId,
                  currentMessageId,
                  messageMetadata,
                  retryIndicatorEffort
                );
                // Update the assistant message with new content
                updateMessage(selectedChatId, currentMessageId, {
                  content: assistantContent,
                });
              } else if (parsed.status) {
                handleStatusEvent(parsed.status as SearchStatusEvent);
              } else if (parsed.type === "web_search_domain" && typeof parsed.domain === "string") {
                addSearchDomain(parsed.domain);
                // Immediately update message metadata with accumulated domains
                const currentMessageId =
                  responseTimingRef.current.assistantMessageId ?? assistantMessageId;
                if (messageMetadata) {
                  const updatedMetadata: AssistantMessageMetadata = {
                    ...messageMetadata,
                    searchedDomains: [...searchDomainListRef.current],
                  };
                  messageMetadata = updatedMetadata;
                  updateMessage(selectedChatId, currentMessageId, {
                    metadata: messageMetadata,
                  });
                }
              } else if (parsed.model_info) {
                // Update model metadata early so model tag switches from unknown immediately
                const currentMessageId =
                  responseTimingRef.current.assistantMessageId ?? assistantMessageId;
                if (messageMetadata) {
                  const updatedMetadata: AssistantMessageMetadata = {
                    ...messageMetadata,
                    modelUsed: parsed.model_info.model,
                    resolvedFamily: parsed.model_info.resolvedFamily,
                    speedModeUsed: parsed.model_info.speedModeUsed,
                    reasoningEffort: parsed.model_info.reasoningEffort,
                  };
                  messageMetadata = updatedMetadata;
                  updateMessage(selectedChatId, currentMessageId, {
                    metadata: messageMetadata,
                  });
                }
              } else if (parsed.meta) {
                const fallbackMeta: AssistantMessageMetadata = {
                  modelUsed: parsed.meta.model,
                  reasoningEffort: parsed.meta.reasoningEffort,
                  resolvedFamily: parsed.meta.resolvedFamily,
                  speedModeUsed: parsed.meta.speedModeUsed,
                  userRequestedFamily: retryModelFamily,
                  userRequestedSpeedMode: retrySpeedMode,
                  userRequestedReasoningEffort: undefined,
                };
                const resolvedMetadata: AssistantMessageMetadata =
                  (parsed.meta.metadata as AssistantMessageMetadata | null) ?? fallbackMeta;
                const metadataWithTiming = mergeThinkingTimingIntoMetadata(
                  resolvedMetadata,
                  pendingThinkingInfoRef.current
                );
                pendingThinkingInfoRef.current = null;
                messageMetadata = metadataWithTiming;
                const newId = parsed.meta.assistantMessageRowId;
                setActiveIndicatorMessageId(newId);
                // Clear thinking indicator when metadata arrives
                resetThinkingIndicator();
                // Replace the temporary ID with the persisted row ID and store metadata
                updateMessage(selectedChatId, assistantMessageId, {
                  id: newId,
                  metadata: metadataWithTiming,
                });
                responseTimingRef.current.assistantMessageId = newId;
              } else if (parsed.done) {
                 // Streaming complete
                 break;
               }
             } catch {
               // Skip lines that aren't valid JSON
             }
           }
         }
       } finally {
         reader.releaseLock();
       }
     } catch (error) {
       console.error("Error retrying with model:", error);
        } finally {
          resetThinkingIndicator();
          // Clear active indicator so buttons appear after streaming completes
          setActiveIndicatorMessageId(null);
     }
  };

  const handleChatSelect = (id: string) => {
    const chat = chats.find((item) => item.id === id);
    setSelectedChatId(id);
    if (chat?.projectId) {
      setSelectedProjectId(chat.projectId);
      router.push(`/projects/${chat.projectId}/c/${id}`);
    } else {
      setSelectedProjectId("");
      router.push(`/c/${id}`);
    }
  };

  const handleProjectChatSelect = (projectIdValue: string, chatId: string) => {
    setSelectedChatId(chatId);
    setSelectedProjectId(projectIdValue);
    router.push(`/projects/${projectIdValue}/c/${chatId}`);
  };

  const handleNewChat = () => {
    if (isGuest) {
      setGuestWarning("Guest mode: sign in to save chats and projects.");
      return;
    }
    setSelectedChatId(null);
    setSelectedProjectId("");
    router.push("/");
  };

  const handleProjectSelect = (id: string) => {
    setSelectedProjectId(id);
    router.push(`/projects/${id}`);
  };

  const handleScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
    const target = event.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const tolerance = Math.max(16, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;

    setShowScrollToBottom(!atBottom);
    // Re-enable autoscroll when user scrolls back to bottom, disable when scrolling up
    setIsAutoScroll(atBottom);
  };

  useEffect(() => {
    // Don't run this effect during streaming - let the streaming autoscroll handle it
    if (isStreaming) return;
    
    if (isAutoScroll) {
      // Only recompute flags, don't force scroll
      setShowScrollToBottom(false);
    } else {
      // Recompute based on actual scroll position so the button state is always correct.
      recomputeScrollFlags();
    }
  }, [isAutoScroll, isStreaming, recomputeScrollFlags]);

  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
      }
      if (searchIndicatorTimerRef.current) {
        clearTimeout(searchIndicatorTimerRef.current);
      }
      if (fileIndicatorTimerRef.current) {
        clearTimeout(fileIndicatorTimerRef.current);
      }
    };
  }, []);

  const handleNewProject = () => {
    if (isGuest) {
      setGuestWarning("Sign in to create and save projects.");
      return;
    }
    setIsNewProjectOpen(true);
  };

  const handleProjectCreate = async (name: string, icon?: string, color?: string) => {
    if (isGuest) {
      setGuestWarning("Sign in to create and save projects.");
      setIsNewProjectOpen(false);
      return;
    }
    const newProject = await addProject(name, icon, color);
    setSelectedProjectId(newProject.id);
    setIsNewProjectOpen(false);
    router.push(`/projects/${newProject.id}`);
  };

  const sidebarConversations = useMemo(
    () =>
      globalChats
        .map((chat) => ({
          id: chat.id,
          title: chat.title,
          timestamp: chat.timestamp,
        }))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [globalChats]
  );

  const projectConversations = useMemo(() => {
    const map: Record<string, ShellConversation[]> = {};

    chats.forEach((chat) => {
      if (!chat.projectId) return;
      if (!map[chat.projectId]) map[chat.projectId] = [];
      map[chat.projectId].push({
        id: chat.id,
        title: chat.title,
        timestamp: chat.timestamp,
        projectId: chat.projectId,
      });
    });

    // Sort each project's chats by most recent
    Object.keys(map).forEach((projectId) => {
      map[projectId].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    });

    return map;
  }, [chats]);

  // Sort projects by most recent activity (most recent chat timestamp in each project)
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aChats = projectConversations[a.id] || [];
      const bChats = projectConversations[b.id] || [];
      
      // Get the most recent chat timestamp for each project
      const aLatest = aChats.length > 0 
        ? Math.max(...aChats.map(chat => new Date(chat.timestamp).getTime()))
        : new Date(a.createdAt || 0).getTime();
      
      const bLatest = bChats.length > 0
        ? Math.max(...bChats.map(chat => new Date(chat.timestamp).getTime()))
        : new Date(b.createdAt || 0).getTime();
      
      return bLatest - aLatest;
    });
  }, [projects, projectConversations]);

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground dark overflow-hidden overscroll-y-none">
      {/* Sidebar */}
      {!isGuest && (
        <ChatSidebar
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((open) => !open)}
          selectedChatId={selectedChatId ?? ""} // Sidebar API expects string
          conversations={sidebarConversations}
          projects={sortedProjects}
          projectChats={projectConversations}
          onChatSelect={handleChatSelect}
          onProjectChatSelect={handleProjectChatSelect}
          onNewChat={handleNewChat}
          onNewProject={handleNewProject}
          onProjectSelect={handleProjectSelect}
          selectedProjectId={selectedProjectId}
          onSettingsOpen={() => setIsSettingsOpen(true)}
          onGeneralSettingsOpen={() => {
            setSettingsTab('general')
            setIsSettingsOpen(true)
          }}
          onRefreshChats={refreshChats}
          onRefreshProjects={refreshProjects}
        />
      )}

      {/* Right column: header + messages + composer */}
      <div className="flex flex-1 flex-col w-full min-w-0 min-h-0 overflow-hidden">
        {/* Header bar */}
        <div className="sticky top-0 z-20 flex h-[53px] items-center justify-between border-b border-border bg-background px-3 lg:px-6">
          <div className="flex items-center gap-2 min-w-0">
            {!isGuest && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 lg:hidden"
                onClick={() => setIsSidebarOpen((open) => !open)}
              >
                <Menu className="h-4 w-4" />
              </Button>
            )}

            {isGuest && (
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => {
                  setSelectedChatId(null);
                  setSelectedProjectId("");
                  ensureChat({
                    id: `guest-${Date.now()}`,
                    title: "New chat",
                    timestamp: new Date().toISOString(),
                    messages: [],
                  });
                  router.push("/");
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}

            <div className="flex-1 flex items-center justify-center">
              <ApiUsageBadge />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-auto gap-1.5 border-0 px-2 text-base font-semibold focus-visible:bg-transparent focus-visible:outline-none focus-visible:ring-0"
                >
                  {currentModel === "Auto"
                    ? "GPT 5.1"
                    : currentModel === "Instant"
                      ? "GPT 5.1 Instant"
                      : currentModel === "Thinking"
                        ? "GPT 5.1 Thinking"
                        : currentModel}
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              {!isGuest ? (
                <DropdownMenuContent
                  align="start"
                  sideOffset={8}
                  className="w-auto min-w-[220px] max-w-[90vw] sm:w-64 space-y-1 py-2"
                >
                  <div className="px-3 pb-1 text-sm font-semibold text-muted-foreground">
                    GPT 5.1
                  </div>
                  <DropdownMenuItem
                    className="items-center gap-3 px-3 py-2"
                    onSelect={() => setCurrentModel("Auto")}
                  >
                    <div className="flex flex-1 flex-col">
                      <span className="font-medium leading-none">Auto</span>
                      <span className="text-xs text-muted-foreground">
                        Auto routing
                      </span>
                    </div>
                    <span className="flex w-4 justify-end">
                      {currentModel === "Auto" && <Check className="h-4 w-4" />}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="items-center gap-3 px-3 py-2"
                    onSelect={() => setCurrentModel("Instant")}
                  >
                    <div className="flex flex-1 flex-col">
                      <span className="font-medium leading-none">Instant</span>
                      <span className="text-xs text-muted-foreground">
                        Answers right away
                      </span>
                    </div>
                    <span className="flex w-4 justify-end">
                      {currentModel === "Instant" && <Check className="h-4 w-4" />}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="items-center gap-3 px-3 py-2"
                    onSelect={() => setCurrentModel("Thinking")}
                  >
                    <div className="flex flex-1 flex-col">
                      <span className="font-medium leading-none">Thinking</span>
                      <span className="text-xs text-muted-foreground">
                        Thinks longer for better answers
                      </span>
                    </div>
                    <span className="flex w-4 justify-end">
                      {currentModel === "Thinking" && <Check className="h-4 w-4" />}
                    </span>
                  </DropdownMenuItem>

                  <div className="px-2">
                    <div className="h-px bg-border" />
                  </div>

                  <DropdownMenuSub>
                     <DropdownMenuSubTrigger className="items-center gap-3 px-3 py-2">
                      <div className="flex flex-col text-left">
                        <span className="font-medium leading-none">
                          Other models
                        </span>
                      </div>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent
                        sideOffset={-16}
                        collisionPadding={12}
                        className="w-[min(300px,calc(100vw-16px))] max-w-[calc(100vw-16px)] sm:w-56 p-2 space-y-1 data-[side=right]:-translate-x-6 sm:data-[side=right]:translate-x-0"
                      >
                        <div className="px-3 pb-1 text-sm font-semibold text-muted-foreground">
                          GPT 5 Nano
                        </div>
                        <DropdownMenuItem
                          className="items-center gap-3 px-3 py-2"
                          onSelect={() => setCurrentModel("GPT 5 Nano Auto")}
                        >
                          <div className="flex flex-1 flex-col">
                            <span className="font-medium leading-none">Auto</span>
                          </div>
                          <span className="flex w-4 justify-end">
                            {currentModel === "GPT 5 Nano Auto" && <Check className="h-4 w-4" />}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="items-center gap-3 px-3 py-2"
                          onSelect={() => setCurrentModel("GPT 5 Nano Instant")}
                        >
                          <div className="flex flex-1 flex-col">
                            <span className="font-medium leading-none">Instant</span>
                          </div>
                          <span className="flex w-4 justify-end">
                            {currentModel === "GPT 5 Nano Instant" && <Check className="h-4 w-4" />}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="items-center gap-3 px-3 py-2"
                          onSelect={() => setCurrentModel("GPT 5 Nano Thinking")}
                        >
                          <div className="flex flex-1 flex-col">
                            <span className="font-medium leading-none">Thinking</span>
                          </div>
                          <span className="flex w-4 justify-end">
                            {currentModel === "GPT 5 Nano Thinking" && <Check className="h-4 w-4" />}
                          </span>
                        </DropdownMenuItem>

                        <div className="px-2">
                          <div className="h-px bg-border" />
                        </div>

                        <div className="px-3 pb-1 text-sm font-semibold text-muted-foreground">
                          GPT 5 Mini
                        </div>
                        <DropdownMenuItem
                          className="items-center gap-3 px-3 py-2"
                          onSelect={() => setCurrentModel("GPT 5 Mini Auto")}
                        >
                          <div className="flex flex-1 flex-col">
                            <span className="font-medium leading-none">Auto</span>
                          </div>
                          <span className="flex w-4 justify-end">
                            {currentModel === "GPT 5 Mini Auto" && <Check className="h-4 w-4" />}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="items-center gap-3 px-3 py-2"
                          onSelect={() => setCurrentModel("GPT 5 Mini Instant")}
                        >
                          <div className="flex flex-1 flex-col">
                            <span className="font-medium leading-none">Instant</span>
                          </div>
                          <span className="flex w-4 justify-end">
                            {currentModel === "GPT 5 Mini Instant" && <Check className="h-4 w-4" />}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="items-center gap-3 px-3 py-2"
                          onSelect={() => setCurrentModel("GPT 5 Mini Thinking")}
                        >
                          <div className="flex flex-1 flex-col">
                            <span className="font-medium leading-none">Thinking</span>
                          </div>
                          <span className="flex w-4 justify-end">
                            {currentModel === "GPT 5 Mini Thinking" && <Check className="h-4 w-4" />}
                          </span>
                        </DropdownMenuItem>

                        <div className="px-2">
                          <div className="h-px bg-border" />
                        </div>

                        <DropdownMenuItem
                          className="items-center gap-3 px-3 py-2"
                          onSelect={() => setCurrentModel("GPT 5 Pro")}
                        >
                          <span className="flex-1">GPT 5 Pro</span>
                          <span className="flex w-4 justify-end">
                            {currentModel === "GPT 5 Pro" && (
                              <Check className="h-4 w-4" />
                            )}
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              ) : (
                <DropdownMenuContent align="start" className="w-72 p-0 overflow-hidden border border-border/60">
                  <div className="bg-card">
                    <div className="h-24 bg-gradient-to-br from-purple-500 via-indigo-500 to-blue-500" />
                    <div className="p-4 space-y-2">
                      <div className="text-sm font-semibold text-foreground">Try advanced features for free</div>
                      <p className="text-xs text-muted-foreground">
                        Get smarter responses, upload files, create images, and more by logging in.
                      </p>
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          className="h-9 rounded-full px-3 text-sm font-semibold"
                          onClick={() => router.push("/login")}
                        >
                          Log in
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 rounded-full px-3 text-sm font-semibold border border-border"
                          onClick={() => router.push("/login")}
                        >
                          Sign up for free
                        </Button>
                      </div>
                    </div>
                  </div>
                </DropdownMenuContent>
              )}
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-2">
            {isGuest ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-sm font-semibold rounded-full"
                  onClick={() => router.push("/login")}
                >
                  Log in
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3 text-sm font-semibold rounded-full border border-border"
                  onClick={() => router.push("/login")}
                >
                  Sign up for free
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {guestWarning && (
          <div className="border-b border-border bg-[#2a2416]/60 px-4 py-3">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
              <StatusBubble label={guestWarning} variant="warning" />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-xs text-yellow-200"
                onClick={() => setGuestWarning(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {!selectedChatId || messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-4">
              <div className="text-center">
                <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">
                  Where should we begin?
                </h2>
              </div>
            </div>
          ) : (
            <ScrollArea
              className="h-full overscroll-y-contain"
              viewportRef={scrollViewportRef}
              viewportClassName="overscroll-y-contain overscroll-contain"
              onViewportScroll={handleScroll}
            >
              <div className="py-4 pb-20">
                {/* Wide desktop layout with padded container */}
                <div className="w-full space-y-4">
                  {messages.map((message) => {
                    const metadata = message.metadata as AssistantMessageMetadata | null;
                    const isStreamingMessage = message.id === activeIndicatorMessageId;

                    // Build display metadata so we can show a live "Thought for xx" chip while waiting for first token
                    let displayMetadata: AssistantMessageMetadata | null = metadata ? { ...metadata } : null;
                    
                    // If metadata already has thinking duration (from database), use it and skip live calculations
                    const hasStoredThinkingDuration = metadata && 
                      (typeof metadata.thinkingDurationMs === 'number' || typeof metadata.thinkingDurationSeconds === 'number');
                    
                    // Show timing: stored from DB, or pending from first token, or live while thinking
                    const hasPendingTiming = Boolean(pendingThinkingInfoRef.current);
                    
                    if (!hasStoredThinkingDuration && isStreamingMessage && hasPendingTiming) {
                      // Show pending timing from first token (triggered immediately when first token arrives)
                      const timing = pendingThinkingInfoRef.current!;
                      displayMetadata = {
                        ...(displayMetadata || ({} as AssistantMessageMetadata)),
                        thoughtDurationLabel: timing.label,
                        thinkingDurationMs: timing.durationMs,
                        thinkingDurationSeconds: timing.durationSeconds,
                        thinking: {
                          ...(displayMetadata?.thinking || {}),
                          effort: timing.effort,
                          durationMs: timing.durationMs,
                          durationSeconds: timing.durationSeconds,
                        },
                      } as AssistantMessageMetadata;
                    }

                    // Show insight chips for thinking duration and web search domains as soon as metadata arrives (or live during thinking)
                    const metadataIndicators =
                      Boolean(displayMetadata?.thoughtDurationLabel) ||
                      Boolean(displayMetadata?.searchedDomains?.length);
                    
                    return (
                      <div
                        key={message.id}
                        ref={(el) => {
                          if (el) {
                            messageRefs.current[message.id] = el;
                          }
                        }}
                      >
                        {message.role === "assistant" && (
                        <div className="flex flex-col gap-2 pb-2 px-4 sm:px-6" style={{ minHeight: metadataIndicators ? 'auto' : '0px' }}>
                          <div className="mx-auto w-full max-w-[min(720px,100%)]">
                            <div className="flex flex-wrap items-center gap-1.5 pt-1">
                              {metadataIndicators && <MessageInsightChips metadata={displayMetadata || undefined} />}
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="px-4 sm:px-6">
                        <div className="mx-auto w-full max-w-[min(720px,100%)]">
                        <ChatMessage
                          {...message}
                          showInsightChips={false}
                          isStreaming={isStreamingMessage}
                          onRetry={
                            message.role === "assistant"
                              ? (model) => handleRetryWithModel(model, message.id)
                              : undefined
                          }
                        />
                        </div>
                      </div>
                    </div>
                  );
                })}
                  {/* Show indicators with priority. Allow web/file indicators even when last assistant message is empty. */}
                  {(() => {
                    const hasIndicator = Boolean(thinkingStatus || searchIndicator || fileReadingIndicator);
                    const lastHasContent = messages.length === 0 || Boolean(messages[messages.length - 1]?.content);
                    const allowRegardless = Boolean(searchIndicator || fileReadingIndicator);
                    return hasIndicator && (lastHasContent || allowRegardless);
                  })() && (
                    <div className="px-4 sm:px-6 pb-8">
                      <div className="mx-auto w-full max-w-3xl">
                        <div className="flex items-center min-h-[28px]">
                          {/* Priority order: file reading > search > thinking (only show one at a time) */}
                          {fileReadingIndicator ? (
                            <StatusBubble
                              label="Reading documents"
                              variant={fileReadingIndicator === "error" ? "error" : "reading"}
                            />
                          ) : searchIndicator ? (
                            <StatusBubble
                              label={searchIndicator.message}
                              variant={searchIndicator.variant === "error" ? "error" : "search"}
                              subtext={searchIndicator.subtext}
                            />
                          ) : thinkingStatus ? (
                            <StatusBubble
                              label={thinkingStatus.label}
                              variant={thinkingStatus.variant === "extended" ? "extended" : "default"}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Bottom spacer for proper scrolling */}
                  <div aria-hidden="true" style={{ height: `${bottomSpacerPx}px` }} />
                </div>
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Composer: full-width bar, centered pill like ChatGPT */}
        <div className="bg-background px-4 sm:px-6 lg:px-12 py-3 sm:py-4 relative sticky bottom-0 z-20 pb-[max(env(safe-area-inset-bottom),0px)]">
          <div
            className={`pointer-events-none fixed right-4 bottom-[calc(96px+env(safe-area-inset-bottom,0px))] z-30 transition-opacity duration-200 ${
              showScrollToBottom ? "opacity-100" : "opacity-0"
            }`}
          >
            <Button
              type="button"
              size="icon"
              className="pointer-events-auto h-10 w-10 rounded-full border border-border bg-card/90 text-foreground shadow-md backdrop-blur hover:bg-background"
              onClick={() => {
                scrollToBottom("smooth");
                // Re-enable autoscroll after scrolling to bottom
                setTimeout(() => {
                  setIsAutoScroll(true);
                  setShowScrollToBottom(false);
                }, 100);
              }}
            >
              <ArrowDown className="h-4 w-4 text-foreground" />
            </Button>
          </div>
          <div className="mx-auto w-full max-w-3xl">
            <ChatComposer
              onSubmit={handleSubmit}
              isStreaming={isStreaming}
              onStop={handleStopGeneration}
            />
          </div>
        </div>
      </div>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false)
          setSettingsTab('personalization')
        }}
        initialTab={settingsTab}
      />
      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={handleProjectCreate}
      />
      <UsageLimitModal
        isOpen={usageLimitModal.isOpen}
        onClose={() => setUsageLimitModal({ ...usageLimitModal, isOpen: false })}
        currentSpending={usageLimitModal.currentSpending}
        limit={usageLimitModal.limit}
        planType={usageLimitModal.planType}
      />
    </div>
  );
}
