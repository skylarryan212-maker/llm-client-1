'use client'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Mic, ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { AttachmentMenu } from '@/components/attachment-menu'

interface ChatComposerProps {
  onSubmit?: (message: string) => void
  onSend?: (message: string) => void
  placeholder?: string
}

export function ChatComposer({ onSubmit, onSend, placeholder = "Message LLM Client..." }: ChatComposerProps) {
  const [message, setMessage] = useState('')
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const handleSubmit = () => {
    if (message.trim()) {
      if (onSubmit) onSubmit(message)
      if (onSend) onSend(message)
      setMessage('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="bg-background p-3 sm:p-4 border-t border-border lg:border-0">
      <div className="mx-auto max-w-3xl">
        <div className="relative flex items-center gap-1.5 sm:gap-2 rounded-3xl border border-border bg-muted/30 px-2 sm:px-3 py-2 transition-all focus-within:border-ring focus-within:bg-background">
          <div className="relative flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-full hover:bg-accent"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <AttachmentMenu isOpen={isMenuOpen} position="top" />
          </div>

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="min-h-[36px] max-h-[200px] flex-1 resize-none border-0 bg-transparent px-0 py-2 text-sm leading-5 focus-visible:ring-0 focus-visible:ring-offset-0"
            rows={1}
          />

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-full hover:bg-accent"
            >
              <Mic className="h-4 w-4" />
            </Button>

            <Button
              onClick={handleSubmit}
              disabled={!message.trim()}
              size="icon"
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
