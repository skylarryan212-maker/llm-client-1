"use client";

import { useEffect, useRef, useState } from "react";
import { getUserPlan, type PlanType } from "@/app/actions/plan-actions";

const PLAN_CACHE_KEY = "user_plan_cache";
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

type PlanCacheEntry = { plan: PlanType; timestamp: number };

function readPlanCache(): PlanCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem(PLAN_CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as PlanCacheEntry;
    if (parsed && typeof parsed.plan === "string" && typeof parsed.timestamp === "number") {
      return parsed;
    }
  } catch (error) {
    console.error("Error reading cached plan:", error);
  }
  return null;
}

function cachePlan(plan: PlanType): PlanCacheEntry | null {
  if (typeof window === "undefined") return null;
  const entry: PlanCacheEntry = { plan, timestamp: Date.now() };
  try {
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(entry));
  } catch (error) {
    console.error("Error caching plan:", error);
  }
  return entry;
}

export function useUserPlan() {
  // Start from a stable server/client default to avoid hydration mismatches.
  const cacheRef = useRef<PlanCacheEntry | null>(null);
  const [plan, setPlan] = useState<PlanType>("free");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // First: try cache from localStorage after mount (client only)
    const cached = readPlanCache();
    if (cached) {
      cacheRef.current = cached;
      setPlan(cached.plan);
      const stillValid = Date.now() - cached.timestamp < PLAN_CACHE_TTL_MS;
      if (stillValid) {
        setIsLoading(false);
        return;
      }
    }

    async function loadPlan() {
      try {
        const userPlan = await getUserPlan();
        if (cancelled) return;
        setPlan(userPlan);
        cacheRef.current = cachePlan(userPlan) ?? { plan: userPlan, timestamp: Date.now() };
      } catch (error) {
        console.error("Error loading user plan:", error);
        if (!cancelled) {
          setPlan("free");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadPlan();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshPlan = async () => {
    setIsLoading(true);
    try {
      const userPlan = await getUserPlan();
      setPlan(userPlan);
      cacheRef.current = cachePlan(userPlan) ?? { plan: userPlan, timestamp: Date.now() };
    } catch (error) {
      console.error("Error refreshing user plan:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return { plan, isLoading, refreshPlan };
}
