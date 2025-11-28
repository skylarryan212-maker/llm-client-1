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
import type { AssistantMessageMetadata } from '@/lib/chatTypes'
import { MessageInsightChips } from '@/components/chat/message-insight-chips'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  model?: string
  metadata?: Record<string, unknown> | null
  hasImage?: boolean
  imageUrl?: string
  hasSources?: boolean
  onRetry?: (modelName: string) => void
  showInsightChips?: boolean
}

export function ChatMessage({
  role,
  content,
  metadata,
  hasImage,
  imageUrl,
  hasSources,
  onRetry,
  showInsightChips = true,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const [retryModel, setRetryModel] = useState('')

  // Extract metadata safely
  let metadataObj: AssistantMessageMetadata | Record<string, unknown> | null = null
  try {
    if (metadata && typeof metadata === 'object') {
      metadataObj = metadata
    }
  } catch {
    // Silently ignore malformed metadata
  }

  const typedMetadata = metadataObj as AssistantMessageMetadata | null

  const modelUsed = typedMetadata?.modelUsed as string | undefined
  let resolvedFamily = typedMetadata?.resolvedFamily as string | undefined
  const reasoningEffort = typedMetadata?.reasoningEffort as string | undefined

  // Map resolved family to display name
  const getDisplayModelName = (family?: string): string => {
    if (!family) return 'Unknown'
    if (family.includes('nano')) return 'GPT 5 Nano'
    if (family.includes('mini')) return 'GPT 5 Mini'
    if (family.includes('5.1')) return 'GPT 5.1'
    if (family.includes('pro')) return 'GPT 5 Pro'
    return family
  }

  // Fallback: derive family from modelUsed if resolvedFamily is missing
  if (!resolvedFamily && modelUsed) {
    const lower = modelUsed.toLowerCase()
    if (lower.includes('nano')) resolvedFamily = 'gpt-5-nano'
    else if (lower.includes('mini')) resolvedFamily = 'gpt-5-mini'
    else if (lower.includes('5.1')) resolvedFamily = 'gpt-5.1'
    else if (lower.includes('pro')) resolvedFamily = 'gpt-5-pro-2025-10-06'
  }

  const displayModelName = getDisplayModelName(resolvedFamily)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRetryWithModel = (model: string) => {
    if (onRetry) {
      onRetry(model)
    }
    setRetryModel(model)
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

          {showInsightChips && <MessageInsightChips metadata={typedMetadata} />}

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
            
            {((hasSources ?? false) || (Array.isArray(typedMetadata?.citations) && typedMetadata.citations.length > 0)) && (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">Sources</span>
              </Button>
            )}
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground flex-shrink-0">
                  {displayModelName}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuRadioGroup value={retryModel} onValueChange={handleRetryWithModel}>
                  <DropdownMenuRadioItem value="GPT 5 Nano">
                    <span className="flex-1">Retry with GPT 5 Nano</span>
                    {displayModelName === 'GPT 5 Nano' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="GPT 5 Mini">
                    <span className="flex-1">Retry with GPT 5 Mini</span>
                    {displayModelName === 'GPT 5 Mini' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="GPT 5.1">
                    <span className="flex-1">Retry with GPT 5.1</span>
                    {displayModelName === 'GPT 5.1' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="GPT 5 Pro">
                    <span className="flex-1">Retry with GPT 5 Pro</span>
                    {displayModelName === 'GPT 5 Pro' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
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
