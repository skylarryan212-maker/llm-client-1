'use client'

import { KeyboardEvent, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Sparkles, ChevronDown, ChevronRight, FolderPlus, X } from 'lucide-react'
import Link from 'next/link'
import { UserProfileMenu } from '@/components/user-profile-menu'
import { usePathname } from 'next/navigation'
import { ChatContextMenu } from '@/components/chat-context-menu'
import { ProjectContextMenu } from '@/components/project-context-menu'

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
  currentModel?: string
  onModelSelect?: (model: string) => void
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
}

export function ChatSidebar({ 
  isOpen, 
  onToggle, 
  currentModel = 'GPT-4',
  onModelSelect,
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
  onSettingsOpen
}: ChatSidebarProps) {
  const pathname = usePathname()
  const isAgentsPage = pathname === '/agents'
  const isProjectsPage = pathname?.startsWith('/projects')
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [chatsCollapsed, setChatsCollapsed] = useState(false)
  const [showMoreProjects, setShowMoreProjects] = useState(false)
  
  const conversations: Conversation[] = propConversations || []

  const projects: Project[] = propProjects || []

  const pathProjectId =
    isProjectsPage && pathname ? pathname.split("/")[2] ?? "" : ""
  const activeProjectId = selectedProjectId || pathProjectId

  const visibleProjects = projects.slice(0, 5)
  const moreProjects = projects.slice(5)

  const projectChatMap = useMemo(() => projectChats, [projectChats])

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

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      <div className={`
        fixed lg:relative h-full border-r border-border bg-sidebar z-50
        transition-all duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${isOpen ? 'w-64' : 'lg:w-[60px] w-64'}
      `}>
        <div className="flex h-full flex-col">
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
              onClick={onNewChat}
              variant="ghost" 
              className={`${isOpen ? 'w-full justify-start' : 'w-10 h-10 p-0 justify-center'} gap-2 text-sidebar-foreground hover:bg-sidebar-accent`}
              title={!isOpen ? "New Chat" : undefined}
            >
              <Plus className="h-4 w-4 flex-shrink-0" />
              {isOpen && "New Chat"}
            </Button>
            
            <Link href="/agents" className="block">
              <Button 
                variant="ghost" 
                className={`${isOpen ? 'w-full justify-start' : 'w-10 h-10 p-0 justify-center'} gap-2 ${
                  isAgentsPage 
                    ? 'bg-zinc-800 text-white hover:bg-zinc-800/90' 
                    : 'text-sidebar-foreground hover:bg-sidebar-accent'
                }`}
                title={!isOpen ? "Agents" : undefined}
              >
                <Sparkles className="h-4 w-4 flex-shrink-0" />
                {isOpen && "Agents"}
              </Button>
            </Link>
          </div>

          {isOpen && (
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full px-3">
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
                        <button
                          onClick={onNewProject}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                        >
                          <FolderPlus className="h-4 w-4" />
                          New project
                        </button>

                        {visibleProjects.map((project) => {
                          const chatsForProject = projectChatMap[project.id] || []
                          const visibleChats = chatsForProject.slice(0, 5)
                          const hasMoreChats = chatsForProject.length > 5

                          return (
                            <div
                              key={project.id}
                              className={`group rounded-lg transition-colors ${
                                activeProjectId === project.id
                                  ? 'bg-zinc-800 text-white'
                                  : 'hover:bg-sidebar-accent'
                              }`}
                            >
                              <Link
                                href={`/projects/${project.id}`}
                                onClick={() => onProjectSelect?.(project.id)}
                                className="flex items-center justify-between gap-2 px-3 py-2"
                              >
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <span className="text-base">{project.icon}</span>
                                  <span className="truncate text-sm text-sidebar-foreground pr-8">{project.name}</span>
                                </div>
                                <ProjectContextMenu
                                  onRename={() => console.log('Rename project', project.id)}
                                  onDelete={() => console.log('Delete project', project.id)}
                                />
                              </Link>

                              {visibleChats.length > 0 && (
                                <div className="px-2 pb-2 space-y-1">
                                  {visibleChats.map((chat) => (
                                    <div
                                      key={chat.id}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => onProjectChatSelect?.(project.id, chat.id)}
                                      onKeyDown={(event) =>
                                        handleListItemKeyDown(event, () => onProjectChatSelect?.(project.id, chat.id))
                                      }
                                      className={`group/chat flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                                        selectedChatId === chat.id
                                          ? 'bg-zinc-800 text-white'
                                          : 'hover:bg-sidebar-accent'
                                      }`}
                                    >
                                      <span className="truncate text-sm text-sidebar-foreground pr-3">
                                        {chat.title}
                                      </span>
                                      <ChatContextMenu
                                        onShare={() => console.log('Share', chat.id)}
                                        onRename={() => console.log('Rename', chat.id)}
                                        onMoveToProject={() => console.log('Move to project', chat.id)}
                                        onArchive={() => console.log('Archive', chat.id)}
                                        onDelete={() => console.log('Delete', chat.id)}
                                      />
                                    </div>
                                  ))}
                                  {hasMoreChats && (
                                    <Link
                                      href={`/projects/${project.id}`}
                                      className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent"
                                      onClick={() => onProjectSelect?.(project.id)}
                                    >
                                      See more…
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
                                    onClick={() => {
                                      onProjectSelect?.(project.id)
                                      setShowMoreProjects(false)
                                    }}
                                    className={`group block w-full text-left rounded-lg transition-colors ${
                                      activeProjectId === project.id
                                        ? 'bg-zinc-800 text-white'
                                        : 'hover:bg-accent'
                                    }`}
                                  >
                                    <div className="py-2 px-3 flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <span className="text-base">{project.icon}</span>
                                        <span className="truncate text-sm">{project.name}</span>
                                      </div>
                                      <ProjectContextMenu
                                        onRename={() => console.log('Rename project', project.id)}
                                        onDelete={() => console.log('Delete project', project.id)}
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
                      <div className="space-y-1">
                        {conversations.map((conv) => (
                          <div
                            key={conv.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onChatSelect?.(conv.id)}
                            onKeyDown={(event) =>
                              handleListItemKeyDown(event, () => onChatSelect?.(conv.id))
                            }
                            className={`group/chat w-full text-left rounded-lg transition-colors ${
                              selectedChatId === conv.id && !isAgentsPage
                                ? 'bg-zinc-800 text-white'
                                : 'hover:bg-sidebar-accent'
                            }`}
                          >
                            <div className="py-2 px-3 flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="truncate text-sm text-sidebar-foreground pr-3">{conv.title}</div>
                              </div>
                              <ChatContextMenu
                                onShare={() => console.log('Share', conv.id)}
                                onRename={() => console.log('Rename', conv.id)}
                                onMoveToProject={() => console.log('Move to project', conv.id)}
                                onArchive={() => console.log('Archive', conv.id)}
                                onDelete={() => console.log('Delete', conv.id)}
                              />
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
          <UserProfileMenu isCompressed={!isOpen} onSettingsOpen={onSettingsOpen} />
        </div>
      </div>
    </>
  )
}
