'use client'

import { useRouter } from 'next/navigation'
import { CreateProjectModal } from '@/components/create-project-modal'

export default function NewProjectPage() {
  const router = useRouter()

  const handleCreate = (name: string, category: string) => {
    // In a real app, this would create the project in a database
    const newProjectId = Date.now().toString()
    router.push(`/project/${newProjectId}`)
  }

  const handleClose = () => {
    router.back()
  }

  return (
    <CreateProjectModal
      isOpen={true}
      onClose={handleClose}
      onCreate={handleCreate}
    />
  )
}
