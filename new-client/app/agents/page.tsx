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
    <div className="relative h-screen overflow-hidden bg-background text-foreground dark">
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="agents-bg absolute inset-0" />
      </div>

      <div className="relative z-10 flex h-full">
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
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false)
          setSettingsTab('personalization')
        }}
        initialTab={settingsTab}
      />

      <style jsx global>{`
        .agents-bg {
          --g1: rgba(56, 189, 248, 0.16);
          --g2: rgba(167, 139, 250, 0.16);
          --g3: rgba(16, 185, 129, 0.11);
          --g4: rgba(244, 114, 182, 0.10);
          background:
            radial-gradient(900px 600px at 10% 15%, var(--g1), transparent 60%),
            radial-gradient(800px 650px at 85% 20%, var(--g2), transparent 60%),
            radial-gradient(900px 700px at 55% 90%, var(--g3), transparent 62%),
            radial-gradient(850px 650px at 30% 70%, var(--g4), transparent 62%),
            conic-gradient(
              from 210deg at 50% 50%,
              rgba(56, 189, 248, 0.08),
              rgba(167, 139, 250, 0.07),
              rgba(16, 185, 129, 0.06),
              rgba(56, 189, 248, 0.08)
            );
          background-size: 160% 160%, 160% 160%, 160% 160%, 160% 160%, 240% 240%;
          background-position: 0% 0%, 100% 0%, 30% 100%, 70% 80%, 50% 50%;
          filter: blur(46px) saturate(1.2);
          transform: scale(1.15);
          animation: agents-flow 18s linear infinite;
          will-change: background-position, filter;
        }

        .agents-bg::before {
          content: "";
          position: absolute;
          inset: -20%;
          background:
            radial-gradient(700px 520px at 22% 30%, rgba(56, 189, 248, 0.10), transparent 62%),
            radial-gradient(720px 520px at 78% 65%, rgba(167, 139, 250, 0.10), transparent 62%),
            radial-gradient(650px 520px at 45% 55%, rgba(16, 185, 129, 0.07), transparent 62%);
          background-size: 180% 180%;
          animation: agents-flow-2 14s ease-in-out infinite;
          filter: blur(54px);
          opacity: 0.9;
          mix-blend-mode: screen;
          will-change: transform, opacity, filter;
        }

        .agents-bg::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            repeating-linear-gradient(
              0deg,
              rgba(255, 255, 255, 0.02),
              rgba(255, 255, 255, 0.02) 1px,
              transparent 1px,
              transparent 7px
            ),
            repeating-linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.015),
              rgba(255, 255, 255, 0.015) 1px,
              transparent 1px,
              transparent 9px
            );
          opacity: 0.12;
          mix-blend-mode: overlay;
          animation: agents-grain 9s ease-in-out infinite;
          will-change: transform, opacity;
        }

        @keyframes agents-flow {
          0% {
            background-position: 0% 0%, 100% 0%, 30% 100%, 70% 80%, 50% 50%;
            filter: blur(46px) saturate(1.2) hue-rotate(0deg);
          }
          25% {
            background-position: 20% 10%, 80% 20%, 45% 90%, 65% 65%, 45% 55%;
          }
          50% {
            background-position: 40% 25%, 60% 35%, 60% 80%, 55% 50%, 55% 45%;
            filter: blur(52px) saturate(1.25) hue-rotate(18deg);
          }
          75% {
            background-position: 25% 45%, 75% 55%, 40% 60%, 40% 70%, 48% 58%;
          }
          100% {
            background-position: 0% 0%, 100% 0%, 30% 100%, 70% 80%, 50% 50%;
            filter: blur(46px) saturate(1.2) hue-rotate(0deg);
          }
        }

        @keyframes agents-flow-2 {
          0% {
            transform: translate3d(-2%, -1%, 0) rotate(0deg) scale(1.02);
            filter: blur(54px) hue-rotate(0deg);
          }
          33% {
            transform: translate3d(3%, -2%, 0) rotate(6deg) scale(1.05);
          }
          66% {
            transform: translate3d(-1%, 3%, 0) rotate(-4deg) scale(1.08);
            filter: blur(60px) hue-rotate(22deg);
          }
          100% {
            transform: translate3d(-2%, -1%, 0) rotate(0deg) scale(1.02);
            filter: blur(54px) hue-rotate(0deg);
          }
        }

        @keyframes agents-grain {
          0% {
            transform: translate3d(0, 0, 0);
            opacity: 0.10;
          }
          50% {
            transform: translate3d(18px, -12px, 0);
            opacity: 0.14;
          }
          100% {
            transform: translate3d(0, 0, 0);
            opacity: 0.10;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .agents-bg,
          .agents-bg::before,
          .agents-bg::after {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
