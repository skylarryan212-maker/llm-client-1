'use client'

import { useEffect, useState } from 'react'
import { PersonalizationForm } from '@/components/personalization-form'
import type { UserPersonalization } from '@/types/preferences'

export function PersonalizationPanel() {
  const [initialData, setInitialData] = useState<UserPersonalization | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/personalization', { cache: 'no-store' })
        const json = await res.json()
        if (!canceled) {
          if (json.success && json.data) {
            setInitialData(json.data as UserPersonalization)
          } else if (json.success && json.data === null) {
            // If API returns null, keep showing loading error
            setError('No personalization data available')
          } else {
            setError(json.error || 'Failed to load personalization')
          }
        }
      } catch (e: any) {
        if (!canceled) setError(String(e))
      } finally {
        if (!canceled) setLoading(false)
      }
    }
    load()
    return () => { canceled = true }
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading personalization…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    )
  }

  if (!initialData) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">No data</p>
      </div>
    )
  }

  return (
    <div className="min-h-[500px]">
      <PersonalizationForm initialData={initialData} />
    </div>
  )
}
