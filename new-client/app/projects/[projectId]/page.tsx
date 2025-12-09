"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Menu, Plus, ArrowLeft } from 'lucide-react'
import { ChatContextMenu } from '@/components/chat-context-menu'
import { renameConversationAction, moveConversationToProjectAction, deleteConversationAction } from '@/app/actions/chat-actions'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { X, FolderPlus } from 'lucide-react'

import { ChatSidebar } from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { SettingsModal } from "@/components/settings-modal";
import { useProjects } from "@/components/projects/projects-provider";
import { NewProjectModal } from "@/components/projects/new-project-modal";
import { ProjectIconEditor } from "@/components/project-icon-editor";
import { usePersistentSidebarOpen } from "@/lib/hooks/use-sidebar-open";
import { useChatStore } from "@/components/chat/chat-provider";
import { ChatComposer } from "@/components/chat-composer";
import { startProjectConversationAction } from "@/app/actions/chat-actions";
import { updateProjectIconAction } from "@/app/actions/project-actions";
import { requestAutoNaming } from "@/lib/autoNaming";
import { useUserIdentity } from "@/components/user-identity-provider";

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

type ActiveAction =
  | { type: 'renameChat'; chatId: string; currentTitle?: string }
  | { type: 'moveChat'; chatId: string; currentProjectId?: string }
  | { type: 'deleteChat'; chatId: string; currentTitle?: string };

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { projects, addProject, refreshProjects } = useProjects();
  const { globalChats, chats, createChat, refreshChats, ensureChat } = useChatStore();
  const { isGuest } = useUserIdentity();

  const [isSidebarOpen, setIsSidebarOpen] = usePersistentSidebarOpen(true);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(params.projectId);
  const [guestWarning, setGuestWarning] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'personalization'>('personalization');
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);
  const [pendingName, setPendingName] = useState('');

  const projectId = params.projectId;

  const project = useMemo(
    () => projects.find((item) => item.id === projectId),
    [projects, projectId]
  );

  const shouldRedirectToProjects = projects.length > 0 && !project;

  useEffect(() => {
    if (isGuest) {
      setGuestWarning("Guest mode: view only. Sign in to manage projects and chats.");
    }
  }, [isGuest]);

  useEffect(() => {
    if (!activeAction) {
      setPendingName('');
      return;
    }

    if (activeAction.type === 'renameChat') {
      setPendingName(activeAction.currentTitle ?? '');
    }
  }, [activeAction]);

  useEffect(() => {
    if (!shouldRedirectToProjects) return;
    router.push("/projects");
  }, [router, shouldRedirectToProjects]);

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

  if (shouldRedirectToProjects) {
    return null;
  }

  const handleNewProject = () => {
    if (isGuest) {
      setGuestWarning("Sign in to create and save projects.");
      return;
    }
    setIsNewProjectOpen(true);
  };

  const handleProjectCreate = async (name: string) => {
    if (isGuest) {
      setGuestWarning("Sign in to create and save projects.");
      setIsNewProjectOpen(false);
      return;
    }
    const newProject = await addProject(name);
    setIsNewProjectOpen(false);
    router.push(`/projects/${newProject.id}`);
  };

  const handleNewChat = () => {
    if (isGuest) {
      setGuestWarning("Guest mode: sign in to save chats.");
      return;
    }
    setSelectedChatId("");
    setSelectedProjectId("");
    router.push("/");
  };

  const handleChatSelect = (chatId: string) => {
    if (isGuest) {
      setGuestWarning("Guest mode: sign in to view chats.");
      return;
    }
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
    if (isGuest) {
      setGuestWarning("Guest mode: sign in to view chats.");
      return;
    }
    setSelectedChatId(chatId);
    setSelectedProjectId(projectIdValue);
    router.push(`/projects/${projectIdValue}/c/${chatId}`);
  };

  const handleProjectChatSubmit = async (
    message: string,
    attachments?: Array<{ name?: string; mime?: string; dataUrl?: string; url?: string }>
  ) => {
    if (isGuest) {
      setGuestWarning("Sign in to start and save chats.");
      return;
    }
    const now = new Date().toISOString();
    const { conversationId, message: createdMessage, conversation } =
      await startProjectConversationAction({
        projectId,
        firstMessageContent: message,
        attachments,
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

  const clearAction = () => {
    setActiveAction(null)
    setPendingName('')
  }

  const queueRenameChat = (chatId: string, currentTitle?: string) => {
    setActiveAction({ type: 'renameChat', chatId, currentTitle })
  }

  const queueMoveChat = (chatId: string, currentProjectId?: string) => {
    setActiveAction({ type: 'moveChat', chatId, currentProjectId })
  }

  const queueDeleteChat = (chatId: string, currentTitle?: string) => {
    setActiveAction({ type: 'deleteChat', chatId, currentTitle })
  }
  const confirmRename = async () => {
    if (!activeAction || activeAction.type !== 'renameChat') return
    const nextName = pendingName.trim()
    if (!nextName) return
    try {
      await renameConversationAction(activeAction.chatId, nextName)
      await refreshChats()
      clearAction()
    } catch (err) {
      console.error('Failed to rename', err)
      window.alert('Failed to rename chat')
    }
  }

  const confirmDelete = async () => {
    if (!activeAction || activeAction.type !== 'deleteChat') return
    try {
      await deleteConversationAction(activeAction.chatId)
      await refreshChats()
      clearAction()
    } catch (err) {
      console.error('Failed to delete', err)
      window.alert('Failed to delete chat')
    }
  }

  const handleMoveTargetSelect = async (targetProjectId: string | null) => {
    if (!activeAction || activeAction.type !== 'moveChat') return
    try {
      await moveConversationToProjectAction(activeAction.chatId, targetProjectId)
      await refreshChats()
      clearAction()
    } catch (err) {
      console.error('Failed to move chat', err)
      window.alert('Failed to move chat')
    }
  }

  const handleIconUpdate = async (icon: string, color: string) => {
    await updateProjectIconAction(projectId, icon, color);
    await refreshProjects();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground dark">
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((open) => !open)}
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
        {isGuest && (
          <div className="px-4 py-2 bg-amber-900/40 text-amber-100 text-sm flex items-center justify-between">
            <span>Guest mode: chats and projects won&apos;t be saved. Sign in to keep your work.</span>
            {guestWarning ? <span className="text-amber-200 text-xs">{guestWarning}</span> : null}
          </div>
        )}
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
                <button
                  onClick={() => router.push("/projects")}
                  className="flex items-center justify-center rounded-lg hover:bg-accent transition-colors p-2"
                  title="Back to projects"
                >
                  <ArrowLeft className="h-6 w-6" strokeWidth={2} />
                </button>
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-3">
                      {project && (
                        <ProjectIconEditor
                          icon={project.icon || 'file'}
                          color={project.color || 'white'}
                          onSave={handleIconUpdate}
                          size="lg"
                        />
                      )}
                      <h1 className="text-3xl font-bold text-foreground">
                        {project?.name ?? "Unknown project"}
                      </h1>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleNewProject} className="accent-new-project-button gap-2">
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
                        <div
                          key={chat.id}
                          onClick={() => handleProjectChatSelect(projectId ?? "", chat.id)}
                          className="group/chat w-full bg-transparent px-3 py-3 cursor-pointer transition hover:bg-muted relative flex items-center min-w-0"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-foreground">
                                {chat.title || "Untitled chat"}
                              </span>
                            </div>
                            {preview && (
                              <p className="text-xs text-muted-foreground truncate max-w-full">
                                {preview}
                              </p>
                            )}
                          </div>

                          <div className="ml-4 flex items-center h-full">
                            <div className="relative w-14 h-8 flex items-center justify-center">
                              <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground transition-opacity duration-200 group-hover/chat:opacity-0">
                                {formatShortDate(latestTimestamp)}
                              </span>

                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/chat:opacity-100 transition-opacity duration-200">
                                <ChatContextMenu
                                  removeLabel={`Remove from ${project?.name ?? 'project'}`}
                                  onRename={() => queueRenameChat(chat.id, chat.title)}
                                  onMoveToProject={() => queueMoveChat(chat.id, projectId)}
                                  onRemoveFromProject={async () => {
                                    // Optimistically update local store so the chat appears
                                    // in "All Chats" immediately without a page reload.
                                    try {
                                      ensureChat({
                                        id: chat.id,
                                        title: chat.title,
                                        timestamp: chat.timestamp,
                                        projectId: undefined,
                                        messages: chat.messages,
                                      })

                                      await moveConversationToProjectAction(chat.id, null)

                                      // Ensure server-canonical state is loaded
                                      await refreshChats()
                                    } catch (err) {
                                      console.error('Remove from project failed', err)
                                      window.alert('Failed to remove chat from project')
                                    }
                                  }}
                                  onDelete={() => queueDeleteChat(chat.id, chat.title)}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
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
      <Dialog open={Boolean(activeAction && activeAction.type === 'renameChat')} onClose={clearAction}>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-foreground">Rename chat</p>
              <p className="text-sm text-muted-foreground">Give this chat a descriptive title so you can find it later.</p>
            </div>
            <Button variant="ghost" size="icon" onClick={clearAction} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Input
            autoFocus
            placeholder="New name"
            value={pendingName}
            onChange={(event) => setPendingName(event.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={clearAction}>Cancel</Button>
            <Button variant="default" size="sm" onClick={confirmRename} className="accent-new-project-button disabled:opacity-50">Rename</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={Boolean(activeAction && activeAction.type === 'moveChat')} onClose={clearAction}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-foreground">Move to project</p>
              <p className="text-sm text-muted-foreground">Select a destination for this chat.</p>
            </div>
            <Button variant="ghost" size="icon" onClick={clearAction} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!handleNewProject) return
                handleNewProject()
                clearAction()
              }}
              className="w-full justify-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <FolderPlus className="h-4 w-4" />
              New project
            </Button>
            {projects.length ? (
              <div className="space-y-1 rounded-lg border border-border bg-background p-1">
                <button
                  type="button"
                  onClick={() => handleMoveTargetSelect(null)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${!activeAction || (activeAction.type === 'moveChat' && !activeAction.currentProjectId) ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base">🌐</span>
                    <span>Global chat</span>
                  </span>
                  {(activeAction && activeAction.type === 'moveChat' && !activeAction.currentProjectId) && (
                    <span className="text-xs font-semibold text-primary">Current</span>
                  )}
                </button>
                {projects.map((p) => {
                  const isSelected = activeAction && activeAction.type === 'moveChat' && activeAction.currentProjectId === p.id
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => handleMoveTargetSelect(p.id)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate">{p.name}</span>
                      </span>
                      {isSelected && (
                        <span className="text-xs font-semibold text-primary">Current</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
                Create a project to move chats here.
              </div>
            )}
          </div>
        </div>
      </Dialog>

      <Dialog open={Boolean(activeAction && activeAction.type === 'deleteChat')} onClose={clearAction}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-foreground">Delete chat?</p>
              <p className="text-sm text-muted-foreground">This will delete this chat.</p>
            </div>
            <Button variant="ghost" size="icon" onClick={clearAction} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={clearAction}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>Delete</Button>
          </div>
        </div>
      </Dialog>

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
