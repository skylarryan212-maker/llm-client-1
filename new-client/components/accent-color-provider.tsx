'use client'

import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { getCurrentUserIdClient } from '@/lib/supabase/user'

const colorMap: Record<string, { base: string; hover: string }> = {
  white: {
    base: 'oklch(0.985 0 0)', // White
    hover: 'oklch(0.90 0 0)', // Slightly darker white on hover
  },
  green: {
    base: 'oklch(0.65 0.18 145)', // Green
    hover: 'oklch(0.60 0.18 145)', // Darker green on hover
  },
  blue: {
    base: 'oklch(0.70 0.22 240)', // Blue
    hover: 'oklch(0.65 0.22 240)', // Darker blue on hover
  },
  purple: {
    base: 'oklch(0.70 0.24 290)', // Purple
    hover: 'oklch(0.65 0.24 290)', // Darker purple on hover
  },
  pink: {
    base: 'oklch(0.75 0.26 330)', // Pink
    hover: 'oklch(0.70 0.26 330)', // Darker pink on hover
  },
  orange: {
    base: 'oklch(0.75 0.22 50)', // Orange
    hover: 'oklch(0.70 0.22 50)', // Darker orange on hover
  },
  red: {
    base: 'oklch(0.70 0.26 25)', // Red
    hover: 'oklch(0.65 0.26 25)', // Darker red on hover
  },
}

export function applyAccentColor(accentColor: string) {
  const colors = colorMap[accentColor] || colorMap.white
  
  // Create or update a style element to override CSS with higher specificity
  let styleEl = document.getElementById('accent-color-override')
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'accent-color-override'
    document.head.appendChild(styleEl)
  }
  
  // Apply accent color ONLY to specific interactive buttons
  styleEl.textContent = `
    /* Send button */
    .accent-send-button {
      background-color: ${colors.base} !important;
      color: oklch(0.205 0 0) !important;
    }
    .accent-send-button:hover:not(:disabled) {
      background-color: ${colors.hover} !important;
    }
    
    /* User message bubbles */
    .accent-user-bubble {
      background-color: ${colors.base} !important;
      color: oklch(0.205 0 0) !important;
    }
    
    /* New Project button */
    .accent-new-project-button {
      background-color: ${colors.base} !important;
      color: oklch(0.205 0 0) !important;
    }
    .accent-new-project-button:hover:not(:disabled) {
      background-color: ${colors.hover} !important;
    }
  `

  // Expose accent colors as CSS variables for other UI elements (read-only usage)
  const root = document.documentElement
  root.style.setProperty('--user-accent-color', colors.base)
  root.style.setProperty('--user-accent-color-hover', colors.hover)
}

export function AccentColorProvider({ 
  children,
  initialAccentColor = 'white'
}: { 
  children: React.ReactNode
  initialAccentColor?: string
}) {
  const [currentColor, setCurrentColor] = useState(initialAccentColor)

  useEffect(() => {
    // Apply initial accent color on mount
    applyAccentColor(initialAccentColor)
    setCurrentColor(initialAccentColor)
  }, [initialAccentColor])

  useEffect(() => {
    let isMounted = true
    let cleanup: (() => void) | null = null

    async function setup() {
      const userId = await getCurrentUserIdClient()
      if (!isMounted || !userId) return

      // Listen for custom event (when color changes in settings)
      const handleAccentColorChange = (e: Event) => {
        const customEvent = e as CustomEvent<string>
        const newColor = customEvent.detail
        applyAccentColor(newColor)
        setCurrentColor(newColor)
      }

      const supabase = supabaseBrowser()
      const channel = supabase
        .channel('user_preferences_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_preferences',
            filter: `user_id=eq.${userId}`,
          },
          (payload: any) => {
            const newRow = payload.new as any
            if (newRow?.accent_color && newRow.accent_color !== currentColor) {
              applyAccentColor(newRow.accent_color)
              setCurrentColor(newRow.accent_color)
            }
          }
        )
        .subscribe()

      window.addEventListener('accentColorChange', handleAccentColorChange)

      cleanup = () => {
        window.removeEventListener('accentColorChange', handleAccentColorChange)
        supabase.removeChannel(channel)
      }
    }

    setup()

    return () => {
      isMounted = false
      if (cleanup) {
        cleanup()
      }
    }
  }, [currentColor])

  return <>{children}</>
}
