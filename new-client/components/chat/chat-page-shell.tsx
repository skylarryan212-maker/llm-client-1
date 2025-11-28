"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatMessage } from "@/components/chat-message";
import { ChatComposer } from "@/components/chat-composer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowDown, Check, ChevronDown, Menu } from "lucide-react";
import { SettingsModal } from "@/components/settings-modal";
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
import { normalizeModelFamily, normalizeSpeedMode, getModelSettingsFromDisplayName } from "@/lib/modelConfig";
import type { ModelFamily, SpeedMode, ReasoningEffort } from "@/lib/modelConfig";
import { isPlaceholderTitle } from "@/lib/conversation-utils";

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

interface ChatPageShellProps {
  conversations: ShellConversation[];
  activeConversationId: string | null; // allow null for "/"
  messages: ServerMessage[];
  searchParams: Record<string, string | string[] | undefined>;
  projectId?: string;
}

export default function ChatPageShell({
  conversations: initialConversations,
  activeConversationId,
  messages: initialMessages,
  projectId,
}: ChatPageShellProps) {
  const router = useRouter();
  const { projects, addProject } = useProjects();
  const {
    chats,
    globalChats,
    createChat,
    appendMessages,
    updateMessage,
    removeMessage,
    ensureChat,
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
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    setSelectedChatId(activeConversationId ?? null);
  }, [activeConversationId]);

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

  const handleSubmit = async (message: string) => {
    const now = new Date().toISOString();
    const userMessage: StoredMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: now,
    };

    if (!selectedChatId) {
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
        };

        const newChatId = createChat({
          id: conversationId,
          projectId: targetProjectId,
          initialMessages: [mappedMessage],
          title: conversation.title ?? "New chat",
        });
        setSelectedChatId(newChatId);
        setSelectedProjectId(targetProjectId);
        router.push(`/projects/${targetProjectId}/c/${newChatId}`);
        
        // Stream the model response without inserting the user message again
        await streamModelResponse(conversationId, targetProjectId, message, newChatId, true);
      } else {
        const { conversationId, message: createdMessage, conversation } =
          await startGlobalConversationAction(message);

        const mappedMessage: StoredMessage = {
          id: createdMessage.id,
          role: "user",
          content: createdMessage.content ?? message,
          timestamp: createdMessage.created_at ?? now,
        };

        const newChatId = createChat({
          id: conversationId,
          initialMessages: [mappedMessage],
          title: conversation.title ?? "New chat",
        });
        setSelectedChatId(newChatId);
        setSelectedProjectId("");
        router.push(`/c/${newChatId}`);
        
        // Stream the model response without inserting the user message again
        await streamModelResponse(conversationId, undefined, message, newChatId, true);
      }
    } else {
      // For existing chats, just append the user message to UI
      // (The /api/chat endpoint will persist it to the database)
      appendMessages(selectedChatId, [userMessage]);
      
        // Stream the model response and insert the user message on server
        await streamModelResponse(selectedChatId, selectedProjectId || undefined, message, selectedChatId, false);
    }
  };

  const triggerAutoNaming = async (
    conversationId: string,
    userMessage: string,
    conversationTitle: string | undefined
  ) => {
    // Only generate title if this is a new conversation with placeholder title
    if (!isPlaceholderTitle(conversationTitle)) {
      return;
    }

    // Fire-and-forget title generation
    try {
      await fetch("/api/conversations/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          userMessage,
        }),
      });
      console.log(`[titleDebug] triggered auto-naming for conversation ${conversationId}`);
    } catch (error) {
      console.error("Auto-naming trigger failed:", error);
    }
  };

  const streamModelResponse = async (
    conversationId: string,
    projectId: string | undefined,
    message: string,
    chatId: string,
    skipUserInsert: boolean = false
  ) => {
    try {
      // Get model settings from current display selection
      const { modelFamily, speedMode, reasoningEffort } = getModelSettingsFromDisplayName(currentModel);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          projectId,
          message,
          modelFamilyOverride: modelFamily,
          speedModeOverride: speedMode,
          reasoningEffortOverride: reasoningEffort,
          skipUserInsert,
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
      const assistantMessageId = `assistant-streaming-${Date.now()}`;
      let messageMetadata: Record<string, unknown> | null = null;

      // Add the initial empty assistant message
      appendMessages(chatId, [
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
        },
      ]);

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
                // Update the assistant message with new content
                updateMessage(chatId, assistantMessageId, {
                  content: assistantContent,
                });
              } else if (parsed.meta) {
                // Capture metadata from API response
                messageMetadata = {
                  modelUsed: parsed.meta.model,
                  reasoningEffort: parsed.meta.reasoningEffort,
                  resolvedFamily: parsed.meta.resolvedFamily,
                  speedModeUsed: parsed.meta.speedModeUsed,
                  userRequestedFamily: modelFamily,
                  userRequestedSpeedMode: speedMode,
                  userRequestedReasoningEffort: reasoningEffort,
                };
                // Replace the temporary ID with the persisted row ID and store metadata
                const newId = parsed.meta.assistantMessageRowId;
                updateMessage(chatId, assistantMessageId, { 
                  id: newId,
                  metadata: messageMetadata,
                });
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

      // After streaming completes, check if we need to auto-generate a title
      // Count assistant messages before this one (skip the one we just added)
      const assistantMessagesBeforeThis = messages.filter(m => m.role === "assistant").length;
      
      // Only trigger auto-naming after the first assistant response
      if (assistantMessagesBeforeThis === 0) {
        const conversation = chats.find(c => c.id === conversationId);
        if (conversation) {
          await triggerAutoNaming(conversationId, message, conversation.title);
        }
      }
    } catch (error) {
      console.error("Error streaming model response:", error);
    }
  };

  const handleRetryWithModel = async (retryModelName: string, messageId: string) => {
    if (!selectedChatId) return;

    // Find the user message that precedes this assistant message
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex <= 0) return;

    const userMessage = messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== "user") return;

     // Map retry model name to model settings (without changing the UI dropdown)
     let retryModelFamily = "gpt-5-mini";
     let retrySpeedMode = "auto";
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

    // Delete the old assistant message from Supabase
    try {
      await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
    } catch (error) {
      console.error("Error deleting old assistant message:", error);
    }

    // Remove the assistant message from UI (local state)
    removeMessage(selectedChatId, messageId);

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
       const assistantMessageId = `assistant-streaming-${Date.now()}`;
       let messageMetadata: Record<string, unknown> | null = null;

       // Add the initial empty assistant message
       appendMessages(selectedChatId, [
         {
           id: assistantMessageId,
           role: "assistant",
           content: "",
           timestamp: new Date().toISOString(),
         },
       ]);

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
                 // Update the assistant message with new content
                 updateMessage(selectedChatId, assistantMessageId, {
                   content: assistantContent,
                 });
               } else if (parsed.meta) {
                 // Capture metadata from API response
                 messageMetadata = {
                   modelUsed: parsed.meta.model,
                   reasoningEffort: parsed.meta.reasoningEffort,
                   resolvedFamily: parsed.meta.resolvedFamily,
                   speedModeUsed: parsed.meta.speedModeUsed,
                   userRequestedFamily: retryModelFamily,
                   userRequestedSpeedMode: retrySpeedMode,
                   userRequestedReasoningEffort: undefined,
                 };
                 // Replace the temporary ID with the persisted row ID and store metadata
                 const newId = parsed.meta.assistantMessageRowId;
                 updateMessage(selectedChatId, assistantMessageId, { 
                   id: newId,
                   metadata: messageMetadata,
                 });
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
              <div className="w-full px-4 sm:px-6 lg:px-12 space-y-4">
                {messages.map((message, index) => (
                  <ChatMessage 
                    key={index} 
                    {...message}
                    onRetry={message.role === 'assistant' ? (model) => handleRetryWithModel(model, message.id) : undefined}
                  />
                ))}
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
            <ChatComposer onSubmit={handleSubmit} />
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
