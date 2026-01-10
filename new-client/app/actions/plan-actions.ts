"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export type PlanType = "free" | "plus" | "max";

const BILLING_PERIOD_DAYS = 30;
const PLAN_PRICE_MAP: Record<Exclude<PlanType, "free">, string | undefined> = {
  plus: process.env.STRIPE_PRICE_PLUS,
  max: process.env.STRIPE_PRICE_MAX,
};

function addDaysIso(dateIso: string, days: number) {
  return new Date(new Date(dateIso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function computeNextPeriod(
  startIso: string,
  nowMs: number
): { currentPeriodStart: string; currentPeriodEnd: string } {
  let currentPeriodStart = startIso;
  let currentPeriodEnd = addDaysIso(startIso, BILLING_PERIOD_DAYS);
  let safety = 0;
  while (new Date(currentPeriodEnd).getTime() <= nowMs && safety < 48) {
    currentPeriodStart = currentPeriodEnd;
    currentPeriodEnd = addDaysIso(currentPeriodStart, BILLING_PERIOD_DAYS);
    safety += 1;
  }
  return { currentPeriodStart, currentPeriodEnd };
}

const UNLOCK_CODES: Record<Exclude<PlanType, "free">, string> = {
  plus: "devadmin",
  max: "devadmin",
};

function normalizePlanType(value: string | null | undefined): PlanType {
  switch ((value ?? "").toLowerCase()) {
    case "max":
    case "dev":
      return "max";
    case "plus":
    case "pro":
    case "basic":
      return "plus";
    case "free":
    default:
      return "free";
  }
}

function resolvePlanFromPriceId(priceId?: string | null): PlanType | null {
  if (!priceId) return null;
  if (priceId === PLAN_PRICE_MAP.plus) return "plus";
  if (priceId === PLAN_PRICE_MAP.max) return "max";
  return null;
}

function toIsoFromSeconds(value?: number | null) {
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

function toStoragePlanType(plan: PlanType): PlanType {
  // Write the exact plan value; Supabase must allow "max" in plan_type.
  return plan;
}

export async function getUserPlan(): Promise<PlanType> {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return "free";
    }

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("user_plans")
      .select("plan_type, is_active, cancel_at, cancel_at_period_end, current_period_start, current_period_end, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      // No active plan found, ensure a free plan row exists for this user.
      // (Schema uses a unique constraint on user_id, so use upsert.)
      await supabase.from("user_plans").upsert(
        {
          user_id: userId,
          plan_type: "free",
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      return "free";
    }

    const normalizedPlan = normalizePlanType((data as any).plan_type as string | null | undefined);

    // If we loaded a legacy plan value, normalize it for return; keep storage compatible with DB constraint.
    const storagePlanType = toStoragePlanType(normalizedPlan);
    if (storagePlanType !== (data as any).plan_type) {
      await supabase
        .from("user_plans")
        .update({
          plan_type: storagePlanType,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }

    const nowMs = Date.now();
    const cancelAtIso = (data as any).cancel_at as string | null | undefined;
    const cancelAtPeriodEnd = Boolean((data as any).cancel_at_period_end);

    // Normalize / advance billing period so renewal dates don't drift.
    if (normalizedPlan !== "free") {
      const currentPeriodStartIso =
        ((data as any).current_period_start as string | null | undefined) ??
        ((data as any).created_at as string | null | undefined) ??
        new Date().toISOString();

      const next = computeNextPeriod(currentPeriodStartIso, nowMs);
      const existingEndMs = (data as any).current_period_end
        ? new Date((data as any).current_period_end as string).getTime()
        : NaN;

      if (Number.isNaN(existingEndMs) || existingEndMs !== new Date(next.currentPeriodEnd).getTime()) {
        await supabase.from("user_plans").upsert(
          {
            user_id: userId,
            plan_type: normalizedPlan,
            is_active: true,
            current_period_start: next.currentPeriodStart,
            current_period_end: next.currentPeriodEnd,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
      }
    }

    // If cancellation was scheduled and the effective date has passed, downgrade now.
    if (cancelAtPeriodEnd && cancelAtIso) {
      const cancelAtMs = new Date(cancelAtIso).getTime();
      if (!Number.isNaN(cancelAtMs) && cancelAtMs <= nowMs) {
        await supabase.from("user_plans").upsert(
          {
            user_id: userId,
            plan_type: "free",
            is_active: true,
            cancel_at: null,
            cancel_at_period_end: false,
            canceled_at: null,
            current_period_start: null,
            current_period_end: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
        return "free";
      }
    }

    return normalizedPlan;
  } catch (error) {
    console.error("Error fetching user plan:", error);
    return "free";
  }
}

export async function unlockPlanWithCode(
  planType: Exclude<PlanType, "free">,
  code: string
): Promise<{ success: boolean; message: string }> {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return { success: false, message: "User not authenticated" };
    }

    // Validate code (case-insensitive and trimmed)
    const trimmedCode = code.trim().toLowerCase();
    const expectedCode = UNLOCK_CODES[planType].toLowerCase();
    
    if (trimmedCode !== expectedCode) {
      return { success: false, message: "Invalid unlock code" };
    }

    const supabase = await supabaseServer();

    const { data: current } = await supabase
      .from("user_plans")
      .select("plan_type, current_period_start, current_period_end")
      .eq("user_id", userId)
      .single();

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const hasActivePeriod =
      current?.current_period_end && new Date(current.current_period_end as any).getTime() > nowMs;
    const shouldStartNewPeriod = !hasActivePeriod || (current?.plan_type as PlanType | undefined) === "free";
    const period = shouldStartNewPeriod
      ? computeNextPeriod(nowIso, nowMs)
      : {
          currentPeriodStart: (current as any).current_period_start as string,
          currentPeriodEnd: (current as any).current_period_end as string,
        };

    const { error: upsertError } = await supabase
      .from("user_plans")
      .upsert(
          {
            user_id: userId,
            plan_type: toStoragePlanType(planType),
            unlock_code: code,
            is_active: true,
            cancel_at: null,
            cancel_at_period_end: false,
            canceled_at: null,
            current_period_start: period.currentPeriodStart,
            current_period_end: period.currentPeriodEnd,
            updated_at: new Date().toISOString(),
          },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      console.error("Error unlocking plan:", upsertError);
      return {
        success: false,
        message: `Failed to unlock plan${upsertError.message ? `: ${upsertError.message}` : ""}`,
      };
    }

    return { success: true, message: `Successfully unlocked ${planType} plan!` };
  } catch (error) {
    console.error("Error unlocking plan:", error);
    return { success: false, message: "An error occurred" };
  }
}

export async function upgradeToPlan(
  planType: PlanType,
  currentPlan?: PlanType
): Promise<{ success: boolean; message: string }> {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return { success: false, message: "User not authenticated" };
    }

    const supabase = await supabaseServer();

    const { data: existing } = await supabase
      .from("user_plans")
      .select("plan_type, cancel_at, cancel_at_period_end, current_period_start, current_period_end, created_at")
      .eq("user_id", userId)
      .single();

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // Preserve billing period across cancel/reactivate and plan changes; only start a new period when moving from free
    // or when the prior period has ended (i.e., resubscribe after expiration).
    let currentPeriodStart: string | null = (existing as any)?.current_period_start ?? null;
    let currentPeriodEnd: string | null = (existing as any)?.current_period_end ?? null;

    if (planType === "free") {
      currentPeriodStart = null;
      currentPeriodEnd = null;
    } else {
      const existingEndMs = currentPeriodEnd ? new Date(currentPeriodEnd).getTime() : NaN;
      const existingPlan = (existing as any)?.plan_type
        ? normalizePlanType((existing as any).plan_type as string)
        : undefined;
      const hasActivePeriod = !Number.isNaN(existingEndMs) && existingEndMs > nowMs;
      const shouldStartNewPeriod = !hasActivePeriod || existingPlan === "free" || !existingPlan;
      if (shouldStartNewPeriod) {
        const period = computeNextPeriod(nowIso, nowMs);
        currentPeriodStart = period.currentPeriodStart;
        currentPeriodEnd = period.currentPeriodEnd;
      } else if (currentPeriodStart) {
        const next = computeNextPeriod(currentPeriodStart, nowMs);
        currentPeriodStart = next.currentPeriodStart;
        currentPeriodEnd = next.currentPeriodEnd;
      } else {
        const base = (existing as any)?.created_at ?? nowIso;
        const next = computeNextPeriod(base, nowMs);
        currentPeriodStart = next.currentPeriodStart;
        currentPeriodEnd = next.currentPeriodEnd;
      }
    }

    const { error: upsertError } = await supabase
      .from("user_plans")
      .upsert(
        {
          user_id: userId,
          plan_type: toStoragePlanType(planType),
          is_active: true,
          cancel_at: null,
          cancel_at_period_end: false,
          canceled_at: null,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      console.error("Error changing plan:", upsertError);
      return {
        success: false,
        message: `Failed to change plan${upsertError.message ? `: ${upsertError.message}` : ""}`,
      };
    }

    // Determine if this is an upgrade or downgrade
  const planHierarchy: Record<PlanType, number> = {
    free: 0,
    plus: 1,
    max: 2,
  };

    const isDowngrade = currentPlan && planHierarchy[planType] < planHierarchy[currentPlan];
    const action = isDowngrade ? "switched" : "upgraded";
    const capitalizedPlan = planType.charAt(0).toUpperCase() + planType.slice(1);

    return { success: true, message: `Successfully ${action} to ${capitalizedPlan} plan!` };
  } catch (error) {
    console.error("Error changing plan:", error);
    return { success: false, message: "An error occurred" };
  }
}

export async function getUserPlanDetails(): Promise<{
  planType: PlanType;
  renewalDate: string | null;
  cancelAt: string | null;
  cancelAtPeriodEnd: boolean;
  isActive: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  pendingPlanType: PlanType | null;
  pendingSwitchAt: string | null;
} | null> {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return null;
    }

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("user_plans")
      .select("plan_type, is_active, created_at, cancel_at, cancel_at_period_end, current_period_start, current_period_end, stripe_customer_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return {
        planType: "free",
        renewalDate: null,
        cancelAt: null,
        cancelAtPeriodEnd: false,
        isActive: true,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        pendingPlanType: null,
        pendingSwitchAt: null,
      };
    }

    const nowMs = Date.now();
    let planType = normalizePlanType((data as any).plan_type as string | null | undefined);

    let currentPeriodStart: string | null = (data as any).current_period_start ?? null;
    let currentPeriodEnd: string | null = (data as any).current_period_end ?? null;
    if (planType !== "free") {
      const baseStart = currentPeriodStart ?? (data as any).created_at ?? new Date().toISOString();
      const next = computeNextPeriod(baseStart, nowMs);
      currentPeriodStart = next.currentPeriodStart;
      currentPeriodEnd = next.currentPeriodEnd;
    } else {
      currentPeriodStart = null;
      currentPeriodEnd = null;
    }

    let cancelAt = (data as any).cancel_at ? new Date((data as any).cancel_at).toISOString() : null;
    let cancelAtPeriodEnd = Boolean((data as any).cancel_at_period_end);
    let pendingPlanType: PlanType | null = null;
    let pendingSwitchAt: string | null = null;

    const stripeCustomerId = (data as any).stripe_customer_id as string | null | undefined;
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (stripeCustomerId && secretKey) {
      try {
        const subRes = await fetch(
          `https://api.stripe.com/v1/subscriptions?customer=${stripeCustomerId}&status=active&limit=1&expand[]=data.schedule&expand[]=data.items.data.price`,
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );
        const subData = (await subRes.json()) as {
          data?: Array<{
            current_period_start?: number;
            current_period_end?: number;
            cancel_at?: number | null;
            cancel_at_period_end?: boolean;
            schedule?: string | { id?: string };
            items?: { data?: Array<{ price?: { id?: string } | null }> };
          }>;
        };
        if (subRes.ok) {
          const activeSub = subData.data?.[0];
          const stripePlanType = resolvePlanFromPriceId(activeSub?.items?.data?.[0]?.price?.id ?? null);
          if (stripePlanType) {
            planType = stripePlanType;
          }
          const stripeStartIso = toIsoFromSeconds(activeSub?.current_period_start);
          const stripeEndIso = toIsoFromSeconds(activeSub?.current_period_end);
          currentPeriodStart = stripeStartIso ?? currentPeriodStart;
          currentPeriodEnd = stripeEndIso ?? currentPeriodEnd;
          cancelAt = toIsoFromSeconds(activeSub?.cancel_at) ?? cancelAt;
          cancelAtPeriodEnd = Boolean(activeSub?.cancel_at_period_end);
          const scheduleId =
            typeof activeSub?.schedule === "string"
              ? activeSub.schedule
              : activeSub?.schedule?.id;
          const currentPriceId = activeSub?.items?.data?.[0]?.price?.id ?? null;
          if (scheduleId) {
            const scheduleRes = await fetch(
              `https://api.stripe.com/v1/subscription_schedules/${scheduleId}?expand[]=phases.items.price`,
              { headers: { Authorization: `Bearer ${secretKey}` } }
            );
            const scheduleData = (await scheduleRes.json()) as {
              phases?: Array<{
                start_date?: number;
                items?: Array<{ price?: { id?: string } | null }>;
              }>;
            };
            if (scheduleRes.ok && scheduleData.phases?.length) {
              const nowSeconds = Math.floor(Date.now() / 1000);
              const nextPhase = scheduleData.phases.find(
                (phase) => (phase.start_date ?? 0) > nowSeconds
              );
              const nextPriceId = nextPhase?.items?.[0]?.price?.id ?? null;
              if (nextPriceId && nextPriceId !== currentPriceId) {
                pendingPlanType = resolvePlanFromPriceId(nextPriceId);
                pendingSwitchAt = nextPhase?.start_date
                  ? new Date(nextPhase.start_date * 1000).toISOString()
                  : null;
              }
            }
          }
        }
      } catch (stripeError) {
        console.warn("[plan-details] Failed to load pending schedule", stripeError);
      }
    }

    return {
      planType,
      renewalDate: currentPeriodEnd ?? null,
      cancelAt,
      cancelAtPeriodEnd,
      isActive: Boolean((data as any).is_active),
      currentPeriodStart,
      currentPeriodEnd,
      pendingPlanType,
      pendingSwitchAt,
    };
  } catch (error) {
    console.error("Error fetching user plan details:", error);
    return null;
  }
}

export async function cancelSubscription(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return { success: false, message: "User not authenticated" };
    }

    const supabase = await supabaseServer();

    const { data: current, error: currentError } = await supabase
      .from("user_plans")
      .select("plan_type, is_active, created_at, cancel_at, cancel_at_period_end, current_period_start, current_period_end")
      .eq("user_id", userId)
      .single();

    if (currentError || !current) {
      return { success: false, message: "Failed to load current subscription" };
    }

    const currentPlan = current.plan_type as PlanType;
    if (currentPlan === "free") {
      return { success: true, message: "You're already on the Free plan." };
    }

    if ((current as any).cancel_at_period_end && (current as any).cancel_at) {
      const when = new Date((current as any).cancel_at as string).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      return { success: true, message: `Your plan is already set to cancel on ${when}.` };
    }

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const baseStart = (current as any).current_period_start ?? (current as any).created_at ?? nowIso;
    const next = computeNextPeriod(baseStart, nowMs);
    const cancelAt = (current as any).current_period_end ?? next.currentPeriodEnd;

    const { error: upsertError } = await supabase
      .from("user_plans")
      .upsert(
        {
          user_id: userId,
          plan_type: currentPlan,
          is_active: true,
          cancel_at: cancelAt,
          cancel_at_period_end: true,
          canceled_at: new Date().toISOString(),
          current_period_start: (current as any).current_period_start ?? next.currentPeriodStart,
          current_period_end: cancelAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      console.error("Error canceling subscription:", upsertError);
      return {
        success: false,
        message: `Failed to cancel subscription${upsertError.message ? `: ${upsertError.message}` : ""}`,
      };
    }

    const when = new Date(cancelAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return {
      success: true,
      message: `Your plan will be canceled on ${when}.`,
    };
  } catch (error) {
    console.error("Error canceling subscription:", error);
    return { success: false, message: "An error occurred" };
  }
}
