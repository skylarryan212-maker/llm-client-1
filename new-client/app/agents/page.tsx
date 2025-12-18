"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";

import { AgentCard } from "@/components/agent-card";
import { ChatSidebar } from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { SettingsModal } from "@/components/settings-modal";
import { useProjects } from "@/components/projects/projects-provider";
import { useChatStore } from "@/components/chat/chat-provider";
import { usePersistentSidebarOpen } from "@/lib/hooks/use-sidebar-open";
import { navigateWithMainPanelFade, runMainPanelEnterIfNeeded } from "@/lib/view-transitions";
import { AGENT_CATALOG } from "@/lib/agents/agentCatalog";

export default function AgentsPage() {
  const router = useRouter();
  const { projects, refreshProjects } = useProjects();
  const { chats, globalChats, refreshChats } = useChatStore();
  const [isSidebarOpen, setIsSidebarOpen] = usePersistentSidebarOpen(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'preferences' | 'data' | 'account'>('preferences');
  const mainPanelRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    runMainPanelEnterIfNeeded(mainPanelRef.current);
  }, []);

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
      void navigateWithMainPanelFade(router, `/projects/${chat.projectId}/c/${chatId}`);
      return;
    }

    void navigateWithMainPanelFade(router, `/c/${chatId}`);
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full bg-background text-foreground dark overflow-hidden overscroll-y-none">
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((open) => !open)}
        selectedChatId={""}
        conversations={sidebarConversations}
        projects={projects}
        projectChats={projectChatMap}
        onChatSelect={handleChatSelect}
        onProjectChatSelect={(projectId, chatId) =>
          void navigateWithMainPanelFade(router, `/projects/${projectId}/c/${chatId}`)
        }
        onNewChat={() => void navigateWithMainPanelFade(router, "/")}
        onNewProject={() => void navigateWithMainPanelFade(router, "/projects")}
        onProjectSelect={(projectId) => void navigateWithMainPanelFade(router, `/projects/${projectId}`)}
        onSettingsOpen={() => {
          setSettingsTab('preferences')
          setIsSettingsOpen(true)
        }}
        onGeneralSettingsOpen={() => {
          setSettingsTab('data')
          setIsSettingsOpen(true)
        }}
        onRefreshChats={refreshChats}
        onRefreshProjects={refreshProjects}
      />

      <div
        ref={mainPanelRef}
        data-main-panel="true"
        className="chat-ambient-bg agents-ambient-bg flex flex-1 flex-col w-full min-w-0 min-h-0 overflow-hidden"
        style={{ viewTransitionName: "main-panel" }}
      >
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
              {AGENT_CATALOG.map((agent) => (
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
          setSettingsTab('preferences')
        }}
        initialTab={settingsTab}
      />
    </div>
  );
}
