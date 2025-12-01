"use client";

import { useEffect, useState } from "react";
import { getUserPlan, type PlanType } from "@/app/actions/plan-actions";

const PLAN_CACHE_KEY = "user_plan_cache";

// Get cached plan from localStorage
function getCachedPlan(): PlanType | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem(PLAN_CACHE_KEY);
    if (cached) {
      const { plan, timestamp } = JSON.parse(cached);
      // Cache is valid for 5 minutes
      if (Date.now() - timestamp < 5 * 60 * 1000) {
        return plan as PlanType;
      }
    }
  } catch (error) {
    console.error("Error reading cached plan:", error);
  }
  return null;
}

// Save plan to localStorage
function cachePlan(plan: PlanType) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      PLAN_CACHE_KEY,
      JSON.stringify({ plan, timestamp: Date.now() })
    );
  } catch (error) {
    console.error("Error caching plan:", error);
  }
}

export function useUserPlan() {
  const cachedPlan = getCachedPlan();
  const [plan, setPlan] = useState<PlanType>(cachedPlan || "free");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadPlan() {
      try {
        const userPlan = await getUserPlan();
        setPlan(userPlan);
        cachePlan(userPlan);
      } catch (error) {
        console.error("Error loading user plan:", error);
        setPlan("free");
      } finally {
        setIsLoading(false);
      }
    }

    loadPlan();
  }, []);

  const refreshPlan = async () => {
    setIsLoading(true);
    try {
      const userPlan = await getUserPlan();
      setPlan(userPlan);
      cachePlan(userPlan);
    } catch (error) {
      console.error("Error refreshing user plan:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return { plan, isLoading, refreshPlan };
}
