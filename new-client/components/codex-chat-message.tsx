'use client'

import { Button } from '@/components/ui/button'
import { Copy, ExternalLink } from 'lucide-react'
import { MarkdownContent } from '@/components/markdown-content'

interface CodexChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  model?: string
  hasCode?: boolean
  code?: string
  language?: string
}

export function CodexChatMessage({ role, content, model, hasCode, code, language = 'typescript' }: CodexChatMessageProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end px-4 py-4">
        <div className="max-w-3xl rounded-2xl bg-primary px-5 py-3 text-primary-foreground">
          <p className="text-sm leading-relaxed">{content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="space-y-4">
          <MarkdownContent content={content} />

          <div className="flex items-center gap-2 pt-2">
            <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs text-muted-foreground hover:text-foreground">
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            
            <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
              Sources
            </Button>
            
            {model && (
              <span className="ml-auto text-xs text-muted-foreground">{model}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
