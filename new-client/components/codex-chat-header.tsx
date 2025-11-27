'use client'

import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface CodexChatHeaderProps {
  title: string
  date: string
  backHref?: string
}

export function CodexChatHeader({ title, date, backHref = '/agents/codex' }: CodexChatHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-4 px-4">
        <Link href={backHref}>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-foreground truncate">{title}</h1>
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
      </div>
    </header>
  )
}
