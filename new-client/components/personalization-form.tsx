'use client'

import { useState, useEffect } from 'react'
import { Save, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { UserPersonalization } from '@/types/preferences'
import { updatePersonalizationAction } from '@/app/actions/personalization-actions'

interface PersonalizationFormProps {
  initialData: UserPersonalization
}

export function PersonalizationForm({ initialData }: PersonalizationFormProps) {
  const [prefs, setPrefs] = useState<UserPersonalization>(initialData)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  useEffect(() => {
    setPrefs(initialData)
  }, [initialData])

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage(null)

    const updates: any = {
      display_name: prefs.displayName,
      avatar_url: prefs.avatarUrl,
      timezone: prefs.timezone,
      locale: prefs.locale,
      accent_color: prefs.accentColor,
      
      tone: prefs.communication.tone,
      verbosity: prefs.communication.verbosity,
      code_first: prefs.communication.codeFirst,
      emoji_usage: prefs.communication.emojiUsage,
      
      default_model: prefs.models.defaultModel,
      service_tier: prefs.models.serviceTier,
      speed_vs_quality: prefs.models.speedVsQuality,
      web_search_default: prefs.models.webSearchDefault,
      context_default: prefs.models.contextDefault,
      
      auto_expand_sources: prefs.sources.autoExpandSources,
      strict_citations: prefs.sources.strictCitations,
      
      share_location: prefs.privacy.shareLocation,
      retention_days: prefs.privacy.retentionDays,
      allow_cache: prefs.privacy.allowCache,
      allow_vector_index: prefs.privacy.allowVectorIndex,
      
      font_scale: prefs.accessibility.fontScale,
      high_contrast: prefs.accessibility.highContrast,
      reduce_motion: prefs.accessibility.reduceMotion,
      keyboard_focus: prefs.accessibility.keyboardFocus,
      
      integrations: prefs.integrations,
      
      persona_note: prefs.advanced.personaNote,
      safe_mode: prefs.advanced.safeMode,
      experimental_flags: prefs.advanced.experimentalFlags,
    }

    const result = await updatePersonalizationAction(updates)
    
    if (result.success) {
      setSaveMessage('Preferences saved successfully!')
      setIsDirty(false)
      setTimeout(() => setSaveMessage(null), 3000)
    } else {
      setSaveMessage(`Error: ${result.error}`)
    }

    setIsSaving(false)
  }

  const handleReset = () => {
    setPrefs(initialData)
    setIsDirty(false)
    setSaveMessage(null)
  }

  const updateField = (path: string[], value: any) => {
    setIsDirty(true)
    setPrefs(prev => {
      const updated = { ...prev }
      let current: any = updated
      for (let i = 0; i < path.length - 1; i++) {
        current[path[i]] = { ...current[path[i]] }
        current = current[path[i]]
      }
      current[path[path.length - 1]] = value
      return updated
    })
  }

  return (
    <div className="mx-auto max-w-5xl p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Personalization</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customize your AI assistant experience
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saveMessage && (
            <span className={`text-sm ${saveMessage.includes('Error') ? 'text-red-500' : 'text-green-500'}`}>
              {saveMessage}
            </span>
          )}
          {isDirty && (
            <>
              <Button variant="outline" size="sm" onClick={handleReset} disabled={isSaving}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                <Save className="h-4 w-4 mr-1" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Profile Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Profile</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={prefs.displayName || ''}
              onChange={(e) => updateField(['displayName'], e.target.value || null)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Select
              value={prefs.timezone}
              onValueChange={(val) => updateField(['timezone'], val)}
            >
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="Europe/London">London (GMT)</SelectItem>
                <SelectItem value="Europe/Paris">Paris (CET)</SelectItem>
                <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Communication Style Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Communication Style</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tone">Tone</Label>
            <Select
              value={prefs.communication.tone}
              onValueChange={(val) => updateField(['communication', 'tone'], val)}
            >
              <SelectTrigger id="tone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="formal">Formal</SelectItem>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="verbosity">Verbosity</Label>
            <Select
              value={prefs.communication.verbosity}
              onValueChange={(val) => updateField(['communication', 'verbosity'], val)}
            >
              <SelectTrigger id="verbosity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="concise">Concise</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="detailed">Detailed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.communication.codeFirst}
              onChange={(e) => updateField(['communication', 'codeFirst'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Code-first responses</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.communication.emojiUsage}
              onChange={(e) => updateField(['communication', 'emojiUsage'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Use emojis</span>
          </label>
        </div>
      </section>

      {/* Models & Quality Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Models & Quality</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="defaultModel">Default Model</Label>
            <Select
              value={prefs.models.defaultModel}
              onValueChange={(val) => updateField(['models', 'defaultModel'], val)}
            >
              <SelectTrigger id="defaultModel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (Recommended)</SelectItem>
                <SelectItem value="gpt-5.1">GPT 5.1</SelectItem>
                <SelectItem value="gpt-5-mini">GPT 5 Mini</SelectItem>
                <SelectItem value="gpt-5-nano">GPT 5 Nano</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="serviceTier">Service Tier</Label>
            <Select
              value={prefs.models.serviceTier}
              onValueChange={(val) => updateField(['models', 'serviceTier'], val)}
            >
              <SelectTrigger id="serviceTier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="standard">Standard (Faster)</SelectItem>
                <SelectItem value="flex">Flex (Lower Cost)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Flex mode may be slower but reduces costs
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="speedVsQuality">Speed vs Quality</Label>
            <Select
              value={prefs.models.speedVsQuality}
              onValueChange={(val) => updateField(['models', 'speedVsQuality'], val)}
            >
              <SelectTrigger id="speedVsQuality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="speed">Prioritize Speed</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="quality">Prioritize Quality</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="webSearchDefault">Web Search Default</Label>
            <Select
              value={prefs.models.webSearchDefault}
              onValueChange={(val) => updateField(['models', 'webSearchDefault'], val)}
            >
              <SelectTrigger id="webSearchDefault">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never</SelectItem>
                <SelectItem value="optional">Optional (Model Decides)</SelectItem>
                <SelectItem value="required">Always Required</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Context & Sources Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Context & Sources</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="contextDefault">Context Strategy</Label>
            <Select
              value={prefs.models.contextDefault}
              onValueChange={(val) => updateField(['models', 'contextDefault'], val)}
            >
              <SelectTrigger id="contextDefault">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minimal">Minimal (Cache Only)</SelectItem>
                <SelectItem value="recent">Recent (Last 15 Messages)</SelectItem>
                <SelectItem value="full">Full (All Messages)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.sources.autoExpandSources}
              onChange={(e) => updateField(['sources', 'autoExpandSources'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Auto-expand sources</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.sources.strictCitations}
              onChange={(e) => updateField(['sources', 'strictCitations'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Enforce strict citations</span>
          </label>
        </div>
      </section>

      {/* Privacy & Data Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Privacy & Data</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="shareLocation">Location Sharing</Label>
            <Select
              value={prefs.privacy.shareLocation}
              onValueChange={(val) => updateField(['privacy', 'shareLocation'], val)}
            >
              <SelectTrigger id="shareLocation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="city">City Level</SelectItem>
                <SelectItem value="precise">Precise</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="retentionDays">Data Retention (Days)</Label>
            <Input
              id="retentionDays"
              type="number"
              value={prefs.privacy.retentionDays}
              onChange={(e) => updateField(['privacy', 'retentionDays'], parseInt(e.target.value) || 90)}
              min="1"
              max="365"
            />
          </div>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.privacy.allowCache}
              onChange={(e) => updateField(['privacy', 'allowCache'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Allow response caching</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.privacy.allowVectorIndex}
              onChange={(e) => updateField(['privacy', 'allowVectorIndex'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Allow attachment indexing</span>
          </label>
        </div>
      </section>

      {/* Accessibility Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Accessibility</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="fontScale">Font Scale ({prefs.accessibility.fontScale.toFixed(1)}x)</Label>
            <input
              id="fontScale"
              type="range"
              min="0.8"
              max="1.5"
              step="0.1"
              value={prefs.accessibility.fontScale}
              onChange={(e) => updateField(['accessibility', 'fontScale'], parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.accessibility.highContrast}
              onChange={(e) => updateField(['accessibility', 'highContrast'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">High contrast mode</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.accessibility.reduceMotion}
              onChange={(e) => updateField(['accessibility', 'reduceMotion'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Reduce motion</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.accessibility.keyboardFocus}
              onChange={(e) => updateField(['accessibility', 'keyboardFocus'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Enhanced keyboard focus</span>
          </label>
        </div>
      </section>

      {/* Integrations Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Integrations</h2>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.integrations.github}
              onChange={(e) => updateField(['integrations', 'github'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">GitHub</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.integrations.notion}
              onChange={(e) => updateField(['integrations', 'notion'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Notion</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.integrations.google}
              onChange={(e) => updateField(['integrations', 'google'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Google Drive</span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Note: Integration linking will be available soon
        </p>
      </section>

      {/* Advanced Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Advanced</h2>
        <div className="space-y-2">
          <Label htmlFor="personaNote">Custom Persona / Instructions</Label>
          <Textarea
            id="personaNote"
            value={prefs.advanced.personaNote || ''}
            onChange={(e) => updateField(['advanced', 'personaNote'], e.target.value || null)}
            placeholder="Add custom instructions or persona details that will be included in every conversation..."
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            This text will be prepended to system prompts
          </p>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.advanced.safeMode}
              onChange={(e) => updateField(['advanced', 'safeMode'], e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-foreground">Safe mode (disable tools)</span>
          </label>
        </div>
      </section>

      {/* Bottom save bar */}
      {isDirty && (
        <div className="sticky bottom-0 left-0 right-0 flex items-center justify-end gap-2 bg-card/95 backdrop-blur-sm border-t border-border p-4 rounded-t-lg">
          {saveMessage && (
            <span className={`text-sm mr-auto ${saveMessage.includes('Error') ? 'text-red-500' : 'text-green-500'}`}>
              {saveMessage}
            </span>
          )}
          <Button variant="outline" onClick={handleReset} disabled={isSaving}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4 mr-1" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}
    </div>
  )
}
