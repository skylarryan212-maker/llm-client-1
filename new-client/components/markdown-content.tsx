'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { ArrowLeft, Check, Copy, Download, Globe, Share2 } from 'lucide-react'
import { visit } from 'unist-util-visit'
import { Button } from '@/components/ui/button'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CitationMetadata } from '@/lib/chatTypes'
import type { PluggableList } from 'unified'
import 'katex/dist/katex.min.css'

interface MarkdownContentProps {
  content: string
  messageId?: string
  generatedFiles?: Array<{
    containerId: string
    fileId: string
    filename: string
  }>
  citations?: CitationMetadata[]
}

const withoutNode = <P extends { node?: unknown }>(
  render: (props: Omit<P, "node">) => React.ReactNode
) => {
  return ({ node, ...rest }: P) => {
    void node;
    return render(rest as Omit<P, "node">);
  };
};

export const MarkdownContent = memo(function MarkdownContent({ content, messageId, generatedFiles, citations }: MarkdownContentProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [copiedTableId, setCopiedTableId] = useState<string | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [lightboxAlt, setLightboxAlt] = useState<string>('')
  const [lightboxCopied, setLightboxCopied] = useState(false)
  const [lightboxOriginalSrc, setLightboxOriginalSrc] = useState<string | null>(null)
  const tableRefs = useRef<Map<string, HTMLTableElement>>(new Map())
  const deferredContent = useDeferredValue(content)

  const normalizeMathDelimiters = useCallback((text: string): string => {
    if (!text) return text;
    let out = '';
    let i = 0;
    const isCurrencyLike = (value: string) =>
      /^[\d\s.,]+(?:[KMBTkm bt]|[KMBT])?%?\s*$/.test(value);
    const shouldRenderInlineMath = (value: string): boolean => {
      const inner = value.trim();
      if (!inner) return false;
      if (isCurrencyLike(inner)) return false;

      const hasLatexCommand = /\\[a-zA-Z]+/.test(inner);
      const hasMathOperators = /[=^_<>]/.test(inner) || /[+\-*/]/.test(inner);
      const hasWordySentence = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(inner);
      const startsWithDigit = /^[\d.,]/.test(inner);

      if (hasWordySentence && !hasLatexCommand) return false;
      if (startsWithDigit && !hasLatexCommand && !hasMathOperators) return false;
      if (startsWithDigit && hasMathOperators && inner.length > 24) return false;

      return hasLatexCommand || hasMathOperators;
    };

    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        out += ch;
        if (i + 1 < text.length) {
          out += text[i + 1];
          i += 2;
          continue;
        }
      }
      if (ch === '$') {
        if (text[i + 1] === '$') {
          out += '$$';
          i += 2;
          continue;
        }
        const next = text[i + 1];
        if (next && /[\d.,]/.test(next)) {
          out += '\\$';
          i += 1;
          continue;
        }
        let j = i + 1;
        let found = false;
        while (j < text.length) {
          if (text[j] === '\\') {
            j += 2;
            continue;
          }
          if (text[j] === '$') {
            found = true;
            break;
          }
          j += 1;
        }
        if (!found) {
          out += '\\$';
          i += 1;
          continue;
        }
        const inner = text.slice(i + 1, j);
        if (shouldRenderInlineMath(inner)) {
          out += `$${inner}$`;
          i = j + 1;
        } else {
          out += '\\$';
          i += 1;
        }
        continue;
      }
      out += ch;
      i += 1;
    }

    return out;
  }, []);

  const safeContent = useMemo(
    () => normalizeMathDelimiters(deferredContent || ''),
    [deferredContent, normalizeMathDelimiters]
  );

  const enableMath = useMemo(() => {
    const text = safeContent;
    if (!text) return false;
    const hasBlock = /\$\$[\s\S]*\$\$/.test(text) || /\\\[[\s\S]*?\\\]/.test(text);
    const hasInlinePair = /\\\((?:.|\n)*?\\\)/.test(text);
    const hasInlineDollar = /(^|[^\\])\$(?!\$)[\s\S]*?[^\\]\$(?!\$)/.test(text);
    const hasLatexEnv = /\\begin\{[^}]+\}/.test(text);
    return hasBlock || hasInlinePair || hasInlineDollar || hasLatexEnv;
  }, [safeContent]);

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

  const citationHostname = (value?: string | null) => {
    if (!value) return null
    try {
      const url = new URL(value)
      return url.hostname.replace(/^www\\./i, '')
    } catch {
      return value.trim() || null
    }
  }

  const normalizeCitationUrl = useCallback((value?: string | null): string => {
    const trimmed = (value ?? '').trim()
    if (!trimmed) return ''
    const stripTrailingSlash = (input: string) => input.replace(/\/+$/, '')

    try {
      const url = new URL(trimmed)
      url.hash = ''
      return stripTrailingSlash(url.toString())
    } catch {
      return stripTrailingSlash(trimmed)
    }
  }, [])

  const sanitizedCitations = useMemo(() => {
    if (!Array.isArray(citations)) return []
    return citations
      .map((citation) => ({
        ...citation,
        url: typeof citation.url === 'string' ? citation.url.trim() : '',
      }))
      .filter((citation): citation is CitationMetadata & { url: string } => Boolean(citation.url))
  }, [citations])

  const citationUrlSet = useMemo(() => {
    const set = new Set<string>()
    for (const citation of sanitizedCitations) {
      const normalized = normalizeCitationUrl(citation.url)
      if (normalized) {
        set.add(normalized)
      }
    }
    return set
  }, [sanitizedCitations, normalizeCitationUrl])

  const citationLookup = useMemo(() => {
    const map = new Map<string, CitationMetadata & { url: string }>()
    for (const citation of sanitizedCitations) {
      const normalized = normalizeCitationUrl(citation.url)
      if (normalized) {
        map.set(normalized, citation)
      }
    }
    return map
  }, [sanitizedCitations, normalizeCitationUrl])

  const getMdastText = (node: any): string => {
    if (!node) return ''
    if (node.type === 'text') return node.value || ''
    if (Array.isArray(node.children)) {
      return node.children.map(getMdastText).join('')
    }
    return ''
  }

  const isCitationLabel = (node: any): boolean => {
    const label = getMdastText(node).trim().toLowerCase()
    if (!label) return false
    const compact = label.replace(/\s+/g, '')
    return /^\d+$/.test(compact) || compact === 'source' || compact === 'sources'
  }

  const isCitationLinkNode = (node: any): string | null => {
    if (!node || node.type !== 'link') return null
    const normalized = normalizeCitationUrl(node.url)
    if (!normalized || !citationUrlSet.has(normalized)) return null
    if (!isCitationLabel(node)) return null
    return normalized
  }

  const remarkCitationGroups = useMemo(() => {
    if (!citationUrlSet.size) return null
    return (tree: any) => {
      visit(tree, 'paragraph', (node: any) => {
        if (!Array.isArray(node.children)) return
        const children = node.children
        const nextChildren: any[] = []
        let i = 0

        while (i < children.length) {
          const child = children[i]
          const firstUrl = isCitationLinkNode(child)
          if (!firstUrl) {
            nextChildren.push(child)
            i += 1
            continue
          }

          const groupUrls: string[] = [firstUrl]
          let j = i + 1

          while (j < children.length) {
            const candidate = children[j]
            if (candidate?.type === 'text' && typeof candidate.value === 'string' && candidate.value.trim() === '') {
              let k = j + 1
              while (
                k < children.length &&
                children[k]?.type === 'text' &&
                typeof children[k]?.value === 'string' &&
                children[k].value.trim() === ''
              ) {
                k += 1
              }
              const nextUrl = k < children.length ? isCitationLinkNode(children[k]) : null
              if (nextUrl) {
                j = k
                continue
              }
              break
            }
            const nextUrl = isCitationLinkNode(candidate)
            if (nextUrl) {
              groupUrls.push(nextUrl)
              j += 1
              continue
            }
            break
          }

          const uniqueUrls: string[] = []
          const seen = new Set<string>()
          for (const url of groupUrls) {
            if (!seen.has(url)) {
              seen.add(url)
              uniqueUrls.push(url)
            }
          }

          nextChildren.push({
            type: 'citationGroup',
            data: {
              hName: 'citation-group',
              hProperties: {
                urls: uniqueUrls,
              },
            },
          })
          i = j
        }

        node.children = nextChildren
      })
    }
  }, [citationUrlSet, normalizeCitationUrl])

  const InlineCitationBadge = ({ urls }: { urls?: string[] | string }) => {
    const parsedUrls = Array.isArray(urls)
      ? urls
      : typeof urls === 'string'
        ? urls.split('|').filter(Boolean)
        : []
    if (!parsedUrls.length) return null
    const uniqueUrls: string[] = []
    const seen = new Set<string>()
    for (const url of parsedUrls) {
      if (!seen.has(url)) {
        seen.add(url)
        uniqueUrls.push(url)
      }
    }
    const primaryKey = uniqueUrls[0]
    const primaryCitation = citationLookup.get(primaryKey) ?? { url: primaryKey }
    const extraCount = Math.max(uniqueUrls.length - 1, 0)
    const label =
      (primaryCitation.domain && primaryCitation.domain.trim()) ||
      (primaryCitation.title && primaryCitation.title.trim()) ||
      citationHostname(primaryCitation.url) ||
      primaryCitation.url
    const tooltipTitle = (primaryCitation.title && primaryCitation.title.trim()) || label
    const tooltipSnippet = primaryCitation.snippet?.trim()
    const domainLabel =
      citationHostname(primaryCitation.url) || primaryCitation.domain || primaryCitation.url

    return (
      <a
        href={primaryCitation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="not-prose group relative inline-flex max-w-[12rem] items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground no-underline transition-colors hover:border-foreground/40 hover:text-foreground align-middle"
      >
        <div className="flex items-center gap-1 truncate">
          <span className="truncate">{label}</span>
          {extraCount > 0 && (
            <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              +{extraCount}
            </span>
          )}
        </div>
        <span className="sr-only">{`Open source ${tooltipTitle}`}</span>
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
  }

  const buildDirectDownloadHref = (file: { containerId: string; fileId: string; filename: string }) => {
    if (!messageId) return null
    return `/api/code-interpreter/download?messageId=${encodeURIComponent(
      messageId
    )}&containerId=${encodeURIComponent(file.containerId)}&fileId=${encodeURIComponent(file.fileId)}`
  }

  const tableToMarkdown = (tableEl: HTMLTableElement): string => {
    const textify = (el: Element | null) =>
      (el?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\|/g, '\\|')
    const headerCells = Array.from(tableEl.querySelectorAll('thead tr:first-child th'))
    const bodyRows = Array.from(tableEl.querySelectorAll('tbody tr'))
    const rows: string[][] = []
    let headerRow: string[] = headerCells.map(textify).filter(Boolean)
    if (headerRow.length === 0 && bodyRows.length) {
      const firstBodyCells = Array.from(bodyRows[0].querySelectorAll('td'))
      headerRow = firstBodyCells.map(textify)
      bodyRows.shift()
    }
    if (headerRow.length > 0) rows.push(headerRow)
    for (const row of bodyRows) {
      const cells = Array.from(row.querySelectorAll('td')).map(textify)
      if (cells.length) rows.push(cells)
    }
    if (!rows.length) return ''
    const normalizedWidth = Math.max(...rows.map((r) => r.length))
    const fill = (arr: string[]) => {
      const copy = [...arr]
      while (copy.length < normalizedWidth) copy.push('')
      return copy
    }
    const lines: string[] = []
    const hdr = fill(rows[0])
    lines.push(`| ${hdr.join(' | ')} |`)
    lines.push(`| ${hdr.map(() => '---').join(' | ')} |`)
    for (const bodyRow of rows.slice(1)) {
      const cells = fill(bodyRow)
      lines.push(`| ${cells.join(' | ')} |`)
    }
    return lines.join('\n')
  }

  const handleCopyTable = async (id: string) => {
    const ref = tableRefs.current.get(id)
    if (!ref) return
    const markdown = tableToMarkdown(ref)
    if (!markdown) return
    await navigator.clipboard.writeText(markdown)
    setCopiedTableId(id)
    setTimeout(() => setCopiedTableId((prev) => (prev === id ? null : prev)), 2000)
  }

  const TableRenderer = (props: any) => {
    const { node, ...rest } = props || {}
    void node
    const tableId = useMemo(() => `tbl-${Math.random().toString(36).slice(2, 8)}`, [])
    const tableRef = useCallback(
      (el: HTMLTableElement | null) => {
        if (el) {
          tableRefs.current.set(tableId, el)
        } else {
          tableRefs.current.delete(tableId)
        }
      },
      [tableId]
    )
    const buttonRef = useRef<HTMLButtonElement | null>(null)

    useEffect(() => {
      const update = () => {
        const tableEl = tableRefs.current.get(tableId)
        const btn = buttonRef.current
        if (!tableEl || !btn) return
        const thead = tableEl.querySelector('thead')
        const wrapper = tableEl.parentElement
        if (!thead || !wrapper) return
        const headRect = thead.getBoundingClientRect()
        const wrapRect = wrapper.getBoundingClientRect()
        const btnRect = btn.getBoundingClientRect()
        const offset = headRect.top - wrapRect.top + headRect.height / 2 - btnRect.height / 2
        btn.style.top = `${Math.max(4, offset)}px`
      }
      update()
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }, [tableId])

    return (
      <div className="group relative my-6 overflow-x-auto">
        <button
          type="button"
          className="absolute right-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-foreground/80 opacity-0 transition hover:text-foreground hover:bg-surface/30 group-hover:opacity-100 border-0 shadow-none"
          ref={buttonRef}
          onClick={(e) => {
            e.stopPropagation()
            void handleCopyTable(tableId)
          }}
          aria-label="Copy table as markdown"
        >
          {copiedTableId === tableId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
        <table
          ref={tableRef}
          className="min-w-full border-collapse text-[14px] text-foreground/90 bg-surface/70"
          {...rest}
        />
      </div>
    )
  }


  const remarkPlugins = useMemo<PluggableList>(() => {
    const plugins: PluggableList = [remarkGfm]
    if (remarkCitationGroups) {
      plugins.push(remarkCitationGroups)
    }
    if (enableMath) {
      plugins.push(remarkMath)
    }
    return plugins
  }, [remarkCitationGroups, enableMath])

  return (
    <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent w-full max-w-full min-w-0 break-words prose-a:break-words">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeRaw, ...(enableMath ? [rehypeKatex] : [])]}
        components={{
        'citation-group': (props: any) => {
          const { node, ...rest } = props || {}
          void node
          return <InlineCitationBadge urls={rest.urls} />
        },
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
          <em className="italic text-foreground" {...props} />
        )),
        i: withoutNode((props) => (
          <i className="italic text-foreground" {...props} />
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
          const normalizedHref = normalizeCitationUrl(href)
          const inlineLinkText = extractText(props?.children ?? '').trim()
          const inlineDigits = inlineLinkText.replace(/\s+/g, '')
          const inlineLabel = inlineDigits.toLowerCase()
          const isCitationLabelText =
            /^\d+$/.test(inlineDigits) || inlineLabel === 'source' || inlineLabel === 'sources'
          const shouldHideInlineCitation =
            Boolean(normalizedHref) &&
            citationUrlSet.has(normalizedHref) &&
            inlineDigits.length > 0 &&
            isCitationLabelText
          if (shouldHideInlineCitation) {
            return <span className="sr-only">{inlineLinkText}</span>
          }

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
        table: TableRenderer,
        thead: withoutNode((props) => (
          <thead className="bg-surface/85 text-foreground/85" {...props} />
        )),
        tbody: withoutNode((props) => (
          <tbody className="bg-surface/70" {...props} />
        )),
        tr: withoutNode((props) => (
          <tr className="last:border-0 hover:bg-surface/75 transition-colors" {...props} />
        )),
        th: withoutNode((props) => (
          <th className="px-5 py-3 text-left text-[14px] font-bold uppercase tracking-wide border-b-2 border-border/60 leading-tight align-middle first:rounded-tl-none last:rounded-tr-none" {...props} />
        )),
        td: withoutNode((props) => (
          <td className="px-5 py-3 text-[14px] text-foreground/90 align-middle border-b border-border/60 leading-tight" {...props} />
        )),

        // Inline code
        code: ({ inline, className, children }: any) => {
          const match = /language-(\w+)/.exec(className || '')
          const language = match ? match[1] : ''
          const codeString = String(children).replace(/\n$/, '')

          if (!inline) {
            const label = language || 'text'
            return (
              <div
                className="my-4 rounded-lg border border-border bg-[#1e1e1e] w-full overflow-hidden min-w-0 mx-auto"
                style={{ maxWidth: 'min(100%, calc(100vw - 2rem))' }}
              >
                <div className="flex items-center justify-between border-b border-border/50 bg-[#252526] px-4 py-2 rounded-t-lg min-w-0">
                  <span className="text-xs font-mono text-muted-foreground">{label}</span>
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
                  aria-label={`${label} code block`}
                  style={{ maxWidth: "100%", width: "100%" }}
                >
                  <SyntaxHighlighter
                    language={language || 'text'}
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
      } as any}
    >
      {safeContent}
    </ReactMarkdown>

      {typeof document !== 'undefined' && lightboxNode ? createPortal(lightboxNode, document.body) : null}
    </div>
  )
});

MarkdownContent.displayName = "MarkdownContent";
