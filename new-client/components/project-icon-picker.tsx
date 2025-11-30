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

interface ProjectIconPickerProps {
  selectedIcon: string
  selectedColor: string
  onIconChange: (icon: string) => void
  onColorChange: (color: string) => void
}

export function ProjectIconPicker({
  selectedIcon,
  selectedColor,
  onIconChange,
  onColorChange,
}: ProjectIconPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const SelectedIconComponent = iconOptions.find((opt) => opt.id === selectedIcon)?.Icon || FileText
  const selectedColorValue = colorOptions.find((opt) => opt.id === selectedColor)?.value || colorOptions[0].value

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background transition-colors hover:bg-accent"
        style={{ color: selectedColorValue }}
      >
        <SelectedIconComponent className="h-5 w-5" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-12 z-50 w-80 rounded-xl border border-border bg-popover p-4 shadow-xl">
          <div className="space-y-4">
            <div>
              <h3 className="mb-3 text-sm font-medium text-foreground">Color</h3>
              <div className="flex gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => onColorChange(color.id)}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${
                      selectedColor === color.id
                        ? 'scale-110 border-foreground'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
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
                    onClick={() => {
                      onIconChange(id)
                      setIsOpen(false)
                    }}
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
          </div>
        </div>
      )}
    </div>
  )
}

export function getProjectIcon(iconId: string) {
  const iconOption = iconOptions.find((opt) => opt.id === iconId)
  return iconOption?.Icon || FileText
}

export function getProjectColor(colorId: string) {
  const colorOption = colorOptions.find((opt) => opt.id === colorId)
  return colorOption?.value || colorOptions[0].value
}
