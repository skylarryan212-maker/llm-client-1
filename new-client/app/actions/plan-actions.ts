"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export type PlanType = "free" | "basic" | "plus" | "pro" | "dev";

const BILLING_PERIOD_DAYS = 30;

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
  basic: "devadmin",
  plus: "devadmin",
  pro: "devadmin",
  dev: "devadmin",
};

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

    const nowMs = Date.now();
    const cancelAtIso = (data as any).cancel_at as string | null | undefined;
    const cancelAtPeriodEnd = Boolean((data as any).cancel_at_period_end);

    // Normalize / advance billing period so renewal dates don't drift.
    if ((data.plan_type as PlanType) !== "free") {
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
            plan_type: data.plan_type,
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

    return data.plan_type as PlanType;
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
          plan_type: planType,
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
      const existingPlan = (existing as any)?.plan_type as PlanType | undefined;
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
          plan_type: planType,
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
    basic: 1,
    plus: 2,
    pro: 3,
    dev: 4,
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
} | null> {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return null;
    }

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("user_plans")
      .select("plan_type, is_active, created_at, cancel_at, cancel_at_period_end, current_period_start, current_period_end")
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
      };
    }

    const nowMs = Date.now();
    const planType = data.plan_type as PlanType;

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

    const cancelAt = (data as any).cancel_at ? new Date((data as any).cancel_at).toISOString().split("T")[0] : null;
    const cancelAtPeriodEnd = Boolean((data as any).cancel_at_period_end);

    return {
      planType,
      renewalDate: currentPeriodEnd ? currentPeriodEnd.split("T")[0] : null,
      cancelAt,
      cancelAtPeriodEnd,
      isActive: data.is_active,
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
