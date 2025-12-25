"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Plus, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SgaInstance, SgaStatus } from "@/lib/types/sga";

type SgaFleetProps = {
  initialInstances: SgaInstance[];
};

const STATUS_LABELS: Record<SgaStatus, string> = {
  idle: "Idle",
  analyzing: "Analyzing",
  planning: "Planning",
  coordinating: "Coordinating",
  executing: "Executing",
  paused: "Paused",
  error: "Error",
};

const ASSURANCE_LABELS: Record<SgaInstance["assuranceLevel"], string> = {
  0: "Fast",
  1: "Standard",
  2: "High",
  3: "Max",
};

function getStatusTone(status: SgaStatus) {
  switch (status) {
    case "executing":
      return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
    case "coordinating":
    case "planning":
    case "analyzing":
      return "border-sky-400/40 bg-sky-500/10 text-sky-100";
    case "paused":
      return "border-amber-400/40 bg-amber-500/10 text-amber-100";
    case "error":
      return "border-rose-400/40 bg-rose-500/10 text-rose-100";
    default:
      return "border-slate-400/40 bg-slate-500/10 text-slate-100";
  }
}

function formatRelativeTime(value: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(diffMinutes);
  const rtf = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl
    ? new Intl.RelativeTimeFormat("en", { numeric: "auto" })
    : null;

  if (absMinutes < 60) {
    return rtf ? rtf.format(diffMinutes, "minute") : `${Math.abs(diffMinutes)}m`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  const absHours = Math.abs(diffHours);
  if (absHours < 24) {
    return rtf ? rtf.format(diffHours, "hour") : `${Math.abs(diffHours)}h`;
  }
  const diffDays = Math.round(diffHours / 24);
  return rtf ? rtf.format(diffDays, "day") : `${Math.abs(diffDays)}d`;
}

function formatCurrency(value: number | null) {
  if (value === null || Number.isNaN(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function SgaFleet({ initialInstances }: SgaFleetProps) {
  const router = useRouter();
  const [instances, setInstances] = useState<SgaInstance[]>(initialInstances ?? []);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formName, setFormName] = useState("Self-Governing Agent");
  const [formEnvironment, setFormEnvironment] = useState("Prod App Ops");
  const [formAssurance, setFormAssurance] = useState<SgaInstance["assuranceLevel"]>(1);
  const [formTimeBudget, setFormTimeBudget] = useState("");
  const [formCostBudget, setFormCostBudget] = useState("");

  const activeCount = useMemo(
    () => instances.filter((instance) => instance.status !== "paused" && instance.status !== "idle").length,
    [instances]
  );

  const openCreate = () => {
    setError(null);
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setFormName("Self-Governing Agent");
    setFormEnvironment("Prod App Ops");
    setFormAssurance(1);
    setFormTimeBudget("");
    setFormCostBudget("");
  };

  const handleCreate = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sga/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim() || "Self-Governing Agent",
          environmentLabel: formEnvironment.trim() || "Primary Ops",
          assuranceLevel: formAssurance,
          dailyTimeBudgetHours: parseOptionalNumber(formTimeBudget),
          dailyCostBudgetUsd: parseOptionalNumber(formCostBudget),
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Failed to create SGA instance");
      }

      const payload = await res.json();
      const created = payload?.instance as SgaInstance | undefined;
      if (created) {
        setInstances((prev) => [created, ...prev]);
      }
      setIsDialogOpen(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create instance");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (instanceId: string) => {
    const current = instances.find((instance) => instance.id === instanceId);
    if (!current) return;
    const nextStatus: SgaStatus = current.status === "paused" ? "coordinating" : "paused";
    setError(null);
    try {
      const res = await fetch(`/api/sga/instances/${instanceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Failed to update status");
      }
      setInstances((prev) =>
        prev.map((instance) =>
          instance.id === instanceId ? { ...instance, status: nextStatus, updatedAt: new Date().toISOString() } : instance
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update status");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#05070b] via-[#050607] to-black text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8 space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-100">
              <ShieldCheck className="h-4 w-4" />
              SGA Fleet
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white">Self-Governing Agents</h1>
              <p className="mt-1 max-w-2xl text-base text-muted-foreground">
                Autonomous decision agents coordinating work across your environment.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="secondary" className="bg-sky-500/15 text-sky-100">
                {activeCount} active
              </Badge>
              <span className="text-muted-foreground/80">{instances.length} total</span>
            </div>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Create SGA Instance
          </Button>
        </header>
        {error && !isDialogOpen ? (
          <p className="text-sm text-rose-300">{error}</p>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-[1.55fr,0.95fr] gap-6">
          <section className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-card/50 p-5 shadow-lg shadow-black/30 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Active instances</h2>
                  <p className="text-sm text-muted-foreground">Monitor status, objectives, and budgets.</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {instances.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-background/70 p-6 text-center text-sm text-muted-foreground">
                    <p className="text-base font-semibold text-white">No SGAs yet</p>
                    <p className="mt-1">Create your first SGA to start coordinating work.</p>
                    <Button className="mt-4" onClick={openCreate}>
                      Create your first SGA
                    </Button>
                  </div>
                ) : (
                  instances.map((instance) => {
                    const statusTone = getStatusTone(instance.status);
                    const assuranceLabel = ASSURANCE_LABELS[instance.assuranceLevel];
                    const budgetSummary =
                      instance.todayEstimatedSpendUsd !== null
                        ? `Today: ${formatCurrency(instance.todayEstimatedSpendUsd)}`
                        : null;
                    return (
                      <div
                        key={instance.id}
                        className="rounded-xl border border-border/70 bg-background/70 p-4 transition hover:border-primary/30 hover:bg-background/80"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-semibold text-white">{instance.name}</h3>
                              <Badge variant="outline" className={cn("border px-2 py-0.5 text-[11px] font-semibold", statusTone)}>
                                {STATUS_LABELS[instance.status]}
                              </Badge>
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">
                                Assurance {instance.assuranceLevel} - {assuranceLabel}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {instance.environmentLabel}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {instance.primaryObjective}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span>Last decision {formatRelativeTime(instance.lastDecisionAt)}</span>
                              {budgetSummary ? <span>{budgetSummary}</span> : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`/sga/${instance.id}`)}
                            >
                              Open console
                            </Button>
                            <Button
                              variant={instance.status === "paused" ? "secondary" : "ghost"}
                              size="sm"
                              className="gap-1"
                              onClick={() => handleToggleStatus(instance.id)}
                            >
                              {instance.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                              {instance.status === "paused" ? "Resume" : "Pause"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-sky-500/30 bg-gradient-to-b from-sky-500/15 via-sky-500/10 to-background p-5 shadow-lg shadow-sky-900/30">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-sky-200/80">Global policies</p>
                  <h3 className="text-lg font-semibold text-white">Fleet guardrails</h3>
                </div>
                <Badge variant="outline" className="border-sky-400/40 text-sky-100">
                  Active
                </Badge>
              </div>
              <ul className="space-y-3 text-sm text-slate-200/80">
                <li className="rounded-xl border border-white/5 bg-white/5 p-3">
                  Default: SGA runs with Assurance Level 1 (Standard) unless changed per instance.
                </li>
                <li className="rounded-xl border border-white/5 bg-white/5 p-3">
                  SGA never deploys code directly; it delegates to LHSA or human approval.
                </li>
                <li className="rounded-xl border border-white/5 bg-white/5 p-3">
                  All SGA actions are logged in an auditable timeline.
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </div>

      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Create SGA instance</h2>
            <p className="text-sm text-muted-foreground">Configure the baseline governance profile.</p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Name</label>
              <Input
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                placeholder="Self-Governing Agent"
                className="bg-background/60"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Environment label</label>
              <Input
                value={formEnvironment}
                onChange={(event) => setFormEnvironment(event.target.value)}
                placeholder="Prod App Ops"
                className="bg-background/60"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Assurance level</label>
              <Select value={String(formAssurance)} onValueChange={(value) => setFormAssurance(Number(value) as SgaInstance["assuranceLevel"])}>
                <SelectTrigger className="w-full bg-background/60">
                  <SelectValue placeholder="Select assurance" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="0">Assurance 0 - Fast</SelectItem>
                  <SelectItem value="1">Assurance 1 - Standard</SelectItem>
                  <SelectItem value="2">Assurance 2 - High</SelectItem>
                  <SelectItem value="3">Assurance 3 - Max</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Daily time budget (hrs)</label>
                <Input
                  type="number"
                  value={formTimeBudget}
                  onChange={(event) => setFormTimeBudget(event.target.value)}
                  placeholder="6"
                  className="bg-background/60"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Daily cost budget (USD)</label>
                <Input
                  type="number"
                  value={formCostBudget}
                  onChange={(event) => setFormCostBudget(event.target.value)}
                  placeholder="120"
                  className="bg-background/60"
                />
              </div>
            </div>
          </div>
          {error ? <p className="text-xs text-rose-300">{error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving ? "Creating..." : "Create instance"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
