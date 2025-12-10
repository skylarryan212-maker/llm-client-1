"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Code2, Database, Menu, PenLine, TrendingUp, Workflow } from "lucide-react";

import { AgentCard } from "@/components/agent-card";
import { ChatSidebar } from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { SettingsModal } from "@/components/settings-modal";
import { useProjects } from "@/components/projects/projects-provider";
import { useChatStore } from "@/components/chat/chat-provider";
import { usePersistentSidebarOpen } from "@/lib/hooks/use-sidebar-open";

const agents = [
  {
    icon: Code2,
    title: "Codex",
    description:
      "Your AI coding assistant. Build applications, review code, debug issues, and get expert programming guidance across all major languages and frameworks.",
    href: "/agents/codex",
    gradient: "bg-gradient-to-br from-blue-500 to-purple-600",
  },
  {
    icon: TrendingUp,
    title: "Market Agent",
    description:
      "Real-time market analysis and insights. Track trends, analyze data, generate reports, and make data-driven decisions with AI-powered market intelligence.",
  },
  {
    icon: Workflow,
    title: "Automation Builder",
    description:
      "Design and deploy intelligent workflows. Connect APIs, automate tasks, orchestrate complex processes, and streamline operations effortlessly.",
  },
  {
    icon: PenLine,
    title: "Human Writing Agent",
    description:
      "Produce clear, human-quality writing fast. Draft emails, docs, and narratives with tone control and structure that feels natural.",
    href: "/agents/human-writing",
    gradient: "bg-gradient-to-br from-amber-500/25 via-orange-500/15 to-rose-500/25",
  },
  {
    icon: Database,
    title: "Data Interpreter",
    description:
      "Transform raw data into actionable insights. Analyze datasets, create visualizations, run queries, and extract meaningful patterns from your data.",
  },
];

export default function AgentsPage() {
  const router = useRouter();
  const { projects, refreshProjects } = useProjects();
  const { chats, globalChats, refreshChats } = useChatStore();
  const [isSidebarOpen, setIsSidebarOpen] = usePersistentSidebarOpen(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'personalization'>('personalization');

  const sidebarConversations = useMemo(
    () =>
      globalChats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        timestamp: chat.timestamp,
      })),
    [globalChats]
  );

  const projectChatMap = useMemo(() => {
    const map: Record<string, { id: string; title: string; timestamp: string; projectId: string }[]> = {};

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

  const handleChatSelect = (chatId: string) => {
    const chat = chats.find((item) => item.id === chatId);
    if (chat?.projectId) {
      router.push(`/projects/${chat.projectId}/c/${chatId}`);
      return;
    }

    router.push(`/c/${chatId}`);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground dark">
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((open) => !open)}
        selectedChatId={""}
        conversations={sidebarConversations}
        projects={projects}
        projectChats={projectChatMap}
        onChatSelect={handleChatSelect}
        onProjectChatSelect={(projectId, chatId) =>
          router.push(`/projects/${projectId}/c/${chatId}`)
        }
        onNewChat={() => router.push("/")}
        onNewProject={() => router.push("/projects")}
        onProjectSelect={(projectId) => router.push(`/projects/${projectId}`)}
        onSettingsOpen={() => {
          setSettingsTab('personalization')
          setIsSettingsOpen(true)
        }}
        onGeneralSettingsOpen={() => {
          setSettingsTab('general')
          setIsSettingsOpen(true)
        }}
        onRefreshChats={refreshChats}
        onRefreshProjects={refreshProjects}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12 lg:py-16">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSidebarOpen(true)}
            className="mb-4 h-8 w-8 lg:hidden"
            aria-label="Open sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>

          {!isSidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(true)}
              className="mb-4 h-8 w-8 hidden lg:block"
              aria-label="Expand sidebar"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" />
                <line x1="9" y1="3" x2="9" y2="21" strokeWidth="2" />
              </svg>
            </Button>
          )}

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
              <AgentCard
                key={agent.title}
                {...agent}
                onClick={!agent.href ? () => console.log(`${agent.title} coming soon`) : undefined}
              />
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
