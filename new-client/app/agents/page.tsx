"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Code2, Database, Menu, TrendingUp, Workflow } from "lucide-react";

import { ChatSidebar } from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { AgentCard } from "@/components/agents/agent-card";
import { useProjects } from "@/components/projects/projects-provider";
import { NewProjectModal } from "@/components/projects/new-project-modal";

const agents = [
  {
    icon: Code2,
    title: "Codex",
    description:
      "Your AI coding assistant. Build applications, review code, debug issues, and get expert programming guidance across all major languages and frameworks.",
    href: "/c/codex",
    gradient: "bg-gradient-to-br from-blue-500 to-purple-600",
  },
  {
    icon: TrendingUp,
    title: "Market Agent",
    description:
      "Real-time market analysis and insights. Track trends, analyze data, generate reports, and make data-driven decisions with AI-powered market intelligence.",
    href: "/c/market",
    gradient: "bg-gradient-to-br from-green-500 to-emerald-600",
  },
  {
    icon: Workflow,
    title: "Automation Builder",
    description:
      "Design and deploy intelligent workflows. Connect APIs, automate tasks, orchestrate complex processes, and streamline operations effortlessly.",
    href: "/c/automation",
    gradient: "bg-gradient-to-br from-orange-500 to-red-600",
  },
  {
    icon: Database,
    title: "Data Interpreter",
    description:
      "Transform raw data into actionable insights. Analyze datasets, create visualizations, run queries, and extract meaningful patterns from your data.",
    href: "/c/data",
    gradient: "bg-gradient-to-br from-cyan-500 to-blue-600",
  },
];

export default function AgentsPage() {
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

  const handleChatSelect = (chatId: string) => {
    router.push(`/c/${chatId}`);
  };

  const handleNewChat = () => {
    router.push("/");
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectId(projectId);
    router.push(`/projects/${projectId}`);
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
        onChatSelect={handleChatSelect}
        onNewChat={handleNewChat}
        onNewProject={handleNewProject}
        onProjectSelect={handleProjectSelect}
        selectedProjectId={selectedProjectId}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12 lg:py-16">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSidebarOpen(true)}
            className="mb-4 h-8 w-8 lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </Button>

          <div className="mb-8 sm:mb-12 space-y-3 sm:space-y-4">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground">
              Choose Your AI Agent
            </h1>

            <p className="max-w-2xl text-base sm:text-lg leading-relaxed text-muted-foreground">
              Select a specialized agent to help you with your tasks. Each agent is optimized for specific workflows and equipped with powerful AI capabilities.
            </p>
          </div>

          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2">
            {agents.map((agent) => (
              <AgentCard key={agent.title} {...agent} />
            ))}
          </div>

          <div className="mt-12 sm:mt-16 rounded-xl border border-border bg-card/50 p-6 sm:p-8">
            <div className="flex flex-col items-center gap-3 sm:gap-4 text-center">
              <h2 className="text-xl sm:text-2xl font-semibold text-foreground">Need a custom agent?</h2>
              <p className="max-w-xl text-sm text-muted-foreground">
                Create your own specialized AI agent tailored to your unique workflow and requirements.
              </p>
              <button className="mt-2 rounded-full bg-primary px-5 sm:px-6 py-2 sm:py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Create Custom Agent
              </button>
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
