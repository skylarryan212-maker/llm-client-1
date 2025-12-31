'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ChatSidebar } from '@/components/chat-sidebar'
import { ChatMessage } from '@/components/chat-message'
import { ChatComposer } from '@/components/chat-composer'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-react'
import { SettingsModal } from '@/components/settings-modal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createConversationRecord } from '@/lib/conversations'
import {
  normalizeConversation,
  type ConversationListItem,
} from '@/lib/client/conversation-ui'

interface MessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  metadata?: Record<string, unknown> | null
  streaming?: boolean
}

export default function ChatPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const chatIdFromUrl = searchParams.get('id')

  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState('gpt-5.1')
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [selectedChatId, setSelectedChatId] = useState(chatIdFromUrl || '')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsSidebarOpen(true)
      } else {
        setIsSidebarOpen(false)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const res = await fetch('/api/conversations')
        const data = await res.json()
        const normalized = Array.isArray(data?.conversations)
          ? (data.conversations as ConversationMeta[]).map((c) =>
              normalizeConversation(c)
            )
          : []
        setConversations(normalized)
        if (!selectedChatId && normalized.length > 0) {
          setSelectedChatId(normalized[0].id)
          setSelectedProjectId(normalized[0].projectId ?? '')
          router.replace(`/chat?id=${normalized[0].id}`)
        }
      } catch (error) {
        console.error('Unable to load conversations', error)
      }
    }

    fetchConversations()
  }, [router, selectedChatId])

  useEffect(() => {
    if (chatIdFromUrl && chatIdFromUrl !== selectedChatId) {
      setSelectedChatId(chatIdFromUrl)
    }
  }, [chatIdFromUrl, selectedChatId])

  const loadMessages = useCallback(
    async (conversationId: string) => {
      setIsLoadingMessages(true)
      try {
        const res = await fetch(`/api/messages?conversationId=${conversationId}`)
        const data = await res.json()
        const rows: MessageRow[] = Array.isArray(data?.messages)
          ? data.messages.map((msg: Record<string, unknown>) => ({
              id:
                typeof msg.id === 'string' ? msg.id : `message-${crypto.randomUUID()}`,
              role:
                msg.role === 'assistant' || msg.role === 'user'
                  ? msg.role
                  : 'assistant',
              content: typeof msg.content === 'string' ? msg.content : '',
              metadata:
                msg.metadata && typeof msg.metadata === 'object'
                  ? (msg.metadata as Record<string, unknown>)
                  : null,
              streaming: false,
            }))
          : []
        setMessages(rows)
        const current = conversations.find((c) => c.id === conversationId)
        setSelectedProjectId(current?.projectId ?? '')
      } catch (error) {
        console.error('Unable to load messages', error)
        setMessages([])
      } finally {
        setIsLoadingMessages(false)
      }
    },
    [conversations]
  )

  useEffect(() => {
    if (!selectedChatId) {
      setMessages([])
      return
    }
    loadMessages(selectedChatId)
  }, [loadMessages, selectedChatId])

  const ensureConversation = useCallback(
    async (title: string) => {
      if (selectedChatId) {
        return selectedChatId
      }
      const newConversation = await createConversationRecord({
        title: title || 'New chat',
        projectId: selectedProjectId || null,
        metadata: null,
      })
      const normalized = normalizeConversation(newConversation)
      setConversations((prev) => [normalized, ...prev])
      setSelectedChatId(normalized.id)
      if (normalized.projectId) {
        setSelectedProjectId(normalized.projectId)
      }
      router.replace(`/chat?id=${normalized.id}`)
      return normalized.id
    },
    [router, selectedChatId, selectedProjectId]
  )

  const handleProjectSelect = (id: string) => {
    router.push(`/project/${id}`)
  }

  const handleNewProject = () => {
    router.push('/project/new')
  }

  const handleChatSelect = (id: string) => {
    setSelectedChatId(id)
    router.push(`/chat?id=${id}`)
  }

  const handleNewChat = () => {
    setSelectedChatId('')
    setSelectedProjectId('')
    setMessages([])
    router.push('/chat')
  }

  const projects = useMemo(() => {
    const list: ConversationListItem['projectId'][] = conversations
      .map((c) => c.projectId)
      .filter((id): id is string => Boolean(id))
    const unique = Array.from(new Set(list))
    return unique.map((id) => ({
      id,
      name: `Project ${id.slice(0, 6)}`,
      icon: '📁',
      color: '#6b7280',
    }))
  }, [conversations])

  const handleSubmit = async (message: string) => {
    if (!message.trim() || isSending) return
    const conversationId = await ensureConversation(message.slice(0, 80))
    const userMessageId = `user-${crypto.randomUUID()}`
    const assistantMessageId = `assistant-${crypto.randomUUID()}`

    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: 'user', content: message },
      { id: assistantMessageId, role: 'assistant', content: '', streaming: true },
    ])

    setIsSending(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message,
          modelFamily: 'auto',
          speedMode: 'auto',
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error('Chat request failed')
      }

      const decoder = new TextDecoder()
      const reader = res.body.getReader()
      let buffer = ''
      let assistantId = assistantMessageId
      let userId = userMessageId

      const updateAssistant = (updater: (value: MessageRow) => MessageRow) => {
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantId ? updater(msg) : msg))
        )
      }

      const updateUserId = (newId: string) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === userId ? { ...msg, id: newId } : msg
          )
        )
        userId = newId
      }

      const updateAssistantId = (newId: string) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, id: newId } : msg
          )
        )
        assistantId = newId
      }

      const handlePayload = (payload: Record<string, unknown>) => {
        if (typeof payload.token === 'string') {
          updateAssistant((msg) => ({
            ...msg,
            content: (msg.content || '') + payload.token,
          }))
        }

        if (payload.meta && typeof payload.meta === 'object') {
          const meta = payload.meta as {
            assistantMessageRowId?: string
            userMessageRowId?: string
          }
          if (meta.assistantMessageRowId) {
            updateAssistantId(meta.assistantMessageRowId)
          }
          if (meta.userMessageRowId) {
            updateUserId(meta.userMessageRowId)
          }
        }

        if (typeof payload.title === 'string') {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId
                ? { ...c, title: payload.title ?? c.title }
                : c
            )
          )
        }

        if (payload.done) {
          updateAssistant((msg) => ({ ...msg, streaming: false }))
        }
      }

      let finished = false
      while (!finished) {
        const { value, done } = await reader.read()
        if (done) {
          finished = true
          updateAssistant((msg) => ({ ...msg, streaming: false }))
          break
        }
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          if (line) {
            try {
              const payload = JSON.parse(line)
              handlePayload(payload)
            } catch (error) {
              console.error('Unable to parse chat payload', error)
            }
          }
          newlineIndex = buffer.indexOf('\n')
        }
      }
    } catch (error) {
      console.error('Chat send failed', error)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.streaming
            ? { ...msg, streaming: false, content: msg.content || 'Error sending message' }
            : msg
        )
      )
    } finally {
      setIsSending(false)
    }
  }

  const currentChat = conversations.find((c) => c.id === selectedChatId)
  const currentMessages = messages

  const sidebarConversations = conversations.map((chat) => ({
    id: chat.id,
    title: chat.title,
    timestamp: chat.timestamp,
  }))

  return (
    <div className="flex h-screen overflow-hidden dark">
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        currentModel={currentModel}
        onModelSelect={setCurrentModel}
        selectedChatId={selectedChatId}
        conversations={sidebarConversations}
        onChatSelect={handleChatSelect}
        onNewChat={handleNewChat}
        onNewProject={handleNewProject}
        onProjectSelect={handleProjectSelect}
        projects={projects}
        selectedProjectId={selectedProjectId || currentChat?.projectId || ''}
        onSettingsOpen={() => setIsSettingsOpen(true)}
      />

      <div className="flex flex-1 flex-col w-full min-w-0">
        <div className="flex h-[53px] items-center justify-between border-b border-border px-3 lg:px-4">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 lg:hidden"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <Menu className="h-4 w-4" />
            </Button>

            <Select value={currentModel} onValueChange={setCurrentModel}>
              <SelectTrigger className="h-9 w-auto gap-1 border-0 px-2 focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-5.1">GPT-5.1</SelectItem>
                <SelectItem value="gpt-5-mini">GPT-5.1 mini</SelectItem>
                <SelectItem value="gpt-5-nano">GPT-5.1 nano</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                />
              </svg>
              <span className="hidden md:inline">Share</span>
            </Button>
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                />
              </svg>
              <span className="hidden md:inline">Archive</span>
            </Button>
          </div>
        </div>

        {!selectedChatId || isLoadingMessages ? (
          <div className="flex flex-1 items-center justify-center px-4 overflow-hidden">
            <div className="text-center">
              <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">
                {isLoadingMessages ? 'Loading conversation…' : 'Where should we begin?'}
              </h2>
            </div>
          </div>
        ) : currentMessages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 overflow-hidden">
            <div className="text-center">
              <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">Where should we begin?</h2>
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1 overflow-auto">
            <div className="py-4 pb-24 sm:pb-4">
              {currentMessages.map((message) => (
                <ChatMessage
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  model={currentModel}
                  hasSources={Boolean(
                    message.metadata &&
                      typeof message.metadata === 'object' &&
                      ((message.metadata as { citations?: unknown[] }).citations?.length ||
                        (message.metadata as { sources?: unknown[] }).sources?.length)
                  )}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="fixed bottom-0 left-0 right-0 lg:relative lg:bottom-auto lg:left-auto lg:right-auto">
          <ChatComposer onSubmit={handleSubmit} />
        </div>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  )
}
