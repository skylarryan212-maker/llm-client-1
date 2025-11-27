"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarIcon, Menu, MessageSquare, Plus, ArrowLeft } from "lucide-react";

import { ChatSidebar } from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/components/projects/projects-provider";
import { NewProjectModal } from "@/components/projects/new-project-modal";

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { projects, addProject } = useProjects();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState("GPT-5.1");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

  const projectId = params.projectId;

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
    const id = `${projectId || "project"}-chat-${Date.now()}`;
    router.push(`/c/${id}`);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground dark">
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        currentModel={currentModel}
        onModelSelect={setCurrentModel}
        selectedChatId={""}
        conversations={[]}
        projects={projects}
        onNewChat={() => router.push("/")}
        onNewProject={handleNewProject}
        onProjectSelect={(id) => router.push(`/projects/${id}`)}
        selectedProjectId={projectId}
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
              <Button variant="secondary" className="gap-2" onClick={handleNewChat}>
                <MessageSquare className="h-4 w-4" />
                New Chat
              </Button>
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

          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
            <p className="text-base font-semibold text-foreground">Project chats</p>
            <p className="text-sm text-muted-foreground">
              Chats started from here stay in local memory for now. Use the New Chat button above to begin.
            </p>
            <Button className="mt-4 gap-2" onClick={handleNewChat}>
              <MessageSquare className="h-4 w-4" />
              Start a chat
            </Button>
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
