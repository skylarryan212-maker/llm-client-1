'use client'

import { Code2, Clock } from 'lucide-react'
import Link from 'next/link'

interface CodexTaskItemProps {
  id: string
  title: string
  date: string
  preview: string
  basePath?: string
}

export function CodexTaskItem({ id, title, date, preview, basePath = '/agents/codex/c' }: CodexTaskItemProps) {
  const href = `${basePath}/${id}`

  return (
    <Link href={href}>
      <div className="group rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/50 hover:bg-accent/50">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Code2 className="h-5 w-5" />
          </div>
          
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{preview}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {date}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
