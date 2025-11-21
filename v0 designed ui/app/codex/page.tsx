'use client'

import { CodexComposerLarge } from '@/components/codex-composer-large'
import { CodexTaskItem } from '@/components/codex-task-item'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'

interface CodexTask {
  id: string
  title: string
  date: string
  preview: string
}

export default function CodexPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'tasks' | 'reviews' | 'archive'>('tasks')
  const [tasks, setTasks] = useState<CodexTask[]>([])

  useEffect(() => {
    const stored = localStorage.getItem('codex-tasks')
    if (stored) {
      setTasks(JSON.parse(stored))
    }
  }, [])

  const handleSubmit = (message: string) => {
    const newChatId = Date.now().toString()
    const newTask: CodexTask = {
      id: newChatId,
      title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      preview: message,
    }

    const updatedTasks = [newTask, ...tasks]
    setTasks(updatedTasks)
    localStorage.setItem('codex-tasks', JSON.stringify(updatedTasks))

    router.push(`/codex/chat/${newChatId}?prompt=${encodeURIComponent(message)}`)
  }

  return (
    <div className="min-h-screen dark">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Agents
          </Link>
        </div>

        <div className="mb-12 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Codex</h1>
              <p className="text-sm text-muted-foreground">AI-powered coding workspace</p>
            </div>
          </div>
        </div>

        <div className="mb-16">
          <CodexComposerLarge onSubmit={handleSubmit} />
        </div>

        <div className="flex flex-col items-center gap-12">
          <div className="flex gap-4 flex-wrap justify-center">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`px-8 py-3 rounded-lg font-semibold text-lg transition-all ${
                activeTab === 'tasks'
                  ? 'bg-primary text-primary-foreground shadow-lg'
                  : 'bg-muted/30 text-foreground hover:bg-muted/50'
              }`}
            >
              Tasks
            </button>
            <button
              onClick={() => setActiveTab('reviews')}
              className={`px-8 py-3 rounded-lg font-semibold text-lg transition-all ${
                activeTab === 'reviews'
                  ? 'bg-primary text-primary-foreground shadow-lg'
                  : 'bg-muted/30 text-foreground hover:bg-muted/50'
              }`}
            >
              Code Reviews
            </button>
            <button
              onClick={() => setActiveTab('archive')}
              className={`px-8 py-3 rounded-lg font-semibold text-lg transition-all ${
                activeTab === 'archive'
                  ? 'bg-primary text-primary-foreground shadow-lg'
                  : 'bg-muted/30 text-foreground hover:bg-muted/50'
              }`}
            >
              Archive
            </button>
          </div>

          <div className="w-full max-w-2xl">
            {activeTab === 'tasks' && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Recent Coding Tasks</h2>
                {tasks.length > 0 ? (
                  tasks.map((task) => (
                    <CodexTaskItem key={task.id} {...task} />
                  ))
                ) : (
                  <p className="text-center text-muted-foreground py-8">No tasks yet. Create one with the composer above.</p>
                )}
              </div>
            )}

            {activeTab === 'reviews' && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="text-center space-y-3">
                  <div className="text-4xl font-bold text-muted-foreground/40">🔜</div>
                  <h3 className="text-xl font-semibold text-foreground">Coming Soon</h3>
                  <p className="text-muted-foreground">Code Reviews feature is under development</p>
                </div>
              </div>
            )}

            {activeTab === 'archive' && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="text-center space-y-3">
                  <div className="text-4xl font-bold text-muted-foreground/40">🔜</div>
                  <h3 className="text-xl font-semibold text-foreground">Coming Soon</h3>
                  <p className="text-muted-foreground">Archive feature is under development</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
