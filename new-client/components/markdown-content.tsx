'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { ArrowLeft, Check, Copy, Download, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import 'katex/dist/katex.min.css'

interface MarkdownContentProps {
  content: string
  messageId?: string
  generatedFiles?: Array<{
    containerId: string
    fileId: string
    filename: string
  }>
}

const withoutNode = <P extends { node?: unknown }>(
  render: (props: Omit<P, "node">) => React.ReactNode
) => {
  return ({ node, ...rest }: P) => {
    void node;
    return render(rest as Omit<P, "node">);
  };
};

export function MarkdownContent({ content, messageId, generatedFiles }: MarkdownContentProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [lightboxAlt, setLightboxAlt] = useState<string>('')
  const [lightboxCopied, setLightboxCopied] = useState(false)
  const [lightboxOriginalSrc, setLightboxOriginalSrc] = useState<string | null>(null)
  const safeContent = useMemo(() => {
    // Escape $ when immediately followed by a digit to avoid accidental math-mode rendering (pricing, counts).
    return content.replace(/(^|[^\\])\$(\d)/g, '$1\\\\$$2')
  }, [content])

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const closeLightbox = () => {
    setLightboxSrc(null)
    setLightboxAlt('')
    setLightboxCopied(false)
    setLightboxOriginalSrc(null)
  }

  useEffect(() => {
    if (!lightboxSrc) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLightbox()
    }
    document.addEventListener('keydown', onKeyDown)
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = originalOverflow
    }
  }, [lightboxSrc])

  const lightboxFilename = useMemo(() => {
    if (!lightboxSrc) return 'image'
    try {
      if (lightboxSrc.startsWith('data:')) return 'image'
      const url = new URL(lightboxSrc)
      const last = url.pathname.split('/').filter(Boolean).pop()
      return last || 'image'
    } catch {
      return 'image'
    }
  }, [lightboxSrc])

  const proxiedImageSrc = (rawSrc: string): string => {
    const src = String(rawSrc || '').trim()
    if (!src) return ''
    if (src.startsWith('data:') || src.startsWith('blob:')) return src
    if (src.startsWith('/api/images/proxy?')) return src

    try {
      const url = new URL(src)
      const protocol = url.protocol.toLowerCase()
      if (protocol !== 'http:' && protocol !== 'https:') return src

      const hostname = url.hostname.toLowerCase()
      const isSupabaseHosted = hostname.endsWith('supabase.co')

      // Always proxy http (mixed-content), and proxy most external https to avoid hotlink/CORS/referrer issues.
      if (protocol === 'http:' || !isSupabaseHosted) {
        return `/api/images/proxy?url=${encodeURIComponent(src)}`
      }

      return src
    } catch {
      return src
    }
  }

  const handleCopyImageUrl = async () => {
    if (!lightboxSrc) return
    try {
      await navigator.clipboard.writeText(lightboxOriginalSrc || lightboxSrc)
      setLightboxCopied(true)
      setTimeout(() => setLightboxCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const handleDownloadImage = async () => {
    if (!lightboxSrc) return

    const triggerDownload = (href: string) => {
      const a = document.createElement('a')
      a.href = href
      a.download = lightboxFilename
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }

    if (lightboxSrc.startsWith('data:')) {
      triggerDownload(lightboxSrc)
      return
    }

    try {
      const res = await fetch(lightboxSrc, { mode: 'cors' })
      if (!res.ok) throw new Error('download_failed')
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      triggerDownload(objectUrl)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
    } catch {
      window.open(lightboxSrc, '_blank', 'noopener,noreferrer')
    }
  }

  const lightboxNode = lightboxSrc ? (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={closeLightbox}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/55"
          onClick={(e) => {
            e.stopPropagation()
            closeLightbox()
          }}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-black/25 text-white opacity-50 cursor-not-allowed"
            onClick={(e) => e.stopPropagation()}
            aria-label="Share (disabled)"
            aria-disabled="true"
            disabled
          >
            <Share2 className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/55"
            onClick={(e) => {
              e.stopPropagation()
              void handleCopyImageUrl()
            }}
            aria-label="Copy image URL"
          >
            {lightboxCopied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/55"
            onClick={(e) => {
              e.stopPropagation()
              void handleDownloadImage()
            }}
            aria-label="Download"
          >
            <Download className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div
        className="absolute inset-0 z-0 flex items-center justify-center px-6 py-16 pointer-events-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={lightboxSrc}
          alt={lightboxAlt || 'Expanded image'}
          className="pointer-events-auto max-h-[82vh] max-w-[92vw] rounded-3xl object-contain shadow-2xl"
        />
      </div>
    </div>
  ) : null

  const resolveCodeInterpreterDownloadLink = (
    href: string | undefined,
  ): { href: string; filename: string } | null => {
    if (!href) return null
    if (!messageId) return null
    if (!Array.isArray(generatedFiles) || generatedFiles.length === 0) return null
    if (href.startsWith('/api/code-interpreter/download')) return null

    const trimmed = href.trim()
    if (!trimmed) return null
    if (trimmed.startsWith('#')) return null
    if (/^https?:\/\//i.test(trimmed)) return null

    const fileIdCandidate = /^file_[a-zA-Z0-9]+$/.test(trimmed) ? trimmed : null

    const withoutQueryOrHash = trimmed.split('#')[0]?.split('?')[0] ?? ''
    const normalizedPath = withoutQueryOrHash.replace(/\\/g, '/')
    const segments = normalizedPath.split('/').filter(Boolean)
    const lastSegment = segments[segments.length - 1] ?? ''

    const match = generatedFiles.find((file) => {
      if (!file) return false
      if (fileIdCandidate && file.fileId === fileIdCandidate) return true
      if (!lastSegment) return false
      return file.filename?.toLowerCase() === lastSegment.toLowerCase()
    })
    if (!match) return null

    return {
      href: `/api/code-interpreter/download?messageId=${encodeURIComponent(
        messageId
      )}&containerId=${encodeURIComponent(match.containerId)}&fileId=${encodeURIComponent(match.fileId)}`,
      filename: match.filename,
    }
  }

  const isExternalHttpLink = (href: string): boolean => /^https?:\/\//i.test(href)

  const extractText = (children: unknown): string => {
    if (typeof children === 'string') return children
    if (Array.isArray(children)) return children.map(extractText).join('')
    if (children && typeof children === 'object' && 'props' in (children as any)) {
      return extractText((children as any).props?.children)
    }
    return ''
  }

  const buildDirectDownloadHref = (file: { containerId: string; fileId: string; filename: string }) => {
    if (!messageId) return null
    return `/api/code-interpreter/download?messageId=${encodeURIComponent(
      messageId
    )}&containerId=${encodeURIComponent(file.containerId)}&fileId=${encodeURIComponent(file.fileId)}`
  }

  return (
    <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent w-full max-w-full min-w-0 break-words prose-a:break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={{
        // Headings
        h1: withoutNode((props) => (
          <h1 className="text-2xl font-bold mt-6 mb-4 text-foreground" {...props} />
        )),
        h2: withoutNode((props) => (
          <h2 className="text-xl font-bold mt-5 mb-3 text-foreground" {...props} />
        )),
        h3: withoutNode((props) => (
          <h3 className="text-lg font-bold mt-4 mb-2 text-foreground" {...props} />
        )),
        h4: withoutNode((props) => (
          <h4 className="text-base font-bold mt-3 mb-2 text-foreground" {...props} />
        )),
        h5: withoutNode((props) => (
          <h5 className="text-sm font-bold mt-2 mb-1 text-foreground" {...props} />
        )),
        h6: withoutNode((props) => (
          <h6 className="text-sm font-bold mt-2 mb-1 text-muted-foreground" {...props} />
        )),

        // Paragraphs
        p: withoutNode((props) => (
          <p className="text-base leading-relaxed text-foreground mb-4 break-words" {...props} />
        )),

        // Lists
        ul: withoutNode((props) => (
          <ul className="list-disc list-outside ml-6 mb-4 space-y-1 text-foreground" {...props} />
        )),
        ol: withoutNode((props) => (
          <ol className="list-decimal list-outside ml-6 mb-4 space-y-1 text-foreground" {...props} />
        )),
        li: withoutNode((props) => (
          <li className="text-base leading-relaxed" {...props} />
        )),

        // Inline formatting
        strong: withoutNode((props) => (
          <strong className="font-bold text-foreground" {...props} />
        )),
        em: withoutNode((props) => (
          <em className="italic" {...props} />
        )),
        del: withoutNode((props) => (
          <del className="line-through text-muted-foreground" {...props} />
        )),

        // Links
        a: withoutNode((props: any) => {
          const resolvedHref =
            typeof props?.href === 'string' ? props.href : undefined

          const fallbackSingleFileDownload =
            resolvedHref === '/' &&
            messageId &&
            Array.isArray(generatedFiles) &&
            generatedFiles.length === 1 &&
            /download/i.test(extractText(props?.children))
              ? {
                  href: buildDirectDownloadHref(generatedFiles[0]),
                  filename: generatedFiles[0].filename,
                }
              : null

          const resolvedDownload =
            (fallbackSingleFileDownload?.href ? fallbackSingleFileDownload : null) ??
            resolveCodeInterpreterDownloadLink(resolvedHref)
          const href = resolvedDownload?.href ?? resolvedHref
          const isDownload = Boolean(resolvedDownload)
          const target = href && isExternalHttpLink(href) ? '_blank' : undefined

          return (
            <a
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2 break-words break-all"
              {...props}
              href={href}
              target={target}
              rel={target ? 'noopener noreferrer' : undefined}
              download={isDownload ? resolvedDownload?.filename ?? '' : undefined}
            />
          )
        }),

        // Blockquotes
        blockquote: withoutNode((props) => (
          <blockquote
            className="border-l-4 border-muted-foreground/30 pl-4 py-1 my-4 italic text-muted-foreground"
            {...props}
          />
        )),

        // Horizontal rule
        hr: withoutNode((props) => (
          <hr className="my-6 border-border" {...props} />
        )),

        // Tables
        table: withoutNode((props) => (
          <div className="overflow-x-auto my-4">
            <table className="min-w-full border-collapse border border-border" {...props} />
          </div>
        )),
        thead: withoutNode((props) => (
          <thead className="bg-muted" {...props} />
        )),
        tbody: withoutNode((props) => (
          <tbody {...props} />
        )),
        tr: withoutNode((props) => (
          <tr className="border-b border-border" {...props} />
        )),
        th: withoutNode((props) => (
          <th className="px-4 py-2 text-left font-semibold text-foreground border border-border" {...props} />
        )),
        td: withoutNode((props) => (
          <td className="px-4 py-2 text-foreground border border-border" {...props} />
        )),

        // Inline code
        code: ({ inline, className, children }: any) => {
          const match = /language-(\w+)/.exec(className || '')
          const language = match ? match[1] : ''
          const codeString = String(children).replace(/\n$/, '')

          if (!inline && language) {
            // Code block with syntax highlighting
            return (
              <div
                className="my-4 rounded-lg border border-border bg-[#1e1e1e] w-full overflow-hidden min-w-0 mx-auto"
                style={{ maxWidth: 'min(100%, calc(100vw - 2rem))' }}
              >
                <div className="flex items-center justify-between border-b border-border/50 bg-[#252526] px-4 py-2 rounded-t-lg min-w-0">
                  <span className="text-xs font-mono text-muted-foreground">{language}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleCopyCode(codeString)}
                  >
                    {copiedCode === codeString ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <div
                  className="overflow-x-auto rounded-b-lg max-w-full w-full touch-pan-x min-w-0"
                  role="region"
                  aria-label={`${language} code block`}
                  style={{ maxWidth: "100%", width: "100%" }}
                >
                  <SyntaxHighlighter
                    language={language}
                    style={vscDarkPlus}
                    customStyle={{
                      margin: 0,
                      padding: '1rem',
                      background: '#1e1e1e',
                      fontSize: '0.875rem',
                      minWidth: '100%',
                      width: '100%',
                      display: 'block',
                      boxSizing: 'border-box',
                    }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              </div>
            )
          }

          // Inline code
          return (
            <code
              className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-sm"
            >
              {children}
            </code>
          )
        },

        // Images
        img: ({ src, alt, title }: any) => {
          const resolvedSrc = typeof src === 'string' ? src : '';
          if (!resolvedSrc) return null;
          const displaySrc = proxiedImageSrc(resolvedSrc);
          const altText = typeof alt === 'string' && alt.length > 0 ? alt : 'Markdown image';
          const titleText = typeof title === 'string' ? title : undefined;
          return (
            <span className="block my-4">
              <button
                type="button"
                className="block text-left"
                onClick={() => {
                  setLightboxSrc(displaySrc)
                  setLightboxOriginalSrc(resolvedSrc)
                  setLightboxAlt(altText)
                  setLightboxCopied(false)
                }}
              >
                <span
                  className="block w-[456px] h-[456px] max-w-full overflow-hidden rounded-lg border border-border/40 bg-black/10"
                  title={titleText}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={displaySrc}
                    alt={altText}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover cursor-pointer"
                  />
                </span>
              </button>
            </span>
          );
        },

        // Task lists (from GFM)
        input: withoutNode((props: any) => {
          if (props.type === 'checkbox') {
            return (
              <input
                type="checkbox"
                disabled
                className="mr-2 accent-primary"
                {...props}
              />
            )
          }
          return <input {...props} />
        }),
      }}
    >
      {safeContent}
    </ReactMarkdown>

    {typeof document !== 'undefined' && lightboxNode ? createPortal(lightboxNode, document.body) : null}
    </div>
  )
}
