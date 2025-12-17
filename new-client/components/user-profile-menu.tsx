'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ChevronUp, Crown, LogIn, Sparkles, Zap, Code2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import supabaseClient from '@/lib/supabase/browser-client'
import { useUserIdentity } from '@/components/user-identity-provider'
import { useUserPlan } from '@/lib/hooks/use-user-plan'

interface UserProfileMenuProps {
  isCompressed?: boolean
  onSettingsOpen?: () => void
  onGeneralSettingsOpen?: () => void
}

function initialsFromName(name?: string | null, fallback?: string | null) {
  const source = name || fallback || '';
  const parts = source.trim().split(/\s+/);
  if (parts.length === 0) return 'G';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function UserProfileMenu({ isCompressed, onSettingsOpen, onGeneralSettingsOpen }: UserProfileMenuProps) {
  const router = useRouter()
  const { fullName, email, isGuest } = useUserIdentity()
  const { plan } = useUserPlan()
  const displayName = isGuest ? 'Guest' : fullName || email || 'User'
  const initials = initialsFromName(fullName, email)

  const getPlanIcon = () => {
    switch (plan) {
      case 'dev':
        return <Crown className="h-2.5 w-2.5" suppressHydrationWarning />
      case 'pro':
        return <Code2 className="h-2.5 w-2.5" suppressHydrationWarning />
      case 'plus':
        return <Zap className="h-2.5 w-2.5" suppressHydrationWarning />
      default:
        return <Sparkles className="h-2.5 w-2.5" suppressHydrationWarning />
    }
  }

  const getPlanLabel = () => {
    if (isGuest) return 'Guest'
    return plan.charAt(0).toUpperCase() + plan.slice(1)
  }

  const handleUpgradePlan = () => {
    router.push('/upgrade')
  }

  const handleSignOut = async () => {
    if (isGuest) {
      window.location.href = '/login'
      return
    }
    await supabaseClient.auth.signOut()
    // Hard reload to flush any cached client state and render guest mode cleanly.
    window.location.href = '/'
  }

  return (
    <>
      <div className="border-t border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {isCompressed ? (
              <Button
                variant="ghost"
                className="w-full p-3 h-auto hover:bg-sidebar-accent flex justify-center"
              >
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-xs font-semibold text-white">
                  {initials}
                </div>
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="w-full justify-between p-3 h-auto hover:bg-sidebar-accent"
              >
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-xs font-semibold text-white">
                    {initials}
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-sidebar-foreground">{displayName}</span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1" suppressHydrationWarning>
                      {getPlanIcon()}
                      {getPlanLabel()}
                    </span>
                  </div>
                </div>
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            {!isGuest && (
              <>
                <DropdownMenuItem onClick={() => onSettingsOpen?.()}>
                  Personalization
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onGeneralSettingsOpen?.()}>Settings</DropdownMenuItem>
                <DropdownMenuItem onClick={handleUpgradePlan}>Upgrade Plan</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleSignOut}>
              {isGuest ? (
                <>
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </>
              ) : (
                'Sign Out'
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}
