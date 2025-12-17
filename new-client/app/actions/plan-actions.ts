"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export type PlanType = "free" | "basic" | "plus" | "pro" | "dev";

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
      .select("plan_type, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      // No plan found, create a free plan
      await supabase.from("user_plans").insert({
        user_id: userId,
        plan_type: "free",
        is_active: true,
      });
      return "free";
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

    // Avoid relying on a specific unique constraint for upsert; enforce "one active plan" ourselves.
    const { error: deactivateError } = await supabase
      .from("user_plans")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("is_active", true);

    if (deactivateError) {
      console.error("Error deactivating existing plan:", deactivateError);
      return {
        success: false,
        message: `Failed to unlock plan${deactivateError.message ? `: ${deactivateError.message}` : ""}`,
      };
    }

    const { error: insertError } = await supabase.from("user_plans").insert({
      user_id: userId,
      plan_type: planType,
      unlock_code: code,
      is_active: true,
      updated_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error("Error unlocking plan:", insertError);
      return {
        success: false,
        message: `Failed to unlock plan${insertError.message ? `: ${insertError.message}` : ""}`,
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

    // Avoid relying on an upsert constraint; enforce "one active plan" ourselves.
    const { error: deactivateError } = await supabase
      .from("user_plans")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("is_active", true);

    if (deactivateError) {
      console.error("Error changing plan:", deactivateError);
      return {
        success: false,
        message: `Failed to change plan${deactivateError.message ? `: ${deactivateError.message}` : ""}`,
      };
    }

    const { error: insertError } = await supabase.from("user_plans").insert({
      user_id: userId,
      plan_type: planType,
      is_active: true,
      updated_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error("Error changing plan:", insertError);
      return {
        success: false,
        message: `Failed to change plan${insertError.message ? `: ${insertError.message}` : ""}`,
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
      .select("plan_type, is_active, created_at, updated_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return {
        planType: "free",
        renewalDate: null,
        isActive: true,
      };
    }

    // Calculate renewal date (30 days from updated_at or created_at)
    const baseDate = data.updated_at || data.created_at;
    const renewalDate = baseDate
      ? new Date(new Date(baseDate).getTime() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]
      : null;

    return {
      planType: data.plan_type as PlanType,
      renewalDate,
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

    const { error: deactivateError } = await supabase
      .from("user_plans")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("is_active", true);

    if (deactivateError) {
      console.error("Error canceling subscription:", deactivateError);
      return {
        success: false,
        message: `Failed to cancel subscription${deactivateError.message ? `: ${deactivateError.message}` : ""}`,
      };
    }

    const { error: insertError } = await supabase.from("user_plans").insert({
      user_id: userId,
      plan_type: "free",
      is_active: true,
      updated_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error("Error canceling subscription:", insertError);
      return {
        success: false,
        message: `Failed to cancel subscription${insertError.message ? `: ${insertError.message}` : ""}`,
      };
    }

    return {
      success: true,
      message: "Subscription canceled successfully. You've been moved to the Free plan.",
    };
  } catch (error) {
    console.error("Error canceling subscription:", error);
    return { success: false, message: "An error occurred" };
  }
}
