"use client"

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, Share, Edit3, FolderInput, Archive, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ChatContextMenuProps {
  onShare?: () => void
  onRename?: () => void
  onMoveToProject?: () => void
  onRemoveFromProject?: () => void
  onDelete?: () => void
  onArchive?: () => void
  removeLabel?: string
}

export function ChatContextMenu({ onShare, onRename, onMoveToProject, onRemoveFromProject, onDelete, onArchive, removeLabel }: ChatContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuCoords, setMenuCoords] = useState<{ left: number; top: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // When the menu opens, render it first (so `menuRef` is available),
    // then measure and update `menuCoords`. We intentionally don't gate
    // rendering on `menuCoords` to avoid a circular dependency where the
    // menu never renders and therefore can never be measured.
    if (!isOpen) return

    const reposition = () => {
      if (!buttonRef.current || !menuRef.current) return
      const buttonRect = buttonRef.current.getBoundingClientRect()
      const menuEl = menuRef.current
      const menuHeight = menuEl.offsetHeight
      const menuWidth = menuEl.offsetWidth
      const spaceBelow = window.innerHeight - buttonRect.bottom

      const position = spaceBelow < menuHeight + 10 ? 'above' : 'below'

      let left = Math.round(buttonRect.right - menuWidth)
      left = Math.min(Math.max(left, 8), Math.max(window.innerWidth - menuWidth - 8, 8))

      const top = position === 'above'
        ? Math.round(buttonRect.top - menuHeight - 8)
        : Math.round(buttonRect.bottom + 8)

      setMenuCoords({ left, top })
    }

    // Use requestAnimationFrame to ensure layout has settled and the
    // portal DOM is attached before measuring.
    const raf = requestAnimationFrame(reposition)

    // Also reposition on resize/scroll to keep the menu aligned.
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
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
        className="h-7 w-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-hover/chat:opacity-100 transition-opacity duration-200"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: menuCoords ? `${menuCoords.left}px` : '-9999px',
            top: menuCoords ? `${menuCoords.top}px` : '-9999px',
            // allow width to size to content
            width: 'auto',
            minWidth: 160,
            // Keep the menu visually hidden until we compute its coords
            visibility: menuCoords ? 'visible' : 'hidden',
          }}
          className={`z-50 rounded-lg border border-border bg-popover p-1 shadow-lg`}
        >
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onShare?.()
              setIsOpen(false)
            }}
            className="hidden sm:flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
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
          {onRemoveFromProject && (
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRemoveFromProject?.()
                setIsOpen(false)
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
            >
              <FolderInput className="h-4 w-4" />
              {typeof removeLabel === 'string' ? removeLabel : 'Remove from project'}
            </button>
          )}
          <div className="border-t border-border mt-1" />
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onArchive?.()
              setIsOpen(false)
            }}
            className="hidden sm:flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
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
        </div>,
        document.body
      )}
    </div>
  )
}
