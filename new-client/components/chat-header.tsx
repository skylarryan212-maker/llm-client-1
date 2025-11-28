'use client'

import { Button } from '@/components/ui/button'
import { Archive, Menu, Share2 } from 'lucide-react'
import { ModelSelector } from '@/components/model-selector'
import type { ModelFamily, SpeedMode } from '@/lib/modelConfig'

interface ChatHeaderProps {
  title: string
  onMenuClick: () => void
  isSidebarOpen: boolean
  modelFamily?: ModelFamily
  speedMode?: SpeedMode
  onModelFamilyChange?: (value: ModelFamily) => void
  onSpeedModeChange?: (value: SpeedMode) => void
}

export function ChatHeader({
  title,
  onMenuClick,
  isSidebarOpen,
  modelFamily = 'auto',
  speedMode = 'auto',
  onModelFamilyChange,
  onSpeedModeChange,
}: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-3 px-4">
        {!isSidebarOpen && (
          <Button variant="ghost" size="icon" onClick={onMenuClick} className="h-9 w-9">
            <Menu className="h-5 w-5" />
          </Button>
        )}
        
        <h1 className="flex-1 text-sm font-semibold text-foreground">{title}</h1>
        
        {onModelFamilyChange && onSpeedModeChange && (
          <ModelSelector
            modelFamily={modelFamily}
            speedMode={speedMode}
            onModelFamilyChange={onModelFamilyChange}
            onSpeedModeChange={onSpeedModeChange}
          />
        )}
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <Share2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <Archive className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}
