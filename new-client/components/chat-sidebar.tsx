'use client'

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Sparkles, ChevronDown, ChevronRight, FolderPlus, X } from 'lucide-react'
import Link from 'next/link'
import { UserProfileMenu } from '@/components/user-profile-menu'
import { usePathname, useRouter } from 'next/navigation'
import {
  deleteConversationAction,
  moveConversationToProjectAction,
  renameConversationAction,
} from '@/app/actions/chat-actions'
import { deleteProjectAction, renameProjectAction } from '@/app/actions/project-actions'
import { ChatContextMenu } from '@/components/chat-context-menu'
import { ProjectContextMenu } from '@/components/project-context-menu'
import { AnimatedTitle } from '@/components/chat/animated-title'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getProjectIcon, getProjectColor } from '@/components/project-icon-picker'
import { useFlipListAnimation } from '@/lib/hooks/use-flip-list'
import { navigateWithMainPanelFade } from '@/lib/view-transitions'

interface Conversation {
  id: string
  title: string
  timestamp: string
}

interface Project {
  id: string
  name: string
  icon?: string
  color?: string
  createdAt?: string
  description?: string
}

interface ChatSidebarProps {
  isOpen: boolean
  onToggle: () => void
  selectedChatId?: string
  conversations?: Conversation[]
  projects?: Project[]
  projectChats?: Record<string, Conversation[]>
  onChatSelect?: (id: string) => void
  onProjectChatSelect?: (projectId: string, chatId: string) => void
  onNewChat?: () => void
  onNewProject?: () => void
  onProjectSelect?: (id: string) => void
  selectedProjectId?: string
  onSettingsOpen?: () => void
  onGeneralSettingsOpen?: () => void
  onRefreshChats?: () => void | Promise<void>
  onRefreshProjects?: () => void | Promise<void>
}

