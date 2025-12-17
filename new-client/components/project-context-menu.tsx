'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, Edit3, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ProjectContextMenuProps {
  onRename?: () => void
  onDelete?: () => void
}

export function ProjectContextMenu({
  onRename,
  onDelete
}: ProjectContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuCoords, setMenuCoords] = useState<{
    position: 'above' | 'below'
    left: number
    top: number
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const reposition = () => {
      if (!buttonRef.current || !menuRef.current) return

      const buttonRect = buttonRef.current.getBoundingClientRect()
      const menuEl = menuRef.current
      const menuHeight = menuEl.offsetHeight
      const menuWidth = menuEl.offsetWidth || 192
      const spaceBelow = window.innerHeight - buttonRect.bottom

      const position: 'above' | 'below' = spaceBelow < menuHeight + 10 ? 'above' : 'below'
      let left = Math.round(buttonRect.right - menuWidth)
      left = Math.min(Math.max(left, 8), Math.max(window.innerWidth - menuWidth - 8, 8))

      const top =
        position === 'above'
          ? Math.round(buttonRect.top - menuHeight - 8)
          : Math.round(buttonRect.bottom + 8)

      setMenuCoords({ position, left, top })
    }

    const raf = requestAnimationFrame(reposition)
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
        setMenuCoords(null)
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
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault()
          e.stopPropagation()
          setMenuCoords(null)
          setIsOpen((prev) => !prev)
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: menuCoords ? `${menuCoords.left}px` : '-9999px',
              top: menuCoords ? `${menuCoords.top}px` : '-9999px',
              visibility: menuCoords ? 'visible' : 'hidden',
              minWidth: 192,
            }}
            className="z-[200] rounded-lg border border-border bg-popover p-1 shadow-lg origin-top-right animate-in fade-in-0 zoom-in-95 duration-150"
          >
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
              Rename project
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
              Delete project
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
