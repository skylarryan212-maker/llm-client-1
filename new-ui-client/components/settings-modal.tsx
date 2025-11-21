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

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type TabType = 'general' | 'personalization' | 'notifications' | 'apps' | 'schedules' | 'orders' | 'data' | 'security' | 'parental' | 'account'

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('personalization')
  const [accentColor, setAccentColor] = useState('green')
  const [customInstructions, setCustomInstructions] = useState('')
  const [nickname, setNickname] = useState('')
  const [occupation, setOccupation] = useState('')
  const [moreAbout, setMoreAbout] = useState('')

  useEffect(() => {
    if (accentColor) {
      const colorMap: Record<string, string> = {
        green: '142 76% 36%',
        blue: '217 91% 60%',
        purple: '271 81% 56%',
        pink: '330 81% 60%',
        orange: '25 95% 53%',
        red: '0 84% 60%',
      }
      
      const hslValue = colorMap[accentColor] || colorMap.green
      
      document.documentElement.style.setProperty('--primary', hslValue)
      document.documentElement.style.setProperty('--sidebar-primary', hslValue)
      
      document.documentElement.offsetHeight
    }
  }, [accentColor])

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
                        onClick={() => setAccentColor(color.value)}
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
