'use client'

import { useState } from 'react'
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
  icon: string
  color: string
}

interface ChatSidebarProps {
  isOpen: boolean
  onToggle: () => void
  currentModel?: string
  onModelSelect?: (model: string) => void
  selectedChatId?: string
  conversations?: Conversation[]
  onChatSelect?: (id: string) => void
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
  onChatSelect,
  onNewChat,
  onNewProject,
  onProjectSelect,
  selectedProjectId,
  onSettingsOpen
}: ChatSidebarProps) {
  const pathname = usePathname()
  const isAgentsPage = pathname === '/agents'
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [chatsCollapsed, setChatsCollapsed] = useState(false)
  const [showMoreProjects, setShowMoreProjects] = useState(false)
  
  const conversations: Conversation[] = propConversations || []

  const projects: Project[] = []

  const visibleProjects = projects.slice(0, 5)
  const moreProjects = projects.slice(5)

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
                Quarry
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

                        {visibleProjects.map((project) => (
                          <button
                            key={project.id}
                            onClick={() => onProjectSelect?.(project.id)}
                            className={`group w-full text-left rounded-lg transition-colors ${
                              selectedProjectId === project.id
                                ? 'bg-zinc-800 text-white'
                                : 'hover:bg-sidebar-accent'
                            }`}
                          >
                            <div className="py-2 px-3 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-base">{project.icon}</span>
                                <span className="truncate text-sm text-sidebar-foreground pr-8">{project.name}</span>
                              </div>
                              <ProjectContextMenu
                                onRename={() => console.log('Rename project', project.id)}
                                onDelete={() => console.log('Delete project', project.id)}
                              />
                            </div>
                          </button>
                        ))}

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
                                  <button
                                    key={project.id}
                                    onClick={() => {
                                      onProjectSelect?.(project.id)
                                      setShowMoreProjects(false)
                                    }}
                                    className="group w-full text-left rounded-lg hover:bg-accent transition-colors"
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
                                  </button>
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
                      CHATS
                    </button>
                    
                    {!chatsCollapsed && (
                      <div className="space-y-1">
                        {conversations.map((conv) => (
                          <button
                            key={conv.id}
                            onClick={() => onChatSelect?.(conv.id)}
                            className={`group w-full text-left rounded-lg transition-colors ${
                              selectedChatId === conv.id && !isAgentsPage
                                ? 'bg-zinc-800 text-white'
                                : 'hover:bg-sidebar-accent'
                            }`}
                          >
                            <div className="py-2 px-3 flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="truncate text-sm text-sidebar-foreground pr-8">{conv.title}</div>
                                <div className="text-xs text-muted-foreground">{conv.timestamp}</div>
                              </div>
                              <ChatContextMenu
                                onShare={() => console.log('Share', conv.id)}
                                onRename={() => console.log('Rename', conv.id)}
                                onMoveToProject={() => console.log('Move to project', conv.id)}
                                onArchive={() => console.log('Archive', conv.id)}
                                onDelete={() => console.log('Delete', conv.id)}
                              />
                            </div>
                          </button>
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
