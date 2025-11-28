"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import supabaseClient from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  model?: string;
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
  ensureChat: (chat: StoredChat) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

const getTitleFromMessages = (messages: StoredMessage[], fallback = "New chat") => {
  const firstMessage = messages.find((msg) => msg.role === "user") ?? messages[0];
  return firstMessage?.content?.slice(0, 80) || fallback;
};

interface ChatProviderProps {
  children: React.ReactNode;
  initialChats?: StoredChat[];
}

export function ChatProvider({ children, initialChats = [] }: ChatProviderProps) {
  const [chats, setChats] = useState<StoredChat[]>(initialChats);

  // Keep a stable ref to user id used for client subscriptions/queries
  const userId = getCurrentUserId();

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

      const rows = data ?? [];
      const hydrated: StoredChat[] = rows.map((row) => ({
        id: row.id,
        title: row.title ?? "Untitled chat",
        timestamp: row.created_at ?? new Date().toISOString(),
        projectId: row.project_id ?? undefined,
        messages: [],
      }));

      setChats(hydrated);
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
            const toAdd: StoredChat = {
              id: newRow.id,
              title: newRow.title ?? "Untitled chat",
              timestamp: newRow.created_at ?? new Date().toISOString(),
              projectId: newRow.project_id ?? undefined,
              messages: [],
            };
            setChats((prev) => [toAdd, ...prev.filter((c) => c.id !== toAdd.id)]);
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
            const newMessage: StoredMessage = {
              id: m.id,
              role: (m.role as "user" | "assistant") || "assistant",
              content: m.content ?? "",
              timestamp: m.created_at ?? new Date().toISOString(),
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

  const ensureChat = useCallback((chat: StoredChat) => {
    setChats((prev) => {
      const existingIndex = prev.findIndex((existing) => existing.id === chat.id);

      if (existingIndex === -1) {
        return [chat, ...prev];
      }

      const existing = prev[existingIndex];
      const mergedMessages =
        chat.messages.length >= existing.messages.length ? chat.messages : existing.messages;

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
      ensureChat,
    }),
    [appendMessages, chats, createChat, ensureChat, getProjectChats, refreshChats]
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
