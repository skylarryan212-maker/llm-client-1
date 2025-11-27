"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatMessage } from "@/components/chat-message";
import { ChatComposer } from "@/components/chat-composer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowDown, ChevronDown, Menu } from "lucide-react";
import { SettingsModal } from "@/components/settings-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjects } from "@/components/projects/projects-provider";
import { NewProjectModal } from "@/components/projects/new-project-modal";
import { StoredMessage, useChatStore } from "@/components/chat/chat-provider";
import { usePersistentSidebarOpen } from "@/lib/hooks/use-sidebar-open";

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

    const first = initialConversations[0];
    ensureChat({
      id: first.id,
      title: first.title,
      timestamp: first.timestamp ?? new Date().toISOString(),
      projectId: projectId ?? first.projectId,
      messages: initialMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: "GPT 5.1",
        timestamp: m.timestamp,
      })),
    });
  }, [ensureChat, initialConversations, initialMessages, projectId]);

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

  const handleSubmit = (message: string) => {
    const now = new Date().toISOString();
    const userMessage: StoredMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: now,
    };
    const assistantMessage: StoredMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: `This is a demo response to: "${message}". In a real app this would come from the model.`,
      model: currentModel,
      timestamp: now,
    };

    if (!selectedChatId) {
      const targetProjectId = selectedProjectId || projectId;
      const newChatId = createChat({
        projectId: targetProjectId,
        initialMessages: [userMessage, assistantMessage],
        title: message.slice(0, 80) || "New chat",
      });
      setSelectedChatId(newChatId);
      if (targetProjectId) {
        setSelectedProjectId(targetProjectId);
        router.push(`/projects/${targetProjectId}/c/${newChatId}`);
      } else {
        router.push(`/c/${newChatId}`);
      }
    } else {
      appendMessages(selectedChatId, [userMessage, assistantMessage]);
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
  }, [messages.length, isAutoScroll]);

  const handleNewProject = () => {
    setIsNewProjectOpen(true);
  };

  const handleProjectCreate = (name: string) => {
    const newProject = addProject(name);
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
                  className="h-9 w-auto gap-1.5 border-0 px-2 text-base font-semibold"
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
                <div className="px-2 pb-1 text-sm font-semibold text-muted-foreground">
                  GPT 5.1
                </div>
                <DropdownMenuRadioGroup
                  value={currentModel}
                  onValueChange={setCurrentModel}
                >
                  <DropdownMenuRadioItem
                    value="Auto"
                    className="items-center gap-3 px-2 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium leading-none">Auto</span>
                      <span className="text-xs text-muted-foreground">
                        Decides how long to think
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="Instant"
                    className="items-center gap-3 px-2 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium leading-none">Instant</span>
                      <span className="text-xs text-muted-foreground">
                        Answers right away
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="Thinking"
                    className="items-center gap-3 px-2 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium leading-none">Thinking</span>
                      <span className="text-xs text-muted-foreground">
                        Thinks longer for better answers
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <div className="px-2">
                  <div className="h-px bg-border" />
                </div>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="items-center gap-3 px-2 py-2">
                    <div className="flex flex-col text-left">
                      <span className="font-medium leading-none">
                        Other models
                      </span>
                    </div>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56">
                    <DropdownMenuRadioGroup
                      value={currentModel}
                      onValueChange={setCurrentModel}
                    >
                      <DropdownMenuRadioItem value="GPT 5 Pro">
                        GPT 5 Pro
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
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
                  strokeWidth="1.5"
                  d="M8.684 13.342a3 3 0 10-1.368 5.342m1.368-5.342l6.632-3.316m-6.632 3.316a3 3 0 111.368-5.342m5.264 2.026a3 3 0 105.368-2.684 3 3 0 00-5.368 2.684z"
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
                  strokeWidth="1.5"
                  d="M3 7h18M5 7V5a2 2 0 012-2h10a2 2 0 012 2v2m-2 4H7m0 0v8a2 2 0 002 2h6a2 2 0 002-2v-8m-10 4h4"
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
                  <ChatMessage key={index} {...message} />
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
