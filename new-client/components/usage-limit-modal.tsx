'use client'

import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'

interface UsageLimitModalProps {
  isOpen: boolean
  onClose: () => void
  currentSpending: number
  limit: number
  planType: string
}

export function UsageLimitModal({ isOpen, onClose, currentSpending, limit, planType }: UsageLimitModalProps) {
  const router = useRouter()

  if (!isOpen) return null

  const handleUpgrade = () => {
    onClose()
    router.push('/upgrade')
  }

  const planRecommendations = {
    free: { name: 'Plus', price: 12, limit: 12 },
    plus: { name: 'Max', price: 120, limit: 120 },
    max: { name: 'Max', price: 120, limit: 120 },
  } as const

  const recommendation = (planRecommendations as any)[planType] || planRecommendations.free

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-yellow-500/10 p-3">
              <AlertTriangle className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold text-foreground">
                Monthly Usage Limit Reached
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                You&apos;ve used ${currentSpending.toFixed(4)} of your ${limit.toFixed(2)} monthly limit
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-yellow-500"
                style={{ width: '100%' }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Current Plan: <span className="font-medium capitalize">{planType}</span></span>
              <span className="font-medium">100% used</span>
            </div>
          </div>

          {/* Explanation */}
          <div className="rounded-lg bg-muted/50 p-4 border border-border">
            <p className="text-sm text-muted-foreground">
              Your {planType} plan includes ${limit.toFixed(2)} of API usage per month. 
              This resets on the 1st of each month. To continue chatting, please upgrade to a higher tier.
            </p>
          </div>

          {/* Upgrade Recommendation */}
          {recommendation.price && (
            <div className="rounded-lg bg-gradient-to-br from-blue-500/10 to-purple-500/10 p-4 border border-blue-500/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-foreground">
                    Upgrade to {recommendation.name}
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    ${recommendation.limit} monthly API usage
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-foreground">
                    ${recommendation.price}
                  </p>
                  <p className="text-xs text-muted-foreground">per month</p>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Close
            </Button>
            <Button
              onClick={handleUpgrade}
              className="flex-1 gap-2"
            >
              View Plans
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Additional Info */}
          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground text-center">
              Your usage will automatically reset on the 1st of next month
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
