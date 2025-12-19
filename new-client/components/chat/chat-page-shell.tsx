"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUserIdentity } from "@/components/user-identity-provider";

import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatMessage } from "@/components/chat-message";
import { ChatComposer } from "@/components/chat-composer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowDown, Check, ChevronDown, Image as ImageIcon, Menu, Plus, X } from "lucide-react";
import { SettingsModal } from "@/components/settings-modal";
import { StatusBubble } from "@/components/chat/status-bubble";
import supabaseBrowserClient from "@/lib/supabase/browser-client";
import { ApiUsageBadge } from "@/components/api-usage-badge";
import { UsageLimitModal } from "@/components/usage-limit-modal";
import {
  startGlobalConversationAction,
  startProjectConversationAction,
} from "@/app/actions/chat-actions";
import {
  getContextModeGlobalPreference,
  saveContextModeGlobalPreference,
} from "@/app/actions/user-preferences-actions";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjects } from "@/components/projects/projects-provider";
import { NewProjectModal } from "@/components/projects/new-project-modal";
import { StoredMessage, type StoredChat, useChatStore } from "@/components/chat/chat-provider";
import { usePersistentSidebarOpen } from "@/lib/hooks/use-sidebar-open";
import { getModelAndReasoningConfig, getModelSettingsFromDisplayName } from "@/lib/modelConfig";
import type { ModelFamily, SpeedMode, ReasoningEffort } from "@/lib/modelConfig";
import { isPlaceholderTitle } from "@/lib/conversation-utils";
import { requestAutoNaming } from "@/lib/autoNaming";
import type { AssistantMessageMetadata } from "@/lib/chatTypes";
import { formatSearchedDomainsLine, formatThoughtDurationLabel } from "@/lib/metadata";
import { MessageInsightChips } from "@/components/chat/message-insight-chips";
import {
  navigateWithChatBodyFade,
  navigateWithMainPanelFade,
  runChatBodyEnterIfNeeded,
  runMainPanelEnterIfNeeded,
} from "@/lib/view-transitions";

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
  | { type: "file-reading-error"; message?: string }
  | { type: "code-interpreter-start" }
  | { type: "code-interpreter-complete" }
  | { type: "code-interpreter-error"; message?: string };

type SearchIndicatorState =
  | {
      message: string;
      variant: "running" | "complete" | "error";
      domains: string[];
      subtext?: string;
    }
  | null;

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

type ContextUsageSnapshot = {
  percent: number;
  limit: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  model?: string;
};

const CONTEXT_USAGE_STORAGE_KEY = "llm-client-context-usage";
const DEFAULT_CONTEXT_WINDOW_TOKENS = 350_000;
const AUTO_STREAM_KEY_PREFIX = "llm-client-auto-stream:";
const getAutoStreamKey = (conversationId: string) =>
  `${AUTO_STREAM_KEY_PREFIX}${conversationId}`;
const AUTO_STREAM_PREFS_KEY_PREFIX = "llm-client-auto-stream-prefs:";
const getAutoStreamPrefsKey = (conversationId: string) =>
  `${AUTO_STREAM_PREFS_KEY_PREFIX}${conversationId}`;
const CONTEXT_MODE_BY_CHAT_KEY = "llm-client-context-mode-by-chat";
const MODEL_SELECTION_STORAGE_KEY = "llm-client-model-selection";
const SIMPLE_CONTEXT_EXTERNAL_CHAT_SELECTION_KEY =
  "llm-client:simple-context-external-chat-ids-by-chat";
const ADVANCED_CONTEXT_TOPIC_SELECTION_KEY =
  "llm-client:advanced-context-topic-ids-by-chat";
const STREAMING_ACTIVE_STORAGE_KEY = "llm-client:streaming-active";
const STREAMING_CHAT_ID_STORAGE_KEY = "llm-client:streaming-chat-id";

function persistModelSelection(displayName: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODEL_SELECTION_STORAGE_KEY, displayName);
  } catch {
    // Ignore persistence failures
  }
}

function readModelSelectionFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY);
    return raw && raw.trim().length > 0 ? raw : null;
  } catch {
    return null;
  }
}

type AutoStreamPrefs = {
  generationMode?: "chat" | "image";
  imageModel?: "nano-banana" | "nano-banana-pro";
};

function saveAutoStreamPrefs(conversationId: string, prefs: AutoStreamPrefs | null) {
  if (typeof window === "undefined") return;
  try {
    const key = getAutoStreamPrefsKey(conversationId);
    if (!prefs) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // Ignore persistence failures
  }
}

function readAutoStreamPrefs(conversationId: string): AutoStreamPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getAutoStreamPrefsKey(conversationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== "object") return null;
    const generationMode =
      parsed.generationMode === "image" || parsed.generationMode === "chat"
        ? (parsed.generationMode as "chat" | "image")
        : undefined;
    const imageModel =
      parsed.imageModel === "nano-banana" || parsed.imageModel === "nano-banana-pro"
        ? (parsed.imageModel as "nano-banana" | "nano-banana-pro")
        : undefined;
    return { generationMode, imageModel };
  } catch {
    return null;
  }
}

function loadInitialContextModeGlobal(): "advanced" | "simple" {
  if (typeof window === "undefined") return "advanced";
  try {
    const raw = window.localStorage.getItem("context-mode-global");
    return raw === "simple" || raw === "advanced" ? raw : "advanced";
  } catch {
    return "advanced";
  }
}