export function ChatSidebar({ 
  isOpen, 
  onToggle, 
  selectedChatId = '4',
  conversations: propConversations,
  projects: propProjects,
  projectChats = {},
  onChatSelect,
  onProjectChatSelect,
  onNewChat,
  onNewProject,
  onProjectSelect,
  selectedProjectId,
  onSettingsOpen,
  onGeneralSettingsOpen,
  onRefreshChats,
  onRefreshProjects,
}: ChatSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const isAgentsPage = pathname === '/agents'
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [chatsCollapsed, setChatsCollapsed] = useState(false)
  const [showMoreProjects, setShowMoreProjects] = useState(false)
  
  const conversations: Conversation[] = propConversations || []

  const projects: Project[] = propProjects || []
  const conversationIds = useMemo(() => conversations.map((c) => c.id), [conversations])
  const allChatsListRef = useRef<HTMLDivElement | null>(null)
  useFlipListAnimation({ containerRef: allChatsListRef, ids: conversationIds, enabled: isOpen && !chatsCollapsed })

  const pathSegments = pathname?.split("/").filter(Boolean) ?? []
  const pathProjectId =
    pathSegments[0] === "projects" ? pathSegments[1] ?? "" : ""
  const isProjectRootView =
    pathSegments[0] === "projects" && pathSegments.length === 2
  const activeProjectId = selectedProjectId || pathProjectId

  const visibleProjects = projects.slice(0, 5)
  const moreProjects = projects.slice(5)

  const projectChatMap = useMemo(() => projectChats, [projectChats])
  const selectedChatProjectId = useMemo(() => {
    const entry = Object.entries(projectChatMap).find(([, chats]) =>
      chats.some((chat) => chat.id === selectedChatId)
    )
    return entry ? entry[0] : ''
  }, [projectChatMap, selectedChatId])

  const handleListItemKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    action?: () => void
  ) => {
    if (!action) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }

  type ActiveAction =
    | { type: 'renameProject'; projectId: string; currentName?: string }
    | { type: 'deleteProject'; projectId: string; currentName?: string }
    | { type: 'renameChat'; chatId: string; currentTitle?: string }
    | { type: 'moveChat'; chatId: string; currentProjectId?: string }
    | { type: 'deleteChat'; chatId: string; currentTitle?: string }

  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null)
  const [pendingName, setPendingName] = useState('')

  useEffect(() => {
    if (!activeAction) {
      setPendingName('')
      return
    }

    if (activeAction.type === 'renameChat') {
      setPendingName(activeAction.currentTitle ?? '')
    } else if (activeAction.type === 'renameProject') {
      setPendingName(activeAction.currentName ?? '')
    }
  }, [activeAction])

  const clearAction = () => {
    setActiveAction(null)
    setPendingName('')
  }

  const queueRenameProject = (projectId: string, currentName?: string) => {
    setActiveAction({ type: 'renameProject', projectId, currentName })
  }

  const queueDeleteProject = (projectId: string, currentName?: string) => {
    setActiveAction({ type: 'deleteProject', projectId, currentName })
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

  const renameAction =
    activeAction && (activeAction.type === 'renameProject' || activeAction.type === 'renameChat')
      ? activeAction
      : null
  const deleteAction =
    activeAction && (activeAction.type === 'deleteProject' || activeAction.type === 'deleteChat')
      ? activeAction
      : null
  const moveAction = activeAction && activeAction.type === 'moveChat' ? activeAction : null

  const confirmRename = async () => {
    if (!renameAction) return

    const nextName = pendingName.trim()
    if (!nextName) return

    try {
      if (renameAction.type === 'renameProject') {
        await renameProjectAction(renameAction.projectId, nextName)
        onRefreshProjects?.()
      } else {
        await renameConversationAction(renameAction.chatId, nextName)
        onRefreshChats?.()
      }
      clearAction()
    } catch (error) {
      console.error('Failed to rename', error)
      window.alert('Unable to rename. Please try again later.')
    }
  }

  const confirmDelete = async () => {
    if (!deleteAction) return

    try {
      if (deleteAction.type === 'deleteProject') {
        await deleteProjectAction(deleteAction.projectId)
        onRefreshProjects?.()
      } else {
        await deleteConversationAction(deleteAction.chatId)
        onRefreshChats?.()
      }
      clearAction()
    } catch (error) {
      console.error('Failed to delete', error)
      window.alert('Unable to delete. Please try again later.')
    }
  }

  const handleMoveTargetSelect = async (targetProjectId: string | null) => {
    if (!moveAction) return

    if (targetProjectId === moveAction.currentProjectId) {
      clearAction()
      return
    }

    try {
      await moveConversationToProjectAction(moveAction.chatId, targetProjectId)
      onRefreshChats?.()
      clearAction()
    } catch (error) {
      console.error('Failed to move chat', error)
      window.alert('Unable to move the chat. Please try again later.')
    }
  }

  const renameExistingName =
    renameAction && (renameAction.type === 'renameProject' ? renameAction.currentName : renameAction.currentTitle)
  const renameDisabled = !pendingName.trim() || pendingName.trim() === renameExistingName?.trim()

  const closeSidebarIfMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      onToggle()
    }
  }

  const primaryButtonClass = isOpen
    ? "w-full max-w-[240px] justify-start px-2.5 h-10 gap-2 text-sidebar-foreground hover:bg-sidebar-accent rounded-lg sidebar-entry overflow-hidden"
    : "w-12 h-10 p-0 justify-center gap-2 text-sidebar-foreground hover:bg-sidebar-accent rounded-lg sidebar-entry overflow-hidden";
  const listItemClass =
    "w-full max-w-[240px] justify-start px-2.5 py-2 gap-2 text-sidebar-foreground hover:bg-sidebar-accent rounded-lg sidebar-entry overflow-hidden";

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      <div
        data-sidebar-open={isOpen ? 'true' : 'false'}
        style={{ viewTransitionName: 'sidebar' }}
        className={`
        sidebar-shell fixed lg:sticky lg:top-0 lg:h-[100dvh] h-full border-r border-border bg-sidebar z-50
        transition-all duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${isOpen ? 'w-[272px]' : 'lg:w-[60px] w-[272px]'}
      `}
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className={`flex h-[53px] items-center border-b border-sidebar-border px-4 ${isOpen ? 'justify-between' : 'lg:justify-center justify-between'}`}>
            {isOpen && (
              <div className="text-sm font-semibold text-sidebar-foreground">
                LLM Client
              </div>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onToggle} 
              className="h-8 w-8 flex-shrink-0"
            >
              {isOpen ? (
                <X className="h-4 w-4 lg:hidden" />
              ) : null}
              <svg className={`h-4 w-4 ${isOpen ? 'hidden lg:block' : 'block'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
                <line x1="9" y1="3" x2="9" y2="21" strokeWidth="2"/>
              </svg>
            </Button>
          </div>

          <div className={`space-y-2 p-3 ${!isOpen && 'lg:flex lg:flex-col lg:items-center hidden'}`}>
            <Button
              onClick={() => {
                onNewChat?.()
                closeSidebarIfMobile()
              }}
              variant="ghost"
                className={primaryButtonClass}
              title={!isOpen ? "New Chat" : undefined}
            >
              <Plus className="h-4 w-4 flex-shrink-0" />
              {isOpen && "New Chat"}
            </Button>
            
            <Link
              href="/agents"
              className="block"
              onClick={(event) => {
                event.preventDefault()
                void navigateWithMainPanelFade(router, "/agents")
                closeSidebarIfMobile()
              }}
            >
              <Button 
                variant="ghost" 
                className={`${primaryButtonClass} ${isAgentsPage ? 'bg-zinc-800 text-white hover:bg-zinc-800/90' : ''}`}
                title={!isOpen ? "Agents" : undefined}
              >
                <Sparkles className="h-4 w-4 flex-shrink-0" />
                {isOpen && "Agents"}
              </Button>
            </Link>
          </div>

          {isOpen && (
            <div className="flex-1 overflow-hidden min-h-0">
              <ScrollArea className="h-full px-3 pb-20 touch-pan-y" viewportClassName="pr-2 touch-pan-y">
                <div className="space-y-4 py-3 pb-4">
                  <div>
                    <button
                      onClick={() => setProjectsCollapsed(!projectsCollapsed)}
                      className="flex w-full items-center gap-1 mb-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {projectsCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      PROJECTS
                    </button>
                    
                    {!projectsCollapsed && (
                      <div className="space-y-1">
                        <Button
                          variant="ghost"
                            className={primaryButtonClass}
                          onClick={() => {
                            onNewProject?.()
                            closeSidebarIfMobile()
                          }}
                        >
                          <FolderPlus className="h-4 w-4" />
                          New project
                        </Button>

                        {visibleProjects.map((project) => {
                          const chatsForProject = projectChatMap[project.id] || []
                          const visibleChats = chatsForProject.slice(0, 5)
                          const hasMoreChats = chatsForProject.length > 5
                          const isProjectActive =
                            isProjectRootView && activeProjectId === project.id
                          const shouldShowChats =
                            activeProjectId === project.id ||
                            selectedChatProjectId === project.id

                          return (
                            <div key={project.id} className="space-y-1">
                              <Link
                                href={`/projects/${project.id}`}
                                onClick={(event) => {
                                  event.preventDefault()
                                  onProjectSelect?.(project.id)
                                  closeSidebarIfMobile()
                                }}
                                className={`group relative flex ${listItemClass} rounded-lg ${
                                  isProjectActive
                                    ? 'bg-zinc-800 text-white'
                                    : 'hover:bg-sidebar-accent'
                                }`}
                                data-sidebar-selected={isProjectActive ? "true" : "false"}
                              >
                                <div className="flex items-center gap-2 flex-1 min-w-0 pr-1">
                                  {(() => {
                                    const IconComponent = getProjectIcon(project.icon || 'file')
                                    const iconColor = getProjectColor(project.color || 'white')
                                    return <IconComponent className="h-5 w-5 flex-shrink-0" style={{ color: iconColor }} />
                                  })()}
                                  <span className="min-w-0 truncate text-sm text-sidebar-foreground">
                                    {project.name}
                                  </span>
                                </div>
                                <div className="flex-shrink-0">
                                  <ProjectContextMenu
                                    onRename={() => void queueRenameProject(project.id, project.name)}
                                    onDelete={() => void queueDeleteProject(project.id, project.name)}
                                  />
                                </div>
                              </Link>

                              {shouldShowChats && visibleChats.length > 0 && (
                                <div className="space-y-1">
                                  {visibleChats.map((chat) => (
                                    <div
                                      key={chat.id}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => {
                                        onProjectChatSelect?.(project.id, chat.id)
                                        closeSidebarIfMobile()
                                      }}
                                      onKeyDown={(event) =>
                                        handleListItemKeyDown(event, () => onProjectChatSelect?.(project.id, chat.id))
                                      }
                                      className={`group/chat flex w-full items-center rounded-lg pl-6 pr-2.5 py-1.5 text-left transition-colors sidebar-entry ${
                                        selectedChatId === chat.id
                                          ? 'bg-zinc-800 text-white'
                                          : 'hover:bg-sidebar-accent'
                                      }`}
                                      data-sidebar-selected={selectedChatId === chat.id ? "true" : "false"}
                                    >
                                      <div className="flex-1 min-w-0 pr-0">
                                        <AnimatedTitle 
                                          chatId={chat.id}
                                          title={chat.title}
                                          className="block min-w-0 w-full truncate text-sm text-sidebar-foreground"
                                        />
                                      </div>
                                      <div className="flex-shrink-0 ml-2">
                                        <ChatContextMenu
                                          removeLabel={`Remove from ${project.name}`}
                                          onShare={() => console.log('Share', chat.id)}
                                          onRename={() => void queueRenameChat(chat.id, chat.title)}
                                          onMoveToProject={() => void queueMoveChat(chat.id, project.id)}
                                          onRemoveFromProject={async () => {
                                            try {
                                              await moveConversationToProjectAction(chat.id, null)
                                              await onRefreshChats?.()
                                              await onRefreshProjects?.()
                                            } catch (err) {
                                              console.error('Remove from project failed', err)
                                            }
                                          }}
                                          onArchive={() => console.log('Archive', chat.id)}
                                          onDelete={() => void queueDeleteChat(chat.id, chat.title)}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                  {hasMoreChats && (
                                    <Link
                                      href={`/projects/${project.id}`}
                                      className="block w-full rounded-lg pl-6 pr-2.5 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent"
                                      onClick={(event) => {
                                        event.preventDefault()
                                        onProjectSelect?.(project.id)
                                        closeSidebarIfMobile()
                                      }}
                                  >
                                    See more
                                  </Link>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {moreProjects.length > 0 && (
                              <div className="relative">
                                <button
                                  onClick={() => setShowMoreProjects(!showMoreProjects)}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent transition-colors"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="1" fill="currentColor"/>
                                    <circle cx="19" cy="12" r="1" fill="currentColor"/>
                                    <circle cx="5" cy="12" r="1" fill="currentColor"/>
                                  </svg>
                                  See more
                                </button>

                            {showMoreProjects && (
                              <div className="absolute left-full top-0 ml-2 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg z-50">
                                {moreProjects.map((project) => (
                                    <Link
                                      key={project.id}
                                      href={`/projects/${project.id}`}
                                      onClick={(event) => {
                                        event.preventDefault()
                                        onProjectSelect?.(project.id)
                                        setShowMoreProjects(false)
                                      }}
                                    className={`group block w-full text-left rounded-lg transition-colors ${
                                      isProjectRootView && activeProjectId === project.id
                                        ? 'bg-zinc-800 text-white'
                                        : 'hover:bg-accent'
                                    }`}
                                    >
                                      <div className="py-2 px-3 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                          {(() => {
                                            const IconComponent = getProjectIcon(project.icon || 'file')
                                            const iconColor = getProjectColor(project.color || 'white')
                                            return <IconComponent className="h-5 w-5 flex-shrink-0" style={{ color: iconColor }} />
                                          })()}
                                          <span className="min-w-0 truncate text-sm">
                                            {project.name}
                                          </span>
                                        </div>
                                        <ProjectContextMenu
                                          onRename={() => void queueRenameProject(project.id, project.name)}
                                          onDelete={() => void queueDeleteProject(project.id, project.name)}
                                        />
                                      </div>
                                    </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <button
                      onClick={() => setChatsCollapsed(!chatsCollapsed)}
                      className="flex w-full items-center gap-1 mb-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {chatsCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      ALL CHATS
                    </button>
                    
                    {!chatsCollapsed && (
                      <div ref={allChatsListRef} className="space-y-1">
                        {conversations.map((conv) => (
                          <div
                            key={conv.id}
                            data-flip-id={conv.id}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                onChatSelect?.(conv.id)
                                closeSidebarIfMobile()
                              }}
                              onKeyDown={(event) =>
                                handleListItemKeyDown(event, () => onChatSelect?.(conv.id))
                              }
                              className={`group/chat flex items-center ${listItemClass} rounded-lg ${
                                selectedChatId === conv.id && !isAgentsPage
                                  ? 'bg-zinc-800 text-white'
                                  : 'hover:bg-sidebar-accent'
                              }`}
                            >
                              <div className="flex-1 min-w-0 pr-0">
                                <AnimatedTitle 
                                  chatId={conv.id}
                                  title={conv.title}
                                  className="min-w-0 w-full truncate text-sm text-sidebar-foreground"
                                />
                              </div>
                              <div className="flex-shrink-0 ml-2">
                                <ChatContextMenu
                                  onShare={() => console.log('Share', conv.id)}
                                  onRename={() => void queueRenameChat(conv.id, conv.title)}
                                  onMoveToProject={() => void queueMoveChat(conv.id)}
                                  onArchive={() => console.log('Archive', conv.id)}
                                  onDelete={() => void queueDeleteChat(conv.id, conv.title)}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 border-t border-sidebar-border bg-sidebar">
          <UserProfileMenu
            isCompressed={!isOpen}
            onSettingsOpen={() => {
              onSettingsOpen?.()
              closeSidebarIfMobile()
            }}
            onGeneralSettingsOpen={() => {
              onGeneralSettingsOpen?.()
              closeSidebarIfMobile()
            }}
          />
        </div>
      </div>

      <Dialog open={Boolean(renameAction)} onClose={clearAction}>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-foreground">
                {renameAction?.type === 'renameProject' ? 'Rename project' : 'Rename chat'}
              </p>
              <p className="text-sm text-muted-foreground">
                {renameAction?.type === 'renameProject'
                  ? 'Give this project a descriptive name so it is easier to find.'
                  : 'Give this chat a descriptive title so you can find it later.'}
              </p>
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
            <Button variant="ghost" size="sm" onClick={clearAction}>
              Cancel
            </Button>
            <Button 
              variant="default" 
              size="sm" 
              onClick={confirmRename} 
              disabled={renameDisabled}
              className="accent-new-project-button disabled:opacity-50"
            >
              Rename
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={Boolean(moveAction)} onClose={clearAction}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-foreground">Move to project</p>
              <p className="text-sm text-muted-foreground">
                Select a destination for this chat.
              </p>
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
                if (!onNewProject) return
                onNewProject()
                clearAction()
              }}
              disabled={!onNewProject}
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
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    !moveAction?.currentProjectId
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-accent'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base">[Global]</span>
                    <span>Global chat</span>
                  </span>
                  {!moveAction?.currentProjectId && (
                    <span className="text-xs font-semibold text-primary">Current</span>
                  )}
                </button>
                {projects.map((project) => {
                  const isSelected = moveAction?.currentProjectId === project.id
                  return (
                    <button
                      type="button"
                      key={project.id}
                      onClick={() => handleMoveTargetSelect(project.id)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {(() => {
                          const IconComponent = getProjectIcon(project.icon || 'file')
                          const iconColor = getProjectColor(project.color || 'white')
                          return <IconComponent className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
                        })()}
                        <span className="truncate">{project.name}</span>
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

      <Dialog open={Boolean(deleteAction)} onClose={clearAction}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-foreground">
                {deleteAction?.type === 'deleteProject' ? 'Delete project?' : 'Delete chat?'}
              </p>
              <p className="text-sm text-muted-foreground">
                {deleteAction?.type === 'deleteProject'
                  ? `This will delete ${deleteAction?.currentName ?? 'the project'} and all its chats.`
                  : `This will delete ${deleteAction?.currentTitle ?? 'this chat'}.`}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={clearAction} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={clearAction}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
