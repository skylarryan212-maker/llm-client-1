'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ModelFamily, SpeedMode } from '@/lib/modelConfig'

interface ModelSelectorProps {
  modelFamily: ModelFamily
  speedMode: SpeedMode
  onModelFamilyChange: (value: ModelFamily) => void
  onSpeedModeChange: (value: SpeedMode) => void
}

const MODEL_FAMILY_OPTIONS: { value: ModelFamily; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'gpt-5.2', label: 'GPT 5.2' },
  { value: 'gpt-5.2-pro', label: 'GPT 5.2 Pro' },
  { value: 'gpt-5-mini', label: 'GPT 5 Mini' },
  { value: 'gpt-5-nano', label: 'GPT 5 Nano' },
]

const SPEED_MODE_OPTIONS: { value: SpeedMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'instant', label: 'Instant' },
  { value: 'thinking', label: 'Thinking' },
]

export function ModelSelector({
  modelFamily,
  speedMode,
  onModelFamilyChange,
  onSpeedModeChange,
}: ModelSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <Select value={modelFamily} onValueChange={(val) => onModelFamilyChange(val as ModelFamily)}>
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          {MODEL_FAMILY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={speedMode} onValueChange={(val) => onSpeedModeChange(val as SpeedMode)}>
        <SelectTrigger className="w-28 h-8 text-xs">
          <SelectValue placeholder="Speed" />
        </SelectTrigger>
        <SelectContent>
          {SPEED_MODE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
