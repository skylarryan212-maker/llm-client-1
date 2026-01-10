"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense, type FormEvent } from "react";
import { ArrowLeft, Check, Lock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { loadStripe, type StripePaymentElementOptions } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getUserPlanDetails, unlockPlanWithCode, type PlanType } from "@/app/actions/plan-actions";
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

const PLAN_PRICES: Record<PlanType, number> = {
  free: 0,
  plus: 20,
  max: 200,
};

const PLAN_HIERARCHY: Record<PlanType, number> = {
  free: 0,
  plus: 1,
  max: 2,
};

const BILLING_PERIOD_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

type CheckoutState = {
  open: boolean;
  mode: "full" | "one_click";
  clientSecret: string | null;
  customerSessionClientSecret: string | null;
  stripeCustomerId: string | null;
  ephemeralKeySecret: string | null;
  paymentMethodLabel: string | null;
  planId: PlanType | null;
  planName: string | null;
  subscriptionId: string | null;
  paymentIntentId: string | null;
};

const PAYMENT_FORM_ID = "stripe-payment-form";

function StripePaymentForm({
  onSuccess,
  onSubmittingChange,
  onCompleteChange,
}: {
  onSuccess: (paymentIntentId?: string) => Promise<void>;
  onSubmittingChange?: (submitting: boolean) => void;
  onCompleteChange?: (complete: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  const paymentElementOptions: StripePaymentElementOptions = useMemo(
    () => ({
      layout: "tabs",
      paymentMethodOrder: ["card"],
      wallets: {
        link: "never" as const,
      },
    }),
    []
  );

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
        await onSuccess(paymentIntent?.id);
        return;
      }
      setFormError("Payment was not completed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form id={PAYMENT_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={paymentElementOptions}
        onChange={(event) => onCompleteChange?.(event.complete)}
      />
      <p className="text-xs text-muted-foreground">
        By providing your card information, you allow New business sandbox to charge your card for future payments in accordance with their terms.
      </p>
      {formError && <p className="text-sm text-red-500">{formError}</p>}
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
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [canSubmitPayment, setCanSubmitPayment] = useState(false);
  const [isSyncingSubscription, setIsSyncingSubscription] = useState(false);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    open: false,
    mode: "full",
    clientSecret: null,
    customerSessionClientSecret: null,
    stripeCustomerId: null,
    ephemeralKeySecret: null,
    paymentMethodLabel: null,
    planId: null,
    planName: null,
    subscriptionId: null,
    paymentIntentId: null,
  });
  const [planDetails, setPlanDetails] = useState<Awaited<ReturnType<typeof getUserPlanDetails>> | null>(null);
  const isMountedRef = useRef(true);
  const loadPlanDetails = useCallback(async () => {
    try {
      await refreshPlan().catch(() => {});
      const details = await getUserPlanDetails();
      if (isMountedRef.current) {
        setPlanDetails(details);
      }
      return details;
    } catch (error) {
      console.error("[upgrade] Failed to load plan details", error);
    }
    return null;
  }, []);

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
      const latestDetails = planDetails ?? (await loadPlanDetails());
      const currentPaidPlan = latestDetails?.planType ?? currentPlan;
      const isUpgradeAttempt =
        currentPaidPlan !== "free" && PLAN_HIERARCHY[planId] > PLAN_HIERARCHY[currentPaidPlan];
      const isDowngradeAttempt =
        currentPaidPlan !== "free" && PLAN_HIERARCHY[planId] < PLAN_HIERARCHY[currentPaidPlan];

      if (isUpgradeAttempt || isDowngradeAttempt) {
        setCheckoutState({
          open: true,
          mode: "one_click",
          clientSecret: null,
          customerSessionClientSecret: null,
          stripeCustomerId: null,
          ephemeralKeySecret: null,
          paymentMethodLabel: "Saved card",
          planId,
          planName,
          subscriptionId: null,
          paymentIntentId: null,
        });
        setCanSubmitPayment(true);
        setIsSubmittingPayment(false);

        const previewRes = await fetch("/api/stripe/upgrade-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: planId }),
        });
        const previewData = (await previewRes.json().catch(() => ({}))) as {
          oneClickAvailable?: boolean;
          paymentMethodLabel?: string | null;
          error?: string;
        };
        if (previewRes.ok && previewData.paymentMethodLabel) {
          setCheckoutState((prev) => ({
            ...prev,
            paymentMethodLabel: previewData.paymentMethodLabel ?? prev.paymentMethodLabel,
          }));
        }
        return;
      }

      const res = await fetch("/api/stripe/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        clientSecret?: string;
        subscriptionId?: string;
        customerSessionClientSecret?: string | null;
        stripeCustomerId?: string | null;
        ephemeralKeySecret?: string | null;
        paymentMethodLabel?: string | null;
        paymentIntentId?: string;
        noPaymentRequired?: boolean;
        error?: string;
      };
      if (!res.ok || (!data?.clientSecret && !data?.noPaymentRequired) || !data?.subscriptionId) {
        throw new Error(data?.error || "Failed to start checkout");
      }
      if (data.noPaymentRequired) {
        await finalizeUpgrade(data.subscriptionId, planName, data.paymentIntentId);
        return;
      }
      setCheckoutState({
        open: true,
        mode: "full",
        clientSecret: data.clientSecret ?? null,
        customerSessionClientSecret: data.customerSessionClientSecret ?? null,
        stripeCustomerId: data.stripeCustomerId ?? null,
        ephemeralKeySecret: data.ephemeralKeySecret ?? null,
        paymentMethodLabel: data.paymentMethodLabel ?? null,
        planId,
        planName,
        subscriptionId: data.subscriptionId,
        paymentIntentId: data.paymentIntentId ?? null,
      });
      setCanSubmitPayment(false);
      setIsSubmittingPayment(false);
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

  const closeCheckout = useCallback(() => {
    setCheckoutState({
      open: false,
      mode: "full",
      clientSecret: null,
      customerSessionClientSecret: null,
      stripeCustomerId: null,
      ephemeralKeySecret: null,
      paymentMethodLabel: null,
      planId: null,
      planName: null,
      subscriptionId: null,
      paymentIntentId: null,
    });
    setIsSubmittingPayment(false);
    setCanSubmitPayment(false);
  }, []);

  useEffect(() => {
    loadPlanDetails();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadPlanDetails]);

  useEffect(() => {
    const handleFocus = () => {
      loadPlanDetails();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [loadPlanDetails]);


  useEffect(() => {
    if (!checkoutState.open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCheckout();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [checkoutState.open, closeCheckout]);

  const syncSubscriptionPlan = async (subscriptionId: string, paymentIntentId?: string) => {
    const res = await fetch("/api/stripe/sync-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionId, paymentIntentId }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; plan?: PlanType };
    if (!res.ok) {
      const error = data?.error;
      if (error === "subscription_not_active") {
        throw new Error("Payment was received, but the subscription is not active yet. Try again in a few seconds.");
      }
      throw new Error(data?.error || "Unable to confirm subscription.");
    }
    return data?.plan;
  };

  const finalizeUpgrade = async (subscriptionId: string, planName: string, paymentIntentId?: string) => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const attempts = 4;
    setIsSyncingSubscription(true);
    try {
      let upgraded = false;
      let lastError: Error | null = null;
      for (let i = 0; i < attempts; i++) {
        try {
          await syncSubscriptionPlan(subscriptionId, paymentIntentId);
          upgraded = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error("Unable to confirm the subscription.");
          if (i < attempts - 1) {
            await delay(1200);
            continue;
          }
        }
      }

      if (upgraded) {
        await refreshPlan();
        await loadPlanDetails();
        closeCheckout();
        setSuccessDialog({
          open: true,
          title: `Upgraded to ${planName}`,
          message: "Payment accepted and your plan is now active.",
        });
        return;
      }

      closeCheckout();
      setSuccessDialog({
        open: true,
        title: "Payment received",
        message:
          lastError?.message ||
          "Payment was received, but the subscription is not active yet. Try again in a few seconds.",
      });
    } finally {
      setIsSyncingSubscription(false);
    }
  };

  const handleCheckoutSuccess = async (paymentIntentId?: string) => {
    const planName = checkoutState.planName;
    const subscriptionId = checkoutState.subscriptionId;
    if (!planName || !subscriptionId) {
      closeCheckout();
      setSuccessDialog({
        open: true,
        title: "Payment received",
        message: "Payment was received, but we could not confirm the subscription details.",
      });
      return;
    }

    if (paymentIntentId) {
      setCheckoutState((prev) => ({ ...prev, paymentIntentId }));
    }

    const resolvedPaymentIntentId = paymentIntentId ?? checkoutState.paymentIntentId ?? undefined;
    await finalizeUpgrade(subscriptionId, planName, resolvedPaymentIntentId);
  };

  const handleOneClickUpgrade = async () => {
    if (!checkoutState.planId || !checkoutState.planName) return;
    setIsProcessing(true);
    try {
      const res = await fetch("/api/stripe/upgrade-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: checkoutState.planId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: "succeeded" | "processing" | "requires_action" | "payment_method_required" | "scheduled";
        subscriptionId?: string;
        clientSecret?: string;
        paymentIntentId?: string;
        switchAt?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Unable to change subscription.");
      }

      if (data.status === "scheduled") {
        await refreshPlan();
        await loadPlanDetails();
        closeCheckout();
        const switchDate =
          data.switchAt && !Number.isNaN(data.switchAt)
            ? new Date(data.switchAt * 1000).toLocaleString()
            : "the next billing cycle";
        setSuccessDialog({
          open: true,
          title: `Switch to ${checkoutState.planName} scheduled`,
          message: `Your current plan will stay active. The switch will occur at ${switchDate}.`,
        });
        return;
      }

      if ((data.status === "requires_action" || data.status === "payment_method_required") && data.clientSecret) {
        setCheckoutState((prev) => ({
          ...prev,
          mode: "full",
          clientSecret: data.clientSecret ?? null,
          subscriptionId: data.subscriptionId ?? prev.subscriptionId,
          paymentIntentId: data.paymentIntentId ?? prev.paymentIntentId,
        }));
        setCanSubmitPayment(false);
        return;
      }

      if (data.status === "payment_method_required") {
        throw new Error("No saved payment method is available. Please add a card.");
      }

      if (!data.subscriptionId) {
        throw new Error("Unable to confirm subscription.");
      }

      await finalizeUpgrade(data.subscriptionId, checkoutState.planName, data.paymentIntentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to upgrade subscription.";
      const isDowngradeAttempt =
        checkoutState.planId &&
        PLAN_HIERARCHY[checkoutState.planId] < PLAN_HIERARCHY[currentPlan];
      setSuccessDialog({
        open: true,
        title: isDowngradeAttempt ? "Switch failed" : "Upgrade failed",
        message,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const planUpgradeSummary = useMemo(() => {
    if (!checkoutState.planId) {
      return { selectedPrice: 0, credit: 0, totalDue: 0, hasCredit: false, isDowngrade: false };
    }
    const selectedPrice = PLAN_PRICES[checkoutState.planId] ?? 0;
    const currentPrice = PLAN_PRICES[currentPlan] ?? 0;
    const isUpgrade =
      PLAN_HIERARCHY[checkoutState.planId] > PLAN_HIERARCHY[currentPlan];
    const isDowngrade =
      PLAN_HIERARCHY[checkoutState.planId] < PLAN_HIERARCHY[currentPlan];

    if (isDowngrade) {
      // Downgrades: no charge today, effective next billing cycle.
      return { selectedPrice, credit: 0, totalDue: 0, hasCredit: false, isDowngrade: true };
    }

    if (!isUpgrade || currentPlan === "free") {
      return { selectedPrice, credit: 0, totalDue: selectedPrice, hasCredit: false, isDowngrade: false };
    }
    const endIso = planDetails?.currentPeriodEnd;
    if (!endIso) {
      return { selectedPrice, credit: 0, totalDue: selectedPrice, hasCredit: false, isDowngrade: false };
    }
    const endMs = new Date(endIso).getTime();
    const nowMs = Date.now();
    if (Number.isNaN(endMs) || endMs <= nowMs) {
      return { selectedPrice, credit: 0, totalDue: selectedPrice, hasCredit: false, isDowngrade: false };
    }
    const startIso = planDetails?.currentPeriodStart;
    const startMs = startIso ? new Date(startIso).getTime() : endMs - BILLING_PERIOD_DAYS * MS_PER_DAY;
    let periodLengthMs = endMs - startMs;
    if (periodLengthMs <= 0) {
      periodLengthMs = BILLING_PERIOD_DAYS * MS_PER_DAY;
    }
    const remainingMs = Math.min(endMs - nowMs, periodLengthMs);
    const credit = Math.min(currentPrice, (currentPrice * remainingMs) / periodLengthMs);
    const totalDue = Math.max(0, selectedPrice - credit);
    return { selectedPrice, credit, totalDue, hasCredit: credit > 0, isDowngrade: false };
  }, [checkoutState.planId, currentPlan, planDetails]);

  const { selectedPrice, credit, totalDue, hasCredit, isDowngrade } = planUpgradeSummary;
  const pendingSwitchInfo = useMemo(() => {
    if (!planDetails?.pendingPlanType || !planDetails?.pendingSwitchAt) {
      return null;
    }
    const dateLabel = new Date(planDetails.pendingSwitchAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return {
      pendingPlanType: planDetails.pendingPlanType,
      pendingSwitchLabel: dateLabel,
    };
  }, [planDetails?.pendingPlanType, planDetails?.pendingSwitchAt]);
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

          {pendingSwitchInfo && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {`Switch to ${pendingSwitchInfo.pendingPlanType} scheduled for ${pendingSwitchInfo.pendingSwitchLabel}.`}
            </div>
          )}

          <div className="max-w-6xl mx-auto flex justify-center px-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 w-full">
          {filteredPlans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const pendingSwitchToPlan = pendingSwitchInfo?.pendingPlanType === plan.id;
            const canDirectChange = currentPlan !== plan.id && !pendingSwitchToPlan;
            const isDowngrade =
              PLAN_HIERARCHY[currentPlan] > PLAN_HIERARCHY[plan.id];
            const pendingSwitchLabel = pendingSwitchToPlan
              ? pendingSwitchInfo?.pendingSwitchLabel
              : null;
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
                              ? isDowngrade
                                ? `Switch to ${plan.name}`
                                : `Upgrade to ${plan.name}`
                              : "Direct upgrades are currently disabled. Please use unlock code."
                          }
                          onClick={async () => {
                            if (!canDirectChange) return;
                            await startStripeCheckout(plan.id, plan.name);
                          }}
                        >
                          {pendingSwitchToPlan
                            ? "Switch scheduled"
                            : isDowngrade
                            ? `Switch to ${plan.name}`
                            : `Upgrade to ${plan.name}`}
                        </Button>
                        {pendingSwitchLabel && (
                          <p className="text-xs text-amber-200 text-center">
                            Switch scheduled for {pendingSwitchLabel}
                          </p>
                        )}
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

      {checkoutState.open && (
        <div className="fixed inset-0 z-[1000] flex items-start justify-center px-4 py-6 overflow-y-auto lg:items-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur"
            onClick={closeCheckout}
          />
          <div
            className={`relative z-10 flex w-full flex-col items-stretch gap-6 ${
              checkoutState.mode === "one_click" ? "max-w-sm" : "max-w-5xl lg:flex-row"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            {checkoutState.mode === "full" && (
              <div className="w-full rounded-2xl border border-border bg-popover p-6 shadow-2xl lg:max-w-2xl max-h-[calc(100vh-6rem)] overflow-y-auto">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {checkoutState.planName ? `Checkout - ${checkoutState.planName}` : "Checkout"}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Complete payment to activate your plan.
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

                  {stripePromise && checkoutState.clientSecret && checkoutState.planName && (
                    <Elements
                      stripe={stripePromise}
                      options={{
                        clientSecret: checkoutState.clientSecret,
                        ...(checkoutState.ephemeralKeySecret && checkoutState.stripeCustomerId
                          ? {
                              customerOptions: {
                                customer: checkoutState.stripeCustomerId,
                                ephemeralKey: checkoutState.ephemeralKeySecret,
                              },
                            }
                          : {
                              customerSessionClientSecret:
                                checkoutState.customerSessionClientSecret ?? undefined,
                            }),
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
                        <StripePaymentForm
                          onSuccess={(paymentIntentId) => handleCheckoutSuccess(paymentIntentId)}
                          onSubmittingChange={setIsSubmittingPayment}
                          onCompleteChange={setCanSubmitPayment}
                        />
                    </Elements>
                  )}
                </div>
              </div>
            )}

            {checkoutState.planId && checkoutState.planName && (
              <div className="w-full rounded-2xl border border-border bg-card/80 p-5 shadow-lg lg:max-w-sm h-[560px] flex flex-col">
                <div className="space-y-2 flex-1 overflow-hidden">
                  {checkoutState.mode === "one_click" ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold">{checkoutState.planName}</p>
                          <p className="text-sm text-muted-foreground">Monthly subscription</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={closeCheckout} aria-label="Close checkout">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-start justify-between">
                        <div />
                        <div className="text-right">
                          <p className="text-lg font-semibold">
                            ${plans.find((p) => p.id === checkoutState.planId)?.price ?? "--"}
                          </p>
                          <p className="text-xs text-muted-foreground">USD / month</p>
                        </div>
                      </div>
                    </>
                  ) : (
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
                  )}

                  <div className="mt-3 space-y-2 text-sm text-foreground/90 max-h-48 overflow-y-auto pr-1">
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
                      <span>${selectedPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Estimated tax</span>
                      <span>$0.00</span>
                    </div>
                    {isDowngrade && (
                      <p className="text-xs text-muted-foreground">
                        Downgrade will take effect at the next billing cycle. No charge today.
                      </p>
                    )}
                    {!isDowngrade && hasCredit && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-emerald-400">
                          <span>Adjustment</span>
                          <span>-${credit.toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Prorated credit for the remainder of your {currentPlan} subscription.
                        </p>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold text-foreground pt-2">
                      <span>Total due today</span>
                      <span>${totalDue.toFixed(2)}</span>
                    </div>
                    {checkoutState.mode === "one_click" && checkoutState.paymentMethodLabel && (
                      <div className="flex justify-between text-muted-foreground pt-3">
                        <span>Payment Method</span>
                        <span>{checkoutState.paymentMethodLabel}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="pt-4">
                  <Button
                    form={checkoutState.mode === "full" ? PAYMENT_FORM_ID : undefined}
                    type={checkoutState.mode === "full" ? "submit" : "button"}
                    className={`w-full relative overflow-hidden transition ${
                      isSubmittingPayment ? "scale-[0.99] opacity-90" : ""
                    }`}
                    onClick={
                      checkoutState.mode === "one_click"
                        ? handleOneClickUpgrade
                        : undefined
                    }
                    disabled={
                      checkoutState.mode === "one_click"
                        ? isProcessing || isSyncingSubscription
                        : !canSubmitPayment || isProcessing || isSubmittingPayment || isSyncingSubscription
                    }
                  >
                    {isSubmittingPayment ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                        <span>Processing...</span>
                      </span>
                    ) : (
                      `Subscribe to ${checkoutState.planName}`
                    )}
                    <span
                      className={`pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/20 via-white/10 to-primary/20 transition-all duration-500 ${
                        isSubmittingPayment ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
                      }`}
                    />
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground text-center">
                    Billed monthly. You can cancel anytime.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
