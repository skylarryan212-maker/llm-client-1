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
import { MarkdownContent } from '@/components/markdown-content'

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
  isStreaming?: boolean
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
  isStreaming = false,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const [retryModel, setRetryModel] = useState('')
  const [showSources, setShowSources] = useState(false)

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
  const isGuest = Boolean((typedMetadata as any)?.isGuest)
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

  const displayModelName = isGuest ? null : getDisplayModelName(resolvedFamily)

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
        <div className="mx-auto w-full max-w-3xl flex flex-col items-end">
          {Array.isArray((metadata as any)?.files) && (metadata as any).files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 justify-end max-w-[92%] sm:max-w-4xl lg:max-w-5xl xl:max-w-[1200px] 2xl:max-w-[1400px]">
              {((metadata as any).files as Array<{ name?: string; mimeType?: string; dataUrl: string }>).map((file, idx) => (
                <a
                  key={`user-file-${idx}`}
                  href={file.dataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-2 hover:bg-muted/60 text-foreground"
                >
                  <div className="h-8 w-8 overflow-hidden rounded-lg bg-muted flex items-center justify-center">
                    {file.mimeType?.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={file.dataUrl} alt={file.name || "Image"} className="h-full w-full object-cover" />
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
                        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                        <path d="M14 3v6h6" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{file.name || file.dataUrl}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {file.mimeType?.toUpperCase() || "FILE"}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
          <div className="accent-user-bubble inline-block rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 max-w-[92%] sm:max-w-[85%]">
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
          <MarkdownContent content={content} />

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

          <div className="flex items-center gap-1.5 sm:gap-2 pt-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ minHeight: '32px' }}>
            {!isStreaming && (
              <>
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
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
                    onClick={() => setShowSources(!showSources)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="hidden xs:inline">{showSources ? 'Hide sources' : 'Sources'}</span>
                  </Button>
                )}
                
                {!isGuest && displayModelName && (
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
                )}
              </>
            )}
          </div>

          {/* Expandable Sources Panel */}
          {showSources && Array.isArray(typedMetadata?.citations) && typedMetadata.citations.length > 0 && (
            <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
              <h4 className="text-sm font-semibold mb-3 text-foreground">Sources</h4>
              <div className="space-y-3">
                {typedMetadata.citations.map((citation, idx) => (
                  <a
                    key={`citation-${idx}-${citation.url}`}
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground group-hover:underline truncate">
                        {citation.title || citation.domain}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {citation.domain}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}