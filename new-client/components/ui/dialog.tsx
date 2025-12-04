'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  contentClassName?: string
}

export function Dialog({ open, onClose, children, contentClassName }: DialogProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const portalContainer = useMemo(() => (mounted ? document.body : null), [mounted])

  const handleBackdropClick = useCallback(() => {
    onClose()
  }, [onClose])

  if (!open || !portalContainer) {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur"
        onClick={handleBackdropClick}
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-popover p-4 shadow-2xl",
          contentClassName
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    portalContainer
  )
}
