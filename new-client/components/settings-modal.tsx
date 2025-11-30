'use client'

import { useState, useEffect } from 'react'
import { X, Settings, Bell, User, Grid3x3, Calendar, ShoppingCart, Database, Shield, Users2, UserCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { applyAccentColor } from '@/components/accent-color-provider'
import { updateAccentColorAction } from '@/app/actions/preferences-actions'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type TabType = 'general' | 'personalization' | 'notifications' | 'apps' | 'schedules' | 'orders' | 'data' | 'security' | 'parental' | 'account'

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('personalization')
  const [accentColor, setAccentColor] = useState('white')
  const [customInstructions, setCustomInstructions] = useState('')
  const [nickname, setNickname] = useState('')
  const [occupation, setOccupation] = useState('')
  const [moreAbout, setMoreAbout] = useState('')
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    // Accent color is now loaded from server via AccentColorProvider
    // We just need to sync the local state when modal opens
    if (isOpen) {
      // Get current color from the DOM style element
      const styleEl = document.getElementById('accent-color-override')
      if (styleEl) {
        // Parse the current color from the style content
        // This is a simple way to sync state without prop drilling
        const content = styleEl.textContent || ''
        if (content.includes('oklch(0.985 0 0)')) setAccentColor('white')
        else if (content.includes('oklch(0.65 0.18 145)')) setAccentColor('green')
        else if (content.includes('oklch(0.70 0.22 240)')) setAccentColor('blue')
        else if (content.includes('oklch(0.70 0.24 290)')) setAccentColor('purple')
        else if (content.includes('oklch(0.75 0.26 330)')) setAccentColor('pink')
        else if (content.includes('oklch(0.75 0.22 50)')) setAccentColor('orange')
        else if (content.includes('oklch(0.70 0.26 25)')) setAccentColor('red')
      }
      // Mark as initialized after syncing from DOM
      setIsInitialized(true)
    } else {
      // Reset when modal closes
      setIsInitialized(false)
    }
  }, [isOpen])

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
      <div className="relative flex h-[600px] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl pointer-events-auto">
        {/* Sidebar */}
        <div className="w-56 border-r border-border bg-muted/30 p-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="mb-3 h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>

          <div className="space-y-1">
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
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
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

                

                

                

                
              </div>
            </div>
          )}

          {activeTab === 'personalization' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">Personalization</h2>
                <div className="mt-1 h-px bg-border" />
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-base">Base style and tone</Label>
                    <Select defaultValue="default">
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="friendly">Friendly</SelectItem>
                        <SelectItem value="formal">Formal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Set the style and tone of how ChatGPT responds to you. This doesn't impact ChatGPT's capabilities.
                  </p>
                </div>

                <div className="space-y-3">
                  <Label className="text-base">Custom instructions</Label>
                  <Textarea
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder="Additional behavior, style, and tone preferences"
                    className="min-h-[80px]"
                  />
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">About you</h3>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Nickname</Label>
                      <Input
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="How should I call you?"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Occupation</Label>
                      <Input
                        value={occupation}
                        onChange={(e) => setOccupation(e.target.value)}
                        placeholder="What do you do?"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>More about you</Label>
                      <Textarea
                        value={moreAbout}
                        onChange={(e) => setMoreAbout(e.target.value)}
                        placeholder="Interests, values, or preferences to keep in mind"
                        className="min-h-[100px]"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab !== 'general' && activeTab !== 'personalization' && (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">This section is coming soon...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
