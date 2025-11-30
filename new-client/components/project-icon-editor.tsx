'use client'

import { useState, useRef, useEffect } from 'react'
import { 
  FileText, DollarSign, Briefcase, GraduationCap, Heart, 
  Plane, Code, Palette, Music, Camera, Book, ShoppingCart,
  Wrench, Leaf, Star, Zap, Trophy, Target, Clock, Globe
} from 'lucide-react'

const iconOptions = [
  { id: 'file', Icon: FileText, name: 'File' },
  { id: 'dollar', Icon: DollarSign, name: 'Dollar' },
  { id: 'briefcase', Icon: Briefcase, name: 'Briefcase' },
  { id: 'graduation', Icon: GraduationCap, name: 'Graduation' },
  { id: 'heart', Icon: Heart, name: 'Heart' },
  { id: 'plane', Icon: Plane, name: 'Plane' },
  { id: 'code', Icon: Code, name: 'Code' },
  { id: 'palette', Icon: Palette, name: 'Palette' },
  { id: 'music', Icon: Music, name: 'Music' },
  { id: 'camera', Icon: Camera, name: 'Camera' },
  { id: 'book', Icon: Book, name: 'Book' },
  { id: 'cart', Icon: ShoppingCart, name: 'Cart' },
  { id: 'wrench', Icon: Wrench, name: 'Wrench' },
  { id: 'leaf', Icon: Leaf, name: 'Leaf' },
  { id: 'star', Icon: Star, name: 'Star' },
  { id: 'zap', Icon: Zap, name: 'Zap' },
  { id: 'trophy', Icon: Trophy, name: 'Trophy' },
  { id: 'target', Icon: Target, name: 'Target' },
  { id: 'clock', Icon: Clock, name: 'Clock' },
  { id: 'globe', Icon: Globe, name: 'Globe' },
]

const colorOptions = [
  { id: 'white', name: 'White', value: 'oklch(0.985 0 0)' },
  { id: 'green', name: 'Green', value: 'oklch(0.65 0.18 145)' },
  { id: 'blue', name: 'Blue', value: 'oklch(0.70 0.22 240)' },
  { id: 'purple', name: 'Purple', value: 'oklch(0.70 0.24 290)' },
  { id: 'pink', name: 'Pink', value: 'oklch(0.75 0.26 330)' },
  { id: 'orange', name: 'Orange', value: 'oklch(0.75 0.22 50)' },
  { id: 'red', name: 'Red', value: 'oklch(0.70 0.26 25)' },
]

interface ProjectIconEditorProps {
  icon: string
  color: string
  onSave: (icon: string, color: string) => Promise<void>
  size?: 'sm' | 'md' | 'lg'
}

export function ProjectIconEditor({
  icon,
  color,
  onSave,
  size = 'md',
}: ProjectIconEditorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIcon, setSelectedIcon] = useState(icon)
  const [selectedColor, setSelectedColor] = useState(color)
  const [isSaving, setIsSaving] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const IconComponent = iconOptions.find((opt) => opt.id === selectedIcon)?.Icon || FileText
  const colorValue = colorOptions.find((opt) => opt.id === selectedColor)?.value || colorOptions[0].value

  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-8 w-8 p-0.5',
  }

  const iconSizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-7 w-7',
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        // Reset to original values if not saved
        setSelectedIcon(icon)
        setSelectedColor(color)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, icon, color])

  const handleSave = async () => {
    if (selectedIcon === icon && selectedColor === color) {
      setIsOpen(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave(selectedIcon, selectedColor)
      setIsOpen(false)
    } catch (error) {
      console.error('Failed to save icon:', error)
      // Reset on error
      setSelectedIcon(icon)
      setSelectedColor(color)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex ${sizeClasses[size]} items-center justify-center rounded-lg bg-transparent transition-colors hover:bg-accent`}
        style={{ color: colorValue }}
        title="Edit project icon"
      >
        <IconComponent className={iconSizeClasses[size]} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-2 z-50 w-80 rounded-xl border border-border bg-popover p-4 shadow-xl">
          <div className="space-y-4">
            <div>
              <h3 className="mb-3 text-sm font-medium text-foreground">Color</h3>
              <div className="flex gap-2">
                {colorOptions.map((colorOption) => (
                  <button
                    key={colorOption.id}
                    type="button"
                    onClick={() => setSelectedColor(colorOption.id)}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${
                      selectedColor === colorOption.id
                        ? 'scale-110 border-foreground'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: colorOption.value }}
                    title={colorOption.name}
                  />
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-medium text-foreground">Icon</h3>
              <div className="grid grid-cols-5 gap-2">
                {iconOptions.map(({ id, Icon, name }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedIcon(id)}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-all ${
                      selectedIcon === id
                        ? 'border-foreground bg-accent'
                        : 'border-border hover:bg-accent'
                    }`}
                    title={name}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false)
                  setSelectedIcon(icon)
                  setSelectedColor(color)
                }}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
