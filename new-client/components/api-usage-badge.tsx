"use client";

import { useState, useEffect } from "react";
import { DollarSign, AlertTriangle } from "lucide-react";
import { getMonthlySpending } from "@/app/actions/usage-actions";
import { getUserPlan } from "@/app/actions/plan-actions";
import { getUsageStatus } from "@/lib/usage-limits";
import { useUserIdentity } from "@/components/user-identity-provider";
import { useUsageSnapshot } from "@/components/usage-snapshot-provider";

export function ApiUsageBadge() {
  const { isGuest } = useUserIdentity();
  const initialSnapshot = useUsageSnapshot();
  const [spending, setSpending] = useState<number>(initialSnapshot?.spending ?? 0);
  const [usageStatus, setUsageStatus] = useState(initialSnapshot?.status ?? null);

  useEffect(() => {
    loadData();

    const handleUsageUpdate = () => {
      loadData();
    };

    window.addEventListener("api-usage-updated", handleUsageUpdate);
    return () => {
      window.removeEventListener("api-usage-updated", handleUsageUpdate);
    };
  }, []);

  const loadData = async () => {
    try {
      const [monthlyTotal, plan] = await Promise.all([
        getMonthlySpending(),
        getUserPlan(),
      ]);
      setSpending(monthlyTotal);
      const status = getUsageStatus(monthlyTotal, plan);
      setUsageStatus(status);
    } catch (error) {
      console.error("Error loading usage data:", error);
    }
  };

  if (isGuest || !usageStatus) {
    return null;
  }

  const { exceeded, warning, percentage, limit } = usageStatus;

  const statusColor = exceeded
    ? "border-red-500 bg-red-500/10 text-red-600 dark:text-red-400"
    : warning
    ? "border-yellow-500 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
    : percentage >= 80
    ? "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400"
    : "border-border bg-muted/50 text-muted-foreground";

  const restrictionLabel = exceeded
    ? "Limit reached"
    : percentage >= 95
    ? "Nano only"
    : percentage >= 90
    ? "Mini/Nano"
    : percentage >= 80
    ? "Flex mode"
    : null;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusColor}`}
    >
      {(exceeded || warning) && <AlertTriangle className="h-3 w-3" />}
      {!exceeded && !warning && <DollarSign className="h-3 w-3" />}
      <span className="tabular-nums">
        ${spending.toFixed(4)} / ${limit.toFixed(2)}
      </span>
      {restrictionLabel && (
        <span className="text-[10px] font-semibold">{restrictionLabel}</span>
      )}
    </div>
  );
}
