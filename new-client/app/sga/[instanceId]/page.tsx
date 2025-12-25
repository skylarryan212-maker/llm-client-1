export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { notFound, redirect } from "next/navigation";

import { SgaConsole } from "@/components/sga/sga-console";
import { loadSgaEvents, loadSgaInstance, loadSgaWorldState } from "@/lib/data/sga";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import type { SgaWorldState } from "@/lib/types/sga";

type PageProps = {
  params: Promise<{ instanceId: string }>;
};

function buildFallbackWorldState(instanceId: string, objective: string): SgaWorldState {
  return {
    instanceId,
    lastUpdatedAt: new Date().toISOString(),
    currentObjective: objective,
    constraints: [],
    riskRegister: [],
    capabilitiesSummary: [],
    openTasks: [],
    budgets: {
      dailyTimeBudgetHours: null,
      dailyCostBudgetUsd: null,
      todayEstimatedSpendUsd: null,
    },
  };
}

export default async function SgaInstancePage({ params }: PageProps) {
  const { instanceId } = await params;
  const userId = await getCurrentUserIdServer();
  if (!userId) {
    redirect(`/login?next=/sga/${instanceId}`);
  }

  const instance = await loadSgaInstance(instanceId);
  if (!instance) {
    notFound();
  }

  const [events, worldState] = await Promise.all([
    loadSgaEvents(instanceId, 50),
    loadSgaWorldState(instanceId),
  ]);

  const resolvedWorldState = worldState ?? buildFallbackWorldState(instanceId, instance.primaryObjective);

  return <SgaConsole instance={instance} events={events} worldState={resolvedWorldState} />;
}
