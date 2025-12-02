import { getPersonalizationAction } from '@/app/actions/personalization-actions'
import { PersonalizationForm } from '@/components/personalization-form'
import { redirect } from 'next/navigation'

export default async function PersonalizationPage() {
  const result = await getPersonalizationAction()

  if (!result.success || !result.data) {
    // If user not authenticated or error, redirect to login
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <PersonalizationForm initialData={result.data} />
    </div>
  );
}
