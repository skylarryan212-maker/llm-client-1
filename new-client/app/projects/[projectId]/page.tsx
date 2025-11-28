"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Menu, Plus, ArrowLeft } from "lucide-react";

import { ChatSidebar } from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/components/projects/projects-provider";
import { NewProjectModal } from "@/components/projects/new-project-modal";
import { usePersistentSidebarOpen } from "@/lib/hooks/use-sidebar-open";
import { useChatStore } from "@/components/chat/chat-provider";
import { ChatComposer } from "@/components/chat-composer";
import { startProjectConversationAction } from "@/app/actions/chat-actions";
import { requestAutoNaming } from "@/lib/autoNaming";

import type { StoredChat, StoredMessage } from "@/components/chat/chat-provider";

const formatShortDate = (value?: string) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsed);
};

const getLatestUserPrompt = (messages: StoredMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === "user" && msg.content?.trim()) {
      return msg.content;
    }
  }
  return messages.length ? messages[messages.length - 1].content : "";
};

const getLatestMessageTimestamp = (messages: StoredMessage[], fallback?: string) => {
  if (messages.length) {
    return messages[messages.length - 1].timestamp || fallback;
  }
  return fallback;
};

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { projects, addProject } = useProjects();
  const { globalChats, chats, createChat } = useChatStore();

  const [isSidebarOpen, setIsSidebarOpen] = usePersistentSidebarOpen(true);
  const [currentModel, setCurrentModel] = useState("GPT-5.1");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(params.projectId);

  const projectId = params.projectId;

  const project = useMemo(
    () => projects.find((item) => item.id === projectId),
    [projects, projectId]
  );

  const handleNewProject = () => {
    setIsNewProjectOpen(true);
  };

  const handleProjectCreate = async (name: string) => {
    const newProject = await addProject(name);
    setIsNewProjectOpen(false);
    router.push(`/projects/${newProject.id}`);
  };

  const handleNewChat = () => {
    setSelectedChatId("");
    setSelectedProjectId("");
    router.push("/");
  };

  const handleChatSelect = (chatId: string) => {
    const chat = chats.find((item) => item.id === chatId);
    setSelectedChatId(chatId);
    if (chat?.projectId) {
      setSelectedProjectId(chat.projectId);
      router.push(`/projects/${chat.projectId}/c/${chatId}`);
    } else {
      setSelectedProjectId("");
      router.push(`/c/${chatId}`);
    }
  };

  const handleProjectChatSelect = (projectIdValue: string, chatId: string) => {
    setSelectedChatId(chatId);
    setSelectedProjectId(projectIdValue);
    router.push(`/projects/${projectIdValue}/c/${chatId}`);
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
    const map: Record<string, StoredChat[]> = {};
    chats.forEach((chat) => {
      if (!chat.projectId) return;
      if (!map[chat.projectId]) map[chat.projectId] = [];
      map[chat.projectId].push(chat);
    });
    return map;
  }, [chats]);

  const projectChatList = useMemo(() => {
    const list = projectConversations[projectId] ?? [];
    return [...list].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [projectConversations, projectId]);

  const handleProjectChatSubmit = async (message: string) => {
    const now = new Date().toISOString();
    const { conversationId, message: createdMessage, conversation } =
      await startProjectConversationAction({
        projectId,
        firstMessageContent: message,
      });

    const chatId = createChat({
      id: conversationId,
      projectId,
      initialMessages: [
        {
          id: createdMessage.id,
          role: "user",
          content: createdMessage.content ?? message,
          timestamp: createdMessage.created_at ?? now,
        },
      ],
      title: conversation.title ?? "New chat",
    });

    setSelectedChatId(chatId);
    setSelectedProjectId(projectId);
    requestAutoNaming(conversationId, message).catch((err) =>
      console.error("Failed to auto-name project chat:", err)
    );
    router.push(`/projects/${projectId}/c/${chatId}`);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground dark">
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((open) => !open)}
        currentModel={currentModel}
        onModelSelect={setCurrentModel}
        selectedChatId={selectedChatId}
        conversations={sidebarConversations}
        projects={projects}
        projectChats={projectConversations}
        onChatSelect={handleChatSelect}
        onProjectChatSelect={handleProjectChatSelect}
        onNewChat={handleNewChat}
        onNewProject={handleNewProject}
        onProjectSelect={(id) => {
          setSelectedProjectId(id);
          router.push(`/projects/${id}`);
        }}
        selectedProjectId={selectedProjectId}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-12 lg:py-16">
          <div className="mx-auto w-full max-w-3xl space-y-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSidebarOpen(true)}
                  className="h-8 w-8 lg:hidden"
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => router.push("/projects")}
                  className="h-8 w-8"
                  title="Back to projects"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <p className="text-sm text-muted-foreground">Project</p>
                  <h1 className="text-3xl font-bold text-foreground">
                    {project?.name ?? "Unknown project"}
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleNewProject} className="gap-2">
                  <Plus className="h-4 w-4" />
                  New Project
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <ChatComposer onSubmit={handleProjectChatSubmit} />
              <div className="border-t border-b border-border bg-transparent">
                {projectChatList.length ? (
                  <div className="max-h-[360px] divide-y divide-border overflow-y-auto">
                    {projectChatList.map((chat) => {
                      const preview = getLatestUserPrompt(chat.messages);
                      const latestTimestamp = getLatestMessageTimestamp(chat.messages, chat.timestamp);
                      return (
                        <button
                          key={chat.id}
                          type="button"
                          onClick={() => handleProjectChatSelect(projectId ?? "", chat.id)}
                          className="group/chat w-full bg-transparent px-3 py-3 text-left transition hover:bg-muted"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {chat.title || "Untitled chat"}
                            </span>
                            <span className="text-xs font-medium text-muted-foreground">
                              {formatShortDate(latestTimestamp)}
                            </span>
                          </div>
                          {preview && (
                            <p className="text-xs text-muted-foreground truncate">
                              {preview}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-4 text-sm text-muted-foreground">
                    No project chats yet. Send a prompt to start one.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={handleProjectCreate}
      />
    </div>
  );
}
