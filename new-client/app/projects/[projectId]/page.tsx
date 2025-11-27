"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarIcon, Menu, Plus, ArrowLeft } from "lucide-react";

import { ChatSidebar } from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/components/projects/projects-provider";
import { NewProjectModal } from "@/components/projects/new-project-modal";
import { usePersistentSidebarOpen } from "@/lib/hooks/use-sidebar-open";
import { useChatStore } from "@/components/chat/chat-provider";
import { ChatComposer } from "@/components/chat-composer";

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

  const handleProjectCreate = (name: string) => {
    const newProject = addProject(name);
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
    const map: Record<string, { id: string; title: string; timestamp: string }[]> = {};
    chats.forEach((chat) => {
      if (!chat.projectId) return;
      if (!map[chat.projectId]) map[chat.projectId] = [];
      map[chat.projectId].push({
        id: chat.id,
        title: chat.title,
        timestamp: chat.timestamp,
      });
    });
    return map;
  }, [chats]);

  const handleProjectChatSubmit = (message: string) => {
    const now = new Date().toISOString();
    const chatId = createChat({
      projectId,
      initialMessages: [
        { id: `user-${Date.now()}`, role: "user", content: message, timestamp: now },
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `This is a demo response to: "${message}". In a real app this would come from the model.`,
          timestamp: now,
          model: currentModel,
        },
      ],
      title: message.slice(0, 80) || "New chat",
    });

    setSelectedChatId(chatId);
    setSelectedProjectId(projectId);
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
          <div className="flex items-center justify-between gap-3 mb-6">
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="rounded-lg border border-border bg-card p-4 sm:col-span-2">
              <h2 className="text-lg font-semibold text-foreground">About this project</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {project?.description ||
                  "Project details are mocked for now. Use this space to describe goals, scope, or linked chats."}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarIcon className="h-4 w-4" />
                <span>Created</span>
              </div>
              <p className="text-base font-medium text-foreground">{project?.createdAt}</p>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6">
            <p className="text-base font-semibold text-foreground">Project chats</p>
            <p className="text-sm text-muted-foreground">
              Chats started from here stay in local memory for now. Use the composer below to begin.
            </p>
            <div className="mt-4 mx-auto w-full max-w-3xl">
              <ChatComposer onSubmit={handleProjectChatSubmit} />
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
