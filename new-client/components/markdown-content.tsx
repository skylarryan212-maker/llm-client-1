'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import 'katex/dist/katex.min.css'

interface MarkdownContentProps {
  content: string
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  return (
    <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={{
        // Headings
        h1: ({ node, ...props }) => (
          <h1 className="text-2xl font-bold mt-6 mb-4 text-foreground" {...props} />
        ),
        h2: ({ node, ...props }) => (
          <h2 className="text-xl font-bold mt-5 mb-3 text-foreground" {...props} />
        ),
        h3: ({ node, ...props }) => (
          <h3 className="text-lg font-bold mt-4 mb-2 text-foreground" {...props} />
        ),
        h4: ({ node, ...props }) => (
          <h4 className="text-base font-bold mt-3 mb-2 text-foreground" {...props} />
        ),
        h5: ({ node, ...props }) => (
          <h5 className="text-sm font-bold mt-2 mb-1 text-foreground" {...props} />
        ),
        h6: ({ node, ...props }) => (
          <h6 className="text-sm font-bold mt-2 mb-1 text-muted-foreground" {...props} />
        ),

        // Paragraphs
        p: ({ node, ...props }) => (
          <p className="text-base leading-relaxed text-foreground mb-4 break-words" {...props} />
        ),

        // Lists
        ul: ({ node, ...props }) => (
          <ul className="list-disc list-outside ml-6 mb-4 space-y-1 text-foreground" {...props} />
        ),
        ol: ({ node, ...props }) => (
          <ol className="list-decimal list-outside ml-6 mb-4 space-y-1 text-foreground" {...props} />
        ),
        li: ({ node, ...props }) => (
          <li className="text-base leading-relaxed" {...props} />
        ),

        // Inline formatting
        strong: ({ node, ...props }) => (
          <strong className="font-bold text-foreground" {...props} />
        ),
        em: ({ node, ...props }) => (
          <em className="italic" {...props} />
        ),
        del: ({ node, ...props }) => (
          <del className="line-through text-muted-foreground" {...props} />
        ),

        // Links
        a: ({ node, ...props }) => (
          <a
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          />
        ),

        // Blockquotes
        blockquote: ({ node, ...props }) => (
          <blockquote
            className="border-l-4 border-muted-foreground/30 pl-4 py-1 my-4 italic text-muted-foreground"
            {...props}
          />
        ),

        // Horizontal rule
        hr: ({ node, ...props }) => (
          <hr className="my-6 border-border" {...props} />
        ),

        // Tables
        table: ({ node, ...props }) => (
          <div className="overflow-x-auto my-4">
            <table className="min-w-full border-collapse border border-border" {...props} />
          </div>
        ),
        thead: ({ node, ...props }) => (
          <thead className="bg-muted" {...props} />
        ),
        tbody: ({ node, ...props }) => (
          <tbody {...props} />
        ),
        tr: ({ node, ...props }) => (
          <tr className="border-b border-border" {...props} />
        ),
        th: ({ node, ...props }) => (
          <th className="px-4 py-2 text-left font-semibold text-foreground border border-border" {...props} />
        ),
        td: ({ node, ...props }) => (
          <td className="px-4 py-2 text-foreground border border-border" {...props} />
        ),

        // Inline code
        code: ({ node, inline, className, children, ...props }: any) => {
          const match = /language-(\w+)/.exec(className || '')
          const language = match ? match[1] : ''
          const codeString = String(children).replace(/\n$/, '')

          if (!inline && language) {
            // Code block with syntax highlighting
            return (
              <div className="my-4 overflow-hidden rounded-lg border border-border bg-[#1e1e1e]">
                <div className="flex items-center justify-between border-b border-border/50 bg-[#252526] px-4 py-2">
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
                  {codeString}
                </SyntaxHighlighter>
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
        img: ({ node, ...props }) => (
          <img
            className="rounded-lg max-w-full h-auto my-4"
            {...props}
          />
        ),

        // Task lists (from GFM)
        input: ({ node, ...props }: any) => {
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
        },
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  )
}
