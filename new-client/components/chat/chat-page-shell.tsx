"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatMessage } from "@/components/chat-message";
import { ChatComposer } from "@/components/chat-composer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { SettingsModal } from "@/components/settings-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjects } from "@/components/projects/projects-provider";
import { NewProjectModal } from "@/components/projects/new-project-modal";
import { useChatStore } from "@/components/chat/chat-provider";
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

interface Message {
  role: "user" | "assistant";
  content: string;
  model?: string;
  hasSources?: boolean;
  timestamp?: string;
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
  const [currentModel, setCurrentModel] = useState("GPT-5.1");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    activeConversationId ?? null
  );

  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
        role: m.role,
        content: m.content,
        model: "GPT-5.1",
        timestamp: m.timestamp,
      })),
    });
  }, [ensureChat, initialConversations, initialMessages, projectId]);

  const currentChat = chats.find((c) => c.id === selectedChatId);
  const messages = currentChat?.messages || [];

  useEffect(() => {
    if (currentChat?.projectId) {
      setSelectedProjectId(currentChat.projectId);
    } else if (selectedChatId) {
      setSelectedProjectId("");
    }
  }, [currentChat, selectedChatId]);

  const handleSubmit = (message: string) => {
    const now = new Date().toISOString();
    const newUserMessage: Message = { role: "user", content: message, timestamp: now };
    const demoAssistantMessage: Message = {
      role: "assistant",
      content: `This is a demo response to: "${message}". In a real app this would come from the model.`,
      model: currentModel,
      timestamp: now,
    };

    if (!selectedChatId) {
      const targetProjectId = selectedProjectId || projectId;
      const newChatId = createChat({
        projectId: targetProjectId,
        initialMessages: [
          { ...newUserMessage, id: `user-${Date.now()}` },
          { ...demoAssistantMessage, id: `assistant-${Date.now()}` },
        ],
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
      appendMessages(selectedChatId, [
        { ...newUserMessage, id: `user-${Date.now()}` },
        { ...demoAssistantMessage, id: `assistant-${Date.now()}` },
      ]);
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

            <Select value={currentModel} onValueChange={setCurrentModel}>
              <SelectTrigger className="h-9 w-auto gap-1 border-0 px-2 focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GPT-5.1">GPT-5.1</SelectItem>
                <SelectItem value="GPT-4 Turbo">GPT-4 Turbo</SelectItem>
                <SelectItem value="GPT-3.5">GPT-3.5</SelectItem>
                <SelectItem value="Claude 3">Claude 3</SelectItem>
              </SelectContent>
            </Select>
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
          <ScrollArea className="flex-1 overflow-auto">
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
        <div className="bg-background px-4 sm:px-6 lg:px-12 py-3 sm:py-4">
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
