"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Plus } from "lucide-react";

import { ChatSidebar } from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/components/projects/projects-provider";
import { ProjectCard } from "@/components/projects/project-card";
import { NewProjectModal } from "@/components/projects/new-project-modal";

export default function ProjectsPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState("GPT-5.1");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const { projects, addProject } = useProjects();
  const router = useRouter();

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

  const handleNewProject = () => {
    setIsNewProjectOpen(true);
  };

  const handleProjectCreate = (name: string) => {
    const newProject = addProject(name);
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
        onNewChat={handleNewChat}
        onNewProject={handleNewProject}
        onProjectSelect={handleProjectSelect}
        selectedProjectId={selectedProjectId}
      />

      <div className="flex-1 overflow-y-auto">
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
              <Button onClick={handleNewProject} className="gap-2">
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
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
    </div>
  );
}
