'use client'

import { Paperclip, Search, Image, Network, BookOpen, MoreHorizontal } from 'lucide-react'

interface AttachmentMenuProps {
  isOpen: boolean
  position?: 'top' | 'bottom'
}

export function AttachmentMenu({ isOpen, position = 'top' }: AttachmentMenuProps) {
  if (!isOpen) return null

  const menuItems = [
    { icon: Paperclip, label: 'Add photos & files' },
    { icon: Search, label: 'Deep research' },
    { icon: Image, label: 'Create image' },
    { icon: Network, label: 'Agent mode' },
    { icon: BookOpen, label: 'Study and learn' },
    { icon: MoreHorizontal, label: 'More', hasArrow: true },
  ]

  return (
    <div 
      className={`absolute left-0 z-50 w-64 rounded-xl border border-border bg-popover shadow-lg ${
        position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
    >
      <div className="p-1.5">
        {menuItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.hasArrow && (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
