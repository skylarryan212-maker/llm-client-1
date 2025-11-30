"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatMessage } from "@/components/chat-message";
import { ChatComposer } from "@/components/chat-composer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowDown, Check, ChevronDown, Menu } from "lucide-react";
import { SettingsModal } from "@/components/settings-modal";
import { StatusBubble } from "@/components/chat/status-bubble";
import {
  appendUserMessageAction,
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
import { normalizeModelFamily, normalizeSpeedMode, getModelAndReasoningConfig, getModelSettingsFromDisplayName } from "@/lib/modelConfig";
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

function mergeThinkingTimingIntoMetadata(
  metadata: AssistantMessageMetadata | null,
  timing: ThinkingTimingInfo | null
): AssistantMessageMetadata | null {
  if (!timing) {
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

  const [isSidebarOpen, setIsSidebarOpen] = usePersistentSidebarOpen(true);
  const [currentModel, setCurrentModel] = useState("Auto");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    activeConversationId ?? null
  );

  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState<{ variant: "thinking" | "extended"; label: string } | null>(null);
  // Force re-render while thinking so a live duration chip can update
  const [thinkingTick, setThinkingTick] = useState(0);
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
  const AUTO_STREAM_KEY_PREFIX = "llm-client-auto-stream:";

  const getAutoStreamKey = (conversationId: string) =>
    `${AUTO_STREAM_KEY_PREFIX}${conversationId}`;

  const hasSessionAutoStream = (conversationId: string) =>
    typeof window !== "undefined" &&
    sessionStorage.getItem(getAutoStreamKey(conversationId)) === "1";

  const markConversationAsAutoStreamed = (conversationId: string) => {
    autoStreamedConversations.current.add(conversationId);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(getAutoStreamKey(conversationId), "1");
    }
  };

  const clearConversationAutoStreamed = (conversationId: string) => {
    autoStreamedConversations.current.delete(conversationId);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(getAutoStreamKey(conversationId));
    }
  };

  const isConversationAutoStreamed = (conversationId: string) => {
    if (!conversationId) return false;
    return (
      autoStreamedConversations.current.has(conversationId) ||
      hasSessionAutoStream(conversationId)
    );
  };

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
    thinkingTimerRef.current = setTimeout(() => {
      setThinkingStatus((prev) =>
        prev ? { variant: "extended", label: "Thinking for longer…" } : prev
      );
      thinkingTimerRef.current = null;
    }, 4000);
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
      // Store client timing for display immediately
      pendingThinkingInfoRef.current = thinkingInfo;
      // Create metadata with client timing to show immediately
      const displayMetadata = mergeThinkingTimingIntoMetadata(metadata, thinkingInfo);
      if (displayMetadata) {
        updateMessage(chatId, messageId, { metadata: displayMetadata });
        return displayMetadata;
      }
      return metadata;
    },
    [hideThinkingIndicator, updateMessage]
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
            message: "Searching the Web",
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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

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
  const messages = currentChat?.messages || [];

  useEffect(() => {
    setIsAutoScroll(true);
    setShowScrollToBottom(false);
    scrollToBottom("auto");
  }, [selectedChatId]);

  useEffect(() => {
    if (currentChat?.projectId) {
      setSelectedProjectId(currentChat.projectId);
    } else if (selectedChatId) {
      setSelectedProjectId("");
    }
  }, [currentChat, selectedChatId]);

  type UploadedFragment = { id: string; name: string; dataUrl: string; mime?: string };
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
        
        // Navigate after streaming completes
        router.push(`/projects/${targetProjectId}/c/${newChatId}?autoStreamHandled=true`);
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
        
        // Navigate after streaming completes
        router.push(`/c/${newChatId}?autoStreamHandled=true`);
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

  const streamModelResponse = async (
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
        }),
        signal: controller.signal,
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
                // Hide file-reading indicator on first token
                clearFileReadingIndicator();
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
            } catch (parseError) {
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
  };

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
  }, [activeConversationId, initialMessages.length, autoStreamHandled]); // Run when conversation changes or message count changes

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
             } catch (parseError) {
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
    const atBottom = distanceFromBottom <= 24;

    setShowScrollToBottom(!atBottom);

    setIsAutoScroll((prev) => {
      if (!prev && atBottom) return prev;
      if (!atBottom) return false;
      return prev;
    });
  };

  useEffect(() => {
    if (isAutoScroll) {
      scrollToBottom("auto");
      setShowScrollToBottom(false);
    } else {
      setShowScrollToBottom(true);
    }
  }, [messages.length, isAutoScroll, messages]);

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
    setIsNewProjectOpen(true);
  };

  const handleProjectCreate = async (name: string) => {
    const newProject = await addProject(name);
    setSelectedProjectId(newProject.id);
    setIsNewProjectOpen(false);
    router.push(`/projects/${newProject.id}`);
  };

  const sidebarConversations = useMemo(
    () =>
      globalChats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        timestamp: chat.timestamp,
      })),
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

    return map;
  }, [chats]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground dark">
      {/* Sidebar */}
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((open) => !open)}
        currentModel={currentModel}
        onModelSelect={setCurrentModel}
        selectedChatId={selectedChatId ?? ""} // Sidebar API expects string
        conversations={sidebarConversations}
        projects={projects}
        projectChats={projectConversations}
        onChatSelect={handleChatSelect}
        onProjectChatSelect={handleProjectChatSelect}
        onNewChat={handleNewChat}
        onNewProject={handleNewProject}
        onProjectSelect={handleProjectSelect}
        selectedProjectId={selectedProjectId}
        onSettingsOpen={() => setIsSettingsOpen(true)}
        onRefreshChats={refreshChats}
        onRefreshProjects={refreshProjects}
      />

      {/* Right column: header + messages + composer */}
      <div className="flex flex-1 flex-col w-full min-w-0">
        {/* Header bar */}
        <div className="flex h-[53px] items-center justify-between border-b border-border px-3 lg:px-6">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile sidebar toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 lg:hidden"
              onClick={() => setIsSidebarOpen((open) => !open)}
            >
              <Menu className="h-4 w-4" />
            </Button>

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
              <DropdownMenuContent align="start" className="w-64 space-y-1 py-2">
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
                    <DropdownMenuSubContent className="w-56 p-2 space-y-1">
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
            </DropdownMenu>
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                />
              </svg>
              <span className="hidden md:inline">Share</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                />
              </svg>
              <span className="hidden md:inline">Archive</span>
            </Button>
          </div>
        </div>

        {/* Messages */}
        {!selectedChatId || messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 overflow-hidden">
            <div className="text-center">
              <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">
                Where should we begin?
              </h2>
            </div>
          </div>
        ) : (
          <ScrollArea
            className="flex-1 overflow-auto"
            viewportRef={scrollViewportRef}
            onViewportScroll={handleScroll}
          >
            <div className="py-4 pb-4">
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
                  const hasLiveStart = Boolean(responseTimingRef.current.start);
                  
                  if (!hasStoredThinkingDuration && isStreamingMessage && hasPendingTiming) {
                    // Show pending timing from first token while waiting for server meta event
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
                  } else if (!hasStoredThinkingDuration && isStreamingMessage && thinkingStatus && hasLiveStart) {
                    // Compute live timing while waiting for first token
                    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
                    const start = responseTimingRef.current.start as number;
                    const seconds = Math.max(0, (now - start) / 1000);
                    const label = formatThoughtDurationLabel(seconds);
                    displayMetadata = {
                      ...(displayMetadata || ({} as AssistantMessageMetadata)),
                      thoughtDurationLabel: label,
                      thinkingDurationMs: Math.max(0, now - start),
                      thinkingDurationSeconds: seconds,
                      thinking: {
                        ...(displayMetadata?.thinking || {}),
                        durationMs: Math.max(0, now - start),
                        durationSeconds: seconds,
                      },
                    } as AssistantMessageMetadata;
                  }

                  // Show insight chips for thinking duration and web search domains as soon as metadata arrives (or live during thinking)
                  const metadataIndicators =
                    Boolean(displayMetadata?.thoughtDurationLabel) ||
                    Boolean(displayMetadata?.searchedDomains?.length);
                  const showIndicatorBlock = message.role === "assistant" && metadataIndicators;
                  
                  return (
                    <div key={message.id}>
                      {showIndicatorBlock && (
                        <div className="flex flex-col gap-2 pb-2 px-4 sm:px-6">
                          <div className="mx-auto w-full max-w-3xl">
                            <div className="flex flex-wrap items-center gap-1.5 pt-1">
                              <MessageInsightChips metadata={displayMetadata || undefined} />
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="px-4 sm:px-6">
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
                  );
                })}
                {(thinkingStatus || searchIndicator || fileReadingIndicator) && (
                  <div className="flex flex-col gap-2 pb-2 px-4 sm:px-6">
                    <div className="mx-auto w-full max-w-3xl">
                      <div className="flex flex-wrap gap-2">
                        {fileReadingIndicator && (
                          <StatusBubble
                            label="Reading documents"
                            variant={fileReadingIndicator === "error" ? "error" : "reading"}
                          />
                        )}
                        {searchIndicator && (
                          <StatusBubble
                            label={searchIndicator.message}
                            variant={searchIndicator.variant === "error" ? "error" : "search"}
                            subtext={searchIndicator.subtext}
                          />
                        )}
                        {thinkingStatus && (
                          <StatusBubble
                            label={thinkingStatus.label}
                            variant={thinkingStatus.variant === "extended" ? "extended" : "default"}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        )}

        {/* Composer: full-width bar, centered pill like ChatGPT */}
        <div className="bg-background px-4 sm:px-6 lg:px-12 py-3 sm:py-4 relative">
          <div
            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 -top-7 transition-opacity duration-200 ${
              showScrollToBottom ? "opacity-100" : "opacity-0"
            }`}
          >
            <Button
              type="button"
              size="icon"
              className="pointer-events-auto h-10 w-10 rounded-full border border-border bg-background/80 shadow-md backdrop-blur hover:bg-background"
              onClick={() => {
                setIsAutoScroll(true);
                setShowScrollToBottom(false);
                scrollToBottom();
              }}
            >
              <ArrowDown className="h-4 w-4" />
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
        onClose={() => setIsSettingsOpen(false)}
      />
      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={handleProjectCreate}
      />
    </div>
  );
}
