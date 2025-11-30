'use client'

import { useState } from 'react'
import { X, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (name: string, category: string) => void
}

const categories = [
  { id: 'investing', name: 'Investing', emoji: '💰', color: 'bg-green-500/10 text-green-500 border-green-500/20' },
  { id: 'homework', name: 'Homework', emoji: '🎓', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  { id: 'writing', name: 'Writing', emoji: '✍️', color: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
  { id: 'health', name: 'Health', emoji: '❤️', color: 'bg-red-500/10 text-red-500 border-red-500/20' },
  { id: 'travel', name: 'Travel', emoji: '🎯', color: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
]

export function CreateProjectModal({ isOpen, onClose, onCreate }: CreateProjectModalProps) {
  const [projectName, setProjectName] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')

  if (!isOpen) return null

  const handleCreate = () => {
    if (projectName.trim()) {
      onCreate(projectName, selectedCategory)
      setProjectName('')
      setSelectedCategory('')
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-popover p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Project name</h2>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
            <span className="text-xl">😊</span>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Copenhagen Trip"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  selectedCategory === category.id
                    ? category.color
                    : 'border-border bg-background text-muted-foreground hover:bg-accent'
                }`}
              >
                <span>{category.emoji}</span>
                {category.name}
              </button>
            ))}
          </div>

          <div className="rounded-lg bg-muted/50 p-4">
            <div className="flex items-start gap-3">
              <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-muted-foreground">
                Projects keep chats, files, and custom instructions in one place. Use them for ongoing work, or just to keep things tidy.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleCreate}
            disabled={!projectName.trim()}
            className="accent-new-project-button disabled:opacity-50"
          >
            Create project
          </Button>
        </div>
      </div>
    </div>
  )
}
