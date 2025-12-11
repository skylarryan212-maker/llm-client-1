'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronUp, Crown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SettingsModal } from '@/components/settings-modal'

interface UserProfileMenuProps {
  isCompressed?: boolean
  onSettingsOpen?: () => void
}

export function UserProfileMenu({ isCompressed, onSettingsOpen }: UserProfileMenuProps) {
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
                  JD
                </div>
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="w-full justify-between p-3 h-auto hover:bg-sidebar-accent"
              >
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-xs font-semibold text-white">
                    JD
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-sidebar-foreground">Test User </span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Crown className="h-2.5 w-2.5" />
                      Dev
                    </span>
                  </div>
                </div>
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuItem onClick={() => onSettingsOpen?.()}>
              Personalization
            </DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Upgrade Plan</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Sign Out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}
