"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import supabaseClient from "@/lib/supabase/browser-client";
import type { Database } from "@/lib/supabase/types";
import type { AssistantMessageMetadata } from "@/lib/chatTypes";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  model?: string;
  metadata?: AssistantMessageMetadata | Record<string, unknown> | null;
  preamble?: string | null;
};

export type StoredChat = {
  id: string;
  title: string;
  timestamp: string;
  projectId?: string;
  messages: StoredMessage[];
};

type ChatContextValue = {
  chats: StoredChat[];
  globalChats: StoredChat[];
  getProjectChats: (projectId: string) => StoredChat[];
  refreshChats: () => Promise<void>;
  createChat: (options: {
    id?: string;
    projectId?: string;
    title?: string;
    initialMessages?: StoredMessage[];
  }) => string;
  appendMessages: (chatId: string, newMessages: StoredMessage[]) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<StoredMessage>) => void;
  updateChatTitle: (chatId: string, title: string) => void;
  ensureChat: (chat: StoredChat) => void;
  removeMessage: (chatId: string, messageId: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

const getTitleFromMessages = (messages: StoredMessage[], fallback = "New chat") => {
  const firstMessage = messages.find((msg) => msg.role === "user") ?? messages[0];
  return firstMessage?.content?.slice(0, 80) || fallback;
};

interface ChatProviderProps {
  children: React.ReactNode;
  initialChats?: StoredChat[];
  userId: string;
}

export function ChatProvider({ children, initialChats = [], userId }: ChatProviderProps) {
  const [chats, setChats] = useState<StoredChat[]>(initialChats);

  // Refresh chats from Supabase client-side (used for manual refresh or initial hydration fallback)
  const refreshChats = useCallback(async () => {
    try {
      if (!userId) return;

      type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];

      const query = supabaseClient
        .from("conversations")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      const { data, error } = await query.returns<ConversationRow[]>();

      if (error) {
        console.warn("Failed to refresh conversations", error);
        return;
      }

      const rows = (data ?? []).filter(
        (row) => (row.metadata as any)?.agent !== "human-writing"
      );
      const conversationIds = rows.map((row) => row.id);
      const { data: messageRows } = await supabaseClient
        .from("messages")
        .select("*")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true })
        .returns<Database["public"]["Tables"]["messages"]["Row"][]>();

      const messageMap = new Map<string, StoredMessage[]>();
      const latestMessageTime = new Map<string, string>();
      (messageRows ?? []).forEach((msg) => {
        const convId = msg.conversation_id;
        if (!convId) return;
        const messages = messageMap.get(convId) ?? [];
        const timestamp = msg.created_at ?? new Date().toISOString();
        messages.push({
          id: msg.id,
          role: (msg.role as "user" | "assistant") || "assistant",
          content: msg.content ?? "",
          timestamp,
          metadata: msg.metadata as AssistantMessageMetadata | Record<string, unknown> | null,
          preamble: (msg as any).preamble ?? null,
        });
        messageMap.set(convId, messages);
        latestMessageTime.set(convId, timestamp);
      });

      // Preserve existing messages for chats already in memory; don't wipe messages to [] on refresh
      setChats((prev) => {
        const prevById = new Map(prev.map((c) => [c.id, c] as const));
        const merged: StoredChat[] = rows.map((row) => {
          const existing = prevById.get(row.id);
          const lastActivity = latestMessageTime.get(row.id) ?? row.created_at ?? existing?.timestamp ?? new Date().toISOString();
          return {
            id: row.id,
            title: row.title ?? existing?.title ?? "Untitled chat",
            timestamp: lastActivity,
            projectId: row.project_id ?? existing?.projectId ?? undefined,
            messages: messageMap.get(row.id) ?? existing?.messages ?? [],
          };
        });
        merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return merged;
      });
    } catch (err) {
      console.warn("refreshChats error", err);
    }
  }, [userId]);

  const createChat = useCallback(
    ({ id, projectId, title, initialMessages = [] }: {
      id?: string;
      projectId?: string;
      title?: string;
      initialMessages?: StoredMessage[];
    }) => {
      const chatId = id ?? `chat-${Date.now()}`;
      const now = new Date().toISOString();
      const derivedTitle = title || getTitleFromMessages(initialMessages);

      const newChat: StoredChat = {
        id: chatId,
        title: derivedTitle,
        timestamp: now,
        projectId,
        messages: initialMessages,
      };

      setChats((prev) => [newChat, ...prev]);
      return chatId;
    },
    []
  );

  const appendMessages = useCallback((chatId: string, newMessages: StoredMessage[]) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;

        const updatedMessages = [...chat.messages, ...newMessages];
        return {
          ...chat,
          messages: updatedMessages,
          timestamp: new Date().toISOString(),
          title:
            chat.messages.length === 0 && newMessages.length > 0
              ? getTitleFromMessages(newMessages, chat.title)
              : chat.title,
        };
      })
    );
  }, []);

  const updateMessage = useCallback(
    (chatId: string, messageId: string, updates: Partial<StoredMessage>) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== chatId) return chat;

          const messageIndex = chat.messages.findIndex((m) => m.id === messageId);
          if (messageIndex < 0) return chat;

          const updatedMessages = [...chat.messages];
          updatedMessages[messageIndex] = {
            ...updatedMessages[messageIndex],
            ...updates,
          };

          return {
            ...chat,
            messages: updatedMessages,
          };
        })
      );
    },
    []
  );

  const removeMessage = useCallback((chatId: string, messageId: string) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        return {
          ...chat,
          messages: chat.messages.filter((m) => m.id !== messageId),
          timestamp: new Date().toISOString(),
        };
      })
    );
  }, []);

  const updateChatTitle = useCallback((chatId: string, title: string) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        return {
          ...chat,
          title,
        };
      })
    );
  }, []);

  // Subscribe to realtime updates (conversations + messages) and apply changes to the local store.
  useEffect(() => {
    // If supabase client is not configured or no user id, skip
    if (!supabaseClient || !userId) return;

    const convChannel = supabaseClient
      .channel("public:conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_id=eq.${userId}` },
        (payload) => {
          const newRow = payload.new as Database["public"]["Tables"]["conversations"]["Row"] | null;
          const oldRow = payload.old as Database["public"]["Tables"]["conversations"]["Row"] | null;

          if (payload.eventType === "INSERT" && newRow) {
            setChats((prev) => {
              const existing = prev.find((c) => c.id === newRow.id);
              const toAdd: StoredChat = {
                id: newRow.id,
                title: newRow.title ?? existing?.title ?? "Untitled chat",
                timestamp: newRow.created_at ?? existing?.timestamp ?? new Date().toISOString(),
                projectId: newRow.project_id ?? existing?.projectId ?? undefined,
                messages: existing?.messages ?? [],
              };
              const filtered = prev.filter((c) => c.id !== toAdd.id);
              return [toAdd, ...filtered];
            });
            return;
          }

          if (payload.eventType === "UPDATE" && newRow) {
            setChats((prev) =>
              prev.map((c) => (c.id === newRow.id ? { ...c, title: newRow.title ?? c.title, timestamp: newRow.created_at ?? c.timestamp, projectId: newRow.project_id ?? c.projectId } : c))
            );
            return;
          }

          if (payload.eventType === "DELETE" && oldRow) {
            setChats((prev) => prev.filter((c) => c.id !== oldRow.id));
            return;
          }
        }
      )
      .subscribe();

    const msgChannel = supabaseClient
      .channel("public:messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as Database["public"]["Tables"]["messages"]["Row"] | null;
          if (!m) return;

          // Only apply if we already have the chat in the store. Ignore otherwise.
          setChats((prev) => {
            const idx = prev.findIndex((c) => c.id === m.conversation_id);
            if (idx === -1) return prev;

            const existing = prev[idx];
            
            // Check if this message is already in the chat (avoid duplicates)
            // Skip if exact ID match or if it has a temporary ID and same content/role/timing
            const alreadyExists = existing.messages.some((msg) => {
              if (msg.id === m.id) return true;
              // Also match temporary IDs to their persisted versions by comparing content and role
              if ((msg.id.startsWith('user-') || msg.id.startsWith('assistant-streaming-')) &&
                  msg.role === m.role &&
                  msg.content === (m.content ?? '') &&
                  Math.abs(new Date(msg.timestamp).getTime() - new Date(m.created_at ?? '').getTime()) < 1000) {
                return true;
              }
              return false;
            });
            if (alreadyExists) return prev;
            
            const newMessage: StoredMessage = {
              id: m.id,
              role: (m.role as "user" | "assistant") || "assistant",
              content: m.content ?? "",
              timestamp: m.created_at ?? new Date().toISOString(),
              metadata: m.metadata as AssistantMessageMetadata | Record<string, unknown> | null | undefined,
            };

            const updated: StoredChat = {
              ...existing,
              messages: [...existing.messages, newMessage],
              timestamp: new Date().toISOString(),
            };
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.old as Database["public"]["Tables"]["messages"]["Row"] | null;
          if (!m) return;

          // Remove the deleted message from the chat
          setChats((prev) => {
            const idx = prev.findIndex((c) => c.id === m.conversation_id);
            if (idx === -1) return prev;

            const existing = prev[idx];
            const updated: StoredChat = {
              ...existing,
              messages: existing.messages.filter((msg) => msg.id !== m.id),
              timestamp: new Date().toISOString(),
            };
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      try {
        convChannel.unsubscribe();
      } catch {}
      try {
        msgChannel.unsubscribe();
      } catch {}
    };
  }, [userId]);

  // Ensure we hydrate from Supabase on initial client mount so the UI shows
  // the latest conversations even when server-rendered props are missing.
  useEffect(() => {
    // Only attempt to refresh if we don't already have chats loaded.
    // This allows server-provided initialChats to remain authoritative on first paint,
    // but will fetch latest data for fresh page loads.
    if (!userId) return;
    refreshChats().catch((err) => {
      // swallow errors in client-side hydration to avoid breaking UI
      console.warn("chat-provider: refreshChats failed", err);
    });
    // We intentionally do not add `chats` here: we want this to run once on mount
  }, [refreshChats, userId]);

  // Also refresh chats when tab regains focus/visibility (helps when changes are made elsewhere)
  useEffect(() => {
    const onFocus = () => {
      if (userId) refreshChats().catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && userId) {
        refreshChats().catch(() => {});
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshChats, userId]);

  const ensureChat = useCallback((chat: StoredChat) => {
    setChats((prev) => {
      const existingIndex = prev.findIndex((existing) => existing.id === chat.id);

      if (existingIndex === -1) {
        return [chat, ...prev];
      }

      const existing = prev[existingIndex];
      
      // When messages come from server (e.g., on page load), they have the authoritative metadata
      // Only keep existing messages if they're not present in the incoming batch
      let mergedMessages: StoredMessage[];
      
      if (chat.messages.length === 0) {
        // If incoming has no messages, keep existing
        mergedMessages = existing.messages;
      } else {
        // Incoming messages are authoritative - use them and only append any new messages from existing
        const incomingIds = new Set(chat.messages.map(m => m.id));
        const existingNew = existing.messages.filter(m => !incomingIds.has(m.id));
        mergedMessages = [...chat.messages, ...existingNew];
      }

      const updated: StoredChat = {
        ...existing,
        ...chat,
        title: chat.title || existing.title,
        timestamp: chat.timestamp || existing.timestamp,
        messages: mergedMessages,
      };

      if (
        updated.title === existing.title &&
        updated.timestamp === existing.timestamp &&
        updated.projectId === existing.projectId &&
        updated.messages === existing.messages
      ) {
        return prev;
      }

      const next = [...prev];
      next[existingIndex] = updated;
      return next;
    });
  }, []);

  const getProjectChats = useCallback(
    (projectId: string) => chats.filter((chat) => chat.projectId === projectId),
    [chats]
  );

  const value = useMemo(
    () => ({
      chats,
      globalChats: chats.filter((chat) => !chat.projectId),
      getProjectChats,
      refreshChats,
      createChat,
      appendMessages,
      updateMessage,
      updateChatTitle,
      ensureChat,
      removeMessage,
    }),
    [appendMessages, chats, createChat, ensureChat, getProjectChats, refreshChats, updateMessage, updateChatTitle, removeMessage]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatStore() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatStore must be used within a ChatProvider");
  }
  return ctx;
}