function loadInitialContextModeByChat(): Record<string, "advanced" | "simple"> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CONTEXT_MODE_BY_CHAT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, "advanced" | "simple">;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function mergeThinkingTimingIntoMetadata(
  metadata: AssistantMessageMetadata | null,
  timing: ThinkingTimingInfo | null
): AssistantMessageMetadata | null {
  if (!timing) {
    return metadata;
  }
  const skipEfforts = new Set<ReasoningEffort>(["low", "none", "minimal"]);
  if (metadata && metadata.reasoningEffort && skipEfforts.has(metadata.reasoningEffort)) {
    return metadata;
  }
  if (timing.effort && skipEfforts.has(timing.effort)) {
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
  const baseBottomSpacerPx = 28;
  const router = useRouter();
  const mainPanelRef = useRef<HTMLDivElement | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    runMainPanelEnterIfNeeded(mainPanelRef.current);
    runChatBodyEnterIfNeeded(chatBodyRef.current);
  }, []);

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

	  const [isSidebarOpen, setIsSidebarOpen] = usePersistentSidebarOpen();
	  const [currentModel, setCurrentModel] = useState("Auto");
	  const [isImageMode, setIsImageMode] = useState(false);
	  const [currentImageModel, setCurrentImageModel] = useState<"nano-banana" | "nano-banana-pro">(
	    "nano-banana"
	  );
	  const hasLoadedModelSelectionRef = useRef(false);
	  const [selectedChatId, setSelectedChatId] = useState<string | null>(
	    activeConversationId ?? null
	  );
	  const prevActiveConversationIdRef = useRef<string | null>(activeConversationId);

	  useEffect(() => {
	    const stored = readModelSelectionFromStorage();
	    if (stored) {
	      setCurrentModel(stored);
	    }
	    hasLoadedModelSelectionRef.current = true;
	  }, []);

    // Ensure the Supabase attachments bucket is readable so image/file attachments render.
    useEffect(() => {
      if (typeof window === "undefined") return;
      void fetch("/api/storage/ensure-bucket", { method: "POST" }).catch(() => {});
    }, []);

	  useEffect(() => {
	    if (!hasLoadedModelSelectionRef.current) return;
	    persistModelSelection(currentModel);
	  }, [currentModel]);

  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'preferences' | 'data' | 'account'>('preferences');
  const [usageLimitModal, setUsageLimitModal] = useState<{
    isOpen: boolean;
    currentSpending: number;
    limit: number;
    planType: string;
  }>({ isOpen: false, currentSpending: 0, limit: 0, planType: 'free' });
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const alignNextUserMessageToTopRef = useRef<string | null>(null);
  const [bottomSpacerPx, setBottomSpacerPx] = useState(baseBottomSpacerPx);
  const [composerLiftPx, setComposerLiftPx] = useState(0);
  const [showOtherModels, setShowOtherModels] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [contextUsageByChat, setContextUsageByChat] = useState<Record<string, ContextUsageSnapshot>>({});
  const [contextModeGlobal, setContextModeGlobal] = useState<"advanced" | "simple">(loadInitialContextModeGlobal);
  const [contextModeByChat, setContextModeByChat] = useState<Record<string, "advanced" | "simple">>(
    loadInitialContextModeByChat
  );
  const [simpleExternalChatSelectionByChat, setSimpleExternalChatSelectionByChat] = useState<
    Record<string, string[] | null>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(SIMPLE_CONTEXT_EXTERNAL_CHAT_SELECTION_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const next: Record<string, string[] | null> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!key || typeof key !== "string") continue;
        if (value === null) {
          next[key] = null;
          continue;
        }
        if (Array.isArray(value)) {
          next[key] = value.filter((x) => typeof x === "string");
        }
      }
      return next;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SIMPLE_CONTEXT_EXTERNAL_CHAT_SELECTION_KEY,
        JSON.stringify(simpleExternalChatSelectionByChat)
      );
    } catch {
      // Ignore persistence failures
    }
  }, [simpleExternalChatSelectionByChat]);

  const [advancedTopicSelectionByChat, setAdvancedTopicSelectionByChat] = useState<
    Record<string, string[] | null>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(ADVANCED_CONTEXT_TOPIC_SELECTION_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const next: Record<string, string[] | null> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!key || typeof key !== "string") continue;
        if (value === null) {
          next[key] = null;
          continue;
        }
        if (Array.isArray(value)) {
          next[key] = value.filter((x) => typeof x === "string");
        }
      }
      return next;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        ADVANCED_CONTEXT_TOPIC_SELECTION_KEY,
        JSON.stringify(advancedTopicSelectionByChat)
      );
    } catch {
      // Ignore persistence failures
    }
  }, [advancedTopicSelectionByChat]);

	  const computeRecentExternalChatIds = useCallback(
	    (excludeChatId: string | null) => {
      const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return (chats ?? [])
        .filter((chat) => {
          if (!chat?.id) return false;
          if (excludeChatId && chat.id === excludeChatId) return false;
          const ts = new Date(chat.timestamp).getTime();
          return Number.isFinite(ts) && ts >= cutoffMs;
        })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .map((chat) => chat.id);
    },
	    [chats]
	  );

	  // Default for each chat: freeze context mode to current global when first opened.
	  useEffect(() => {
	    if (!selectedChatId) return;
	    setContextModeByChat((prev) => {
	      if (Object.prototype.hasOwnProperty.call(prev, selectedChatId)) return prev;
	      return { ...prev, [selectedChatId]: contextModeGlobal };
	    });
	  }, [contextModeGlobal, selectedChatId]);

	  // Default for each chat: select all recent chats (last 7 days).
	  useEffect(() => {
	    if (!selectedChatId) return;
	    setSimpleExternalChatSelectionByChat((prev) => {
	      if (Object.prototype.hasOwnProperty.call(prev, selectedChatId)) return prev;
      return { ...prev, [selectedChatId]: computeRecentExternalChatIds(selectedChatId) };
    });
  }, [computeRecentExternalChatIds, selectedChatId]);

  const simpleExternalChatIdsForActiveChat = useMemo(() => {
    if (!selectedChatId) return null;
    const value = simpleExternalChatSelectionByChat[selectedChatId];
    return typeof value === "undefined" ? computeRecentExternalChatIds(selectedChatId) : value;
  }, [computeRecentExternalChatIds, selectedChatId, simpleExternalChatSelectionByChat]);

  const setSimpleExternalChatIdsForActiveChat = useCallback(
    (next: React.SetStateAction<string[] | null>) => {
      if (!selectedChatId) return;
      setSimpleExternalChatSelectionByChat((prev) => {
        const current =
          typeof prev[selectedChatId] === "undefined"
            ? computeRecentExternalChatIds(selectedChatId)
            : prev[selectedChatId];
        const resolved = typeof next === "function" ? (next as any)(current) : next;
        return { ...prev, [selectedChatId]: resolved };
      });
    },
    [computeRecentExternalChatIds, selectedChatId]
  );

  const getSimpleContextExternalChatIdsForChat = useCallback(
    (chatId: string | null): string[] | undefined => {
      if (!chatId) return undefined;
      const selection = simpleExternalChatSelectionByChat[chatId];
      if (selection === null) return undefined; // auto selection
      if (Array.isArray(selection)) return selection;
      return computeRecentExternalChatIds(chatId);
    },
    [computeRecentExternalChatIds, simpleExternalChatSelectionByChat]
  );

  const getAdvancedContextTopicIdsForChat = useCallback(
    (chatId: string | null): string[] | undefined => {
      if (!chatId) return undefined;
      const selection = advancedTopicSelectionByChat[chatId];
      if (selection === null) return undefined; // auto selection
      if (Array.isArray(selection) && selection.length > 0) return selection;
      return undefined;
    },
    [advancedTopicSelectionByChat]
  );
  const [messagesWithFirstToken, setMessagesWithFirstToken] = useState<Set<string>>(new Set());
  const [thinkingStatus, setThinkingStatus] = useState<{ variant: "thinking" | "extended"; label: string } | null>(null);
  // Force re-render while thinking so a live duration chip can update
  const [, setThinkingTick] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const createInsightAnimationScopeId = useCallback(
    (conversationId: string | null) =>
      `${conversationId ?? "__no_conversation__"}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    []
  );
  const [insightAnimationScopeId, setInsightAnimationScopeId] = useState(() =>
    createInsightAnimationScopeId(activeConversationId ?? null)
  );
  const prevInsightConversationIdRef = useRef<string | null>(activeConversationId ?? null);
  const [searchIndicator, setSearchIndicator] = useState<
    SearchIndicatorState
  >(null);
  const searchDomainListRef = useRef<string[]>([]);
  const searchDomainSetRef = useRef(new Set<string>());
  const [fileReadingIndicator, setFileReadingIndicator] = useState<"running" | "error" | null>(null);
  const [activeIndicatorMessageId, setActiveIndicatorMessageId] = useState<string | null>(null);
  const [reserveRuntimeIndicatorSpace, setReserveRuntimeIndicatorSpace] = useState(false);
  const [isInsightSidebarOpen, setIsInsightSidebarOpen] = useState(false);
  const [insightPreambles, setInsightPreambles] = useState<Record<string, string>>({});
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const pinToPromptRef = useRef(false);
  const pinnedMessageIdRef = useRef<string | null>(null);
  const pinnedScrollTopRef = useRef<number | null>(null);
  const conversationRenderKeyRef = useRef<string | null>(null);
  const animatedMessageIdsRef = useRef<Set<string>>(new Set());
  const lastCreatedConversationIdRef = useRef<string | null>(null);
  const autoStreamedConversations = useRef<Set<string>>(new Set());
  const streamModelResponseRef = useRef<typeof streamModelResponse | null>(null);
  // Track the last OpenAI response id per chat so guest mode can pass previous_response_id
  const guestResponseIdsRef = useRef<Record<string, string | undefined>>({});
  const inFlightRequests = useRef<Set<string>>(new Set());
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const lastTokenAtRef = useRef<number>(0);
  const activeStreamStateRef = useRef<{
    conversationId: string;
    chatId: string;
    placeholderMessageId: string;
    minContentLength: number;
  } | null>(null);
  const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const responseTimingRef = useRef({
    start: null as number | null,
    firstToken: null as number | null,
    assistantMessageId: null as string | null,
  });
  const pendingThinkingInfoRef = useRef<ThinkingTimingInfo | null>(null);
  const conversationUiStateRef = useRef<
    Record<
      string,
      {
        isStreaming: boolean;
        thinkingStatus: { variant: "thinking" | "extended"; label: string } | null;
        searchIndicator: SearchIndicatorState;
        fileReadingIndicator: "running" | "error" | null;
        activeIndicatorMessageId: string | null;
        responseTiming: { start: number | null; firstToken: number | null; assistantMessageId: string | null };
        pendingThinking: ThinkingTimingInfo | null;
      }
    >
  >({});
  const searchIndicatorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fileIndicatorTimerRef = useRef<NodeJS.Timeout | null>(null);

  const openInsightSidebar = useCallback(() => setIsInsightSidebarOpen(true), []);
  const closeInsightSidebar = useCallback(() => setIsInsightSidebarOpen(false), []);
  const appendPreambleDelta = useCallback(
    (messageId: string, delta: string) => {
      if (!delta) return;
      setInsightPreambles((prev) => {
        const current = prev[messageId] || "";
        return { ...prev, [messageId]: current + delta };
      });
      setIsInsightSidebarOpen(true);
    },
    []
  );
  const hasSessionAutoStream = useCallback((conversationId: string) => {
    return (
      typeof window !== "undefined" &&
      sessionStorage.getItem(getAutoStreamKey(conversationId)) === "1"
    );
  }, []);

  const clearConversationAutoStreamed = useCallback((conversationId: string) => {
    autoStreamedConversations.current.delete(conversationId);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(getAutoStreamKey(conversationId));
    }
  }, []);

  const currentConversationKey = activeConversationId ?? "__no_conversation__";
  const conversationChanged = conversationRenderKeyRef.current !== currentConversationKey;
  let allowAssistantHistoryAnimation = false;
  if (conversationChanged) {
    animatedMessageIdsRef.current.clear();
    const lastCreatedId = lastCreatedConversationIdRef.current;
    if (currentConversationKey && currentConversationKey !== "__no_conversation__") {
      if (lastCreatedId && currentConversationKey === lastCreatedId) {
        // Suppress animations for the initial navigation into a brand-new chat
        lastCreatedConversationIdRef.current = null;
      } else {
        allowAssistantHistoryAnimation = true;
        lastCreatedConversationIdRef.current = null;
      }
    }
  }
  conversationRenderKeyRef.current = currentConversationKey;
  const effectiveChatId = activeConversationId ?? selectedChatId;
  const currentContextUsage =
    (effectiveChatId ? contextUsageByChat[effectiveChatId] : null) ?? {
      percent: 0,
      limit: DEFAULT_CONTEXT_WINDOW_TOKENS,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    };
  const currentContextMode =
    (effectiveChatId && contextModeByChat[effectiveChatId]) || contextModeGlobal;
	  const useSimpleContext = currentContextMode === "simple";
	  const advancedTopicIdsForActiveChat =
	    (effectiveChatId ? advancedTopicSelectionByChat[effectiveChatId] : null) ?? null;
	  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(CONTEXT_USAGE_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setContextUsageByChat((prev) => ({
          ...parsed,
          ...prev,
        }));
      }
    } catch (error) {
      console.error("Failed to load context usage cache", error);
    }
  }, []);

  // Load global context mode preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;
    try {
      const raw = window.localStorage.getItem("context-mode-global");
      if (raw === "simple" || raw === "advanced") {
        setContextModeGlobal(raw);
      }
    } catch (err) {
      console.error("Failed to load context mode preference", err);
    }

    if (!isGuest) {
      getContextModeGlobalPreference()
        .then((mode) => {
          if (!alive) return;
          setContextModeGlobal(mode);
          try {
            window.localStorage.setItem("context-mode-global", mode);
          } catch {
            // ignore
          }
        })
        .catch(() => {});
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail === "simple" || detail === "advanced") {
        setContextModeGlobal(detail);
      }
    };
    window.addEventListener("contextModeGlobalChange", handler as EventListener);
    return () => {
      alive = false;
      window.removeEventListener("contextModeGlobalChange", handler as EventListener);
    };
  }, [isGuest]);

  // Load per-chat context modes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(CONTEXT_MODE_BY_CHAT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setContextModeByChat(parsed as Record<string, "advanced" | "simple">);
        }
      }
    } catch (err) {
      console.error("Failed to load per-chat context modes", err);
    }
  }, []);

  // Persist per-chat context modes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const hasEntries = Object.keys(contextModeByChat).length > 0;
      if (!hasEntries) {
        window.localStorage.removeItem(CONTEXT_MODE_BY_CHAT_KEY);
        return;
      }
      window.localStorage.setItem(CONTEXT_MODE_BY_CHAT_KEY, JSON.stringify(contextModeByChat));
    } catch (err) {
      console.error("Failed to persist per-chat context modes", err);
    }
  }, [contextModeByChat]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const hasEntries = Object.keys(contextUsageByChat).length > 0;
      if (!hasEntries) {
        window.localStorage.removeItem(CONTEXT_USAGE_STORAGE_KEY);
        return;
      }

      window.localStorage.setItem(
        CONTEXT_USAGE_STORAGE_KEY,
        JSON.stringify(contextUsageByChat)
      );
    } catch (error) {
      console.error("Failed to persist context usage cache", error);
    }
  }, [contextUsageByChat]);

  useEffect(() => {
    setMessagesWithFirstToken(new Set());
  }, [activeConversationId]);

  // Reset insight chip "pop" animations each time a chat is opened.
  useEffect(() => {
    const nextConversationId = activeConversationId ?? null;
    if (prevInsightConversationIdRef.current === nextConversationId) return;
    prevInsightConversationIdRef.current = nextConversationId;
    setInsightAnimationScopeId(createInsightAnimationScopeId(nextConversationId));
  }, [activeConversationId, createInsightAnimationScopeId]);

  // If the current chat/project disappears, redirect to a safe route.
  useEffect(() => {
    if (!pathname) return;
    const segments = pathname.split("/").filter(Boolean);
    const pathProjectId = segments[0] === "projects" ? segments[1] : null;
    const chatIdInPath =
      segments[0] === "projects" && segments[2] === "c"
        ? segments[3]
        : segments[0] === "c"
          ? segments[1]
          : null;

    // Handle deleted project
    if (pathProjectId && !projects.find((p) => p.id === pathProjectId)) {
      setSelectedProjectId("");
      router.push("/projects");
      return;
    }

    // Handle deleted chat
    if (selectedChatId && !chats.find((c) => c.id === selectedChatId)) {
      setSelectedChatId(null);
      if (chatIdInPath === selectedChatId) {
        if (pathProjectId) {
          router.push(`/projects/${pathProjectId}`);
        } else {
          router.push("/");
        }
      }
    }
  }, [pathname, projects, chats, selectedChatId, router]);

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

  const showThinkingIndicator = useCallback(() => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setThinkingStatus({ variant: "thinking", label: "Thinking" });
  }, []);

  const promoteThinkingIndicator = useCallback((effort?: ReasoningEffort | null) => {
    if (effort !== "medium" && effort !== "high") return;
    if (responseTimingRef.current.firstToken !== null) return;
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setThinkingStatus({ variant: "extended", label: "Thinking for longer" });
  }, []);

  const startResponseTiming = useCallback(() => {
    // Clear timers without hiding the current thinking indicator so it can show immediately.
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    responseTimingRef.current = {
      start: typeof performance !== "undefined" ? performance.now() : Date.now(),
      firstToken: null,
      assistantMessageId: null,
    };
    pendingThinkingInfoRef.current = null;
    setThinkingStatus((prev) => prev ?? { variant: "thinking", label: "Thinking" });
  }, []);

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
      setMessagesWithFirstToken((prev) => {
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });
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

  const clearAnalyzingIndicator = useCallback(() => {
    setIsAnalyzing(false);
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
        case "code-interpreter-start":
          setIsAnalyzing(true);
          break;
        case "code-interpreter-complete":
          setIsAnalyzing(false);
          break;
        case "code-interpreter-error":
          setIsAnalyzing(false);
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
      !thinkingStatus &&
      !isAnalyzing
    ) {
      setActiveIndicatorMessageId(null);
    }
  }, [activeIndicatorMessageId, searchIndicator, fileReadingIndicator, thinkingStatus, isAnalyzing]);

  useEffect(() => {
    const previousKey = prevActiveConversationIdRef.current ?? "__no_conversation__";
    conversationUiStateRef.current[previousKey] = {
      isStreaming,
      thinkingStatus,
      searchIndicator,
      fileReadingIndicator,
      activeIndicatorMessageId,
      responseTiming: { ...responseTimingRef.current },
      pendingThinking: pendingThinkingInfoRef.current,
    };

    // If we're not switching conversations (e.g., tab visibility change causing re-render),
    // avoid resetting the selected chat id back to null when streaming state changes.
    if (prevActiveConversationIdRef.current === activeConversationId) {
      return;
    }

    setSelectedChatId(activeConversationId ?? null);
    const key = activeConversationId ?? "__no_conversation__";
    const saved = conversationUiStateRef.current[key];

    if (saved) {
      setIsStreaming(saved.isStreaming);
      setThinkingStatus(saved.thinkingStatus);
      setSearchIndicator(saved.searchIndicator);
      setFileReadingIndicator(saved.fileReadingIndicator);
      setActiveIndicatorMessageId(saved.activeIndicatorMessageId);
      responseTimingRef.current = { ...saved.responseTiming };
      pendingThinkingInfoRef.current = saved.pendingThinking;
    } else {
      setIsStreaming(false);
      hideThinkingIndicator();
      setSearchIndicator(null);
      setFileReadingIndicator(null);
      setActiveIndicatorMessageId(null);
      responseTimingRef.current = { start: null, firstToken: null, assistantMessageId: null };
      pendingThinkingInfoRef.current = null;
      // Reset guest response chain when switching to a chat we haven't seen
      if (activeConversationId) {
        guestResponseIdsRef.current[activeConversationId] = undefined;
      }
    }
    prevActiveConversationIdRef.current = activeConversationId ?? null;
  }, [
    activeConversationId,
    hideThinkingIndicator,
    isStreaming,
    thinkingStatus,
    searchIndicator,
    fileReadingIndicator,
    activeIndicatorMessageId,
  ]);

  useEffect(() => {
    const key = selectedChatId ?? "__no_conversation__";
    conversationUiStateRef.current[key] = {
      isStreaming,
      thinkingStatus,
      searchIndicator,
      fileReadingIndicator,
      activeIndicatorMessageId,
      responseTiming: { ...responseTimingRef.current },
      pendingThinking: pendingThinkingInfoRef.current,
    };
  }, [
    selectedChatId,
    isStreaming,
    thinkingStatus,
    searchIndicator,
    fileReadingIndicator,
    activeIndicatorMessageId,
  ]);

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
  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const candidate = messages[i];
      if (candidate?.role === "user") return candidate.id;
    }
    return null;
  }, [messages]);

  const getEffectiveScrollBottom = useCallback(
    (viewport: HTMLDivElement) => {
      const extraSpacer = Math.max(0, bottomSpacerPx - baseBottomSpacerPx);
      return Math.max(0, viewport.scrollHeight - extraSpacer);
    },
    [baseBottomSpacerPx, bottomSpacerPx]
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const viewport = scrollViewportRef.current;
      if (!viewport) return;

      const bottom = getEffectiveScrollBottom(viewport);
      const targetTop = Math.max(0, bottom - viewport.clientHeight);
      viewport.scrollTo({ top: targetTop, behavior });
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() =>
          viewport.scrollTo({ top: targetTop, behavior: "auto" })
        );
      }
    },
    [getEffectiveScrollBottom]
  );

  const computeRequiredSpacerForMessage = useCallback(
    (messageId: string) => {
      const viewport = scrollViewportRef.current;
      const el = messageRefs.current[messageId];
      if (!viewport || !el) return null;

      const viewportRect = viewport.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const desiredPadding = 14;

      const elContentTop = viewport.scrollTop + (elRect.top - viewportRect.top);
      const requiredScrollTop = Math.max(0, Math.round(elContentTop - desiredPadding));

      // Estimate max scroll if bottom spacer were reset to base.
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

  useEffect(() => {
    const targetMessageId = alignNextUserMessageToTopRef.current;
    if (!targetMessageId) return;

    // The ref may not be mounted on the same tick as the message is appended.
    // If we bail out here, the "align prompt to top" behavior can be delayed
    // until the next unrelated state change (commonly seen on the first prompt
    // that appears under an assistant message). Retry briefly until mounted.
    let cancelled = false;
    let retryRaf: number | null = null;
    const startMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const deadlineMs = startMs + 2500;

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    let guardTimer: ReturnType<typeof setTimeout> | null = null;

    const doScroll = () => {
      if (cancelled) return;
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (nowMs > deadlineMs) return;

      const viewport = scrollViewportRef.current;
      if (!viewport) return;

      const el = messageRefs.current[targetMessageId];
      if (!el) {
        if (typeof requestAnimationFrame !== "undefined") {
          retryRaf = requestAnimationFrame(doScroll);
        }
        return;
      }

      // Ensure there's always enough scrollable "runway" below the messages to
      // bring the new user prompt up to the top immediately, even before the
      // assistant placeholder/stream has added any height. This prevents the
      // first prompt-under-assistant case from waiting until the response ends.
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

      // If there's not enough scrollable space to bring this message to the top,
      // expand the bottom spacer so we can scroll further without affecting the
      // composer (which is outside the ScrollArea viewport).
      if (targetTop > maxScrollTop) {
        const desiredSpacer = computeRequiredSpacerForMessage(targetMessageId);
        if (typeof desiredSpacer === "number") {
          setBottomSpacerPx((prev) => Math.max(prev, desiredSpacer));
        }
        if (typeof requestAnimationFrame !== "undefined") {
          requestAnimationFrame(doScroll);
        }
        return;
      }

      // Ensure programmatic scrolling doesn't toggle autoscroll state.
      isProgrammaticScrollRef.current = true;
      pinnedScrollTopRef.current = targetTop;
      // Keep autoscroll disabled after pinning so streaming doesn't pull us away.
      setIsAutoScroll(false);
      {
        const effectiveBottom = getEffectiveScrollBottom(viewport);
        const distanceFromBottom = effectiveBottom - (targetTop + viewport.clientHeight);
        const tolerance = Math.max(12, bottomSpacerPx / 3);
        setShowScrollToBottom(!(distanceFromBottom <= tolerance));
      }
      alignNextUserMessageToTopRef.current = null;

      // Let the new message render in place first, then smoothly scroll it to the top.
      scrollTimer = setTimeout(() => {
        viewport.scrollTo({ top: targetTop, behavior: "smooth" });
      }, 80);

      // Keep the programmatic scroll guard up long enough to ignore scroll events
      // fired during the smooth scroll animation.
      guardTimer = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        // Once the "prompt to top" animation finishes, stop pinning/clamping scroll.
        // The initial alignment is intentional, but after that the user should be
        // able to scroll normally even while the model is streaming.
        pinToPromptRef.current = false;
        pinnedScrollTopRef.current = null;
      }, 900);
    };

    // Double-RAF to ensure the viewport + message layout is settled.
    requestAnimationFrame(() => requestAnimationFrame(doScroll));

    return () => {
      cancelled = true;
      if (retryRaf && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(retryRaf);
      }
      if (scrollTimer) clearTimeout(scrollTimer);
      if (guardTimer) clearTimeout(guardTimer);
      isProgrammaticScrollRef.current = false;
    };
  }, [messages.length, bottomSpacerPx]);

  const recomputeScrollFlags = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const { scrollTop, clientHeight } = viewport;
    const effectiveBottom = getEffectiveScrollBottom(viewport);
    const distanceFromBottom = effectiveBottom - (scrollTop + clientHeight);
    const tolerance = Math.max(12, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;
    setShowScrollToBottom(!atBottom);
  }, [bottomSpacerPx, getEffectiveScrollBottom]);

  // Dynamically size the bottom spacer to provide room below messages
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    const compute = () => {
      if (!viewport) return;
      setBottomSpacerPx((prev) => Math.max(baseBottomSpacerPx, prev));
    };
    compute();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", compute);
      return () => window.removeEventListener("resize", compute);
    }
  }, [baseBottomSpacerPx, messages.length]);

  // Lock body scroll when mobile sidebar is open so only sidebar scrolls
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.innerWidth < 1024;
    if (!isMobile || !isSidebarOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isSidebarOpen]);

  // Track keyboard height (visualViewport) to smoothly lift composer with the on-screen keyboard
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const update = () => {
      const vv = window.visualViewport!;
      const delta = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Ignore tiny changes; reset when keyboard is gone
      setComposerLiftPx(delta > 6 ? delta : 0);
    };
    update();
    window.visualViewport.addEventListener("resize", update);
    window.visualViewport.addEventListener("scroll", update);
    // Fallback: when focus leaves inputs, drop the composer after the keyboard hides
    const handleFocusOut = () => {
      setTimeout(() => {
        update();
      }, 200);
    };
    window.addEventListener("focusout", handleFocusOut);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

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
    if (pinToPromptRef.current) return;
    
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    
    // Use requestAnimationFrame to ensure DOM is fully rendered before scrolling
    // Double-RAF for better reliability with dynamic content
    const scrollToEnd = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (viewport) {
            const bottom = getEffectiveScrollBottom(viewport);
            const targetTop = Math.max(0, bottom - viewport.clientHeight);
            viewport.scrollTo({ top: targetTop, behavior: "auto" });
          }
        });
      });
    };
    
    scrollToEnd();
  }, [messages, isAutoScroll, isStreaming, getEffectiveScrollBottom]);

  useEffect(() => {
    if (pinToPromptRef.current) return;
    setIsAutoScroll(true);
    setShowScrollToBottom(false);
    scrollToBottom("auto");
  }, [selectedChatId, scrollToBottom]);

  useEffect(() => {
    if (pinToPromptRef.current) return;
    pinnedScrollTopRef.current = null;

    // Shrink any extra spacer once we have enough content below the pinned prompt.
    if (runtimeIndicatorBubble) return;
    const pinnedId = pinnedMessageIdRef.current;
    if (!pinnedId) return;

    const desiredSpacer = computeRequiredSpacerForMessage(pinnedId);
    if (typeof desiredSpacer !== "number") return;

    const nextSpacer = Math.max(baseBottomSpacerPx, desiredSpacer);
    if (nextSpacer >= bottomSpacerPx) return;

    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    // If we're currently "down in the spacer", shrinking would cause the browser to clamp
    // scrollTop, which can feel like a jump. Prefer shrinking anyway (to avoid huge empty
    // scroll areas) and manually clamp to the new max in a controlled way.
    const contentWithoutSpacer = viewport.scrollHeight - bottomSpacerPx;
    const nextMaxScrollTop = Math.max(0, contentWithoutSpacer + nextSpacer - viewport.clientHeight);
    const shouldClampScrollTop = viewport.scrollTop > nextMaxScrollTop + 1;

    setBottomSpacerPx(nextSpacer);
    if (shouldClampScrollTop && typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => {
        const v = scrollViewportRef.current;
        if (!v) return;
        const maxTop = Math.max(0, v.scrollHeight - v.clientHeight);
        if (v.scrollTop > maxTop) v.scrollTop = maxTop;
      });
    }

    if (nextSpacer === baseBottomSpacerPx) {
      pinnedMessageIdRef.current = null;
    }
  }, [messages.length, bottomSpacerPx, baseBottomSpacerPx, computeRequiredSpacerForMessage]);

  useEffect(() => {
    if (currentChat?.projectId) {
      setSelectedProjectId(currentChat.projectId);
    } else if (selectedChatId) {
      setSelectedProjectId("");
    }
  }, [currentChat, selectedChatId]);

  // Seed preambles from loaded messages (including persisted preambles)
  useEffect(() => {
    const next: Record<string, string> = {};
    messages.forEach((m) => {
      const meta = m.metadata as any;
      if (meta?.preamble && typeof meta.preamble === "string") {
        next[m.id] = meta.preamble;
      }
      if ((m as any).preamble && typeof (m as any).preamble === "string") {
        next[m.id] = (m as any).preamble as string;
      }
    });
    setInsightPreambles(next);
  }, [messages, selectedChatId]);

  type UploadedFragment = { id: string; name: string; dataUrl?: string; url?: string; mime?: string };

  const streamGuestResponse = async (
    assistantId: string,
    chatId: string,
    userMessage: string,
    history: { role: "user" | "assistant"; content: string }[]
  ) => {
    setIsStreaming(true);
    setActiveIndicatorMessageId(assistantId);
    responseTimingRef.current.assistantMessageId = assistantId;
    const {
      modelFamily: guestModelFamily,
      speedMode: guestSpeedMode,
      reasoningEffort: guestReasoningEffort,
    } = getModelSettingsFromDisplayName(currentModel);
    const guestPreviewFamily: ModelFamily =
      currentModel === "Auto" ? "gpt-5-mini" : guestModelFamily;
    const guestPreviewConfig = getModelAndReasoningConfig(
      guestPreviewFamily,
      guestSpeedMode,
      userMessage,
      guestReasoningEffort
    );
    startResponseTiming();
    showThinkingIndicator();
    promoteThinkingIndicator(guestPreviewConfig.reasoning?.effort ?? guestReasoningEffort);
    try {
      const response = await fetch("/api/guest-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          model: currentModel,
          previousResponseId: guestResponseIdsRef.current[chatId],
          history,
        }),
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
        let ndjsonBuffer = "";
	      while (true) {
	        const { done, value } = await reader.read();
	        if (done) break;
	        ndjsonBuffer += decoder.decode(value, { stream: true });
          while (true) {
            const newlineIndex = ndjsonBuffer.indexOf("\n");
            if (newlineIndex === -1) break;
            const line = ndjsonBuffer.slice(0, newlineIndex);
            ndjsonBuffer = ndjsonBuffer.slice(newlineIndex + 1);
            if (!line.trim()) continue;
	          try {
	            const parsed = JSON.parse(line);
	            if (parsed.response_id) {
	              guestResponseIdsRef.current[chatId] = parsed.response_id as string;
	            }
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
      metadata: attachments && attachments.length
        ? {
            files: attachments.map(a => ({
              name: a.name,
              mimeType: a.mime,
              url: a.url,
            })),
          }
        : undefined,
    };

    // Align the newly-sent user message to the top of the viewport (instead of
    // always jumping to the bottom). Also disable streaming auto-scroll so the
    // alignment isn't immediately overwritten.
    setIsAutoScroll(false);
    setReserveRuntimeIndicatorSpace(true);
    showThinkingIndicator();
    pinToPromptRef.current = true;
    pinnedMessageIdRef.current = userMessage.id;
    pinnedScrollTopRef.current = null;
    alignNextUserMessageToTopRef.current = userMessage.id;

    if (isGuest) {
      // Local-only guest chat; not persisted.
      let chatId = selectedChatId;
      // Build full history including the new user message for model context.
      const existingMessages = chats.find((c) => c.id === selectedChatId)?.messages ?? [];
      const historyForModel = [...existingMessages, userMessage]
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }))
        .filter((m) => m.content && m.content.trim().length > 0);
      if (!chatId) {
        chatId = createChat({
          id: `guest-${Date.now()}`,
          initialMessages: [userMessage],
          title: "Guest chat",
        });
        guestResponseIdsRef.current[chatId] = undefined;
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
      await streamGuestResponse(assistantId, chatId, message, historyForModel);
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
            attachments,
          });
        saveAutoStreamPrefs(
          conversationId,
          isImageMode ? { generationMode: "image", imageModel: currentImageModel } : null
        );

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
                    url: a.url,
                  })),
                }
              : undefined,
        };

        pinnedMessageIdRef.current = mappedMessage.id;
        pinnedScrollTopRef.current = null;
        alignNextUserMessageToTopRef.current = mappedMessage.id;

        const newChatId = createChat({
          id: conversationId,
          projectId: targetProjectId,
          initialMessages: [mappedMessage],
          title: conversation.title ?? "New chat",
        });
        setSelectedChatId(newChatId);
        setSelectedProjectId(targetProjectId);
        lastCreatedConversationIdRef.current = conversationId;

        // Trigger auto-naming immediately (in parallel with navigation/stream)
        triggerAutoNaming(conversationId, message, conversation.title ?? undefined);

        // Navigate immediately so the new chat page shows thinking/streaming
        const targetUrl = `/projects/${targetProjectId}/c/${newChatId}`;
        if (typeof window !== "undefined" && !window.location.pathname.includes(`/c/${newChatId}`)) {
          persistModelSelection(currentModel);
          void navigateWithMainPanelFade(router, targetUrl);
        }
      } else {
        const { conversationId, message: createdMessage, conversation } =
          await startGlobalConversationAction(message, attachments);
        saveAutoStreamPrefs(
          conversationId,
          isImageMode ? { generationMode: "image", imageModel: currentImageModel } : null
        );

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
                    url: a.url,
                  })),
                }
              : undefined,
        };

        pinnedMessageIdRef.current = mappedMessage.id;
        pinnedScrollTopRef.current = null;
        alignNextUserMessageToTopRef.current = mappedMessage.id;

        const newChatId = createChat({
          id: conversationId,
          initialMessages: [mappedMessage],
          title: conversation.title ?? "New chat",
        });
        setSelectedChatId(newChatId);
        setSelectedProjectId("");
        lastCreatedConversationIdRef.current = conversationId;

        // Trigger auto-naming immediately (in parallel with navigation/stream)
        triggerAutoNaming(conversationId, message, conversation.title ?? undefined);

        // Navigate immediately so the new chat page shows thinking/streaming
        if (typeof window !== "undefined" && !window.location.pathname.includes(`/c/${newChatId}`)) {
          persistModelSelection(currentModel);
          void navigateWithMainPanelFade(router, `/c/${newChatId}`);
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

  const finalizeStreamingState = useCallback(
    () => {
      setIsStreaming(false);
      hideThinkingIndicator();
      clearAnalyzingIndicator();
      setActiveIndicatorMessageId(null);
      setReserveRuntimeIndicatorSpace(false);
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem(STREAMING_ACTIVE_STORAGE_KEY);
          window.sessionStorage.removeItem(STREAMING_CHAT_ID_STORAGE_KEY);
        } catch {}
      }
      // Clear timing/pending data to avoid stale chips or stuck UI
      responseTimingRef.current = { start: null, firstToken: null, assistantMessageId: null };
      pendingThinkingInfoRef.current = null;
      clearSearchIndicator();
      clearFileReadingIndicator();
    },
    [clearAnalyzingIndicator, clearFileReadingIndicator, clearSearchIndicator, hideThinkingIndicator]
  );

  const recoverInterruptedStream = useCallback(
    async (options: {
      conversationId: string;
      chatId: string;
      placeholderMessageId: string;
      minContentLength: number;
    }) => {
      const { conversationId, chatId, placeholderMessageId, minContentLength } = options;

      // Keep the "wave" alive while recovering.
      setIsStreaming(true);
      setReserveRuntimeIndicatorSpace(true);
      setThinkingStatus({ variant: "thinking", label: "Reconnecting" });
      setActiveIndicatorMessageId(placeholderMessageId);

      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          const { data } = await supabaseBrowserClient
            .from("messages")
            .select("id, role, content, created_at, metadata, preamble, openai_response_id")
            .eq("conversation_id", conversationId)
            .eq("role", "assistant")
            .order("created_at", { ascending: false })
            .limit(3);

          const rows = Array.isArray(data) ? (data as any[]) : [];
          const best = rows.find((m) => typeof m?.id === "string" && m.id.trim()) ?? null;
          if (best) {
            const text = typeof best.content === "string" ? best.content : "";
            const hasFinalId = typeof best.openai_response_id === "string" && best.openai_response_id.trim().length > 0;
            if (hasFinalId || text.length >= minContentLength) {
              const metadata = (best.metadata && typeof best.metadata === "object") ? (best.metadata as any) : null;
              const updates: any = {
                id: best.id,
                content: text,
                timestamp: best.created_at ?? new Date().toISOString(),
                metadata,
                preamble: typeof best.preamble === "string" ? best.preamble : null,
              };

              const currentChat = chats.find((c) => c.id === chatId);
              const hasPlaceholder = Boolean(currentChat?.messages?.some((m) => m.id === placeholderMessageId));
              const hasPersisted = Boolean(currentChat?.messages?.some((m) => m.id === best.id));

              if (hasPlaceholder) {
                updateMessage(chatId, placeholderMessageId, updates);
              } else if (hasPersisted) {
                updateMessage(chatId, best.id, updates);
              } else {
                appendMessages(chatId, [
                  {
                    id: best.id,
                    role: "assistant",
                    content: text,
                    timestamp: best.created_at ?? new Date().toISOString(),
                    metadata,
                    preamble: typeof best.preamble === "string" ? best.preamble : null,
                  },
                ]);
              }
              finalizeStreamingState();
              return;
            }
          }
        } catch {
          // swallow and retry
        }
        await delay(650);
      }

      finalizeStreamingState();
    },
    [appendMessages, chats, finalizeStreamingState, updateMessage]
  );

  const streamModelResponse = useCallback(async (
    conversationId: string,
    projectId: string | undefined,
    message: string,
    chatId: string,
    skipUserInsert: boolean = false,
    attachments?: UploadedFragment[],
    generationOverride?: AutoStreamPrefs
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
	    if (typeof window !== "undefined") {
	      try {
	        window.sessionStorage.setItem(STREAMING_ACTIVE_STORAGE_KEY, "1");
	        window.sessionStorage.setItem(STREAMING_CHAT_ID_STORAGE_KEY, chatId);
	      } catch {}
	    }

    console.log("[chatDebug] streamModelResponse start", { conversationId, chatId, skipUserInsert, shortMessage: message.slice(0,40) });

    const assistantMessageId = `assistant-streaming-${Date.now()}`;
    let currentAssistantMessageId = assistantMessageId;
    let sawToken = false;
    let sawDone = false;
    let sawMeta = false;
    let interrupted = false;
    let assistantContent = "";
    let messageMetadata: AssistantMessageMetadata | null = {};
    activeStreamStateRef.current = {
      conversationId,
      chatId,
      placeholderMessageId: assistantMessageId,
      minContentLength: 0,
    };

    try {
      // Create the placeholder assistant message immediately so the pre-stream shimmer shows with no network delay.
      setActiveIndicatorMessageId(assistantMessageId);
      appendMessages(chatId, [
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
        },
      ]);
      responseTimingRef.current.assistantMessageId = assistantMessageId;

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
      startResponseTiming();
      showThinkingIndicator();
      promoteThinkingIndicator(previewModelConfig.reasoning?.effort ?? reasoningEffortOverride);
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
            timezone: parsed.timezone || (typeof Intl !== "undefined"
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : null),
          };
        }
      } catch (e) {
        console.error("[Location] Failed to parse location data:", e);
      }

      const timezone =
        locationData?.timezone ||
        (typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : null);

      const effectiveMode = generationOverride?.generationMode ?? (isImageMode ? "image" : "chat");
      const effectiveImageModel = generationOverride?.imageModel ?? currentImageModel;

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            projectId,
            message,
            generationMode: effectiveMode,
            imageModel: effectiveMode === "image" ? effectiveImageModel : undefined,
            modelFamilyOverride: modelFamily,
            speedModeOverride: speedMode,
            reasoningEffortOverride: reasoningEffortOverride,
            skipUserInsert,
            attachments,
            location: locationData,
            clientNow: Date.now(),
            timezone,
            simpleContextMode: useSimpleContext,
            simpleContextExternalChatIds: useSimpleContext
              ? getSimpleContextExternalChatIdsForChat(chatId)
              : undefined,
            advancedContextTopicIds: !useSimpleContext
              ? getAdvancedContextTopicIdsForChat(chatId)
              : undefined,
          }),
          signal: controller.signal,
        });

      if (!response.ok) {
        // Stop streaming state and indicators on error
        finalizeStreamingState();

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
        // Non-429 or unparsed error: surface the error content in the chat so the user isn't stuck.
        let errorMessage = `Request failed (${response.status} ${response.statusText})`;
        try {
          const raw = await response.text();
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as any;
              const detail = parsed?.details ? `\n${String(parsed.details)}` : "";
              if (parsed?.message) errorMessage = String(parsed.message) + detail;
              else if (parsed?.error) errorMessage = String(parsed.error) + detail;
              else errorMessage = raw;
            } catch {
              errorMessage = raw;
            }
          }
        } catch {}

        const currentMessageId =
          responseTimingRef.current.assistantMessageId ?? assistantMessageId;
        updateMessage(chatId, currentMessageId, {
          content: errorMessage,
        });
        console.warn("Chat API error:", response.status, response.statusText, errorMessage);
        return;
      }

	      const reader = response.body?.getReader();
      if (!reader) {
        console.error("No response body reader");
        finalizeStreamingState();
        return;
      }

	      const decoder = new TextDecoder();
        let ndjsonBuffer = "";

	      try {
	        while (true) {
	          const { done, value } = await reader.read();
	          if (done) break;

	          ndjsonBuffer += decoder.decode(value, { stream: true });

            while (true) {
              const newlineIndex = ndjsonBuffer.indexOf("\n");
              if (newlineIndex === -1) break;
              const line = ndjsonBuffer.slice(0, newlineIndex);
              ndjsonBuffer = ndjsonBuffer.slice(newlineIndex + 1);
              if (!line.trim()) continue;
	            try {
	              const parsed = JSON.parse(line);

		              if (parsed.token) {
		                lastTokenAtRef.current = Date.now();
		                assistantContent += parsed.token;
		                sawToken = true;
                    if (activeStreamStateRef.current) {
                      activeStreamStateRef.current.minContentLength = assistantContent.length;
                    }
	                const currentMessageId =
	                  responseTimingRef.current.assistantMessageId ?? assistantMessageId;
	                messageMetadata = recordFirstTokenTiming(
	                  chatId,
                  currentMessageId,
                  messageMetadata,
                  messageMetadata?.reasoningEffort ?? null
                );
                // On first token, clear transient indicators without wiping timing
                if (responseTimingRef.current.firstToken !== null) {
                  hideThinkingIndicator();
                  clearSearchIndicator();
                  clearFileReadingIndicator();
                  clearAnalyzingIndicator();
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
              } else if (typeof parsed.preamble_delta === "string") {
                appendPreambleDelta(assistantMessageId, parsed.preamble_delta);
              } else if (typeof parsed.preamble === "string") {
                appendPreambleDelta(assistantMessageId, parsed.preamble);
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
                  if (parsed.model_info.reasoningEffort === "medium" || parsed.model_info.reasoningEffort === "high") {
                    promoteThinkingIndicator(parsed.model_info.reasoningEffort as ReasoningEffort);
                  }
                  messageMetadata = updatedMetadata;
                  updateMessage(chatId, currentMessageId, {
                    metadata: messageMetadata,
                  });
                }
		              } else if (parsed.meta) {
		                sawMeta = true;
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
                if (parsed.meta.contextUsage && chatId) {
                  const usage = parsed.meta.contextUsage as ContextUsageSnapshot;
                  if (typeof usage.percent === "number") {
                    setContextUsageByChat((prev) => ({
                      ...prev,
                      [chatId]: usage,
                    }));
                  }
                }
	                const newId = parsed.meta.assistantMessageRowId;
	                currentAssistantMessageId = newId;
                  if (activeStreamStateRef.current) {
                    activeStreamStateRef.current.placeholderMessageId = newId;
                  }
                const finalContent =
                  typeof (parsed.meta as any).finalContent === "string" ? ((parsed.meta as any).finalContent as string) : null;
                if (finalContent) {
                  assistantContent = finalContent;
                }
	                setActiveIndicatorMessageId(newId);
                // Clear thinking indicator when metadata arrives
                resetThinkingIndicator();
                // Replace the temporary ID with the persisted row ID and store metadata
                updateMessage(chatId, assistantMessageId, {
                  id: newId,
                  metadata: metadataWithTiming,
                  ...(finalContent ? { content: finalContent } : {}),
                });
	                responseTimingRef.current.assistantMessageId = newId;
                setMessagesWithFirstToken((prev) => {
                  if (!prev.has(assistantMessageId) || prev.has(newId)) return prev;
                  const next = new Set(prev);
                  next.add(newId);
                  return next;
                });
                
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
		                sawDone = true;
		                break;
		              }
		            } catch {
		              // Skip lines that aren't valid JSON
		            }
            }
	        }
          // If the stream ended without an explicit `{ done: true }` marker, treat it as interrupted.
          if (!sawDone && (sawToken || sawMeta)) {
            interrupted = true;
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
	      const likelyBackgroundInterruption =
	        typeof document !== "undefined" && document.visibilityState !== "visible";
	      interrupted =
	        !stopRequestedRef.current &&
          !sawDone &&
          (sawToken || sawMeta) &&
	        (isAbortError || likelyBackgroundInterruption || error instanceof TypeError);
	    } finally {
	      if (streamAbortControllerRef.current === controller) {
	        streamAbortControllerRef.current = null;
	      }
	      inFlightRequests.current.delete(requestKey);

	      const wasStopRequested = stopRequestedRef.current;
	      stopRequestedRef.current = false;

	      if (interrupted && !wasStopRequested) {
	        // Keep the streaming UI alive and recover from the persisted assistant message.
          const state = activeStreamStateRef.current;
          if (state) {
            void recoverInterruptedStream({
              conversationId: state.conversationId,
              chatId: state.chatId,
              placeholderMessageId: state.placeholderMessageId,
              minContentLength: Math.max(1, state.minContentLength),
            });
          } else {
            void recoverInterruptedStream({
              conversationId,
              chatId,
              placeholderMessageId: currentAssistantMessageId,
              minContentLength: Math.max(1, assistantContent.length),
            });
          }
	        return;
	      }

	      finalizeStreamingState();
        activeStreamStateRef.current = null;
	      if (!sawToken && !sawMeta) {
	        removeMessage(chatId, currentAssistantMessageId);
	      }
	    }
	  }, [
    addSearchDomain,
    appendMessages,
    clearFileReadingIndicator,
    clearSearchIndicator,
    currentImageModel,
    currentModel,
    handleStatusEvent,
    hideThinkingIndicator,
    isImageMode,
    resetThinkingIndicator,
    removeMessage,
    recordFirstTokenTiming,
	    finalizeStreamingState,
	    recoverInterruptedStream,
	    promoteThinkingIndicator,
	    showThinkingIndicator,
	    startResponseTiming,
	    updateMessage,
	  ]);

  // Keep the latest streamModelResponse without retriggering effects that shouldn't re-run on dropdown changes
  useEffect(() => {
    streamModelResponseRef.current = streamModelResponse;
  }, [streamModelResponse]);

	  const handleStopGeneration = useCallback(() => {
	    const controller = streamAbortControllerRef.current;
	    if (!controller) return;
	    stopRequestedRef.current = true;
	    controller.abort();
	    streamAbortControllerRef.current = null;
	    setIsStreaming(false);
	    if (typeof window !== "undefined") {
	      try {
	        window.sessionStorage.removeItem(STREAMING_ACTIVE_STORAGE_KEY);
	        window.sessionStorage.removeItem(STREAMING_CHAT_ID_STORAGE_KEY);
	      } catch {}
	    }
	    resetThinkingIndicator();
	    clearAnalyzingIndicator();
	  }, [clearAnalyzingIndicator, resetThinkingIndicator]);

	  useEffect(() => {
	    const onVisible = () => {
	      if (document.visibilityState !== "visible") return;
	      if (!isStreaming) return;
	      const last = lastTokenAtRef.current;
	      if (!last) return;
	      if (Date.now() - last < 8000) return;
	      // If we appear stuck after resuming, trigger a non-destructive recovery fetch.
        const state = activeStreamStateRef.current;
        if (!state) return;
        stopRequestedRef.current = false;
        void recoverInterruptedStream({
          conversationId: state.conversationId,
          chatId: state.chatId,
          placeholderMessageId: state.placeholderMessageId,
          minContentLength: Math.max(1, state.minContentLength),
        });
	    };
	    document.addEventListener("visibilitychange", onVisible);
	    window.addEventListener("focus", onVisible);
	    return () => {
	      document.removeEventListener("visibilitychange", onVisible);
	      window.removeEventListener("focus", onVisible);
	    };
	  }, [isStreaming, recoverInterruptedStream]);

  const buildAttachmentsFromMetadata = useCallback(
    (metadata?: Record<string, unknown> | null): UploadedFragment[] => {
      if (!metadata || typeof metadata !== "object") return [];
      const files = Array.isArray((metadata as any).files) ? (metadata as any).files : [];

      return files
        .map((file: any, idx: number) => ({
          id: file?.id || `initial-file-${idx}`,
          name: file?.name || file?.url || `Attachment ${idx + 1}`,
          url: file?.url,
          mime: file?.mimeType || file?.mime,
        }))
        .filter((file: UploadedFragment) => Boolean(file.name));
    },
    []
  );

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

      const prefs = readAutoStreamPrefs(activeConversationId);
      if (prefs?.generationMode === "image") {
        setIsImageMode(true);
        if (prefs.imageModel) {
          setCurrentImageModel(prefs.imageModel);
        }
      }
      saveAutoStreamPrefs(activeConversationId, null);

      // Mark as auto-streamed before triggering
      autoStreamedConversations.current.add(activeConversationId);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(getAutoStreamKey(activeConversationId), "1");
        } catch {}
      }

      const initialAttachments = buildAttachmentsFromMetadata(userMessage.metadata);

      // Use ref to avoid retriggering on model dropdown changes
      streamModelResponseRef.current?.(
        activeConversationId,
        projectId,
        userMessage.content,
        activeConversationId,
        true, // skipUserInsert since message is already in DB
        initialAttachments.length ? initialAttachments : undefined,
        prefs ?? undefined
      ).catch((err: unknown) => {
        console.error("Failed to stream initial message:", err);
      });
    }
  }, [
    activeConversationId,
    autoStreamHandled,
    buildAttachmentsFromMetadata,
    clearConversationAutoStreamed,
    initialMessages,
    isConversationAutoStreamed,
    projectId,
  ]); // Run when conversation changes or message count changes

  const handleRetryWithModel = async (retryModelName: string, messageId: string) => {
    if (!selectedChatId) return;

    // Find the user message that precedes this assistant message
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex <= 0) return;

    const userMessage = messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== "user") return;

    const isImageRetry = retryModelName === "Nano Banana" || retryModelName === "Nano Banana Pro";
    const retryGenerationMode: "chat" | "image" = isImageRetry ? "image" : "chat";
    const retryImageModel: "nano-banana" | "nano-banana-pro" | undefined = isImageRetry
      ? retryModelName === "Nano Banana Pro"
        ? "nano-banana-pro"
        : "nano-banana"
      : undefined;

    if (isImageRetry) {
      setIsImageMode(true);
      setCurrentImageModel(retryImageModel ?? "nano-banana");
    } else {
      setIsImageMode(false);
    }

    // Map retry model name to model settings (without changing the UI dropdown)
    let retryModelFamily: ModelFamily = "gpt-5-mini";
    let retrySpeedMode: SpeedMode = "auto";
    if (retryModelName === "GPT 5 Nano") {
      retryModelFamily = "gpt-5-nano";
      retrySpeedMode = "auto";
    } else if (retryModelName === "GPT 5 Mini") {
      retryModelFamily = "gpt-5-mini";
      retrySpeedMode = "auto";
    } else if (retryModelName === "GPT 5.2") {
      retryModelFamily = "gpt-5.2";
      retrySpeedMode = "auto";
    } else if (retryModelName === "GPT 5.2 Pro" || retryModelName === "GPT 5 Pro") {
      retryModelFamily = "gpt-5.2-pro";
      retrySpeedMode = "auto";
    }
    const retryPreviewConfig = isImageRetry
      ? null
      : getModelAndReasoningConfig(retryModelFamily, retrySpeedMode, userMessage.content);

    // Start timing and show thinking indicator BEFORE removing message
    startResponseTiming();
    showThinkingIndicator();
    promoteThinkingIndicator(retryPreviewConfig?.reasoning?.effort);
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
            timezone: parsed.timezone || (typeof Intl !== "undefined"
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : null),
          };
        }
      } catch (e) {
        console.error("[Location] Failed to parse location data:", e);
      }

      const timezone =
        locationData?.timezone ||
        (typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : null);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: selectedChatId,
          projectId: selectedProjectId || undefined,
          message: userMessage.content,
          generationMode: retryGenerationMode,
          imageModel: retryGenerationMode === "image" ? retryImageModel : undefined,
          modelFamilyOverride: retryModelFamily,
          speedModeOverride: retrySpeedMode,
          reasoningEffortOverride: undefined, // Let API auto-calculate
          skipUserInsert: true,
          location: locationData,
          clientNow: Date.now(),
          timezone,
          simpleContextMode: useSimpleContext,
          simpleContextExternalChatIds: useSimpleContext
            ? getSimpleContextExternalChatIdsForChat(selectedChatId)
            : undefined,
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
        let ndjsonBuffer = "";

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

	          ndjsonBuffer += decoder.decode(value, { stream: true });

            while (true) {
              const newlineIndex = ndjsonBuffer.indexOf("\n");
              if (newlineIndex === -1) break;
              const line = ndjsonBuffer.slice(0, newlineIndex);
              ndjsonBuffer = ndjsonBuffer.slice(newlineIndex + 1);
              if (!line.trim()) continue;
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
                  messageMetadata?.reasoningEffort ?? null
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
                  if (parsed.model_info.reasoningEffort === "medium" || parsed.model_info.reasoningEffort === "high") {
                    promoteThinkingIndicator(parsed.model_info.reasoningEffort as ReasoningEffort);
                  }
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
                if (parsed.meta.contextUsage && selectedChatId) {
                  const usage = parsed.meta.contextUsage as ContextUsageSnapshot;
                  if (typeof usage.percent === "number") {
                    setContextUsageByChat((prev) => ({
                      ...prev,
                      [selectedChatId]: usage,
                    }));
                  }
                }
                const newId = parsed.meta.assistantMessageRowId;
                setActiveIndicatorMessageId(newId);
                // Clear thinking indicator when metadata arrives
                resetThinkingIndicator();
                const finalContent =
                  typeof (parsed.meta as any).finalContent === "string" ? ((parsed.meta as any).finalContent as string) : null;
                if (finalContent) {
                  assistantContent = finalContent;
                }
                // Replace the temporary ID with the persisted row ID and store metadata
                updateMessage(selectedChatId, assistantMessageId, {
                  id: newId,
                  metadata: metadataWithTiming,
                  ...(finalContent ? { content: finalContent } : {}),
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
    if (chat?.projectId) {
      void navigateWithChatBodyFade(router, `/projects/${chat.projectId}/c/${id}`);
    } else {
      void navigateWithChatBodyFade(router, `/c/${id}`);
    }
  };

  const handleProjectChatSelect = (projectIdValue: string, chatId: string) => {
    void navigateWithChatBodyFade(router, `/projects/${projectIdValue}/c/${chatId}`);
  };

  const handleNewChat = () => {
    if (isGuest) {
      setGuestWarning("Guest mode: sign in to save chats and projects.");
      return;
    }
    void navigateWithChatBodyFade(router, "/", "replace");
  };

  const handleProjectSelect = (id: string) => {
    void navigateWithMainPanelFade(router, `/projects/${id}`);
  };

  const handleScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
    if (isProgrammaticScrollRef.current) return;

    const target = event.currentTarget;
    const { scrollTop, clientHeight } = target;

    // While pinned-to-prompt, don't allow scrolling "past" the pinned position
    // (which would reveal blank space created by the temporary spacer).
    if (pinToPromptRef.current && pinnedScrollTopRef.current !== null) {
      const maxAllowed = pinnedScrollTopRef.current;
      if (scrollTop > maxAllowed + 2) {
        isProgrammaticScrollRef.current = true;
        target.scrollTop = maxAllowed;
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 150);
        return;
      }
    }

    const effectiveBottom = getEffectiveScrollBottom(target);
    const distanceFromBottom = effectiveBottom - (scrollTop + clientHeight);
    const tolerance = Math.max(16, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;

    setShowScrollToBottom(!atBottom);
    // Re-enable autoscroll when user scrolls back to bottom, disable when scrolling up
    if (!pinToPromptRef.current) {
      setIsAutoScroll(atBottom);
    }
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
    setIsNewProjectOpen(false);
    void navigateWithMainPanelFade(router, `/projects/${newProject.id}`);
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

  const runtimeIndicatorBubble = useMemo(() => {
    if (!selectedChatId || !lastUserMessageId) return null;

    const hasIndicator = Boolean(thinkingStatus || searchIndicator || fileReadingIndicator || isAnalyzing);
    const lastHasContent = messages.length === 0 || Boolean(messages[messages.length - 1]?.content);
    const allowRegardless = Boolean(searchIndicator || fileReadingIndicator || thinkingStatus || isAnalyzing);

    if (!hasIndicator || (!lastHasContent && !allowRegardless)) {
      return null;
    }

    const bubble = isAnalyzing ? (
      <StatusBubble label="Analyzing" variant="analyzing" />
    ) : fileReadingIndicator ? (
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
        onClick={openInsightSidebar}
      />
    ) : null;

    if (!bubble) return null;

    return bubble;
  }, [
    fileReadingIndicator,
    isAnalyzing,
    lastUserMessageId,
    messages,
    searchIndicator,
    selectedChatId,
    thinkingStatus,
  ]);

  const assistantShimmerRgb = useMemo(() => {
    if (fileReadingIndicator) return "83, 242, 199"; // green
    if (searchIndicator) return "75, 100, 255"; // darker blue
    if (isAnalyzing) return "196, 181, 253"; // purple
    if (thinkingStatus?.variant === "extended") return "138, 180, 255"; // blue
    if (thinkingStatus) return "255, 255, 255"; // default thinking
    return "255, 255, 255";
  }, [fileReadingIndicator, searchIndicator, isAnalyzing, thinkingStatus]);

  const shouldRenderRuntimeIndicatorSlot =
    Boolean(selectedChatId && lastUserMessageId) &&
    (reserveRuntimeIndicatorSpace ||
      Boolean(thinkingStatus || searchIndicator || fileReadingIndicator || isAnalyzing));

  // When we're intentionally not auto-scrolling (e.g., pinning the prompt near the top),
  // prevent newly mounted runtime indicators from nudging the scroll position.
  useEffect(() => {
    if (isAutoScroll) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const lockedTop = viewport.scrollTop;
    const restore = () => {
      viewport.scrollTop = lockedTop;
    };

    // Restore immediately and over the next two frames to cover layout/paint.
    restore();
    const raf1 = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(() => {
      restore();
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(restore);
      }
    }) : null;

    // If the viewport resizes while indicators are present, keep the same top.
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(restore)
        : null;
    if (resizeObserver) {
      resizeObserver.observe(viewport);
    }

    return () => {
      if (raf1 && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(raf1);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [
    isAutoScroll,
    thinkingStatus,
    searchIndicator,
    fileReadingIndicator,
    reserveRuntimeIndicatorSpace,
  ]);

  // Lock scroll position while runtime indicator is visible to avoid jumps from layout/anchor adjustments.
  useEffect(() => {
    if (!runtimeIndicatorBubble) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const lockTop = viewport.scrollTop;
    const effectiveBottom = getEffectiveScrollBottom(viewport);
    const distanceFromBottom = effectiveBottom - (viewport.scrollTop + viewport.clientHeight);
    if (distanceFromBottom > 8) {
      setIsAutoScroll(false);
    }

    const restore = () => {
      viewport.scrollTop = lockTop;
    };

    restore();
    const raf1 =
      typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame(() => {
            restore();
            if (typeof requestAnimationFrame !== "undefined") {
              requestAnimationFrame(restore);
            }
          })
        : null;

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(restore)
        : null;
    if (resizeObserver) {
      resizeObserver.observe(viewport);
    }

    return () => {
      if (raf1 && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(raf1);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [runtimeIndicatorBubble, getEffectiveScrollBottom]);

  // Ensure we never shrink the bottom spacer while a runtime indicator is visible; keeps page height stable.
  useEffect(() => {
    if (!runtimeIndicatorBubble) return;
    setBottomSpacerPx((prev) => Math.max(prev, baseBottomSpacerPx + 80));
  }, [runtimeIndicatorBubble, baseBottomSpacerPx]);

  useEffect(() => {
    if (!shouldRenderRuntimeIndicatorSlot && !isStreaming) {
      setReserveRuntimeIndicatorSpace(false);
    }
  }, [isStreaming, shouldRenderRuntimeIndicatorSlot]);

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full bg-background text-foreground dark overflow-hidden overscroll-y-none">
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
            setSettingsTab('account')
            setIsSettingsOpen(true)
          }}
          onRefreshChats={refreshChats}
          onRefreshProjects={refreshProjects}
        />
      )}

      {/* Right column: header + messages + composer */}
      <div
        ref={mainPanelRef}
        data-main-panel="true"
        className="chat-ambient-bg flex flex-1 flex-col w-full min-w-0 min-h-0 overflow-hidden"
        style={{ viewTransitionName: "main-panel", ["--assistant-shimmer-rgb" as any]: assistantShimmerRgb }}
      >
        {/* Header bar */}
        <div className="sticky top-0 z-20 flex h-[53px] items-center justify-between border-b border-border bg-background px-3 lg:px-6">
          <div className="flex items-center gap-3 min-w-0">
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
                  guestResponseIdsRef.current = {};
                  router.replace("/");
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}

            <ApiUsageBadge />
            <DropdownMenu
              onOpenChange={(open) => {
                if (!open) {
                  setShowOtherModels(false);
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-auto gap-1.5 border-0 px-2 text-base font-semibold focus-visible:bg-transparent focus-visible:outline-none focus-visible:ring-0"
                >
                  {isImageMode
                    ? currentImageModel === "nano-banana"
                      ? "Nano Banana"
                      : "Nano Banana Pro"
                    : currentModel === "Auto"
                      ? "GPT 5.2"
                      : currentModel === "Instant"
                        ? "GPT 5.2 Instant"
                        : currentModel === "Thinking"
                          ? "GPT 5.2 Thinking"
                          : currentModel === "Pro"
                            ? "GPT 5.2 Pro"
                            : currentModel}
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              {!isGuest ? (
                isImageMode ? (
                  <DropdownMenuContent
                    align="start"
                    sideOffset={8}
                    className="w-auto min-w-[220px] max-w-[90vw] sm:w-64 space-y-1 py-2"
                  >
                    <div className="px-3 pb-1 text-sm font-semibold text-muted-foreground">
                      Image generation
                    </div>
                    <DropdownMenuItem
                      className="items-center gap-3 px-3 py-2"
                      onSelect={() => setCurrentImageModel("nano-banana")}
                    >
                      <span className="flex-1">Nano Banana</span>
                      <span className="flex w-4 justify-end">
                        {currentImageModel === "nano-banana" && <Check className="h-4 w-4" />}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="items-center gap-3 px-3 py-2"
                      onSelect={() => setCurrentImageModel("nano-banana-pro")}
                    >
                      <span className="flex-1">Nano Banana Pro</span>
                      <span className="flex w-4 justify-end">
                        {currentImageModel === "nano-banana-pro" && <Check className="h-4 w-4" />}
                      </span>
                    </DropdownMenuItem>

                    <div className="px-2">
                      <div className="h-px bg-border" />
                    </div>

                    <DropdownMenuItem
                      className="items-center gap-3 px-3 py-2"
                      onSelect={() => setIsImageMode(false)}
                    >
                      <span className="flex-1 text-muted-foreground">Back to chat models</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                ) : (
                  <DropdownMenuContent
                    align="start"
                    sideOffset={8}
                    className="w-auto min-w-[220px] max-w-[90vw] sm:w-64 space-y-1 py-2"
                  >
                  <div className="px-3 pb-1 text-sm font-semibold text-muted-foreground">
                    GPT 5.2
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
                  <DropdownMenuItem
                    className="items-center gap-3 px-3 py-2"
                    onSelect={() => setCurrentModel("Pro")}
                  >
                    <div className="flex flex-1 flex-col">
                      <span className="font-medium leading-none">Pro</span>
                      <span className="text-xs text-muted-foreground">Highest quality GPT 5.2</span>
                    </div>
                    <span className="flex w-4 justify-end">
                      {currentModel === "Pro" && <Check className="h-4 w-4" />}
                    </span>
                  </DropdownMenuItem>

                  <div className="px-2">
                    <div className="h-px bg-border" />
                  </div>

                  <DropdownMenuItem
                    className="items-center gap-3 px-3 py-2"
                    onSelect={(e) => {
                      e.preventDefault();
                      setShowOtherModels((open) => !open);
                    }}
                  >
                    <div className="flex flex-1 flex-col text-left">
                      <span className="font-medium leading-none">
                        Other models
                      </span>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${showOtherModels ? "rotate-180" : ""}`}
                    />
                  </DropdownMenuItem>
                  {showOtherModels && (
                    <div className="mt-1 space-y-1 rounded-md border border-border/70 bg-popover px-2 py-2 text-foreground shadow-sm origin-top animate-in fade-in-0 zoom-in-95 duration-150">
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
                    </div>
                  )}
                </DropdownMenuContent>
                )
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

          <div className="flex items-center gap-3">
	            <ContextUsageIndicator
	              usage={currentContextUsage}
	              contextMode={currentContextMode}
	              availableChats={chats}
	              activeChatId={effectiveChatId}
	              simpleExternalChatIds={simpleExternalChatIdsForActiveChat}
	              onChangeSimpleExternalChatIds={setSimpleExternalChatIdsForActiveChat}
	              advancedTopicIds={advancedTopicIdsForActiveChat}
	              onChangeAdvancedTopicIds={(next) => {
	                if (!effectiveChatId) return;
	                setAdvancedTopicSelectionByChat((prev) => {
	                  const current = typeof prev[effectiveChatId] === "undefined" ? null : prev[effectiveChatId];
	                  const resolved = typeof next === "function" ? (next as any)(current) : next;
	                  return { ...prev, [effectiveChatId]: resolved };
	                });
	              }}
	              onToggleMode={(next) => {
	                if (!effectiveChatId) {
	                  setContextModeGlobal(next);
	                  try {
	                    window.localStorage.setItem("context-mode-global", next);
                   } catch {}
                  if (!isGuest) {
                    saveContextModeGlobalPreference(next)
                      .then((result) => {
                        if (!result.success) {
                          console.error("Failed to save context mode:", result.message);
                        }
                      })
                      .catch(() => {});
                  }
                   return;
                 }
                 setContextModeByChat((prev) => ({
                   ...prev,
                   [effectiveChatId]: next,
                }));
              }}
            />
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

        <div
          ref={chatBodyRef}
          data-chat-body="true"
          className="flex-1 overflow-hidden flex flex-col min-h-0"
        >
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
              className="flex-1 min-h-0 overscroll-y-contain"
              viewportRef={scrollViewportRef}
              viewportClassName="chat-scroll-viewport h-full overscroll-y-contain overscroll-contain"
              onViewportScroll={handleScroll}
            >
              <div className="py-4 pb-20">
                {/* Wide desktop layout with padded container */}
                <div className="w-full space-y-4">
                  {messages.map((message, index) => {
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

                    const hasFirstToken = messagesWithFirstToken.has(message.id);

                    let shouldAnimateEntry = false;
                    const isNewestMessage = index === messages.length - 1;
                    const isOnlyMessageInThread = messages.length === 1;
                    const alreadyAnimated = animatedMessageIdsRef.current.has(message.id);
                    const isFirstMessageInConversation = conversationChanged && index === 0;

                    if (message.role === "assistant") {
                      if (
                        !alreadyAnimated &&
                        (isFirstMessageInConversation ||
                          (allowAssistantHistoryAnimation && isNewestMessage))
                      ) {
                        shouldAnimateEntry = true;
                        animatedMessageIdsRef.current.add(message.id);
                      }
                    } else {
                      if (
                        !alreadyAnimated &&
                        (isFirstMessageInConversation || isNewestMessage || isOnlyMessageInThread)
                      ) {
                        shouldAnimateEntry = true;
                        animatedMessageIdsRef.current.add(message.id);
                      }
                    }

                    return (
                      <React.Fragment key={message.id}>
                        <div
                          ref={(el) => {
                            if (el) {
                              messageRefs.current[message.id] = el;
                            }
                          }}
                        >
                          {message.role === "assistant" && (
                            <div className="flex flex-col gap-2 pb-2 px-4 sm:px-6">
                              <div
                                className="mx-auto w-full max-w-[min(720px,100%)] px-1.5 sm:px-0"
                                style={{ minHeight: metadataIndicators ? 'auto' : '0px' }}
                              >
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                  {metadataIndicators && (
                                    <MessageInsightChips
                                      metadata={displayMetadata || undefined}
                                      messageId={message.id}
                                      animationScopeId={insightAnimationScopeId}
                                      onOpenSidebar={openInsightSidebar}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="px-4 sm:px-6">
                            <div className="mx-auto w-full max-w-[min(720px,100%)] px-1.5 sm:px-0">
                              <ChatMessage
                                {...message}
                                messageId={message.id}
                                enableEntryAnimation={shouldAnimateEntry}
                                showInsightChips={false}
                                isStreaming={isStreamingMessage}
                                suppressPreStreamAnimation={hasFirstToken}
                                onRetry={
                                  message.role === "assistant"
                                    ? (model) => handleRetryWithModel(model, message.id)
                                    : undefined
                                }
                              />
                            </div>
                          </div>
                        </div>
                        {/* Runtime indicator is rendered as a fixed overlay (not in flow) to avoid layout shifts */}
                      </React.Fragment>
                    );
                })}
                  {/* Bottom spacer for proper scrolling */}
                  <div aria-hidden="true" style={{ height: `${bottomSpacerPx}px` }} />
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
        {/* Runtime indicator overlay (fixed, out of document flow) */}
        {shouldRenderRuntimeIndicatorSlot && runtimeIndicatorBubble ? (
          <div
            className="pointer-events-none fixed inset-x-0 bottom-[calc(104px+env(safe-area-inset-bottom,0px))] z-40 flex justify-center"
            style={{ overflowAnchor: "none" }}
          >
            <div className="pointer-events-auto">
              {runtimeIndicatorBubble}
            </div>
          </div>
        ) : null}
        {/* Composer: full-width bar, centered pill like ChatGPT */}
        <div
          className="bg-transparent px-4 sm:px-6 lg:px-12 py-3 sm:py-4 relative sticky bottom-0 z-30 pb-[max(env(safe-area-inset-bottom),0px)] transition-transform duration-200 ease-out"
          style={{ transform: `translateY(${-Math.max(0, composerLiftPx + 4)}px)` }}
        >
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
          </div>
          <div className="mx-auto w-full max-w-3xl">
            {isImageMode && (
              <div className="mb-2 flex pl-2">
                <button
                  type="button"
                  onClick={() => setIsImageMode(false)}
                  className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-border bg-card/85 px-3 py-2 text-xs font-medium text-fuchsia-50 shadow-sm transition hover:bg-card/95 hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/50 cursor-pointer"
                  aria-label="Exit image mode"
                  title="Click to exit image mode"
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-500/20">
                    <ImageIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate">Create image</span>
                  <span className="ml-1 text-[14px] leading-none text-fuchsia-50/80">x</span>
                </button>
              </div>
            )}
            <ChatComposer
              conversationId={selectedChatId}
              onSubmit={handleSubmit}
              isStreaming={isStreaming}
              onStop={handleStopGeneration}
              onCreateImage={() => setIsImageMode(true)}
              placeholder={isImageMode ? "Describe the image you want to generate…" : undefined}
            />
          </div>
        </div>
      </div>
      {/* Insight sidebar */}
      <div
        className={`h-full flex-shrink-0 transition-all duration-300 ease-in-out border-l border-border bg-background overflow-hidden ${
          isInsightSidebarOpen ? "w-[400px] max-w-[80vw] opacity-100 pointer-events-auto" : "w-0 opacity-0 pointer-events-none"
        }`}
        aria-hidden={!isInsightSidebarOpen}
      >
        <div className={`flex h-full flex-col transition-opacity duration-200 ease-in-out ${isInsightSidebarOpen ? "opacity-100" : "opacity-0"}`}>
          <div className="flex h-[53px] items-center justify-between px-4 border-b border-border">
            <div className="text-sm font-medium">Thoughts &amp; updates</div>
            <Button variant="ghost" size="icon" onClick={closeInsightSidebar}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 p-4 text-sm text-muted-foreground space-y-3 overflow-y-auto">
            {Object.entries(insightPreambles).length === 0 ? (
              <p className="text-muted-foreground/80">Tool preambles will appear here.</p>
            ) : (
              Object.entries(insightPreambles).map(([messageId, text]) => (
                <div key={messageId} className="rounded-lg border border-border bg-card/80 p-3 text-foreground">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
                    Message {messageId.slice(0, 6)}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">{text}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false)
          setSettingsTab('preferences')
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

function formatTokenCount(tokens: number) {
  if (!Number.isFinite(tokens)) return "0";
  if (tokens >= 1_000_000_000) {
    const value = tokens / 1_000_000_000;
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)}b`;
  }
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)}m`;
  }
  if (tokens >= 10000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  if (tokens >= 1000) {
    const value = tokens / 1000;
    return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}k`;
  }
  return Math.max(0, Math.round(tokens)).toLocaleString();
}

function ContextUsageIndicator({
  usage,
  contextMode,
  availableChats,
  activeChatId,
  simpleExternalChatIds,
  onChangeSimpleExternalChatIds,
  advancedTopicIds,
  onChangeAdvancedTopicIds,
  onToggleMode,
}: {
  usage: ContextUsageSnapshot;
  contextMode: "advanced" | "simple";
  availableChats: StoredChat[];
  activeChatId: string | null;
  simpleExternalChatIds: string[] | null;
  onChangeSimpleExternalChatIds: React.Dispatch<React.SetStateAction<string[] | null>>;
  advancedTopicIds: string[] | null;
  onChangeAdvancedTopicIds: React.Dispatch<React.SetStateAction<string[] | null>>;
  onToggleMode: (next: "advanced" | "simple") => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isConfigureOpen, setIsConfigureOpen] = useState(false);
  const [allTopics, setAllTopics] = useState<
    Array<{
      id: string;
      conversationId: string;
      label: string;
      tokenEstimate: number;
      updatedAt: string | null;
      conversationTitle: string | null;
      projectName: string | null;
    }> | null
  >(null);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const topicsRequestRef = useRef<AbortController | null>(null);
  const percent = Math.min(100, Math.max(0, Math.round(usage.percent ?? 0)));
  const remainingPercent = Math.max(0, 100 - percent);
  const accent = "var(--user-accent-color, #7dd3fc)";
  const radius = 12.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percent / 100);
  const safeNumber = (value?: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const usedTokens =
    safeNumber(usage.inputTokens) +
    safeNumber(usage.cachedTokens) +
    safeNumber(usage.outputTokens);
  const limitTokens = Math.max(0, safeNumber(usage.limit));

  const [recentChatsCutoffMs, setRecentChatsCutoffMs] = useState(0);
  useEffect(() => {
    setRecentChatsCutoffMs(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }, []);

  const recentExternalChats = useMemo(() => {
    return (availableChats ?? [])
      .filter((chat) => {
        if (!chat?.id) return false;
        if (activeChatId && chat.id === activeChatId) return false;
        const ts = new Date(chat.timestamp).getTime();
        return Number.isFinite(ts) && ts >= recentChatsCutoffMs;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activeChatId, availableChats, recentChatsCutoffMs]);

  const toggleExternalChatId = useCallback(
    (chatId: string, checked: boolean) => {
      onChangeSimpleExternalChatIds((prev) => {
        if (prev === null) {
          if (checked) return null;
          return recentExternalChats.filter((c) => c.id !== chatId).map((c) => c.id);
        }
        const nextSet = new Set<string>(Array.isArray(prev) ? prev : []);
        if (checked) nextSet.add(chatId);
        else nextSet.delete(chatId);
        return Array.from(nextSet);
      });
    },
    [onChangeSimpleExternalChatIds, recentExternalChats]
  );

  const allExternalChatsSelected =
    recentExternalChats.length > 0 &&
    (simpleExternalChatIds === null || simpleExternalChatIds.length === recentExternalChats.length);

  useEffect(() => {
    if (!isConfigureOpen) return;
    if (contextMode !== "advanced") return;
    if (allTopics !== null) return;
    if (topicsRequestRef.current) return;

    const controller = new AbortController();
    topicsRequestRef.current = controller;
    setTopicsLoading(true);
    setTopicsError(null);
    fetch("/api/conversation-topics", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load topics (${res.status})`);
        }
        return (await res.json()) as { topics?: any[] };
      })
      .then((payload) => {
        const topics = Array.isArray(payload.topics) ? payload.topics : [];
        setAllTopics(
          topics
            .map((t) => ({
              id: String(t.id),
              conversationId: String(t.conversationId),
              label: typeof t.label === "string" ? t.label : "Untitled topic",
              tokenEstimate: typeof t.tokenEstimate === "number" ? t.tokenEstimate : 0,
              updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : null,
              conversationTitle: typeof t.conversationTitle === "string" ? t.conversationTitle : null,
              projectName: typeof t.projectName === "string" ? t.projectName : null,
            }))
            .filter((t) => t.id && t.conversationId)
        );
      })
      .catch((err) => {
        if ((err as any)?.name === "AbortError") return;
        setTopicsError(err instanceof Error ? err.message : "Failed to load topics");
        setAllTopics([]);
      })
      .finally(() => {
        topicsRequestRef.current = null;
        setTopicsLoading(false);
      });

    return () => {
      controller.abort();
      topicsRequestRef.current = null;
    };
  }, [allTopics, contextMode, isConfigureOpen]);

  const topicsForActiveChat = useMemo(() => {
    if (!activeChatId || !Array.isArray(allTopics)) return [];
    return allTopics.filter((t) => t.conversationId === activeChatId);
  }, [activeChatId, allTopics]);

  const topicsForOtherChats = useMemo(() => {
    if (!Array.isArray(allTopics)) return [];
    if (!activeChatId) return allTopics;
    return allTopics.filter((t) => t.conversationId !== activeChatId);
  }, [activeChatId, allTopics]);

  const toggleTopicId = useCallback(
    (topicId: string, checked: boolean) => {
      onChangeAdvancedTopicIds((prev) => {
        if (prev === null) {
          return checked ? [topicId] : null;
        }
        const nextSet = new Set<string>(Array.isArray(prev) ? prev : []);
        if (checked) nextSet.add(topicId);
        else nextSet.delete(topicId);
        return Array.from(nextSet);
      });
    },
    [onChangeAdvancedTopicIds]
  );

  return (
    <div
      className="relative flex items-center gap-2 text-xs text-muted-foreground"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => {
        if (isPinned || isConfigureOpen) return;
        setIsOpen(false);
      }}
      onFocus={() => setIsOpen(true)}
      onBlur={() => {
        if (isPinned || isConfigureOpen) return;
        setIsOpen(false);
      }}
      tabIndex={0}
      aria-label="Context window usage"
      data-context-usage-indicator
    >
      <div
        className="relative h-7 w-7 cursor-pointer"
        onClick={() => {
          setIsPinned((prev) => {
            const next = !prev;
            if (!next) {
              setIsOpen(false);
            } else {
              setIsOpen(true);
            }
            return next;
          });
        }}
      >
        <svg className="absolute inset-0" viewBox="0 0 28 28" aria-hidden="true">
          <circle
            cx="14"
            cy="14"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="3"
          />
          <circle
            cx="14"
            cy="14"
            r={radius}
            fill="none"
            stroke={accent}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
            className="context-ring-progress"
            transform="rotate(-90 14 14)"
          />
        </svg>
        <div className="absolute inset-[3px] rounded-full bg-background" />
      </div>
      <span className="text-sm font-semibold text-foreground">{percent}%</span>

      {isOpen ? (
        <div className="absolute right-0 top-[115%] z-30 w-64 rounded-lg border border-border/80 bg-card/95 text-foreground shadow-xl backdrop-blur-sm">
          <div className="relative space-y-1.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Context window
              </div>
              <DropdownMenu
                open={isConfigureOpen}
                onOpenChange={(open) => {
                  setIsConfigureOpen(open);
                  if (open) {
                    setIsOpen(true);
                  } else if (!isPinned) {
                    setIsOpen(false);
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                  >
                    Configure
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-72"
                  onCloseAutoFocus={(e) => {
                    // Keep the hover card open if pinned; otherwise allow it to close.
                    if (isPinned) {
                      e.preventDefault();
                      setIsOpen(true);
                    }
                  }}
                  onOpenAutoFocus={(e) => {
                    // Prevent focus trap stealing focus from the hover card toggle.
                    e.preventDefault();
                  }}
                  onEscapeKeyDown={() => {
                    setIsConfigureOpen(false);
                    if (!isPinned) setIsOpen(false);
                  }}
                >
	                   {contextMode === "simple" ? (
	                     <>
	                       <DropdownMenuLabel className="text-xs">
	                         Chats to load (last 7 days)
	                       </DropdownMenuLabel>
	                       <DropdownMenuSeparator />
	                       <DropdownMenuItem
	                         className="text-xs"
	                         onSelect={(e) => {
	                           e.preventDefault();
	                           onChangeSimpleExternalChatIds(allExternalChatsSelected ? [] : null);
	                         }}
	                       >
	                         {allExternalChatsSelected ? "Deselect all" : "Reset to auto selection"}
	                       </DropdownMenuItem>
	                       <DropdownMenuSeparator />
	                       <div className="max-h-64 overflow-auto py-1">
	                         {recentExternalChats.length ? (
	                           recentExternalChats.map((chat) => {
	                             const checked =
	                               simpleExternalChatIds === null ? true : simpleExternalChatIds.includes(chat.id);
	                             return (
	                               <DropdownMenuCheckboxItem
	                                 key={chat.id}
	                                 checked={checked}
	                                 onCheckedChange={(nextChecked) => {
	                                   toggleExternalChatId(chat.id, Boolean(nextChecked));
	                                 }}
	                                 onSelect={(e) => e.preventDefault()}
	                                 className="items-start gap-2 py-2"
	                               >
	                                 <div className="flex flex-col">
	                                   <div className="text-xs font-medium text-foreground">
	                                     {chat.title || "Untitled chat"}
	                                   </div>
	                                 </div>
	                               </DropdownMenuCheckboxItem>
	                             );
	                           })
	                         ) : (
	                           <DropdownMenuItem disabled className="text-xs">
	                             No chats updated in the last week
	                           </DropdownMenuItem>
	                         )}
	                       </div>
	                     </>
	                   ) : (
	                     <>
	                       <DropdownMenuLabel className="text-xs">
	                         Topics to load
	                       </DropdownMenuLabel>
	                       <DropdownMenuSeparator />
	                       <DropdownMenuItem
	                         className="text-xs items-center justify-between"
	                         onSelect={(e) => {
	                           e.preventDefault();
	                           onChangeAdvancedTopicIds(null);
	                         }}
	                       >
	                         <span>Auto selection</span>
	                         <span className="flex w-4 justify-end">
	                           {advancedTopicIds === null && <Check className="h-4 w-4" />}
	                         </span>
	                       </DropdownMenuItem>
	                       <DropdownMenuSeparator />

	                       {topicsLoading ? (
	                         <DropdownMenuItem disabled className="text-xs">
	                           Loading topics…
	                         </DropdownMenuItem>
	                       ) : topicsError ? (
	                         <DropdownMenuItem disabled className="text-xs text-red-400">
	                           {topicsError}
	                         </DropdownMenuItem>
	                       ) : (
	                         <div className="max-h-64 overflow-auto py-1">
	                           <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
	                             This chat
	                           </div>
	                           {topicsForActiveChat.length ? (
	                             topicsForActiveChat.map((topic) => {
	                               const checked = Array.isArray(advancedTopicIds)
	                                 ? advancedTopicIds.includes(topic.id)
	                                 : false;
	                               return (
	                                 <DropdownMenuCheckboxItem
	                                   key={topic.id}
	                                   checked={checked}
	                                   onCheckedChange={(nextChecked) => {
	                                     toggleTopicId(topic.id, Boolean(nextChecked));
	                                   }}
	                                   onSelect={(e) => e.preventDefault()}
	                                   className="items-start gap-2 py-2"
	                                 >
	                                   <div className="flex flex-col min-w-0">
	                                     <div className="text-xs font-medium text-foreground truncate">
	                                       {topic.label}
	                                     </div>
	                                     <div className="text-[11px] text-muted-foreground truncate">
	                                       {topic.tokenEstimate ? `${Math.round(topic.tokenEstimate / 1000)}k tokens` : "No token estimate"}
	                                     </div>
	                                   </div>
	                                 </DropdownMenuCheckboxItem>
	                               );
	                             })
	                           ) : (
	                             <DropdownMenuItem disabled className="text-xs">
	                               No topics found for this chat
	                             </DropdownMenuItem>
	                           )}

	                           <div className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
	                             Other chats
	                           </div>
	                           {topicsForOtherChats.length ? (
	                             topicsForOtherChats.map((topic) => {
	                               const checked = Array.isArray(advancedTopicIds)
	                                 ? advancedTopicIds.includes(topic.id)
	                                 : false;
	                               const chatLabel = topic.conversationTitle || "Untitled chat";
	                               const projectLabel = topic.projectName ? ` • ${topic.projectName}` : "";
	                               return (
	                                 <DropdownMenuCheckboxItem
	                                   key={topic.id}
	                                   checked={checked}
	                                   onCheckedChange={(nextChecked) => {
	                                     toggleTopicId(topic.id, Boolean(nextChecked));
	                                   }}
	                                   onSelect={(e) => e.preventDefault()}
	                                   className="items-start gap-2 py-2"
	                                 >
	                                   <div className="flex flex-col min-w-0">
	                                     <div className="text-xs font-medium text-foreground truncate">
	                                       {topic.label}
	                                     </div>
	                                     <div className="text-[11px] text-muted-foreground truncate">
	                                       {chatLabel}{projectLabel}
	                                     </div>
	                                   </div>
	                                 </DropdownMenuCheckboxItem>
	                               );
	                             })
	                           ) : (
	                             <DropdownMenuItem disabled className="text-xs">
	                               No topics found in other chats
	                             </DropdownMenuItem>
	                           )}
	                         </div>
	                       )}
	                     </>
	                   )}
	                 </DropdownMenuContent>
	               </DropdownMenu>
	             </div>
             <div className="text-sm font-semibold">
               {percent}% used ({remainingPercent}% left)
             </div>
             <div className="text-xs text-muted-foreground">
               {formatTokenCount(usedTokens)} / {formatTokenCount(limitTokens)} tokens used
            </div>
            <div className="pt-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Context mode</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => onToggleMode(contextMode === "simple" ? "advanced" : "simple")}
                >
                  {contextMode === "simple" ? "Simple" : "Advanced"}
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Toggle between simple and advanced context (placeholder; coming soon).
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
