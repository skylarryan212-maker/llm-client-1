'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Copy, ExternalLink, Check, Download, Globe } from 'lucide-react'
import Image from 'next/image'
import { memo, useEffect, useRef, useState } from 'react'
import type { AssistantMessageMetadata, CitationMetadata } from '@/lib/chatTypes'
import { MessageInsightChips } from '@/components/chat/message-insight-chips'
import { MarkdownContent } from '@/components/markdown-content'

const MemoMessageInsightChips = memo(MessageInsightChips)

interface ChatMessageProps {
  messageId?: string
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
  enableEntryAnimation?: boolean
  suppressPreStreamAnimation?: boolean
  showModelActions?: boolean
  modelTagClickable?: boolean
  forceFullWidth?: boolean
  forceStaticBubble?: boolean
}

export const ChatMessage = memo(function ChatMessage({
  messageId,
  role,
  content,
  metadata,
  hasImage,
  imageUrl,
  hasSources,
  onRetry,
  showInsightChips = true,
  isStreaming = false,
  enableEntryAnimation = false,
  suppressPreStreamAnimation = false,
  showModelActions = true,
  modelTagClickable = true,
  forceFullWidth = false,
  forceStaticBubble = false,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const [retryModel, setRetryModel] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [isAnimating, setIsAnimating] = useState(Boolean(enableEntryAnimation))
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enableEntryAnimation) {
      setIsAnimating(false)
      return undefined
    }

    setIsAnimating(true)
    if (typeof window === 'undefined') {
      return undefined
    }

    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current)
    }

    animationTimeoutRef.current = setTimeout(() => {
      setIsAnimating(false)
      animationTimeoutRef.current = null
    }, 650)

    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current)
        animationTimeoutRef.current = null
      }
    }
  }, [enableEntryAnimation, messageId])

  const animateClass = isAnimating ? 'chat-entry-animate' : ''
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
  const agentMetadata = metadataObj && typeof metadataObj === "object" ? (metadataObj as any).agent : undefined

  const modelUsed = typedMetadata?.modelUsed as string | undefined
  const isGuest = Boolean((typedMetadata as any)?.isGuest)
  let resolvedFamily = typedMetadata?.resolvedFamily as string | undefined
  // Map resolved family to display name
  const getDisplayModelName = (family?: string): string => {
    if (!family) return 'Unknown'
    const lower = family.toLowerCase()
    // Gemini image models (avoid accidental "mini" match from "geMINI")
    if (lower.includes('gemini-2.5-flash-image')) return 'Nano Banana'
    if (lower.includes('gemini-3-pro-image-preview')) return 'Nano Banana Pro'
    if (lower.includes('gemini')) return 'Gemini'

    if (lower.includes('gpt-5-nano') || lower.includes('gpt 5 nano')) return 'GPT 5 Nano'
    if (lower.includes('gpt-5-mini') || lower.includes('gpt 5 mini')) return 'GPT 5 Mini'
    if (lower.includes('gpt-5.2-pro') || lower.includes('gpt 5.2 pro') || lower.includes('gpt-5.2 pro') || lower.includes('52-pro')) return 'GPT 5.2 Pro'
    if (lower.includes('gpt-5.2') || lower.includes('gpt 5.2')) return 'GPT 5.2'
    if (family.includes('pro')) return 'GPT 5.2 Pro'
    return family
  }

  // Fallback: derive family from modelUsed if resolvedFamily is missing
  if (!resolvedFamily && modelUsed) {
    const lower = modelUsed.toLowerCase()
    if (lower.includes('gemini')) resolvedFamily = modelUsed
    else if (lower.includes('gpt-5-nano') || lower.includes('gpt 5 nano')) resolvedFamily = 'gpt-5-nano'
    else if (lower.includes('gpt-5-mini') || lower.includes('gpt 5 mini')) resolvedFamily = 'gpt-5-mini'
    else if (lower.includes('gpt-5.2') || lower.includes('gpt 5.2')) resolvedFamily = 'gpt-5.2'
    else if (lower.includes('gpt-5.2-pro') || lower.includes('gpt 5.2 pro') || lower.includes('gpt-5.2 pro') || lower.includes('pro')) resolvedFamily = 'gpt-5.2-pro'
  }

  const displayModelName = isGuest || agentMetadata === "sga" ? null : getDisplayModelName(resolvedFamily)
  const isGeminiImageMessage =
    Boolean(modelUsed && modelUsed.toLowerCase().includes("gemini")) ||
    Boolean((typedMetadata as any)?.imageGeneration?.provider === "gemini") ||
    Boolean(resolvedFamily && resolvedFamily.toLowerCase().includes("gemini"));
  const suppressSources = isGeminiImageMessage || Boolean((typedMetadata as any)?.imageGeneration);
  const citationHostname = (value?: string | null) => {
    if (!value) return null
    try {
      const url = new URL(value)
      return url.hostname.replace(/^www\\./i, '')
    } catch {
      return value.trim() || null
    }
  }
  const citationsRaw = Array.isArray(typedMetadata?.citations) ? typedMetadata.citations : []
  const sanitizedCitations = citationsRaw
    .map((citation) => ({
      ...citation,
      url: typeof citation.url === 'string' ? citation.url.trim() : '',
    }))
    .filter(
      (citation): citation is CitationMetadata & { url: string } =>
        Boolean(citation.url && citation.url.length)
    )
  const primaryCitation = sanitizedCitations[0]
  const extraCitationCount = Math.max(sanitizedCitations.length - 1, 0)
  const primaryCitationBadge = primaryCitation
    ? (() => {
        const label =
          (primaryCitation.domain && primaryCitation.domain.trim()) ||
          (primaryCitation.title && primaryCitation.title.trim()) ||
          citationHostname(primaryCitation.url) ||
          primaryCitation.url
        const tooltipTitle = (primaryCitation.title && primaryCitation.title.trim()) || label
        const tooltipSnippet = primaryCitation.snippet?.trim()
        const domainLabel =
          citationHostname(primaryCitation.url) || primaryCitation.domain || primaryCitation.url
        const srOnlyText = `Open source ${tooltipTitle}${
          extraCitationCount > 0 ? ` (plus ${extraCitationCount} more source${extraCitationCount === 1 ? '' : 's'})` : ''
        }`
        return (
          <a
            key={`citation-primary-${primaryCitation.url}`}
            href={primaryCitation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative inline-flex max-w-[12rem] items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <div className="flex items-center gap-1 truncate">
              <span className="truncate">{label}</span>
              {extraCitationCount > 0 && (
                <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  +{extraCitationCount}
                </span>
              )}
            </div>
            <span className="sr-only">{srOnlyText}</span>
            <div className="pointer-events-none absolute left-1/2 top-full z-50 w-72 -translate-x-1/2 -translate-y-2 rounded-2xl border border-border bg-card/95 p-3 text-xs text-foreground opacity-0 transition duration-150 group-hover:opacity-100 group-hover:translate-y-0 shadow-2xl">
              <div className="flex items-center gap-2 text-[12px] font-semibold">
                <Globe className="h-3 w-3 text-muted-foreground" />
                <span className="truncate">{tooltipTitle}</span>
              </div>
              {tooltipSnippet ? (
                <p
                  className="mt-1 text-[11px] text-muted-foreground"
                  style={{ maxHeight: "3rem", overflow: "hidden" }}
                >
                  {tooltipSnippet}
                </p>
              ) : null}
              {domainLabel ? (
                <div className="mt-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  <span className="truncate">{domainLabel}</span>
                </div>
              ) : null}
            </div>
          </a>
        )
      })()
    : null

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

  const [showUserCopyHover, setShowUserCopyHover] = useState(false)
  const rootAttributes = messageId ? { "data-agent-message-id": messageId } : {}

  const userBubbleClass = forceStaticBubble
    ? "inline-block max-w-full rounded-2xl px-3 sm:px-3 py-2 sm:py-2 bg-white/5 border border-border/60 text-foreground"
    : "accent-user-bubble inline-block max-w-full rounded-2xl px-3 sm:px-3 py-2 sm:py-2"

  if (role === 'user') {
    return (
      <div {...rootAttributes} className={`py-3 sm:py-4 ${animateClass}`}>
        <div
          className={`mx-auto w-full ${forceFullWidth ? "max-w-full" : "max-w-3xl"} min-w-0 flex flex-col items-end px-1.5 sm:px-0`}
        >
          {Array.isArray((metadata as any)?.files) && (metadata as any).files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 justify-end max-w-[92%] sm:max-w-4xl lg:max-w-5xl xl:max-w-[1200px] 2xl:max-w-[1400px]">
              {((metadata as any).files as Array<{ name?: string; mimeType?: string; dataUrl?: string; url?: string }>).map((file, idx) => (
                <a
                  key={`user-file-${idx}`}
                  href={file.url || file.dataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-2 hover:bg-muted/60 text-foreground"
                >
                  <div className="h-8 w-8 overflow-hidden rounded-lg bg-muted flex items-center justify-center">
                    {file.mimeType?.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={file.url || file.dataUrl}
                        alt={file.name || "Image"}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
                        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                        <path d="M14 3v6h6" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{file.name || file.url || file.dataUrl}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {file.mimeType?.toUpperCase() || "FILE"}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
          <div className="relative w-full flex justify-end">
            <div
              className="relative max-w-[92%] sm:max-w-[85%] pb-0 min-w-0"
              onMouseEnter={() => setShowUserCopyHover(true)}
              onMouseLeave={() => setShowUserCopyHover(false)}
            >
              <div className={userBubbleClass}>
                <p className="text-base leading-relaxed break-words [overflow-wrap:anywhere]">{content}</p>
              </div>
              <div
                className={`absolute -bottom-4 right-0 transition-opacity ${
                  showUserCopyHover ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleCopy}
                  aria-label="Copy message"
                  className="h-8 w-8 flex-shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>
      </div>
    </div>
  )
}

  const shouldRenderMarkdown = !(role === "assistant" && isStreaming);

  return (
    <div {...rootAttributes} className={`py-0 ${animateClass}`}>
      <div
        className={`mx-auto w-full ${
          forceFullWidth ? "max-w-full" : "max-w-3xl"
        } min-w-0 px-1.5 sm:px-0`}
      >
        <div className={`${
          forceStaticBubble
            ? "space-y-3 sm:space-y-4 bg-transparent"
            : "space-y-3 sm:space-y-4"
        }`}
        >
          {shouldRenderMarkdown ? (
            <MarkdownContent
              content={content}
              messageId={messageId}
              generatedFiles={typedMetadata?.generatedFiles}
              citations={sanitizedCitations}
            />
          ) : (
            <div className="assistant-streaming-text whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
              {content}
            </div>
          )}

          {showInsightChips && <MemoMessageInsightChips metadata={typedMetadata} messageId={messageId} />}

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

                {Boolean(messageId) &&
                  Array.isArray(typedMetadata?.generatedFiles) &&
                  typedMetadata.generatedFiles.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
                      onClick={() => setShowFiles(!showFiles)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span className="hidden xs:inline">{showFiles ? 'Hide files' : 'Files'}</span>
                    </Button>
                  )}
                
                {!suppressSources && ((hasSources ?? false) || (Array.isArray(typedMetadata?.citations) && typedMetadata.citations.length > 0)) && (
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
                
                {!isGuest && displayModelName && showModelActions && (
                  modelTagClickable && Boolean(onRetry) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground flex-shrink-0">
                          {displayModelName}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-auto min-w-max max-w-[90vw] whitespace-nowrap overflow-x-auto"
                      >
                        <DropdownMenuRadioGroup value={retryModel} onValueChange={handleRetryWithModel}>
                          {isGeminiImageMessage ? (
                            <>
                              <DropdownMenuRadioItem value="Nano Banana">
                                <span className="flex-1 whitespace-nowrap">Retry with Nano Banana</span>
                                {displayModelName === 'Nano Banana' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="Nano Banana Pro">
                                <span className="flex-1 whitespace-nowrap">Retry with Nano Banana Pro</span>
                                {displayModelName === 'Nano Banana Pro' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
                              </DropdownMenuRadioItem>
                            </>
                          ) : (
                            <>
                              <DropdownMenuRadioItem value="GPT 5 Nano">
                                <span className="flex-1 whitespace-nowrap">Retry with GPT 5 Nano</span>
                                {displayModelName === 'GPT 5 Nano' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="GPT 5 Mini">
                                <span className="flex-1 whitespace-nowrap">Retry with GPT 5 Mini</span>
                                {displayModelName === 'GPT 5 Mini' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="GPT 5.2">
                                <span className="flex-1 whitespace-nowrap">Retry with GPT 5.2</span>
                                {displayModelName === 'GPT 5.2' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="GPT 5.2 Pro">
                                <span className="flex-1 whitespace-nowrap">Retry with GPT 5.2 Pro</span>
                                {displayModelName === 'GPT 5.2 Pro' && <span className="text-xs text-muted-foreground ml-2">(current)</span>}
                              </DropdownMenuRadioItem>
                            </>
                          )}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="h-8 px-3 inline-flex items-center text-xs text-muted-foreground flex-shrink-0 select-none">
                      {displayModelName}
                    </span>
                  )
                )}
              </>
            )}
          </div>

          {!suppressSources && sanitizedCitations.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 text-xs">
              <div className="flex flex-wrap gap-2">{primaryCitationBadge}</div>
              <div className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span>{sanitizedCitations.length} source{sanitizedCitations.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          )}
          {/* Expandable Sources Panel */}
          {!suppressSources && showSources && Array.isArray(typedMetadata?.citations) && typedMetadata.citations.length > 0 && (
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

          {showFiles &&
            Boolean(messageId) &&
            Array.isArray(typedMetadata?.generatedFiles) &&
            typedMetadata.generatedFiles.length > 0 && (
              <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
                <h4 className="text-sm font-semibold mb-3 text-foreground">Files</h4>
                <div className="space-y-2">
                  {typedMetadata.generatedFiles.map((file) => (
                    <a
                      key={`${file.containerId}:${file.fileId}`}
                      href={`/api/code-interpreter/download?messageId=${encodeURIComponent(
                        messageId as string
                      )}&containerId=${encodeURIComponent(file.containerId)}&fileId=${encodeURIComponent(file.fileId)}`}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors group"
                    >
                      <div className="flex-shrink-0">
                        <Download className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground group-hover:underline truncate">
                          {file.filename}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {file.fileId}
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
});

ChatMessage.displayName = "ChatMessage";
