'use client'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Mic, ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { AttachmentMenu } from '@/components/attachment-menu'

interface CodexComposerLargeProps {
  onSubmit?: (message: string) => void
}

export function CodexComposerLarge({ onSubmit }: CodexComposerLargeProps) {
  const [message, setMessage] = useState('')
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const handleSubmit = () => {
    if (message.trim() && onSubmit) {
      onSubmit(message)
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
    <div className="mx-auto w-full max-w-4xl">
      <div className="relative rounded-2xl border border-border bg-card shadow-lg transition-all focus-within:border-primary/50 focus-within:shadow-xl focus-within:shadow-primary/5">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="You can ask me to build anything..."
          className="min-h-[120px] resize-none border-0 bg-transparent px-6 py-5 text-base leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        
        <div className="flex items-end justify-between border-t border-border px-4 py-3">
          <div className="relative flex items-center">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <AttachmentMenu isOpen={isMenuOpen} position="bottom" />
          </div>
          
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground">
              <Mic className="h-4 w-4" />
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!message.trim()}
              size="icon"
              className="h-9 w-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Press <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">Enter</kbd> to send
      </p>
    </div>
  )
}
