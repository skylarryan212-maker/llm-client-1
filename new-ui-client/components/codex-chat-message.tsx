'use client'

import { Button } from '@/components/ui/button'
import { Copy, ExternalLink } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

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
          <p className="text-sm leading-relaxed text-foreground">{content}</p>

          {hasCode && code && (
            <div className="overflow-hidden rounded-lg border border-border bg-[#1e1e1e]">
              <div className="flex items-center justify-between border-b border-border/50 bg-[#252526] px-4 py-2">
                <span className="text-xs font-mono text-muted-foreground">{language}</span>
                <Button variant="ghost" size="sm" className="h-7 gap-2 text-xs text-muted-foreground hover:text-foreground">
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
              <SyntaxHighlighter
                language={language}
                style={vscDarkPlus}
                customStyle={{
                  margin: 0,
                  padding: '1rem',
                  background: '#1e1e1e',
                  fontSize: '0.875rem',
                }}
              >
                {code}
              </SyntaxHighlighter>
            </div>
          )}

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
