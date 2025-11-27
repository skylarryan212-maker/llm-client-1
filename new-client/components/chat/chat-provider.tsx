"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

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
  createChat: (options: {
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

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [chats, setChats] = useState<StoredChat[]>([]);

  const createChat = useCallback(
    ({ projectId, title, initialMessages = [] }: {
      projectId?: string;
      title?: string;
      initialMessages?: StoredMessage[];
    }) => {
      const chatId = `chat-${Date.now()}`;
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

  const ensureChat = useCallback((chat: StoredChat) => {
    setChats((prev) => {
      if (prev.some((existing) => existing.id === chat.id)) {
        return prev;
      }
      return [chat, ...prev];
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
      createChat,
      appendMessages,
      ensureChat,
    }),
    [appendMessages, chats, createChat, ensureChat, getProjectChats]
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
