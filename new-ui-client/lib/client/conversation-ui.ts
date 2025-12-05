import type { ConversationMeta } from '@/lib/conversations'

export interface ConversationListItem {
  id: string
  title: string
  timestamp: string
  projectId: string | null
}

export function formatTimestamp(value?: string | null) {
  if (!value) return 'Just now'
  try {
    const date = new Date(value)
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch (error) {
    console.warn('Unable to format timestamp', error)
    return 'Just now'
  }
}

export function normalizeConversation(meta: ConversationMeta): ConversationListItem {
  return {
    id: meta.id,
    title: meta.title || 'New chat',
    timestamp: formatTimestamp(meta.created_at ?? null),
    projectId: meta.project_id ?? null,
  }
}
