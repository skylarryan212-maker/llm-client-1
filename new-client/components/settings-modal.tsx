'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Palette, Database, UserCircle, ChevronDown, Info, Copy, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { applyAccentColor } from '@/components/accent-color-provider'
import { updateAccentColorAction } from '@/app/actions/preferences-actions'
import { getContextModeGlobalPreference, saveContextModeGlobalPreference } from '@/app/actions/user-preferences-actions'
import { useUserPlan } from '@/lib/hooks/use-user-plan'
import { useUserIdentity } from '@/components/user-identity-provider'
import supabaseClient from '@/lib/supabase/browser-client'
import { getUserPlanDetails, cancelSubscription } from '@/app/actions/plan-actions'
import { getUserTotalSpending, getMonthlySpending } from '@/app/actions/usage-actions'
import { getUsageStatus } from '@/lib/usage-limits'
import { PersonalizationPanel } from '@/components/personalization-panel'
import { useChatStore } from '@/components/chat/chat-provider'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: TabType
}

type TabType = 'preferences' | 'data' | 'account'
const SPEED_MODE_STORAGE_KEY = "llm-client-speed-mode"

export function SettingsModal({ isOpen, onClose, initialTab = 'preferences' }: SettingsModalProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>(initialTab)
  const [accentColor, setAccentColor] = useState('white')
  const { plan, refreshPlan } = useUserPlan()
  const [contextModeGlobal, setContextModeGlobal] = useState<"advanced" | "simple">("simple")
  const [speedModeEnabled, setSpeedModeEnabled] = useState(false)
  const { fullName, email, isGuest, tokenAuth } = useUserIdentity()
  const { refreshChats } = useChatStore()

  const [planDetails, setPlanDetails] = useState<{
    planType: string
    renewalDate: string | null
    cancelAt: string | null
    cancelAtPeriodEnd: boolean
    isActive: boolean
  } | null>(null)
  const [totalSpending, setTotalSpending] = useState<number | null>(null)
  const [monthlySpending, setMonthlySpending] = useState<number | null>(null)
  const [usageStatus, setUsageStatus] = useState<{
    exceeded: boolean
    warning: boolean
    percentage: number
    remaining: number
    limit: number
  } | null>(null)
  const [tokenKey, setTokenKey] = useState<string | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle")
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancelProcessing, setCancelProcessing] = useState(false)
  const [cancelResultDialog, setCancelResultDialog] = useState<{ open: boolean; message: string; success: boolean }>({ open: false, message: "", success: false })
  const [deleteAllChatsConfirmOpen, setDeleteAllChatsConfirmOpen] = useState(false)
  const [deleteAllChatsProcessing, setDeleteAllChatsProcessing] = useState(false)
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const fetchAccountData = useCallback(async () => {
    try {
      const [details, total, monthly] = await Promise.all([
        getUserPlanDetails(),
        getUserTotalSpending(),
        getMonthlySpending()
      ])

      setPlanDetails(details)
      setTotalSpending(total)
      setMonthlySpending(monthly)

      const status = details ? getUsageStatus(monthly, details.planType) : null
      setUsageStatus(status)

    } catch (error) {
      console.error('Failed to load account data', error)
    }
  }, [])

  useEffect(() => {
    // Refresh account data in the background regardless of modal state
    fetchAccountData()
    const interval = setInterval(fetchAccountData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchAccountData])

  useEffect(() => {
    if (isOpen && activeTab === 'account') {
      fetchAccountData()
    }
  }, [isOpen, activeTab, fetchAccountData])

  useEffect(() => {
    // Accent color is now loaded from server via AccentColorProvider
    // We just need to sync the local state when modal opens
    if (isOpen) {
      let alive = true
      setActiveTab(initialTab)
      try {
        const storedSpeedMode = window.localStorage.getItem(SPEED_MODE_STORAGE_KEY)
        setSpeedModeEnabled(storedSpeedMode === "1")
      } catch {}
      const styleEl = document.getElementById('accent-color-override')
      if (styleEl) {
        const content = styleEl.textContent || ''
        if (content.includes('oklch(0.985 0 0)')) setAccentColor('white')
        else if (content.includes('oklch(0.65 0.18 145)')) setAccentColor('green')
        else if (content.includes('oklch(0.70 0.22 240)')) setAccentColor('blue')
        else if (content.includes('oklch(0.70 0.24 290)')) setAccentColor('purple')
        else if (content.includes('oklch(0.75 0.26 330)')) setAccentColor('pink')
        else if (content.includes('oklch(0.75 0.22 50)')) setAccentColor('orange')
        else if (content.includes('oklch(0.70 0.26 25)')) setAccentColor('red')
      }
      // Always refresh plan and usage when opening to avoid stale cache
      refreshPlan().catch(() => {})
      fetchAccountData().catch(() => {})
      try {
        const storedMode = window.localStorage.getItem("context-mode-global")
        if (storedMode === "simple" || storedMode === "advanced") {
          setContextModeGlobal(storedMode)
        }
      } catch {}

      if (!isGuest) {
        getContextModeGlobalPreference()
          .then((mode) => {
            if (!alive) return
            setContextModeGlobal(mode)
            try {
              window.localStorage.setItem("context-mode-global", mode)
              window.dispatchEvent(
                new CustomEvent("contextModeGlobalChange", { detail: mode })
              )
            } catch {}
          })
          .catch(() => {})
      }

      return () => {
        alive = false
      }
    }
  }, [isOpen, initialTab, isGuest, refreshPlan, fetchAccountData])

  useEffect(() => {
    if (!isOpen) return

    const el = contentScrollRef.current
    if (!el) return

    const update = () => {
      const maxScrollTop = el.scrollHeight - el.clientHeight
      const scrollTop = el.scrollTop
      setCanScrollUp(scrollTop > 2)
      setCanScrollDown(scrollTop < maxScrollTop - 2)
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [isOpen, activeTab])

  useEffect(() => {
    if (!isOpen || activeTab !== 'account' || !tokenAuth) {
      setTokenKey(null)
      setTokenLoading(false)
      setTokenVisible(false)
      return
    }

    let alive = true
    setTokenLoading(true)
    supabaseClient
      .from("token_auth_keys")
      .select("token")
      .maybeSingle()
      .then((result) => {
        if (!alive) return
        setTokenKey(result.data?.token ?? null)
        setTokenVisible(false)
        setCopyStatus("idle")
      })
      .catch((error) => {
        console.error("[settings][token] failed to load token", error)
        if (!alive) return
        setTokenKey(null)
      })
      .finally(() => {
        if (!alive) return
        setTokenLoading(false)
      })

    return () => {
      alive = false
    }
  }, [isOpen, activeTab, tokenAuth])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleAccentColorChange = (newColor: string) => {
    // Only save when user explicitly changes the color
    setAccentColor(newColor)
    
    // Apply the accent color immediately
    applyAccentColor(newColor)
    
    // Dispatch custom event so AccentColorProvider can react
    window.dispatchEvent(new CustomEvent('accentColorChange', { detail: newColor }))
    
    // Save to Supabase (async, non-blocking)
    updateAccentColorAction(newColor)
      .then((result) => {
        if (!result.success) {
          console.error('Failed to save accent color:', result.error)
        }
      })
  }

  const handleSpeedModeToggle = (nextEnabled: boolean) => {
    setSpeedModeEnabled(nextEnabled)
    try {
      if (nextEnabled) {
        window.localStorage.setItem(SPEED_MODE_STORAGE_KEY, "1")
      } else {
        window.localStorage.removeItem(SPEED_MODE_STORAGE_KEY)
      }
      window.dispatchEvent(new CustomEvent("speedModeChange", { detail: nextEnabled }))
    } catch {}

    if (nextEnabled) {
      setContextModeGlobal("simple")
      try {
        window.localStorage.setItem("context-mode-global", "simple")
        window.dispatchEvent(
          new CustomEvent("contextModeGlobalChange", { detail: "simple" })
        )
      } catch {}
      if (!isGuest) {
        saveContextModeGlobalPreference("simple").catch(() => {})
      }
    }
  }

  const handleChangePlan = () => {
    onClose()
    router.push('/upgrade?showAll=true')
  }

  const handleCancelSubscription = async () => {
    setCancelConfirmOpen(false)
    setCancelProcessing(true)
    
    const result = await cancelSubscription()
    if (result.success) {
      // Clear plan cache to force immediate update everywhere
      try {
        window.localStorage.removeItem('user_plan_cache')
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent('api-usage-updated'))
      } catch {}
      
      // Refresh plan status everywhere
      await refreshPlan()
      
      // Refresh all plan-related data in the settings modal
      const [details, total, monthly] = await Promise.all([
        getUserPlanDetails(),
        getUserTotalSpending(),
        getMonthlySpending()
      ])
      setPlanDetails(details)
      setTotalSpending(total)
      setMonthlySpending(monthly)
      
      if (details) {
        const status = getUsageStatus(monthly, details.planType)
        setUsageStatus(status)
      }
    }
    
    setCancelResultDialog({ 
      open: true, 
      message: result.message,
      success: result.success
    })
    setCancelProcessing(false)
  }

  const handleDeleteAllChats = async () => {
    setDeleteAllChatsConfirmOpen(false)
    setDeleteAllChatsProcessing(true)
    
    try {
      const { deleteAllConversationsAction } = await import('@/app/actions/chat-actions')
      await deleteAllConversationsAction()
      try {
        await refreshChats()
      } catch (refreshErr) {
        console.error('Failed to refresh chats after deletion:', refreshErr)
      }
      
      // Close modal and redirect to home
      onClose()
      router.push('/')
      router.refresh()
    } catch (error) {
      console.error('Failed to delete all chats:', error)
      alert('Failed to delete all chats. Please try again.')
    } finally {
      setDeleteAllChatsProcessing(false)
    }
  }

  const handleCopyToken = async () => {
    if (!tokenKey || typeof navigator === "undefined" || !navigator.clipboard) {
      return
    }
    try {
      await navigator.clipboard.writeText(tokenKey)
      setCopyStatus("copied")
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopyStatus("idle")
      }, 1500)
    } catch (error) {
      console.error("[settings][token] failed to copy token", error)
    }
  }

  if (!isOpen) return null

  const tabs = [
    { id: 'preferences' as TabType, label: 'Preferences', icon: Palette },
    { id: 'data' as TabType, label: 'Data', icon: Database },
    { id: 'account' as TabType, label: 'Account & Plan', icon: UserCircle },
  ]

  const accentColors = [
    { value: 'white', label: 'White', class: 'bg-white border border-border' },
    { value: 'green', label: 'Green', class: 'bg-green-500' },
    { value: 'blue', label: 'Blue', class: 'bg-blue-500' },
    { value: 'purple', label: 'Purple', class: 'bg-purple-500' },
    { value: 'pink', label: 'Pink', class: 'bg-pink-500' },
    { value: 'orange', label: 'Orange', class: 'bg-orange-500' },
    { value: 'red', label: 'Red', class: 'bg-red-500' },
  ]

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
      <div
        className="modal-panel relative flex flex-col sm:flex-row h-[58vh] max-h-[58vh] w-full max-w-[min(520px,95vw)] sm:max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl pointer-events-auto"
      >
        {/* Sidebar */}
        <div className="w-full sm:w-56 border-b sm:border-b-0 sm:border-r border-border bg-muted/30 px-3 pt-3 pb-3">
          <div className="mb-3 flex h-8 items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-1 gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? 'secondary' : 'ghost'}
                  className="w-full justify-start gap-3 text-sm"
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Button>
              )
            })}
          </div>

          <div aria-hidden="true" className="mt-3 h-8" />
        </div>

        {/* Content */}
        <div className="relative flex-1 min-h-0">
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 right-0 top-0 z-10 h-10 bg-gradient-to-b from-black/35 to-transparent transition-opacity duration-200 ${canScrollUp ? 'opacity-100' : 'opacity-0'}`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 right-0 bottom-0 z-10 h-12 bg-gradient-to-t from-black/35 to-transparent transition-opacity duration-200 ${canScrollDown ? 'opacity-100' : 'opacity-0'}`}
          />
          <div ref={contentScrollRef} className="h-full overflow-y-auto p-6 sm:p-8">
          {activeTab === 'preferences' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">Preferences</h2>
                <div className="mt-1 h-px bg-border" />
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <Label className="text-base">Theme</Label>
                  <Select defaultValue="system">
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">System</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-base">Accent color</Label>
                  <div className="flex items-center gap-2">
                    {accentColors.map((color) => (
                      <button
                        key={color.value}
                        onClick={() => handleAccentColorChange(color.value)}
                        className={`h-6 w-6 rounded-full ${color.class} transition-all ${
                          accentColor === color.value
                            ? 'ring-2 ring-offset-1 ring-offset-background ring-primary'
                            : 'hover:scale-105'
                        }`}
                        title={color.label}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-base">Context mode (default)</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 text-sm"
                    disabled={speedModeEnabled}
                    title={speedModeEnabled ? "Speed Mode forces simple context." : undefined}
                    onClick={() => {
                      const next = contextModeGlobal === "simple" ? "advanced" : "simple"
                      setContextModeGlobal(next)
                      try {
                        window.localStorage.setItem("context-mode-global", next)
                        window.dispatchEvent(
                          new CustomEvent("contextModeGlobalChange", { detail: next })
                        )
                      } catch {}
                      if (!isGuest) {
                        saveContextModeGlobalPreference(next)
                          .then((result) => {
                            if (!result.success) {
                              console.error('Failed to save context mode:', result.message)
                            }
                          })
                          .catch(() => {})
                      }
                    }}
                  >
                    {contextModeGlobal === "simple" ? "Simple" : "Advanced"}
                  </Button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-base">Speed Mode</Label>
                    <span title="Disables auto model selection and advanced context to keep responses fast.">
                      <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </span>
                  </div>
                  <Button
                    variant={speedModeEnabled ? "secondary" : "outline"}
                    size="sm"
                    className="h-9 px-3 text-sm"
                    onClick={() => handleSpeedModeToggle(!speedModeEnabled)}
                  >
                    {speedModeEnabled ? "On" : "Off"}
                  </Button>
                </div>
              </div>

              <div className="pt-2">
                <div className="text-sm font-medium text-muted-foreground">Personalization</div>
              </div>
              <PersonalizationPanel />
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">Data</h2>
                <div className="mt-1 h-px bg-border" />
              </div>

              <div className="space-y-6">
                <div className="rounded-lg border border-border bg-muted/30 p-6">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">Delete all chats</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Permanently delete all your chat conversations. This action cannot be undone.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => setDeleteAllChatsConfirmOpen(true)}
                      disabled={deleteAllChatsProcessing}
                      className="w-full sm:w-auto"
                    >
                      {deleteAllChatsProcessing ? 'Deleting...' : 'Delete all'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'account' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">Account & Plan</h2>
                <div className="mt-1 h-px bg-border" />
              </div>

              {/* Plan Information Card */}
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-foreground capitalize">
                        {plan} Plan
                      </h3>
                    </div>
                    {planDetails?.renewalDate && plan !== 'free' && (
                      <p className="text-sm text-muted-foreground">
                        {planDetails.cancelAtPeriodEnd && planDetails.cancelAt ? (
                          <>Your plan will be canceled on {new Date(planDetails.cancelAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</>
                        ) : (
                          <>Your plan auto-renews on {new Date(planDetails.renewalDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</>
                        )}
                      </p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1">
                        Manage
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleChangePlan}>
                        Change plan
                      </DropdownMenuItem>
                      {plan !== 'free' && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => setCancelConfirmOpen(true)}
                            className="text-red-600 dark:text-red-400"
                          >
                            Cancel subscription
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* API Usage Card */}
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-muted-foreground">API Usage (This Month)</h3>
                  
                  {/* Monthly Usage Progress */}
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-bold text-foreground">
                        ${monthlySpending !== null ? monthlySpending.toFixed(4) : '0.0000'}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        of ${usageStatus?.limit.toFixed(2) || '0.00'}
                      </span>
                    </div>
                    
                    {/* Progress Bar */}
                    {usageStatus && (
                      <div className="space-y-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full transition-all ${
                              usageStatus.exceeded
                                ? 'bg-red-500'
                                : usageStatus.warning
                                ? 'bg-yellow-500'
                                : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(usageStatus.percentage, 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className={
                            usageStatus.exceeded
                              ? 'text-red-600 dark:text-red-400 font-medium'
                              : usageStatus.warning
                              ? 'text-yellow-600 dark:text-yellow-400 font-medium'
                              : 'text-muted-foreground'
                          }>
                            {usageStatus.percentage.toFixed(1)}% used
                          </span>
                          <span className="text-muted-foreground">
                            ${usageStatus.remaining.toFixed(4)} remaining
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* All-time total */}
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>All-time total:</span>
                      <span className="font-medium">${totalSpending !== null ? totalSpending.toFixed(4) : '0.0000'}</span>
                    </div>
                  </div>

                  {/* Warning messages */}
                  {usageStatus?.exceeded && (
                    <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3">
                      <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                        ⚠️ You&rsquo;ve exceeded your monthly limit. Upgrade your plan to continue using the service.
                      </p>
                    </div>
                  )}
                  {(usageStatus?.percentage ?? 0) >= 95 && !usageStatus?.exceeded && (
                    <div className="rounded-md bg-orange-500/10 border border-orange-500/20 p-3">
                      <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                        ⚡ Cost-saving mode: Only GPT 5 Nano is available (95%+ usage)
                      </p>
                    </div>
                  )}
                  {(usageStatus?.percentage ?? 0) >= 90 && (usageStatus?.percentage ?? 0) < 95 && (
                    <div className="rounded-md bg-orange-500/10 border border-orange-500/20 p-3">
                      <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                        ⚡ Cost-saving mode: GPT 5.2 disabled, Mini and Nano available (90%+ usage)
                      </p>
                    </div>
                  )}
                  {(usageStatus?.percentage ?? 0) >= 80 && (usageStatus?.percentage ?? 0) < 90 && (
                    <div className="rounded-md bg-blue-500/10 border border-blue-500/20 p-3">
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                        ⚡ Flex mode enabled: Responses may be slower to reduce costs (80%+ usage)
                      </p>
                    </div>
                  )}
                  {usageStatus?.warning && (usageStatus?.percentage ?? 0) < 80 && (
                    <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-3">
                      <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                        ⚠️ You&rsquo;re approaching your monthly limit. Consider upgrading your plan.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {tokenAuth ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-muted-foreground">Authentication token</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyToken}
                        disabled={!tokenKey || tokenLoading}
                        className="h-8 w-8 p-0"
                        aria-label="Copy token"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTokenVisible((prev) => !prev)}
                        disabled={!tokenKey || tokenLoading}
                        className="h-8 w-8 p-0"
                        aria-label={tokenVisible ? "Hide token" : "Show token"}
                      >
                        {tokenVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm">
                    {tokenLoading
                      ? "Loading token..."
                      : tokenKey
                      ? tokenVisible
                        ? tokenKey
                        : "•".repeat(Math.max(12, tokenKey.length))
                      : "Token not available"}
                  </div>
                  {copyStatus === "copied" && (
                    <p className="text-xs text-muted-foreground">Token copied to clipboard.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm text-muted-foreground">Email</Label>
                    <p className="text-base text-foreground mt-1">{email || 'Not available'}</p>
                  </div>
                  {fullName && (
                    <div>
                      <Label className="text-sm text-muted-foreground">Name</Label>
                      <p className="text-base text-foreground mt-1">{fullName}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          </div>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {cancelConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 pointer-events-auto">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl pointer-events-auto">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Cancel subscription?
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Are you sure you want to cancel your subscription? You will keep access until your current period ends{planDetails?.renewalDate ? ` (${new Date(planDetails.renewalDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}).` : '.'}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setCancelConfirmOpen(false)}
                  disabled={cancelProcessing}
                >
                  Keep subscription
                </Button>
                <Button
                  variant="destructive"
                  className="hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
                  onClick={handleCancelSubscription}
                  disabled={cancelProcessing}
                >
                  {cancelProcessing ? "Canceling..." : "Cancel subscription"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Result Dialog */}
      {cancelResultDialog.open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 pointer-events-auto">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl pointer-events-auto">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {cancelResultDialog.success ? "Subscription Canceled" : "Error"}
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  {cancelResultDialog.message}
                </p>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  onClick={() => setCancelResultDialog({ open: false, message: "", success: false })}
                >
                  OK
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Chats Confirmation Dialog */}
      {deleteAllChatsConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 pointer-events-auto">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl pointer-events-auto">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Delete all chats?
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Are you sure you want to delete all your chat conversations? This action cannot be undone.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setDeleteAllChatsConfirmOpen(false)}
                  disabled={deleteAllChatsProcessing}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
                  onClick={handleDeleteAllChats}
                  disabled={deleteAllChatsProcessing}
                >
                  {deleteAllChatsProcessing ? "Deleting..." : "Delete all"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
