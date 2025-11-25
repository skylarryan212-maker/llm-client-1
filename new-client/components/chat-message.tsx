'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Copy, ExternalLink, Check } from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  model?: string
  hasImage?: boolean
  imageUrl?: string
  hasSources?: boolean
}

export function ChatMessage({ role, content, model, hasImage, imageUrl, hasSources }: ChatMessageProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (role === 'user') {
    return (
      <div className="flex justify-end px-4 sm:px-6 lg:px-10 py-3 sm:py-4">
        <div className="max-w-[92%] sm:max-w-3xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl rounded-2xl bg-primary px-3 sm:px-4 py-2.5 sm:py-3 text-primary-foreground">
          <p className="text-base leading-relaxed break-words">{content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
      <div className="mx-auto max-w-full">
        <div className="space-y-3 sm:space-y-4">
          <div className="prose prose-invert max-w-none">
            <p className="text-base leading-relaxed text-foreground break-words">{content}</p>
          </div>

          {hasImage && imageUrl && (
            <div className="relative overflow-hidden rounded-lg border border-border">
              <Image
                src={imageUrl || "/placeholder.svg"}
                alt="Generated content"
                width={600}
                height={400}
                className="w-full"
              />
            </div>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2 pt-2 overflow-x-auto pb-1 -mx-1 px-1">
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span className="hidden xs:inline">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span className="hidden xs:inline">Copy</span>
                </>
              )}
            </Button>
            
            {hasSources && (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">Sources</span>
              </Button>
            )}
            
            {model && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground flex-shrink-0">
                    {model}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem className="flex items-center justify-between">
                    <span>Retry with GPT-4</span>
                    <span className="text-xs text-muted-foreground">current</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>Retry with GPT-4 Turbo</DropdownMenuItem>
                  <DropdownMenuItem>Retry with GPT-3.5</DropdownMenuItem>
                  <DropdownMenuItem>Retry with Claude 3</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
