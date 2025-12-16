"use client";

import { useState, useEffect, Suspense } from "react";
import { ArrowLeft, Check, Lock, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unlockPlanWithCode, upgradeToPlan, type PlanType } from "@/app/actions/plan-actions";
import { useUserPlan } from "@/lib/hooks/use-user-plan";

const plans = [
  {
    id: "basic" as PlanType,
    name: "Basic",
    price: 10,
    description: "Essential access with light usage limits.",
    features: ["API limit: $5 usage per month"],
    recommended: false,
    gradientFrom: "from-blue-400/5",
    gradientTo: "to-indigo-700/5",
  },
  {
    id: "plus" as PlanType,
    name: "Plus",
    price: 20,
    description: "Higher limits for growing workloads.",
    features: ["API limit: $15 usage per month"],
    recommended: false,
    gradientFrom: "from-purple-400/5",
    gradientTo: "to-fuchsia-700/5",
  },
  {
    id: "pro" as PlanType,
    name: "Pro",
    price: 50,
    description: "Advanced tier with expanded headroom.",
    features: ["API limit: $30 usage per month"],
    recommended: true,
    gradientFrom: "from-green-400/5",
    gradientTo: "to-teal-700/5",
  },
  {
    id: "dev" as PlanType,
    name: "Dev",
    price: 200,
    description: "Maximum limits for demanding teams.",
    features: ["API limit: $150 usage per month"],
    recommended: false,
    gradientFrom: "from-amber-400/5",
    gradientTo: "to-orange-700/5",
  },
];

function UpgradePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { plan: currentPlan, refreshPlan } = useUserPlan();
  const [isUnlockDialogOpen, setIsUnlockDialogOpen] = useState(false);
  const [selectedPlanForUnlock, setSelectedPlanForUnlock] = useState<Exclude<PlanType, "free"> | null>(null);
  const [unlockCode, setUnlockCode] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [successDialog, setSuccessDialog] = useState<{ open: boolean; message: string; title: string }>({ open: false, message: "", title: "" });

  useEffect(() => {
    // Check if we should show all plans from URL parameter
    const showAll = searchParams.get("showAll") === "true";
    setShowAllPlans(showAll);
  }, [searchParams]);

  const handleOpenUnlockDialog = (planId: Exclude<PlanType, "free">) => {
    setSelectedPlanForUnlock(planId);
    setIsUnlockDialogOpen(true);
    setUnlockCode("");
    setErrorMessage("");
  };

  const handleUnlockWithCode = async () => {
    if (!selectedPlanForUnlock) return;
    setIsProcessing(true);
    const result = await unlockPlanWithCode(selectedPlanForUnlock, unlockCode.trim());
    if (result.success) {
      await refreshPlan();
      setIsUnlockDialogOpen(false);
      setUnlockCode("");
      setErrorMessage("");
      const planName = plans.find(p => p.id === selectedPlanForUnlock)?.name || selectedPlanForUnlock;
      setSuccessDialog({ 
        open: true, 
        message: result.message,
        title: `Unlocked ${planName} Plan`
      });
    } else {
      setErrorMessage(result.message);
    }
    setIsProcessing(false);
  };

  // Determine if we should show all plans (from settings modal)
  const shouldShowAllPlans = showAllPlans;

  // Helper to determine plan hierarchy
  const planHierarchy: Record<string, number> = {
    basic: 1,
    plus: 2,
    pro: 3,
    dev: 4,
  };

  const isLowerTier = (planId: string) => {
    const targetRank = planHierarchy[planId] ?? -1;
    const currentRank = planHierarchy[currentPlan] ?? 0;
    return targetRank < currentRank;
  };

  const filteredPlans = plans.filter(() => true);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="flex-1">
          <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Go back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">Upgrade</h1>
              <p className="text-sm text-muted-foreground">Choose the plan that fits you best.</p>
            </div>
          </div>

          <div className="max-w-6xl mx-auto flex justify-center px-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 auto-rows-fr gap-4 sm:gap-6 w-full place-items-stretch justify-items-center place-content-center justify-center">
          {filteredPlans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            return (
              <div
                key={plan.id}
                className="group relative w-full max-w-[280px] h-full overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
              >
                {plan.recommended && (
                  <div className="absolute top-4 right-4 rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary">
                    RECOMMENDED
                  </div>
                )}
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${plan.gradientFrom} ${plan.gradientTo} opacity-0 transition-opacity group-hover:opacity-100`} />
                <div className="relative p-5 flex flex-col h-full min-h-[260px]">
                  <div className="mb-4">
                    <h2 className="text-2xl font-bold text-foreground mb-1">{plan.name}</h2>
                    <div className="flex items-baseline gap-1 mb-2">
                      <span className="text-sm text-muted-foreground">$</span>
                      <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                      <span className="text-sm text-muted-foreground">USD / month</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  </div>

                  <div className="space-y-2 flex-1">
                    {plan.features.map((feature, index) => (
                      <div key={index} className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary" />
                          </div>
                        </div>
                        <span className="text-sm text-foreground leading-relaxed">{feature}</span>
                      </div>
                    ))}
                  </div>

                    <div className="mt-4 space-y-2">
                    {isCurrent ? (
                      <Button variant="outline" className="w-full" disabled>
                        Your current plan
                      </Button>
                    ) : (
                      <>
                        <Button
                          className="w-full"
                          variant="outline"
                          disabled={!isLowerTier(plan.id) || isProcessing}
                          title={
                            isLowerTier(plan.id)
                              ? `Switch to ${plan.name}`
                              : "Direct upgrades are currently disabled. Please use unlock code."
                          }
                          onClick={async () => {
                            if (!isLowerTier(plan.id)) return;
                            setIsProcessing(true);
                            const result = await upgradeToPlan(plan.id, currentPlan);
                            await refreshPlan();
                            setIsProcessing(false);
                            setSuccessDialog({
                              open: true,
                              message: result.message,
                              title: `Switched to ${plan.name}`,
                            });
                          }}
                        >
                          {isLowerTier(plan.id)
                            ? `Switch to ${plan.name}`
                            : `Upgrade to ${plan.name}`}
                        </Button>
                        {!isLowerTier(plan.id) && (
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => handleOpenUnlockDialog(plan.id as Exclude<PlanType, "free">)}
                            disabled={isProcessing}
                          >
                            <Lock className="h-4 w-4 mr-2" />
                            Unlock with code
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-8 mt-16 text-center space-y-1">
        <p className="text-xs text-muted-foreground">Need more capabilities?</p>
        <button className="text-xs text-primary hover:underline">
          Click here
        </button>
      </div>

      {/* Success Dialog */}
      {successDialog.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {successDialog.title}
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  {successDialog.message}
                </p>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  onClick={() => setSuccessDialog({ open: false, message: "", title: "" })}
                >
                  OK
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unlock Dialog */}
      {isUnlockDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-foreground">
                  Unlock {selectedPlanForUnlock ? selectedPlanForUnlock.charAt(0).toUpperCase() + selectedPlanForUnlock.slice(1) : ""} Plan
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your unlock code to activate the {selectedPlanForUnlock} plan
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setIsUnlockDialogOpen(false);
                  setUnlockCode("");
                  setErrorMessage("");
                }}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3 mt-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Unlock Code</label>
                <Input
                  type="text"
                  placeholder="Enter your code"
                  value={unlockCode}
                  onChange={(e) => {
                    setUnlockCode(e.target.value);
                    setErrorMessage("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleUnlockWithCode();
                    }
                  }}
                  disabled={isProcessing}
                />
                {errorMessage && <p className="text-sm text-red-500 mt-2">{errorMessage}</p>}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsUnlockDialogOpen(false);
                  setUnlockCode("");
                  setErrorMessage("");
                }}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleUnlockWithCode} disabled={!unlockCode.trim() || isProcessing}>
                {isProcessing ? "Unlocking..." : "Unlock"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UpgradePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    }>
      <UpgradePageContent />
    </Suspense>
  );
}
