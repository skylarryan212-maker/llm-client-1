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
    const pageSize = 1000;
    let from = 0;
    let total = 0;

    while (true) {
      const { data, error } = await supabase
        .from("user_api_usage")
        .select("estimated_cost")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error("Error fetching user spending:", error);
        return total;
      }

      if (!data || data.length === 0) {
        break;
      }

      total += data.reduce((sum, row) => sum + parseFloat(row.estimated_cost?.toString() || "0"), 0);
      from += pageSize;

      if (data.length < pageSize) {
        break;
      }
    }

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

    const pageSize = 1000;
    let from = 0;
    let total = 0;
    let batch = 0;

    while (true) {
      const { data, error } = await supabase
        .from("user_api_usage")
        .select("estimated_cost, created_at")
        .eq("user_id", userId)
        .gte("created_at", startOfMonth.toISOString())
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error("[monthlySpending] Error fetching monthly spending:", error);
        return total;
      }

      if (!data || data.length === 0) {
        break;
      }

      batch += 1;
      total += data.reduce((sum, row) => sum + parseFloat(row.estimated_cost?.toString() || "0"), 0);
      from += pageSize;

      if (data.length < pageSize) {
        break;
      }
    }

    console.log("[monthlySpending] Batches fetched:", batch, "Total spending:", total.toFixed(6));
    return total;
  } catch (error) {
    console.error("[monthlySpending] Error calculating monthly spending:", error);
    return 0;
  }
}
