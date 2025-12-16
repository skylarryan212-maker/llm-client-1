'use client'

import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react'
import { X, Settings, Bell, User, Grid3x3, Calendar, ShoppingCart, Database, Shield, Users2, UserCircle, ChevronDown } from 'lucide-react'
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
import { useUserPlan } from '@/lib/hooks/use-user-plan'
import { useUserIdentity } from '@/components/user-identity-provider'
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

type TabType = 'general' | 'personalization' | 'notifications' | 'apps' | 'schedules' | 'orders' | 'data' | 'security' | 'parental' | 'account'

export function SettingsModal({ isOpen, onClose, initialTab = 'personalization' }: SettingsModalProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>(initialTab)
  const [accentColor, setAccentColor] = useState('white')
  const { plan, refreshPlan } = useUserPlan()
  const [contextModeGlobal, setContextModeGlobal] = useState<"advanced" | "simple">("advanced")
  const { fullName, email } = useUserIdentity()
  const { refreshChats } = useChatStore()

  const [planDetails, setPlanDetails] = useState<{
    planType: string
    renewalDate: string | null
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
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancelProcessing, setCancelProcessing] = useState(false)
  const [cancelResultDialog, setCancelResultDialog] = useState<{ open: boolean; message: string; success: boolean }>({ open: false, message: "", success: false })
  const [deleteAllChatsConfirmOpen, setDeleteAllChatsConfirmOpen] = useState(false)
  const [deleteAllChatsProcessing, setDeleteAllChatsProcessing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement | null>(null)
  const [panelHeightPx, setPanelHeightPx] = useState<number | null>(null)

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
      setActiveTab(initialTab)
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
    }
  }, [isOpen, initialTab])

  const recomputePanelHeight = useCallback(() => {
    if (typeof window === 'undefined') return
    const sidebarEl = sidebarRef.current
    if (!sidebarEl) return

    const desktop = window.matchMedia('(min-width: 640px)').matches
    if (!desktop) {
      setPanelHeightPx(null)
      return
    }

    const sidebarHeight = Math.ceil(sidebarEl.scrollHeight)
    const maxHeight = Math.floor(window.innerHeight * 0.82)
    setPanelHeightPx(Math.min(sidebarHeight, maxHeight))
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return
    recomputePanelHeight()
    window.addEventListener('resize', recomputePanelHeight)
    return () => window.removeEventListener('resize', recomputePanelHeight)
  }, [isOpen, recomputePanelHeight])

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

  if (!isOpen) return null

  const tabs = [
    { id: 'general' as TabType, label: 'General', icon: Settings },
    { id: 'notifications' as TabType, label: 'Notifications', icon: Bell },
    { id: 'personalization' as TabType, label: 'Personalization', icon: User },
    { id: 'apps' as TabType, label: 'Apps & Connectors', icon: Grid3x3 },
    { id: 'schedules' as TabType, label: 'Schedules', icon: Calendar },
    { id: 'orders' as TabType, label: 'Orders', icon: ShoppingCart },
    { id: 'data' as TabType, label: 'Data controls', icon: Database },
    { id: 'security' as TabType, label: 'Security', icon: Shield },
    { id: 'parental' as TabType, label: 'Parental controls', icon: Users2 },
    { id: 'account' as TabType, label: 'Account', icon: UserCircle },
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
        className="modal-panel relative flex flex-col sm:flex-row h-[82vh] sm:h-auto max-h-[82vh] w-full max-w-[min(520px,95vw)] sm:max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl pointer-events-auto"
        style={panelHeightPx ? { height: `${panelHeightPx}px` } : undefined}
      >
        {/* Sidebar */}
        <div ref={sidebarRef} className="w-full sm:w-56 border-b sm:border-b-0 sm:border-r border-border bg-muted/30 px-3 pt-3 pb-3">
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
        <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8">
          {activeTab === 'general' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">General</h2>
                <div className="mt-1 h-px bg-border" />
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <Label className="text-base">Appearance</Label>
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
                  <Label className="text-base">Context mode (global default)</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 text-sm"
                    onClick={() => {
                      const next = contextModeGlobal === "simple" ? "advanced" : "simple"
                      setContextModeGlobal(next)
                      try {
                        window.localStorage.setItem("context-mode-global", next)
                        window.dispatchEvent(
                          new CustomEvent("contextModeGlobalChange", { detail: next })
                        )
                      } catch {}
                    }}
                  >
                    {contextModeGlobal === "simple" ? "Simple" : "Advanced"}
                  </Button>
                </div>

                

                

                

                
              </div>
            </div>
          )}

          {activeTab === 'personalization' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">Personalization</h2>
                <div className="mt-1 h-px bg-border" />
              </div>
              <PersonalizationPanel />
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">Data controls</h2>
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
                <h2 className="text-2xl font-semibold text-foreground">Account</h2>
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
                        Your plan auto-renews on {new Date(planDetails.renewalDate).toLocaleDateString('en-US', { 
                          month: 'long', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
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

              {/* User Information */}
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
            </div>
          )}

          {activeTab !== 'general' && activeTab !== 'personalization' && activeTab !== 'data' && activeTab !== 'account' && (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">This section is coming soon...</p>
            </div>
          )}
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
                  Are you sure you want to cancel your subscription? You will be downgraded to the Free plan immediately.
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
