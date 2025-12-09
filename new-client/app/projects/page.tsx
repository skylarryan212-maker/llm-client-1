"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Plus } from "lucide-react";

import { ChatSidebar } from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { SettingsModal } from "@/components/settings-modal";
import { useProjects } from "@/components/projects/projects-provider";
import { ProjectCard } from "@/components/projects/project-card";
import { NewProjectModal } from "@/components/projects/new-project-modal";
import { usePersistentSidebarOpen } from "@/lib/hooks/use-sidebar-open";
import { useChatStore } from "@/components/chat/chat-provider";

export default function ProjectsPage() {
  const [isSidebarOpen, setIsSidebarOpen] = usePersistentSidebarOpen(true);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'personalization'>('personalization');
  const { projects, addProject, refreshProjects } = useProjects();
  const { globalChats, chats, refreshChats } = useChatStore();
  const router = useRouter();

  const handleNewProject = () => {
    setIsNewProjectOpen(true);
  };

  const handleProjectCreate = async (name: string) => {
    const newProject = await addProject(name);
    setSelectedProjectId(newProject.id);
    setIsNewProjectOpen(false);
    router.push(`/projects/${newProject.id}`);
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectId(projectId);
    router.push(`/projects/${projectId}`);
  };

  const handleNewChat = () => {
    router.push("/");
  };

  const handleChatSelect = (chatId: string) => {
    const chat = chats.find((item) => item.id === chatId);
    if (chat?.projectId) {
      setSelectedProjectId(chat.projectId);
      router.push(`/projects/${chat.projectId}/c/${chatId}`);
    } else {
      setSelectedProjectId("");
      router.push(`/c/${chatId}`);
    }
  };

  const handleProjectChatSelect = (projectIdValue: string, chatId: string) => {
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

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground dark">
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((open) => !open)}
        selectedChatId={""}
        conversations={sidebarConversations}
        projects={projects}
        projectChats={projectConversations}
        onChatSelect={handleChatSelect}
        onProjectChatSelect={handleProjectChatSelect}
        onNewChat={handleNewChat}
        onNewProject={handleNewProject}
        onProjectSelect={handleProjectSelect}
        selectedProjectId={selectedProjectId}
        onRefreshChats={refreshChats}
        onRefreshProjects={refreshProjects}
        onSettingsOpen={() => {
          setSettingsTab('personalization')
          setIsSettingsOpen(true)
        }}
        onGeneralSettingsOpen={() => {
          setSettingsTab('general')
          setIsSettingsOpen(true)
        }}
      />

      <div className="flex-1 overflow-y-auto h-full">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12 lg:py-16">
          <div className="flex items-center justify-between gap-3 mb-8">
            <div>
              <p className="text-sm text-muted-foreground">Projects</p>
              <h1 className="text-3xl font-bold text-foreground">Workspace</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(true)}
                className="h-8 w-8 lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </Button>
              <Button onClick={handleNewProject} className="accent-new-project-button gap-2">
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onUpdate={refreshProjects} />
            ))}
          </div>

          {projects.length === 0 && (
            <div className="mt-10 rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
              <p className="text-lg font-semibold text-foreground">No projects yet</p>
              <p className="text-sm text-muted-foreground">
                Create a project to organize chats, files, and settings.
              </p>
              <Button className="mt-4" onClick={handleNewProject}>
                Start a project
              </Button>
            </div>
          )}
        </div>
      </div>

      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={handleProjectCreate}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false)
          setSettingsTab('personalization')
        }}
        initialTab={settingsTab}
      />
    </div>
  );
}
