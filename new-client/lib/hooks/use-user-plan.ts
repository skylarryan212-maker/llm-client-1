"use client";

import { useEffect, useState } from "react";
import { getUserPlan, type PlanType } from "@/app/actions/plan-actions";

export function useUserPlan() {
  const [plan, setPlan] = useState<PlanType>("free");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadPlan() {
      try {
        const userPlan = await getUserPlan();
        setPlan(userPlan);
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
    } catch (error) {
      console.error("Error refreshing user plan:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return { plan, isLoading, refreshPlan };
}
