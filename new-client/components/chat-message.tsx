'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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

export function ChatMessage({
  role,
  content,
  hasImage,
  imageUrl,
  hasSources,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const [retryModel, setRetryModel] = useState('GPT 5.1')

  const displayModel = 'GPT 5.1'

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (role === 'user') {
    return (
      <div className="py-3 sm:py-4">
        <div className="mx-auto w-full max-w-3xl flex justify-end">
          <div className="max-w-[92%] sm:max-w-4xl lg:max-w-5xl xl:max-w-[1200px] 2xl:max-w-[1400px] rounded-2xl bg-primary px-3 sm:px-4 py-2.5 sm:py-3 text-primary-foreground">
            <p className="text-base leading-relaxed break-words">{content}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="py-4 sm:py-6">
      <div className="mx-auto w-full max-w-3xl">
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
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground flex-shrink-0">
                  {displayModel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuRadioGroup
                  value={retryModel}
                  onValueChange={setRetryModel}
                >
                  <DropdownMenuRadioItem value="GPT-5 Nano">
                    GPT-5 Nano
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="GPT-5 Mini">
                    GPT-5 Mini
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="GPT 5.1" className="flex items-center justify-between gap-2">
                    <span className="flex-1">GPT 5.1</span>
                    <span className="text-xs text-muted-foreground">Current</span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="GPT-5 Pro">
                    GPT-5 Pro
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}
