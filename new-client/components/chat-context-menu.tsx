'use client'

import { useState, useRef, useEffect } from 'react'
import { MoreHorizontal, Share, Edit3, FolderInput, Archive, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ChatContextMenuProps {
  onShare?: () => void
  onRename?: () => void
  onMoveToProject?: () => void
  onArchive?: () => void
  onDelete?: () => void
}

export function ChatContextMenu({
  onShare,
  onRename,
  onMoveToProject,
  onArchive,
  onDelete
}: ChatContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<'above' | 'below'>('below')
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen && buttonRef.current && menuRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect()
      const menuHeight = menuRef.current.offsetHeight
      const spaceBelow = window.innerHeight - buttonRect.bottom
      
      setMenuPosition(spaceBelow < menuHeight + 10 ? 'above' : 'below')
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100 group-hover/chat:opacity-100 transition-opacity duration-200"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>

      {isOpen && (
        <div
          ref={menuRef}
          className={`absolute right-0 ${menuPosition === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'} z-50 w-48 rounded-lg border border-border bg-popover p-1 shadow-lg`}
        >
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onShare?.()
              setIsOpen(false)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
          >
            <Share className="h-4 w-4" />
            Share
          </button>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRename?.()
              setIsOpen(false)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
          >
            <Edit3 className="h-4 w-4" />
            Rename
          </button>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onMoveToProject?.()
              setIsOpen(false)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
          >
            <FolderInput className="h-4 w-4" />
            Move to project
            <svg className="ml-auto h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onArchive?.()
              setIsOpen(false)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
          >
            <Archive className="h-4 w-4" />
            Archive
          </button>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onDelete?.()
              setIsOpen(false)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-destructive hover:bg-accent"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
