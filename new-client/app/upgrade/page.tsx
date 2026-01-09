"use client";

import { useState, Suspense, type FormEvent } from "react";
import { ArrowLeft, Check, Lock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { unlockPlanWithCode, type PlanType } from "@/app/actions/plan-actions";
import { useUserPlan } from "@/lib/hooks/use-user-plan";

const plans = [
  {
    id: "plus" as PlanType,
    name: "Plus",
    price: 20,
    description: "Everyday plan with generous limits.",
      features: [
        "Core models and Human Writing agent",
        "Adds Market agent",
        "File uploads and image generation with higher allowances",
      ],
    recommended: false,
    gradientFrom: "from-purple-400/5",
    gradientTo: "to-fuchsia-700/5",
  },
  {
    id: "max" as PlanType,
    name: "Max",
    price: 200,
    description: "Priority access, best models, and highest limits.",
    features: [
      "Everything in Plus",
      "Priority processing on all models including GPT-5.2 Pro",
      "Highest allowances across agents and attachments",
      "Early access to new features",
    ],
    recommended: true,
    gradientFrom: "from-amber-400/5",
    gradientTo: "to-orange-700/5",
  },
];

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

type CheckoutState = {
  open: boolean;
  clientSecret: string | null;
  planId: PlanType | null;
  planName: string | null;
};

function StripePaymentForm({
  planName,
  onSuccess,
}: {
  planName: string;
  onSuccess: () => Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      const returnUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/upgrade?stripe=return`
          : "/upgrade?stripe=return";
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (error) {
        setFormError(error.message ?? "Payment failed. Please try again.");
        return;
      }
      const status = paymentIntent?.status;
      if (status === "succeeded" || status === "processing") {
        await onSuccess();
      } else {
        setFormError("Payment was not completed. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
          paymentMethodOrder: ["apple_pay", "google_pay", "link", "card"],
        }}
      />
      {formError && <p className="text-sm text-red-500">{formError}</p>}
      <Button type="submit" className="w-full" disabled={!stripe || !elements || isSubmitting}>
        {isSubmitting ? "Processing..." : `Pay for ${planName}`}
      </Button>
    </form>
  );
}

function UpgradePageContent() {
  const router = useRouter();
  const { plan: currentPlan, refreshPlan } = useUserPlan();
  const [isUnlockDialogOpen, setIsUnlockDialogOpen] = useState(false);
  const [selectedPlanForUnlock, setSelectedPlanForUnlock] = useState<Exclude<PlanType, "free"> | null>(null);
  const [unlockCode, setUnlockCode] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successDialog, setSuccessDialog] = useState<{ open: boolean; message: string; title: string }>({ open: false, message: "", title: "" });
  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    open: false,
    clientSecret: null,
    planId: null,
    planName: null,
  });

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

  const startStripeCheckout = async (planId: PlanType, planName: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/stripe/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const data = (await res.json().catch(() => ({}))) as { clientSecret?: string; error?: string };
      if (!res.ok || !data?.clientSecret) {
        throw new Error(data?.error || "Failed to start checkout");
      }
      setCheckoutState({
        open: true,
        clientSecret: data.clientSecret,
        planId,
        planName,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to start checkout. Please try again.";
      setSuccessDialog({
        open: true,
        title: `Could not start ${planName} checkout`,
        message,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const startHostedCheckout = async (planId: PlanType, planName: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Failed to start hosted checkout");
      }
      window.location.href = data.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to open hosted checkout.";
      setSuccessDialog({
        open: true,
        title: `Could not start ${planName} checkout`,
        message,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const closeCheckout = () => {
    setCheckoutState({ open: false, clientSecret: null, planId: null, planName: null });
  };

  const handleCheckoutSuccess = async () => {
    closeCheckout();
    setSuccessDialog({
      open: true,
      message: "Payment received. Your plan will activate after Stripe confirms the subscription.",
      title: "Payment processing",
    });
    await refreshPlan();
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 w-full">
          {filteredPlans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const canDirectChange = currentPlan !== plan.id;
            return (
              <div
                key={plan.id}
                className="group relative w-full h-full overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${plan.gradientFrom} ${plan.gradientTo} opacity-0 transition-opacity group-hover:opacity-100`} />
                <div className="relative p-6 md:p-8 flex flex-col h-full min-h-[320px]">
                  <div className="mb-4">
                    <h2 className="text-3xl font-bold text-foreground mb-2">{plan.name}</h2>
                    <div className="flex items-baseline gap-1 mb-3">
                      <span className="text-sm text-muted-foreground">$</span>
                      <span className="text-5xl font-bold text-foreground">{plan.price}</span>
                      <span className="text-sm text-muted-foreground">USD / month</span>
                    </div>
                    <p className="text-base text-muted-foreground">{plan.description}</p>
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
                          disabled={!canDirectChange || isProcessing}
                          title={
                            canDirectChange
                              ? `Upgrade to ${plan.name}`
                              : "Direct upgrades are currently disabled. Please use unlock code."
                          }
                          onClick={async () => {
                            if (!canDirectChange) return;
                            await startStripeCheckout(plan.id, plan.name);
                          }}
                        >
                          {canDirectChange
                            ? `Upgrade to ${plan.name}`
                            : `Upgrade to ${plan.name}`}
                        </Button>
                        {!canDirectChange && (
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

      <Dialog
        open={checkoutState.open}
        onClose={closeCheckout}
        contentClassName="w-full max-w-4xl p-6"
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {checkoutState.planName ? `Checkout - ${checkoutState.planName}` : "Checkout"}
              </h3>
              <p className="text-sm text-muted-foreground">
                Complete payment to activate your plan. We’ll update your account once Stripe confirms payment.
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={closeCheckout} aria-label="Close checkout">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {!stripePromise && (
            <p className="text-sm text-red-500">
              Stripe publishable key is missing. Set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
            </p>
          )}

          {stripePromise && !checkoutState.clientSecret && (
            <p className="text-sm text-muted-foreground">Preparing secure payment form...</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-4 items-start">
            <div className="space-y-4">
              {stripePromise && checkoutState.clientSecret && checkoutState.planName && (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret: checkoutState.clientSecret,
                    appearance: {
                      theme: "night",
                      variables: {
                        colorBackground: "#0b0b0f",
                        colorText: "#e5e7eb",
                        colorPrimary: "#8b5cf6",
                        colorTextSecondary: "#9ca3af",
                        colorDanger: "#f87171",
                        borderRadius: "12px",
                        spacingUnit: "6px",
                      },
                    },
                  }}
                >
                  <StripePaymentForm planName={checkoutState.planName} onSuccess={handleCheckoutSuccess} />
                </Elements>
              )}
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Prefer a simpler flow? You can also</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={isProcessing}
                  onClick={() => checkoutState.planId && startHostedCheckout(checkoutState.planId, checkoutState.planName || "Plan")}
                >
                  Open Stripe hosted checkout
                </Button>
              </div>
            </div>

            {checkoutState.planId && checkoutState.planName && (
              <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-lg">
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-lg font-semibold">{checkoutState.planName}</p>
                      <p className="text-sm text-muted-foreground">Monthly subscription</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold">
                        ${plans.find((p) => p.id === checkoutState.planId)?.price ?? "--"}
                      </p>
                      <p className="text-xs text-muted-foreground">USD / month</p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2 text-sm text-foreground/90">
                    {(plans.find((p) => p.id === checkoutState.planId)?.features || []).slice(0, 4).map((feat, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <div className="h-2 w-2 rounded-full bg-primary/70 mt-1.5" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>

                  <div className="my-4 h-px bg-border" />
                  <div className="text-sm text-foreground/90 space-y-2">
                    <div className="flex justify-between">
                      <span>Monthly subscription</span>
                      <span>
                        $
                        {(plans.find((p) => p.id === checkoutState.planId)?.price ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Estimated tax</span>
                      <span>$0.00</span>
                    </div>
                    <div className="flex justify-between font-semibold text-foreground pt-2">
                      <span>Due today</span>
                      <span>
                        $
                        {(plans.find((p) => p.id === checkoutState.planId)?.price ?? 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Dialog>

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
