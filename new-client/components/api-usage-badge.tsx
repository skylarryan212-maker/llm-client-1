"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DollarSign, AlertTriangle } from "lucide-react";
import { getMonthlySpending } from "@/app/actions/usage-actions";
import { getUserPlan } from "@/app/actions/plan-actions";
import { getUsageStatus } from "@/lib/usage-limits";
import { useUserIdentity } from "@/components/user-identity-provider";
import { useUsageSnapshot } from "@/components/usage-snapshot-provider";

type UsageStatus = ReturnType<typeof getUsageStatus>;

type UsageCacheEntry = {
  spending: number;
  status: UsageStatus;
  timestamp: number;
};

let lastKnownUsage: { spending: number; status: UsageStatus } | null = null;

const USAGE_CACHE_KEY = "api_usage_cache_v1";

function readUsageCache(): UsageCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USAGE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.spending === "number" &&
      parsed.status &&
      typeof parsed.timestamp === "number"
    ) {
      return parsed as UsageCacheEntry;
    }
  } catch (err) {
    console.error("Error reading usage cache:", err);
  }
  return null;
}

function writeUsageCache(spending: number, status: UsageStatus) {
  if (typeof window === "undefined") return;
  try {
    const entry: UsageCacheEntry = { spending, status, timestamp: Date.now() };
    localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(entry));
  } catch (err) {
    console.error("Error writing usage cache:", err);
  }
}

export function ApiUsageBadge() {
  const { isGuest } = useUserIdentity();
  const pathname = usePathname();
  const initialSnapshot = useUsageSnapshot();

  const [spending, setSpending] = useState<number | null>(
    lastKnownUsage?.spending ?? initialSnapshot?.spending ?? null
  );
  const [usageStatus, setUsageStatus] = useState<UsageStatus | null>(
    lastKnownUsage?.status ?? initialSnapshot?.status ?? null
  );

  const loadData = useCallback(async () => {
    try {
      const [monthlyTotal, plan] = await Promise.all([getMonthlySpending(), getUserPlan()]);
      const status = getUsageStatus(monthlyTotal, plan);
      lastKnownUsage = { spending: monthlyTotal, status };
      setSpending(monthlyTotal);
      setUsageStatus(status);
      writeUsageCache(monthlyTotal, status);
    } catch (error) {
      console.error("Error loading usage data:", error);
    }
  }, []);

  // After hydration, prefer cached values (if any) without causing an SSR/client mismatch.
  useEffect(() => {
    if (lastKnownUsage) return;
    const cached = readUsageCache();
    if (!cached) return;
    lastKnownUsage = { spending: cached.spending, status: cached.status };
    setSpending(cached.spending);
    setUsageStatus(cached.status);
  }, []);

  // Seed from SSR snapshot only if no cache exists (prevents flashing back to stale snapshot values).
  useEffect(() => {
    if (!initialSnapshot) return;
    if (lastKnownUsage) return;
    if (readUsageCache()) return;
    const seededStatus = initialSnapshot.status as UsageStatus;
    lastKnownUsage = { spending: initialSnapshot.spending, status: seededStatus };
    setSpending(initialSnapshot.spending);
    setUsageStatus(seededStatus);
    writeUsageCache(initialSnapshot.spending, seededStatus);
  }, [initialSnapshot]);

  // Listen for usage update events.
  useEffect(() => {
    const handleUsageUpdate = () => {
      loadData();
    };

    window.addEventListener("api-usage-updated", handleUsageUpdate);
    return () => {
      window.removeEventListener("api-usage-updated", handleUsageUpdate);
    };
  }, [loadData]);

  // On URL/path change: keep current value visible; fetch fresh and update when ready.
  useEffect(() => {
    loadData();
  }, [pathname, loadData]);

  if (isGuest || !usageStatus || spending === null) {
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
