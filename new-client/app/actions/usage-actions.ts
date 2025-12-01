"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export async function getUserTotalSpending(): Promise<number> {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return 0;
    }

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("user_api_usage")
      .select("estimated_cost")
      .eq("user_id", userId);

    if (error) {
      console.error("Error fetching user spending:", error);
      return 0;
    }

    if (!data || data.length === 0) {
      return 0;
    }

    const total = data.reduce((sum, row) => {
      const cost = parseFloat(row.estimated_cost?.toString() || "0");
      return sum + cost;
    }, 0);

    return total;
  } catch (error) {
    console.error("Error calculating user spending:", error);
    return 0;
  }
}

export async function getMonthlySpending(): Promise<number> {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      console.log("[monthlySpending] No user ID found");
      return 0;
    }

    // Get start of current month in UTC (not local timezone)
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    
    console.log("[monthlySpending] Querying for user:", userId);
    console.log("[monthlySpending] Start of month (UTC):", startOfMonth.toISOString());

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("user_api_usage")
      .select("estimated_cost, created_at")
      .eq("user_id", userId)
      .gte("created_at", startOfMonth.toISOString());

    if (error) {
      console.error("[monthlySpending] Error fetching monthly spending:", error);
      return 0;
    }

    console.log("[monthlySpending] Found", data?.length || 0, "records");
    if (data && data.length > 0) {
      console.log("[monthlySpending] Sample record:", data[0]);
    }

    if (!data || data.length === 0) {
      return 0;
    }

    const total = data.reduce((sum, row) => {
      const cost = parseFloat(row.estimated_cost?.toString() || "0");
      return sum + cost;
    }, 0);

    console.log("[monthlySpending] Total spending:", total);
    return total;
  } catch (error) {
    console.error("[monthlySpending] Error calculating monthly spending:", error);
    return 0;
  }
}