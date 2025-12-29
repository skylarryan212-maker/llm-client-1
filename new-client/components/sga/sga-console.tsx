"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ChevronDown,
  Clock3,
  ListChecks,
  MessageCircle,
  Pause,
  Play,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Json } from "@/lib/supabase/types";
import type {
  SgaConnection,
  SgaConnectionPermission,
  SgaEvent,
  SgaInstance,
  SgaPolicy,
  SgaStatus,
  SgaWorldState,
} from "@/lib/types/sga";

type SgaConsoleProps = {
  instance: SgaInstance;
  events: SgaEvent[];
  worldState: SgaWorldState;
};

type SgaMessage = {
  id: string;
  role: "user" | "sga";
  content: string;
  createdAt: string;
  metadata: Json | null;
};

type SgaMessageRow = {
  id: string;
  role: string | null;
  content?: string | null;
  created_at?: string | null;
  metadata?: Json | null;
};

type ConstraintSource = "User" | "Policy" | "Safety";
type DecisionStatus = "NOOP" | "Delegating" | "Executing" | "Waiting approval" | "Paused";
type RunPhase = "paused" | "waiting" | "running";

type CollapsibleCardProps = {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
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

const EVENT_KIND_LABELS: Record<SgaEvent["kind"], string> = {
  situation_scan: "Situation Scan",
  risk_update: "Risk Update",
  plan_update: "Plan Update",
  delegated_task: "Delegated Task",
  external_action: "External Action",
  verification: "Verification",
  human_feedback: "Human Feedback",
  system_pause: "System Pause",
  system_resume: "System Resume",
  error: "Error",
};

const baseBottomSpacerPx = 28;
const DEFAULT_INDICATOR_LABEL = "Thinking";
const DEFAULT_SGA_GREETING = "Standing by for governance directives and timeline updates.";

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

function getDecisionTone(status: DecisionStatus) {
  switch (status) {
    case "Executing":
      return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
    case "Delegating":
      return "border-sky-400/40 bg-sky-500/10 text-sky-100";
    case "Waiting approval":
      return "border-amber-400/40 bg-amber-500/10 text-amber-100";
    case "Paused":
      return "border-slate-400/40 bg-slate-500/10 text-slate-100";
    default:
      return "border-white/20 bg-white/5 text-white/80";
  }
}

function getSeverityTone(severity?: SgaEvent["severity"]) {
  switch (severity) {
    case "high":
      return "border-rose-400/40 bg-rose-500/10 text-rose-100";
    case "medium":
      return "border-amber-400/40 bg-amber-500/10 text-amber-100";
    case "low":
      return "border-sky-400/40 bg-sky-500/10 text-sky-100";
    default:
      return "border-slate-400/40 bg-slate-500/10 text-slate-100";
  }
}

function formatTime(value: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatCurrency(value: number | null) {
  if (value === null || Number.isNaN(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

function formatHours(value: number | null) {
  if (value === null || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)}h`;
}

function getModeLabel(status: SgaStatus) {
  switch (status) {
    case "analyzing":
      return "Analyzing";
    case "planning":
      return "Planning";
    case "coordinating":
      return "Delegating";
    case "executing":
      return "Executing";
    case "paused":
      return "Paused";
    case "error":
      return "Incident";
    default:
      return "Monitoring";
  }
}

function inferConstraintSource(constraint: string): ConstraintSource {
  const normalized = constraint.toLowerCase();
  if (normalized.includes("safety") || normalized.includes("security")) return "Safety";
  if (normalized.includes("policy") || normalized.includes("do not") || normalized.includes("never")) return "Policy";
  return "User";
}

function getConstraintTone(source: ConstraintSource) {
  switch (source) {
    case "Policy":
      return "border-indigo-400/40 bg-indigo-500/10 text-indigo-100";
    case "Safety":
      return "border-rose-400/40 bg-rose-500/10 text-rose-100";
    default:
      return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
  }
}

function getRiskTone(level: "low" | "medium" | "high") {
  switch (level) {
    case "high":
      return "border-rose-400/40 bg-rose-500/10 text-rose-100";
    case "medium":
      return "border-amber-400/40 bg-amber-500/10 text-amber-100";
    default:
      return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
  }
}

function formatElapsed(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatRemaining(minutes: number | null) {
  if (minutes === null) return "n/a";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours > 0) return `${hours}h ${remainder}m`;
  return `${remainder}m`;
}

function asMetadataRecord(value: Json | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
function generateId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function CollapsibleCard({ title, subtitle, icon, isOpen, onToggle, children }: CollapsibleCardProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/50 p-4 shadow-lg shadow-black/20 backdrop-blur">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-4 text-left">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-100">
            {icon}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{isOpen ? "Collapse" : "View details"}</span>
          <ChevronDown className={cn("h-4 w-4 transition", isOpen ? "rotate-180" : "rotate-0")} />
        </div>
      </button>
      {isOpen ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

type SettingsSheetProps = {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  assuranceLevel: SgaInstance["assuranceLevel"];
  authorityLevel: SgaInstance["authorityLevel"];
  dailyTimeBudgetHours: number | null;
  dailyCostBudgetUsd: number | null;
  policy: SgaPolicy;
  connections: SgaConnection[];
  onAssuranceChange: (value: string) => void;
  onAuthorityChange: (value: string) => void;
  onPolicySaved: (policy: SgaPolicy) => void;
};

type ConnectionDraft = {
  id: string;
  name: string;
  baseUrl: string;
  permission: SgaConnectionPermission;
  allowList: string;
  denyList: string;
  readEndpoints: string;
  headers: string;
  authType: SgaConnection["authType"];
  authHeader: string;
  authValue: string;
  hasAuthValue: boolean;
};

const DEFAULT_POLICY: SgaPolicy = {
  allowedActions: ["delegate_lhsa", "delegate_ada", "schedule_recheck", "write_low_risk_config"],
  forbiddenActions: ["delete_production_data", "rotate_secrets", "deploy_to_prod_directly"],
  approvalRequiredActions: ["database_migrations", "billing_plan_changes", "security_policy_changes"],
  riskBudget: { maxHighRiskActionsPerWeek: 0, maxMediumRiskPerDay: 3 },
  costBudget: { monthlyUsdCap: 500, dailyUsdCap: 25, perTaskUsdCap: 50 },
  timeBudget: { dailyActiveWindowMinutes: 480, maxCycleSeconds: 60 },
  throttleRules: {
    minMinutesBetweenCyclesNormal: 15,
    minMinutesBetweenCyclesAlert: 2,
    maxCyclesPerDay: 200,
  },
};

function parseListInput(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatHeadersInput(headers: Record<string, string> | undefined) {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function parseHeadersInput(value: string) {
  const headers: Record<string, string> = {};
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [key, ...rest] = line.split(":");
      if (!key) return;
      const cleanedKey = key.trim();
      const cleanedValue = rest.join(":").trim();
      if (!cleanedKey || !cleanedValue) return;
      headers[cleanedKey] = cleanedValue;
    });
  return headers;
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

function SettingsSheet({
  open,
  onClose,
  instanceId,
  assuranceLevel,
  authorityLevel,
  dailyTimeBudgetHours,
  dailyCostBudgetUsd,
  policy,
  connections,
  onAssuranceChange,
  onAuthorityChange,
  onPolicySaved,
}: SettingsSheetProps) {
  const [policyDraft, setPolicyDraft] = useState<SgaPolicy>(policy ?? DEFAULT_POLICY);
  const [connectionsDraft, setConnectionsDraft] = useState<ConnectionDraft[]>([]);
  const [budgetTime, setBudgetTime] = useState<string>("");
  const [budgetCost, setBudgetCost] = useState<string>("");
  const [monthlyCost, setMonthlyCost] = useState<string>("");
  const [perTaskCost, setPerTaskCost] = useState<string>("");
  const [dailyWindowMinutes, setDailyWindowMinutes] = useState<string>("");
  const [maxCycleSeconds, setMaxCycleSeconds] = useState<string>("");
  const [maxHighRiskPerWeek, setMaxHighRiskPerWeek] = useState<string>("");
  const [maxMediumRiskPerDay, setMaxMediumRiskPerDay] = useState<string>("");
  const [throttleNormal, setThrottleNormal] = useState<string>("");
  const [throttleAlert, setThrottleAlert] = useState<string>("");
  const [maxCyclesPerDay, setMaxCyclesPerDay] = useState<string>("");
  const [allowedActions, setAllowedActions] = useState("");
  const [forbiddenActions, setForbiddenActions] = useState("");
  const [approvalActions, setApprovalActions] = useState("");
  const [savingBudgets, setSavingBudgets] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingConnections, setSavingConnections] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const basePolicy = policy ?? DEFAULT_POLICY;
    setPolicyDraft(basePolicy);
    setBudgetTime(dailyTimeBudgetHours !== null ? String(dailyTimeBudgetHours) : "");
    setBudgetCost(dailyCostBudgetUsd !== null ? String(dailyCostBudgetUsd) : "");
    setMonthlyCost(String(basePolicy.costBudget.monthlyUsdCap));
    setPerTaskCost(String(basePolicy.costBudget.perTaskUsdCap));
    setDailyWindowMinutes(String(basePolicy.timeBudget.dailyActiveWindowMinutes));
    setMaxCycleSeconds(String(basePolicy.timeBudget.maxCycleSeconds));
    setMaxHighRiskPerWeek(String(basePolicy.riskBudget.maxHighRiskActionsPerWeek));
    setMaxMediumRiskPerDay(String(basePolicy.riskBudget.maxMediumRiskPerDay));
    setThrottleNormal(String(basePolicy.throttleRules.minMinutesBetweenCyclesNormal));
    setThrottleAlert(String(basePolicy.throttleRules.minMinutesBetweenCyclesAlert));
    setMaxCyclesPerDay(String(basePolicy.throttleRules.maxCyclesPerDay));
    setAllowedActions(basePolicy.allowedActions.join(", "));
    setForbiddenActions(basePolicy.forbiddenActions.join(", "));
    setApprovalActions(basePolicy.approvalRequiredActions.join(", "));
    setConnectionsDraft(
      (connections ?? []).map((conn) => ({
        id: conn.id,
        name: conn.name,
        baseUrl: conn.baseUrl ?? "",
        permission: conn.permission,
        allowList: conn.allowList.join(", "),
        denyList: conn.denyList.join(", "),
        readEndpoints: conn.readEndpoints?.join(", ") ?? "",
        headers: formatHeadersInput(conn.headers),
        authType: conn.authType ?? "none",
        authHeader: conn.authHeader ?? "",
        authValue: "",
        hasAuthValue: !!conn.hasAuthValue,
      }))
    );
    setSaveError(null);
  }, [open, policy, connections, dailyTimeBudgetHours, dailyCostBudgetUsd]);

  const handleSaveBudgets = async () => {
    setSavingBudgets(true);
    setSaveError(null);
    const nextDailyTime = budgetTime.trim() === "" ? null : Number(budgetTime);
    const nextDailyCost = budgetCost.trim() === "" ? null : Number(budgetCost);
    const nextPolicy: SgaPolicy = {
      ...policyDraft,
      costBudget: {
        ...policyDraft.costBudget,
        monthlyUsdCap: Number(monthlyCost) || 0,
        dailyUsdCap: Number(budgetCost) || policyDraft.costBudget.dailyUsdCap,
        perTaskUsdCap: Number(perTaskCost) || 0,
      },
      timeBudget: {
        ...policyDraft.timeBudget,
        dailyActiveWindowMinutes: Number(dailyWindowMinutes) || 0,
        maxCycleSeconds: Number(maxCycleSeconds) || 0,
      },
      riskBudget: {
        maxHighRiskActionsPerWeek: Number(maxHighRiskPerWeek) || 0,
        maxMediumRiskPerDay: Number(maxMediumRiskPerDay) || 0,
      },
      throttleRules: {
        minMinutesBetweenCyclesNormal: Number(throttleNormal) || 0,
        minMinutesBetweenCyclesAlert: Number(throttleAlert) || 0,
        maxCyclesPerDay: Number(maxCyclesPerDay) || 0,
      },
    };
    try {
      const res = await fetch(`/api/sga/instances/${instanceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyTimeBudgetHours: nextDailyTime,
          dailyCostBudgetUsd: nextDailyCost,
          policy: nextPolicy,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to save budgets");
      }
      setPolicyDraft(nextPolicy);
      onPolicySaved(nextPolicy);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save budgets");
    } finally {
      setSavingBudgets(false);
    }
  };

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    setSaveError(null);
    const nextPolicy: SgaPolicy = {
      ...policyDraft,
      allowedActions: parseListInput(allowedActions),
      forbiddenActions: parseListInput(forbiddenActions),
      approvalRequiredActions: parseListInput(approvalActions),
    };
    try {
      const res = await fetch(`/api/sga/instances/${instanceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: nextPolicy }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to save policy");
      }
      setPolicyDraft(nextPolicy);
      onPolicySaved(nextPolicy);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSaveConnections = async () => {
    setSavingConnections(true);
    setSaveError(null);
    const nextConnections: SgaConnection[] = connectionsDraft.map((conn) => {
      const nextAuthValue = conn.authValue.trim();
      return {
        id: conn.id,
        name: conn.name.trim() || "Connection",
        baseUrl: normalizeBaseUrl(conn.baseUrl),
        permission: conn.permission,
        allowList: parseListInput(conn.allowList),
        denyList: parseListInput(conn.denyList),
        readEndpoints: parseListInput(conn.readEndpoints),
        headers: parseHeadersInput(conn.headers),
        authType: conn.authType,
        authHeader: conn.authHeader.trim() || null,
        authValue: nextAuthValue.length ? nextAuthValue : undefined,
      };
    });
    try {
      const res = await fetch(`/api/sga/instances/${instanceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connections: nextConnections }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to save connections");
      }
      setConnectionsDraft((prev) =>
        prev.map((conn) => ({
          ...conn,
          hasAuthValue: conn.hasAuthValue || conn.authValue.trim().length > 0,
          authValue: "",
        }))
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save connections");
    } finally {
      setSavingConnections(false);
    }
  };

  const handleAddConnection = () => {
    setConnectionsDraft((prev) => [
      ...prev,
      {
        id: `conn-${Date.now()}`,
        name: "",
        baseUrl: "",
        permission: "read",
        allowList: "",
        denyList: "",
        readEndpoints: "",
        headers: "",
        authType: "none",
        authHeader: "",
        authValue: "",
        hasAuthValue: false,
      },
    ]);
  };

  const updateConnection = (id: string, patch: Partial<ConnectionDraft>) => {
    setConnectionsDraft((prev) =>
      prev.map((conn) => (conn.id === id ? { ...conn, ...patch } : conn))
    );
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        role="presentation"
        onClick={onClose}
      />
      <div className="relative ml-auto flex h-full w-full max-w-2xl flex-col border-l border-white/10 bg-[#060708] px-6 py-6 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.28em] text-white/50">Settings</p>
            <h3 className="text-lg font-semibold text-white">Self-Governing Agent</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-6 space-y-5 overflow-y-auto pr-2">
          {saveError ? <p className="text-xs text-rose-300">{saveError}</p> : null}

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">Governance</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Assurance level</label>
                <Select value={String(assuranceLevel)} onValueChange={onAssuranceChange}>
                  <SelectTrigger className="w-full bg-white/5 border-white/10 text-sm">
                    <SelectValue placeholder="Assurance level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Assurance 0 - Fast</SelectItem>
                    <SelectItem value="1">Assurance 1 - Standard</SelectItem>
                    <SelectItem value="2">Assurance 2 - High</SelectItem>
                    <SelectItem value="3">Assurance 3 - Max</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Authority level</label>
                <Select value={String(authorityLevel)} onValueChange={onAuthorityChange}>
                  <SelectTrigger className="w-full bg-white/5 border-white/10 text-sm">
                    <SelectValue placeholder="Authority level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">AL0 - Observe</SelectItem>
                    <SelectItem value="1">AL1 - Recommend</SelectItem>
                    <SelectItem value="2">AL2 - Execute Safe</SelectItem>
                    <SelectItem value="3">AL3 - Execute Extended</SelectItem>
                    <SelectItem value="4">AL4 - Override</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">Budgets & time</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Daily time budget (hrs)</label>
                <Input
                  value={budgetTime}
                  onChange={(event) => setBudgetTime(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Daily cost budget (USD)</label>
                <Input
                  value={budgetCost}
                  onChange={(event) => setBudgetCost(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Monthly cost cap (USD)</label>
                <Input
                  value={monthlyCost}
                  onChange={(event) => setMonthlyCost(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Per-task cost cap (USD)</label>
                <Input
                  value={perTaskCost}
                  onChange={(event) => setPerTaskCost(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Active window (minutes)</label>
                <Input
                  value={dailyWindowMinutes}
                  onChange={(event) => setDailyWindowMinutes(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Max cycle seconds</label>
                <Input
                  value={maxCycleSeconds}
                  onChange={(event) => setMaxCycleSeconds(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Max high-risk actions / week</label>
                <Input
                  value={maxHighRiskPerWeek}
                  onChange={(event) => setMaxHighRiskPerWeek(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Max medium-risk actions / day</label>
                <Input
                  value={maxMediumRiskPerDay}
                  onChange={(event) => setMaxMediumRiskPerDay(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Min minutes between cycles (normal)</label>
                <Input
                  value={throttleNormal}
                  onChange={(event) => setThrottleNormal(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Min minutes between cycles (alert)</label>
                <Input
                  value={throttleAlert}
                  onChange={(event) => setThrottleAlert(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Max cycles per day</label>
                <Input
                  value={maxCyclesPerDay}
                  onChange={(event) => setMaxCyclesPerDay(event.target.value)}
                  type="number"
                  min="0"
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleSaveBudgets} disabled={savingBudgets}>
              {savingBudgets ? "Saving..." : "Save budgets"}
            </Button>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">Policy permissions</p>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Allowed actions</label>
              <Textarea
                value={allowedActions}
                onChange={(event) => setAllowedActions(event.target.value)}
                className="bg-white/5 border-white/10 text-sm"
                placeholder="delegate_lhsa, delegate_ada"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Forbidden actions</label>
              <Textarea
                value={forbiddenActions}
                onChange={(event) => setForbiddenActions(event.target.value)}
                className="bg-white/5 border-white/10 text-sm"
                placeholder="deploy_to_prod_directly"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Approval required actions</label>
              <Textarea
                value={approvalActions}
                onChange={(event) => setApprovalActions(event.target.value)}
                className="bg-white/5 border-white/10 text-sm"
                placeholder="database_migrations"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleSavePolicy} disabled={savingPolicy}>
              {savingPolicy ? "Saving..." : "Save policy"}
            </Button>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">Connections & permissions</p>
              <Button variant="outline" size="sm" onClick={handleAddConnection}>
                Add connection
              </Button>
            </div>
            {connectionsDraft.length === 0 ? (
              <p className="text-sm text-muted-foreground">No connections configured yet.</p>
            ) : (
              <div className="space-y-4">
                {connectionsDraft.map((conn) => (
                  <div key={conn.id} className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Connection name</label>
                        <Input
                          value={conn.name}
                          onChange={(event) => updateConnection(conn.id, { name: event.target.value })}
                          className="bg-white/5 border-white/10 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Base URL</label>
                        <Input
                          value={conn.baseUrl}
                          onChange={(event) => updateConnection(conn.id, { baseUrl: event.target.value })}
                          className="bg-white/5 border-white/10 text-sm"
                          placeholder="https://api.example.com"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Permission</label>
                        <Select
                          value={conn.permission}
                          onValueChange={(value) =>
                            updateConnection(conn.id, { permission: value as SgaConnectionPermission })
                          }
                        >
                          <SelectTrigger className="w-full bg-white/5 border-white/10 text-sm">
                            <SelectValue placeholder="Permission" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="read">Read only</SelectItem>
                            <SelectItem value="write">Write only</SelectItem>
                            <SelectItem value="read_write">Read + write</SelectItem>
                            <SelectItem value="custom">Custom</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Auth type</label>
                        <Select
                          value={conn.authType}
                          onValueChange={(value) =>
                            updateConnection(conn.id, { authType: value as SgaConnection["authType"] })
                          }
                        >
                          <SelectTrigger className="w-full bg-white/5 border-white/10 text-sm">
                            <SelectValue placeholder="Auth type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="api_key">API key</SelectItem>
                            <SelectItem value="bearer">Bearer token</SelectItem>
                            <SelectItem value="basic">Basic auth</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Auth header</label>
                        <Input
                          value={conn.authHeader}
                          onChange={(event) => updateConnection(conn.id, { authHeader: event.target.value })}
                          className="bg-white/5 border-white/10 text-sm"
                          placeholder="Authorization"
                          disabled={conn.authType === "none"}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Auth value</label>
                        <Input
                          value={conn.authValue}
                          onChange={(event) => updateConnection(conn.id, { authValue: event.target.value })}
                          className="bg-white/5 border-white/10 text-sm"
                          type="password"
                          placeholder={conn.hasAuthValue ? "Stored (leave blank to keep)" : "Enter token"}
                          disabled={conn.authType === "none"}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Read endpoints</label>
                        <Textarea
                          value={conn.readEndpoints}
                          onChange={(event) => updateConnection(conn.id, { readEndpoints: event.target.value })}
                          className="bg-white/5 border-white/10 text-sm"
                          placeholder="/metrics/summary, /events"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Headers (key: value)</label>
                        <Textarea
                          value={conn.headers}
                          onChange={(event) => updateConnection(conn.id, { headers: event.target.value })}
                          className="bg-white/5 border-white/10 text-sm"
                          placeholder="x-team: ops"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Allow list</label>
                        <Textarea
                          value={conn.allowList}
                          onChange={(event) => updateConnection(conn.id, { allowList: event.target.value })}
                          className="bg-white/5 border-white/10 text-sm"
                          placeholder="metrics.read, events.read"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Deny list</label>
                        <Textarea
                          value={conn.denyList}
                          onChange={(event) => updateConnection(conn.id, { denyList: event.target.value })}
                          className="bg-white/5 border-white/10 text-sm"
                          placeholder="billing.write"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={handleSaveConnections} disabled={savingConnections}>
              {savingConnections ? "Saving..." : "Save connections"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SgaConsole({ instance, events, worldState }: SgaConsoleProps) {
  const [status, setStatus] = useState<SgaStatus>(instance.status);
  const [assuranceLevel, setAssuranceLevel] = useState<SgaInstance["assuranceLevel"]>(instance.assuranceLevel);
  const [authorityLevel, setAuthorityLevel] = useState<SgaInstance["authorityLevel"]>(instance.authorityLevel);
  const [messages, setMessages] = useState<SgaMessage[]>(() => [
    {
      id: "sga-greeting",
      role: "sga",
      content: DEFAULT_SGA_GREETING,
      createdAt: new Date().toISOString(),
      metadata: null,
    },
  ]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [openSections, setOpenSections] = useState({
    objective: false,
    constraints: false,
    risks: false,
    delegations: false,
    capabilities: false,
    timeline: false,
  });
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [eventsState, setEventsState] = useState<SgaEvent[]>(events);
  const [worldStateState, setWorldStateState] = useState<SgaWorldState>(worldState);
  const [policyState, setPolicyState] = useState<SgaPolicy>(instance.policy ?? DEFAULT_POLICY);
  const [lastRunAtState, setLastRunAtState] = useState<number | null>(null);
  const [nextRunLabel, setNextRunLabel] = useState<string>("--");
  const [runPhase, setRunPhase] = useState<RunPhase>("waiting");
  const [pausedRemainingMsState, setPausedRemainingMsState] = useState<number | null>(null);

  const replyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const runIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runInFlightRef = useRef(false);
  const lastRunAtRef = useRef<number | null>(null);
  const pausedRemainingMsRef = useRef<number | null>(null);

  useEffect(() => {
    setEventsState(events);
  }, [events]);

  useEffect(() => {
    setWorldStateState(worldState);
  }, [worldState]);

  useEffect(() => {
    setPolicyState(instance.policy ?? DEFAULT_POLICY);
  }, [instance.policy]);

  useEffect(() => {
    if (status === "paused" || status === "idle") {
      setRunPhase("paused");
    } else {
      setRunPhase((prev) => (prev === "running" ? prev : "waiting"));
    }
  }, [status]);

  useEffect(() => {
    const fallback =
      instance.lastDecisionAt ??
      worldStateState.lastUpdatedAt ??
      null;
    if (!fallback) return;
    const ts = new Date(fallback).getTime();
    if (!Number.isNaN(ts)) {
      lastRunAtRef.current = ts;
      setLastRunAtState(ts);
    }
  }, [instance.lastDecisionAt, worldStateState.lastUpdatedAt]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [eventsState.length]);

  useEffect(() => {
    return () => {
      if (replyTimeoutRef.current) {
        clearTimeout(replyTimeoutRef.current);
      }
    };
  }, []);

  const groupedEvents = useMemo(() => {
    if (!eventsState?.length) return [] as { dateLabel: string; events: SgaEvent[] }[];
    const sorted = [...eventsState].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const groups: { dateLabel: string; events: SgaEvent[] }[] = [];
    sorted.forEach((event) => {
      const dateLabel = formatDate(event.createdAt);
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.dateLabel !== dateLabel) {
        groups.push({ dateLabel, events: [event] });
      } else {
        lastGroup.events.push(event);
      }
    });
    return groups;
  }, [eventsState]);

  const latestEvent = useMemo(() => {
    if (!eventsState?.length) return null;
    return [...eventsState].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }, [eventsState]);

  const currentTask = useMemo(() => {
    return (
      worldStateState.openTasks.find((task) => task.status === "in_progress") ??
      worldStateState.openTasks.find((task) => task.status === "planned") ??
      null
    );
  }, [worldStateState.openTasks]);

  const pendingDelegations = useMemo(
    () => worldStateState.openTasks.filter((task) => task.status !== "done").length,
    [worldStateState.openTasks]
  );

  const policyConfig = policyState;

  const mergeEvents = useCallback((prev: SgaEvent[], incoming: SgaEvent[]) => {
    const map = new Map<string, SgaEvent>();
    const add = (event: SgaEvent) => {
      const key =
        event.id ||
        `${event.kind}-${event.createdAt}-${event.title}-${event.summary}`;
      map.set(key, event);
    };
    prev.forEach(add);
    incoming.forEach(add);
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, []);

  const refreshEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/sga/instances/${instance.id}/events`);
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        return;
      }
      if (Array.isArray(payload?.events) && payload.events.length > 0) {
        const incoming = payload.events as SgaEvent[];
        setEventsState((prev) => mergeEvents(prev, incoming));
        if (incoming.length > 0) {
          const latest = incoming.reduce((acc: SgaEvent | null, event: SgaEvent) => {
            if (!acc) return event;
            return new Date(event.createdAt).getTime() > new Date(acc.createdAt).getTime()
              ? event
              : acc;
          }, null);
          if (latest) {
            const ts = new Date(latest.createdAt).getTime();
            if (!Number.isNaN(ts)) {
              lastRunAtRef.current = ts;
              setLastRunAtState(ts);
            }
          }
        }
      }
    } catch {
      // Ignore refresh failures to avoid masking successful runs.
    }
  }, [instance.id]);


  const highestRisk = useMemo(() => {
    if (!worldStateState.riskRegister.length) return null;
    const priority: Record<"low" | "medium" | "high", number> = { low: 1, medium: 2, high: 3 };
    return worldStateState.riskRegister.reduce((acc, risk) =>
      priority[risk.level] > priority[acc.level] ? risk : acc
    );
  }, [worldStateState.riskRegister]);

  const confidenceScore = useMemo(() => {
    let score = 88;
    worldStateState.riskRegister.forEach((risk) => {
      if (risk.level === "high") score -= 20;
      if (risk.level === "medium") score -= 10;
    });
    return Math.max(52, Math.min(96, score));
  }, [worldStateState.riskRegister]);

  const focusThread = worldStateState.currentObjective || instance.primaryObjective;
  const hasBlockedTasks = useMemo(
    () => worldStateState.openTasks.some((task) => task.status === "blocked"),
    [worldStateState.openTasks]
  );
  const decisionStatus = useMemo<DecisionStatus>(() => {
    if (status === "paused") return "Paused";
    if (hasBlockedTasks) return "Waiting approval";
    if (status === "executing") return "Executing";
    if (pendingDelegations > 0 || status === "coordinating" || status === "planning") return "Delegating";
    return "NOOP";
  }, [status, hasBlockedTasks, pendingDelegations]);
  const isStopped = status === "paused" || status === "idle";
  const riskPosture = highestRisk ? `${highestRisk.level} risk` : "low risk";
  const confidenceLabel = `${confidenceScore}% confidence`;
  const modeTone = highestRisk?.level === "high" ? "Alert" : status === "paused" ? "Manual" : "Normal";
  const healthStatus =
    highestRisk?.level === "high" ? "Critical" : highestRisk?.level === "medium" ? "Degraded" : "Good";
  const healthDriver = highestRisk?.label ?? "No critical anomalies detected.";
  const budgetRemainingUsd =
    worldStateState.budgets.dailyCostBudgetUsd !== null && worldStateState.budgets.todayEstimatedSpendUsd !== null
      ? Math.max(0, worldStateState.budgets.dailyCostBudgetUsd - worldStateState.budgets.todayEstimatedSpendUsd)
      : null;

  const latestAction = latestEvent?.title ?? "Awaiting first operational cycle";
  const reasoningSnapshot = latestEvent?.summary ?? "No activity logged yet for this SGA.";
  const nextCycleMinutes = useMemo(() => {
    if (status === "paused") return null;
    if (highestRisk?.level === "high") return 2;
    if (highestRisk?.level === "medium") return 5;
    return 15;
  }, [status, highestRisk]);
  const cadenceMinutes = useMemo(() => {
    if (highestRisk?.level === "high") {
      return Math.max(1, policyConfig.throttleRules.minMinutesBetweenCyclesAlert || 2);
    }
    return Math.max(1, policyConfig.throttleRules.minMinutesBetweenCyclesNormal || 15);
  }, [highestRisk?.level, policyConfig.throttleRules.minMinutesBetweenCyclesAlert, policyConfig.throttleRules.minMinutesBetweenCyclesNormal]);
  const cadenceReason = isStopped
    ? "paused"
    : highestRisk?.level === "high"
      ? "alert cadence"
      : "default cadence";
  const nextCycleLabel = isStopped ? "Paused" : nextRunLabel;
  const lastRunLabel = lastRunAtState
    ? formatTime(new Date(lastRunAtState).toISOString())
    : "Not yet";
  const runPhaseLabel =
    runPhase === "running"
      ? "Calling APIs"
      : runPhase === "paused"
        ? "Paused"
        : "Waiting for next trigger";
  const timeRemainingMinutes = worldStateState.budgets.dailyTimeBudgetHours
    ? Math.round(worldStateState.budgets.dailyTimeBudgetHours * 60)
    : null;

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const runSgaCycle = useCallback(
    async (trigger: "manual" | "schedule") => {
      if (runInFlightRef.current || isStopped) return;
      runInFlightRef.current = true;
      setRunError(null);
      setRunPhase("running");
      try {
        const res = await fetch(`/api/sga/instances/${instance.id}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.error || "Failed to run SGA cycle");
        }
        if (payload?.worldState) {
          setWorldStateState(payload.worldState as SgaWorldState);
        }
        if (Array.isArray(payload?.events)) {
          setEventsState((prev) => mergeEvents(prev, payload.events as SgaEvent[]));
        } else if (payload?.event) {
          setEventsState((prev) => mergeEvents(prev, [payload.event as SgaEvent]));
        }
        setOpenSections((prev) => (prev.timeline ? prev : { ...prev, timeline: true }));
        await refreshEvents();
        const now = Date.now();
        lastRunAtRef.current = now;
        setLastRunAtState(now);
      } catch (err) {
        setRunError(err instanceof Error ? err.message : "Failed to run SGA cycle");
      } finally {
        runInFlightRef.current = false;
        setRunPhase(isStopped ? "paused" : "waiting");
      }
    },
    [instance.id, isStopped]
  );

  useEffect(() => {
    if (isStopped) {
      if (runIntervalRef.current) {
        clearInterval(runIntervalRef.current);
        runIntervalRef.current = null;
      }
      return;
    }

    const effectiveCadence = Math.max(1, cadenceMinutes || 15);
    const cadenceMs = effectiveCadence * 60 * 1000;
    if (pausedRemainingMsRef.current !== null) {
      const adjustedLastRun = Date.now() - (cadenceMs - pausedRemainingMsRef.current);
      lastRunAtRef.current = adjustedLastRun;
      setLastRunAtState(adjustedLastRun);
      pausedRemainingMsRef.current = null;
      setPausedRemainingMsState(null);
    }
    const shouldRunNow =
      !lastRunAtRef.current || Date.now() - lastRunAtRef.current >= cadenceMs;

    if (shouldRunNow) {
      runSgaCycle("manual");
    }

    if (runIntervalRef.current) {
      clearInterval(runIntervalRef.current);
    }

    runIntervalRef.current = setInterval(() => {
      const lastRun = lastRunAtRef.current;
      if (!lastRun || Date.now() - lastRun >= cadenceMs) {
        runSgaCycle("schedule");
      }
    }, Math.min(cadenceMs, 60000));

    return () => {
      if (runIntervalRef.current) {
        clearInterval(runIntervalRef.current);
        runIntervalRef.current = null;
      }
    };
  }, [cadenceMinutes, isStopped, runSgaCycle]);

  useEffect(() => {
    if (isStopped) {
      if (pausedRemainingMsState !== null) {
        const totalSeconds = Math.ceil(pausedRemainingMsState / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        setNextRunLabel(minutes <= 0 ? `${seconds}s` : `${minutes}m ${seconds.toString().padStart(2, "0")}s`);
      } else {
        setNextRunLabel("Paused");
      }
      return;
    }
    if (!cadenceMinutes) {
      setNextRunLabel("--");
      return;
    }

    const cadenceMs = cadenceMinutes * 60 * 1000;
    const formatCountdown = (ms: number) => {
      if (ms <= 0) return "now";
      const totalSeconds = Math.ceil(ms / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      if (minutes <= 0) return `${seconds}s`;
      return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
    };

    const updateLabel = () => {
      const lastRun = lastRunAtState ?? lastRunAtRef.current;
      const nextAt = lastRun ? lastRun + cadenceMs : Date.now() + cadenceMs;
      setNextRunLabel(formatCountdown(nextAt - Date.now()));
    };

    updateLabel();
    const timer = setInterval(updateLabel, 1000);
    return () => clearInterval(timer);
  }, [cadenceMinutes, isStopped, lastRunAtState]);

  useEffect(() => {
    if (!isStopped) return;
    if (pausedRemainingMsRef.current !== null) return;
    const cadenceMs = cadenceMinutes ? cadenceMinutes * 60 * 1000 : null;
    if (cadenceMs) {
      const lastRun = lastRunAtRef.current ?? Date.now();
      const remaining = Math.max(0, cadenceMs - (Date.now() - lastRun));
      pausedRemainingMsRef.current = remaining;
      setPausedRemainingMsState(remaining);
    } else {
      pausedRemainingMsRef.current = null;
      setPausedRemainingMsState(null);
    }
  }, [cadenceMinutes, isStopped]);

  const handleToggleStatus = async () => {
    const nextStatus: SgaStatus = isStopped ? "coordinating" : "paused";
    setStatusSaving(true);
    setSettingsError(null);
    setRunError(null);
    try {
      const res = await fetch(`/api/sga/instances/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to update status");
      }
      setStatus(nextStatus);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Unable to update status");
    } finally {
      setStatusSaving(false);
    }
  };

  const handleAssuranceChange = async (value: string) => {
    const nextValue = Number(value) as SgaInstance["assuranceLevel"];
    const prev = assuranceLevel;
    setAssuranceLevel(nextValue);
    setSettingsError(null);
    try {
      const res = await fetch(`/api/sga/instances/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assuranceLevel: nextValue }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to update assurance level");
      }
    } catch (err) {
      setAssuranceLevel(prev);
      setSettingsError(err instanceof Error ? err.message : "Unable to update assurance level");
    }
  };

  const handleAuthorityChange = async (value: string) => {
    const nextValue = Number(value) as SgaInstance["authorityLevel"];
    const prev = authorityLevel;
    setAuthorityLevel(nextValue);
    setSettingsError(null);
    try {
      const res = await fetch(`/api/sga/instances/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorityLevel: nextValue }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to update authority level");
      }
    } catch (err) {
      setAuthorityLevel(prev);
      setSettingsError(err instanceof Error ? err.message : "Unable to update authority level");
    }
  };

  const persistChatMessage = useCallback(
    async (payload: { role: "user" | "agent"; content: string }) => {
      try {
        const res = await fetch(`/api/sga/instances/${instance.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error || "Failed to save chat message");
        }
        return body?.message ?? null;
      } catch (err) {
        setChatError(err instanceof Error ? err.message : "Failed to save chat message");
        return null;
      }
    },
    [instance.id]
  );

  const handleSend = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    setChatError(null);
    const createdAt = new Date().toISOString();
    const outgoing: SgaMessage = {
      id: generateId(),
      role: "user",
      content: trimmed,
      createdAt,
      metadata: null,
    };
    setMessages((prev) => [...prev, outgoing]);
    void persistChatMessage({ role: "user", content: trimmed });

    if (replyTimeoutRef.current) {
      clearTimeout(replyTimeoutRef.current);
    }
    replyTimeoutRef.current = setTimeout(() => {
      const inbound: SgaMessage = {
        id: generateId(),
        role: "sga",
        content: "Acknowledged. Logging this for the next decision cycle.",
        createdAt: new Date().toISOString(),
        metadata: null,
      };
      setMessages((prev) => [...prev, inbound]);
      void persistChatMessage({ role: "agent", content: inbound.content });
      // TODO: Replace mock response with real SGA response pipeline.
    }, 700);
    return outgoing.id;
  };

  useEffect(() => {
    let cancelled = false;
    const loadMessages = async () => {
      setIsLoadingMessages(true);
      setChatError(null);
      try {
        const res = await fetch(`/api/sga/instances/${instance.id}/messages`);
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error ?? "Failed to load chat");
        }
        const items: SgaMessageRow[] = Array.isArray(payload?.messages)
          ? (payload.messages as SgaMessageRow[])
          : [];
        items.sort(
          (a: SgaMessageRow, b: SgaMessageRow) =>
            new Date(a.created_at || "").getTime() - new Date(b.created_at || "").getTime()
        );
        const mapped: SgaMessage[] = items.map((msg) => ({
          id: msg.id,
          role: msg.role === "user" ? "user" : "sga",
          content: msg.content ?? "",
          createdAt: msg.created_at ?? new Date().toISOString(),
          metadata: msg.metadata ?? null,
        }));
        if (!cancelled && mapped.length) {
          setMessages((prev) => {
            const mappedIds = new Set(mapped.map((msg) => msg.id));
            const extras = prev.filter(
              (msg) => msg.id !== "sga-greeting" && !mappedIds.has(msg.id)
            );
            return extras.length ? [...mapped, ...extras] : mapped;
          });
        }
      } catch (err) {
        if (!cancelled) {
          setChatError(err instanceof Error ? err.message : "Failed to load chat");
        }
      } finally {
        if (!cancelled) setIsLoadingMessages(false);
      }
    };
    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [instance.id]);

  return (
    <>
    <div className="flex min-h-screen md:h-screen md:overflow-hidden flex-col bg-gradient-to-b from-[#05070b] via-[#050607] to-black text-foreground">
      <header className="sticky top-0 z-40 flex w-full items-center justify-between gap-4 border-b border-white/10 bg-black/80 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white">
            <Link href="/sga">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/40">
                Self-Governing Agent
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white truncate">{instance.name || "SGA"}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0 flex justify-center">
            <div className="flex flex-wrap md:flex-nowrap items-center gap-x-8 gap-y-2 text-xs text-muted-foreground max-w-6xl">
              <div className="flex items-center gap-2 shrink-0">
                <Activity className="h-4 w-4 shrink-0 text-sky-200" />
                <span className="text-white/60">Mode</span>
                <span className="font-semibold text-white">{modeTone}</span>
              </div>
              <div className="flex min-w-0 flex-none w-fit max-w-[360px] items-center gap-2">
                <Target className="h-4 w-4 shrink-0 text-sky-200" />
                <span className="text-white/60">Focus</span>
                <span className="min-w-0 truncate text-white">{focusThread}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ListChecks className="h-4 w-4 shrink-0 text-amber-200" />
                <span className="text-white/60">Decision</span>
                <Badge
                  variant="outline"
                  className={cn("border px-2 py-0.5 text-[11px] font-semibold uppercase", getDecisionTone(decisionStatus))}
                >
                  {decisionStatus}
                </Badge>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-200" />
                <span className="text-white/60">Risk</span>
                <span className="text-white">{riskPosture}</span>
                <span className="text-white/50">- {confidenceLabel}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Clock3 className="h-4 w-4 shrink-0 text-sky-200" />
                <span className="text-white/60">Next</span>
                <span className="text-white">{nextCycleLabel}</span>
                <span className="text-white/50">({cadenceReason})</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 min-w-[300px] justify-end">
          <Button
            variant={isStopped ? "secondary" : "outline"}
            size="sm"
            className="gap-2 h-8 w-[110px] justify-center"
            onClick={handleToggleStatus}
            disabled={statusSaving}
          >
            {isStopped ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {isStopped ? "Start" : "Pause"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-8 w-[120px] justify-center"
            onClick={() => setIsChatSidebarOpen((prev) => !prev)}
          >
            <MessageCircle className="h-4 w-4" />
            {isChatSidebarOpen ? "Hide chat" : "Chat"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-8 w-[110px] justify-center"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings2 className="h-4 w-4" />
            Settings
          </Button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0 h-full items-stretch md:overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <main className="space-y-6">
            {settingsError || runError ? (
              <p className="text-xs text-rose-300 px-1">{settingsError || runError}</p>
            ) : null}

            <section className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-gradient-to-b from-white/5 via-transparent to-transparent p-5 shadow-lg shadow-black/30 backdrop-blur">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">
                      Cycle summary
                    </div>
                    <h2 className="text-2xl font-semibold text-white">{latestAction}</h2>
                    <p className="text-sm text-muted-foreground">{reasoningSnapshot}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-white/70">
                      <span>Agent: {runPhaseLabel}</span>
                      <span>Last API call: {lastRunLabel}</span>
                      <span>Next trigger: {nextCycleLabel}</span>
                    </div>
                    <p className="text-sm text-white/80">
                      Health:{" "}
                      <span className="font-semibold text-white">{healthStatus}</span>
                      {healthDriver ? ` - ${healthDriver}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant="outline" className="border-white/20 bg-white/5 text-white/80">
                      {modeTone}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn("border px-2 py-0.5 text-xs font-semibold uppercase", getDecisionTone(decisionStatus))}
                    >
                      {decisionStatus}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "border px-2 py-0.5 text-xs",
                        highestRisk ? getRiskTone(highestRisk.level) : "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                      )}
                    >
                      {highestRisk ? `${highestRisk.level} risk` : "low risk"}
                    </Badge>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                    <p className="text-xs text-muted-foreground">Decision outcome</p>
                    <p className="text-sm font-semibold text-white">{decisionStatus}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                    <p className="text-xs text-muted-foreground">Risk posture</p>
                    <p className="text-sm font-semibold text-white">{riskPosture}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                    <p className="text-xs text-muted-foreground">Budget remaining</p>
                    <p className="text-sm font-semibold text-white">
                      {budgetRemainingUsd !== null ? formatCurrency(budgetRemainingUsd) : "n/a"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {timeRemainingMinutes !== null ? `${formatRemaining(timeRemainingMinutes)} left` : "Time window not set"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                    <p className="text-xs text-muted-foreground">Next check</p>
                    <p className="text-sm font-semibold text-white">{nextCycleLabel}</p>
                    <p className="text-xs text-muted-foreground">{cadenceReason}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setOpenSections((prev) => ({ ...prev, timeline: true }))}>
                    View evidence
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenSections((prev) => ({ ...prev, delegations: true }))}
                  >
                    View delegations
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setOpenSections((prev) => ({ ...prev, timeline: true }))}>
                    View full record
                  </Button>
                </div>
                <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Primary objective
                  </p>
                  <p className="mt-2 text-sm text-slate-100">
                    {focusThread}
                  </p>
                </div>
              </div>

            <CollapsibleCard
              title="Objective & initiatives"
              subtitle={`Focus thread updated ${formatTime(worldStateState.lastUpdatedAt)}`}
              icon={<Target className="h-4 w-4" />}
              isOpen={openSections.objective}
              onToggle={() => toggleSection("objective")}
            >
              <div className="space-y-3">
                <p className="text-sm text-slate-100">{worldStateState.currentObjective}</p>
                <p className="text-xs text-muted-foreground">
                  {currentTask ? `In execution: ${currentTask.label}` : "No initiative currently in execution."}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-muted-foreground">Daily time budget</p>
                    <p className="text-sm font-semibold text-white">
                      {formatHours(worldStateState.budgets.dailyTimeBudgetHours)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-muted-foreground">Daily cost budget</p>
                    <p className="text-sm font-semibold text-white">
                      {formatCurrency(worldStateState.budgets.dailyCostBudgetUsd)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-muted-foreground">Today's spend</p>
                    <p className="text-sm font-semibold text-white">
                      {formatCurrency(worldStateState.budgets.todayEstimatedSpendUsd)}
                    </p>
                  </div>
                </div>
              </div>
            </CollapsibleCard>

            <CollapsibleCard
              title="Constraints & policy"
              subtitle="Guardrails, approvals, and authority levels"
              icon={<ShieldCheck className="h-4 w-4" />}
              isOpen={openSections.constraints}
              onToggle={() => toggleSection("constraints")}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-100">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-200" />
                  <Select value={String(assuranceLevel)} onValueChange={handleAssuranceChange}>
                    <SelectTrigger className="h-auto min-h-0 w-auto !border-transparent !bg-transparent !px-0 !py-0 text-xs font-normal text-slate-100 shadow-none">
                      <SelectValue placeholder="Assurance level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Assurance 0 - Fast</SelectItem>
                      <SelectItem value="1">Assurance 1 - Standard</SelectItem>
                      <SelectItem value="2">Assurance 2 - High</SelectItem>
                      <SelectItem value="3">Assurance 3 - Max</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-100">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-200" />
                  <Select value={String(authorityLevel)} onValueChange={handleAuthorityChange}>
                    <SelectTrigger className="h-auto min-h-0 w-auto !border-transparent !bg-transparent !px-0 !py-0 text-xs font-normal text-slate-100 shadow-none">
                      <SelectValue placeholder="Authority level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">AL0 - Observe</SelectItem>
                      <SelectItem value="1">AL1 - Recommend</SelectItem>
                      <SelectItem value="2">AL2 - Execute Safe</SelectItem>
                      <SelectItem value="3">AL3 - Execute Extended</SelectItem>
                      <SelectItem value="4">AL4 - Override</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-3">
                {worldStateState.constraints.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No constraints recorded.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {worldStateState.constraints.map((constraint) => {
                      const source = inferConstraintSource(constraint);
                      return (
                        <div
                          key={constraint}
                          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-100"
                          title={constraint}
                        >
                          <span className="max-w-[220px] truncate">{constraint}</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "border px-2 py-0.5 text-[10px] font-semibold uppercase",
                              getConstraintTone(source)
                            )}
                          >
                            {source}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CollapsibleCard>
            <CollapsibleCard
              title="Risk register"
              subtitle="Severity, horizon, and mitigation status"
              icon={<ShieldAlert className="h-4 w-4" />}
              isOpen={openSections.risks}
              onToggle={() => toggleSection("risks")}
            >
              {worldStateState.riskRegister.length === 0 ? (
                <p className="text-sm text-muted-foreground">No risks logged for this cycle.</p>
              ) : (
                <div className="space-y-3">
                  {worldStateState.riskRegister.map((risk) => (
                    <div
                      key={risk.id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-white">{risk.label}</p>
                        <p className="text-xs text-muted-foreground">{risk.note}</p>
                      </div>
                      <Badge variant="outline" className={cn("border px-2 py-0.5 text-xs", getRiskTone(risk.level))}>
                        {risk.level}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleCard>

            <CollapsibleCard
              title="Delegations & active work"
              subtitle="Issued tasks, approvals, and evidence returns"
              icon={<ListChecks className="h-4 w-4" />}
              isOpen={openSections.delegations}
              onToggle={() => toggleSection("delegations")}
            >
              {worldStateState.openTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open tasks tracked right now.</p>
              ) : (
                <div className="space-y-3">
                  {worldStateState.openTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-white">{task.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Assurance A{assuranceLevel} - Deadline n/a
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "border px-2 py-0.5 text-xs",
                          task.status === "blocked"
                            ? "border-rose-400/40 bg-rose-500/10 text-rose-100"
                            : task.status === "in_progress"
                              ? "border-sky-400/40 bg-sky-500/10 text-sky-100"
                              : task.status === "planned"
                                ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
                                : "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                        )}
                      >
                        {task.status.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleCard>

            <CollapsibleCard
              title="Capabilities & connections"
              subtitle="Connected systems, tools, and data sources"
              icon={<Activity className="h-4 w-4" />}
              isOpen={openSections.capabilities}
              onToggle={() => toggleSection("capabilities")}
            >
              {worldStateState.capabilitiesSummary.length === 0 ? (
                <p className="text-sm text-muted-foreground">No capabilities registered yet.</p>
              ) : (
                <ScrollArea className="h-56">
                  <div className="space-y-3 pr-3">
                    {worldStateState.capabilitiesSummary.map((capability) => (
                      <div
                        key={capability.id}
                        className="rounded-xl border border-white/10 bg-white/5 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-white">{capability.displayName}</p>
                          <Badge variant="outline" className={cn("border px-2 py-0.5 text-xs", getRiskTone(capability.riskLevel))}>
                            {capability.riskLevel} risk
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                            {capability.kind.replace("_", " ")}
                          </span>
                          {capability.domainTags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CollapsibleCard>

            <CollapsibleCard
              title="Activity timeline"
              subtitle="Operations log and decisions"
              icon={<Activity className="h-4 w-4" />}
              isOpen={openSections.timeline}
              onToggle={() => toggleSection("timeline")}
            >
              {groupedEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet for this SGA.</p>
              ) : (
                <ScrollArea className="h-[360px]">
                  <div className="space-y-6 pr-4">
                    {groupedEvents.map((group) => (
                      <div key={group.dateLabel} className="space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          {group.dateLabel}
                        </div>
                        <div className="space-y-3 border-l border-white/10 pl-4">
                          {group.events.map((event) => {
                            const severityTone = getSeverityTone(event.severity);
                            return (
                              <div key={event.id} className="relative">
                                <span className="absolute -left-[9px] top-2 h-2 w-2 rounded-full bg-sky-400" />
                                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant="outline" className="border-white/20 bg-white/5 text-white/80">
                                        {EVENT_KIND_LABELS[event.kind]}
                                      </Badge>
                                      {event.severity ? (
                                        <Badge variant="outline" className={cn("border px-2 py-0.5 text-xs", severityTone)}>
                                          {event.severity === "high" || event.severity === "medium" ? (
                                            <AlertTriangle className="mr-1 h-3 w-3" />
                                          ) : null}
                                          {event.severity}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <span className="text-xs text-muted-foreground">{formatTime(event.createdAt)}</span>
                                  </div>
                                  <p className="mt-2 text-sm font-semibold text-white">{event.title}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">{event.summary}</p>
                                  {typeof event.metadata?.preview === "string" && event.metadata.preview.trim() ? (
                                    <p className="mt-2 text-xs text-white/70 font-mono whitespace-pre-wrap">
                                      {event.metadata.preview}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <div ref={timelineEndRef} />
                  </div>
                </ScrollArea>
              )}
            </CollapsibleCard>
          </section>
            </main>
          </div>
        </div>
        <SgaChatSidebar
          open={isChatSidebarOpen}
          onClose={() => setIsChatSidebarOpen(false)}
          messages={messages}
          onSend={handleSend}
          isLoading={isLoadingMessages}
          error={chatError}
        />
      </div>
    </div>
    <SettingsSheet
      open={isSettingsOpen}
      onClose={() => setIsSettingsOpen(false)}
      instanceId={instance.id}
      assuranceLevel={assuranceLevel}
      authorityLevel={authorityLevel}
      dailyTimeBudgetHours={instance.dailyTimeBudgetHours}
      dailyCostBudgetUsd={instance.dailyCostBudgetUsd}
      policy={policyState}
      connections={instance.connections ?? []}
      onAssuranceChange={handleAssuranceChange}
      onAuthorityChange={handleAuthorityChange}
      onPolicySaved={setPolicyState}
    />
    </>
  );
}

type SgaChatSidebarProps = {
  open: boolean;
  onClose: () => void;
  messages: SgaMessage[];
  onSend: (message: string) => string | null;
  isLoading: boolean;
  error: string | null;
};

function SgaChatSidebar({
  open,
  onClose,
  messages,
  onSend,
  isLoading,
  error,
}: SgaChatSidebarProps) {
  const panelClass = cn(
    "flex-shrink-0 min-h-0 overflow-hidden transition-[width] duration-300",
    open
      ? "fixed inset-0 z-40 h-full w-full md:relative md:z-auto md:h-full md:w-[440px] md:max-w-[440px]"
      : "hidden md:block md:w-0"
  );
  const [isMobileView, setIsMobileView] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [bottomSpacerPx, setBottomSpacerPx] = useState(baseBottomSpacerPx);
  const [pinSpacerHeight, setPinSpacerHeight] = useState(0);
  const [alignTrigger, setAlignTrigger] = useState(0);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const pinnedMessageIdRef = useRef<string | null>(null);
  const initialScrollDoneRef = useRef(false);
  const pinToPromptRef = useRef(false);
  const pinnedScrollTopRef = useRef<number | null>(null);
  const alignNextUserMessageToTopRef = useRef<string | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const lockedScrollHeightRef = useRef<number | null>(null);
  const [prefillValue, setPrefillValue] = useState<string | null>(null);
  const isStreaming = false;
  const showThinkingIndicator = false;
  const indicatorLabel = DEFAULT_INDICATOR_LABEL;

  const composerWrapperClass = cn(
    "agent-chat-composer-wrapper border-t border-border/60 space-y-3",
    isMobileView ? "sticky left-0 right-0 z-20 bg-[#050505]/95 px-4 pt-3" : "px-2 pt-2"
  );
  const composerStickyStyle = isMobileView
    ? { bottom: `calc(4rem + env(safe-area-inset-bottom, 0px))`, paddingBottom: "1rem" }
    : undefined;
  const baseScrollBottom = 96;
  const scrollTipBottom = baseScrollBottom;
  const scrollTipBottomPosition = isMobileView
    ? `calc(${scrollTipBottom}px + 4rem + env(safe-area-inset-bottom,0px))`
    : `calc(${scrollTipBottom}px + env(safe-area-inset-bottom,0px))`;

  const showStarterPrompts = !isLoading && !error && messages.length === 0;
  const starterPrompts = [
    "Refine the current thesis for these tickers.",
    "What would invalidate this bias today?",
    "Tighten alerts around key levels and volatility.",
  ];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsMobileView(window.innerWidth < 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (open) {
      initialScrollDoneRef.current = false;
    }
  }, [open]);

  const scheduleProgrammaticScrollReset = () => {
    if (typeof window === "undefined") return;
    if (programmaticScrollTimeoutRef.current) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, 160);
  };

  const getEffectiveScrollBottom = useCallback(
    (viewport: HTMLDivElement) => {
      const extraSpacer = Math.max(0, bottomSpacerPx - baseBottomSpacerPx);
      return Math.max(0, viewport.scrollHeight - extraSpacer);
    },
    [bottomSpacerPx]
  );

  const getLockedMaxScrollTop = (viewport: HTMLDivElement) => {
    const lockedHeight = lockedScrollHeightRef.current;
    if (!lockedHeight) return null;
    return Math.max(0, lockedHeight - viewport.clientHeight);
  };

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const viewport = chatListRef.current;
      if (!viewport) return;
      const bottom = getEffectiveScrollBottom(viewport);
      const targetTop = Math.max(0, bottom - viewport.clientHeight);
      isProgrammaticScrollRef.current = true;
      viewport.scrollTo({ top: targetTop, behavior });
      scheduleProgrammaticScrollReset();
    },
    [getEffectiveScrollBottom]
  );

  const releasePinning = () => {
    pinToPromptRef.current = false;
    pinnedScrollTopRef.current = null;
    setPinSpacerHeight(0);
  };

  const computeRequiredSpacerForMessage = useCallback(
    (messageId: string) => {
      const viewport = chatListRef.current;
      if (!viewport) return null;
      const messageEl = viewport.querySelector(`[data-agent-message-id="${messageId}"]`) as HTMLElement | null;
      if (!messageEl) return null;
      const viewportRect = viewport.getBoundingClientRect();
      const elRect = messageEl.getBoundingClientRect();
      const desiredPadding = 14;
      const elContentTop = viewport.scrollTop + (elRect.top - viewportRect.top);
      const requiredScrollTop = Math.max(0, Math.round(elContentTop - desiredPadding));
      const contentWithoutSpacer = viewport.scrollHeight - bottomSpacerPx;
      const maxScrollTopWithBase = Math.max(
        0,
        contentWithoutSpacer + baseBottomSpacerPx - viewport.clientHeight
      );
      const extraNeeded = Math.max(0, requiredScrollTop - maxScrollTopWithBase);
      return baseBottomSpacerPx + extraNeeded;
    },
    [bottomSpacerPx]
  );

  const handleChatScroll = () => {
    const viewport = chatListRef.current;
    if (!viewport) return;
    if (isProgrammaticScrollRef.current) return;
    if (pinToPromptRef.current) {
      pinToPromptRef.current = false;
      pinnedScrollTopRef.current = null;
      setPinSpacerHeight(0);
    }
    const { scrollTop, clientHeight } = viewport;
    const lockedMax = getLockedMaxScrollTop(viewport);
    if (lockedMax !== null && !isStreaming && scrollTop > lockedMax + 2) {
      isProgrammaticScrollRef.current = true;
      viewport.scrollTop = lockedMax;
      scheduleProgrammaticScrollReset();
      return;
    }
    const effectiveBottom = getEffectiveScrollBottom(viewport);
    const distanceFromBottom = effectiveBottom - (scrollTop + clientHeight);
    const tolerance = Math.max(16, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;
    setShowScrollToBottom(!atBottom);
    if (!pinToPromptRef.current) {
      setIsAutoScroll(atBottom);
    }
  };

  const recomputeScrollFlags = useCallback(() => {
    const viewport = chatListRef.current;
    if (!viewport) return;
    const { scrollTop, clientHeight } = viewport;
    const effectiveBottom = getEffectiveScrollBottom(viewport);
    const distanceFromBottom = effectiveBottom - (scrollTop + clientHeight);
    const tolerance = Math.max(16, bottomSpacerPx / 3);
    const atBottom = distanceFromBottom <= tolerance;
    setShowScrollToBottom(!atBottom);
  }, [bottomSpacerPx, getEffectiveScrollBottom]);

  useEffect(() => {
    if (!open) {
      releasePinning();
      setShowScrollToBottom(false);
      setIsAutoScroll(true);
      return;
    }
    if (isAutoScroll) {
      setShowScrollToBottom(false);
    } else {
      recomputeScrollFlags();
    }
  }, [open, isAutoScroll, recomputeScrollFlags]);

  useEffect(() => {
    const targetMessageId = alignNextUserMessageToTopRef.current;
    if (!open || !targetMessageId) return;
    pinnedMessageIdRef.current = targetMessageId;

    let cancelled = false;
    let retryRaf: number | null = null;
    let scrollTimer: number | null = null;
    const startMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const deadlineMs = startMs + 2500;

    const doScroll = () => {
      if (cancelled) return;
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (nowMs > deadlineMs) return;

      const viewport = chatListRef.current;
      if (!viewport) return;

      const el = viewport.querySelector(
        `[data-agent-message-id="${targetMessageId}"]`
      ) as HTMLElement | null;
      if (!el) {
        if (typeof requestAnimationFrame !== "undefined") {
          retryRaf = requestAnimationFrame(doScroll);
        }
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const desiredPadding = 14;
      const nextTop = viewport.scrollTop + (elRect.top - viewportRect.top) - desiredPadding;
      const targetTop = Math.max(0, Math.round(nextTop));
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (targetTop > maxScrollTop) {
        const desiredSpacer = computeRequiredSpacerForMessage(targetMessageId);
        if (typeof desiredSpacer === "number") {
          setBottomSpacerPx((prev) => Math.max(prev, desiredSpacer));
        }
        if (typeof requestAnimationFrame !== "undefined") {
          retryRaf = requestAnimationFrame(doScroll);
        }
        return;
      }

      isProgrammaticScrollRef.current = true;
      pinnedScrollTopRef.current = targetTop;
      setIsAutoScroll(false);
      const effectiveBottom = getEffectiveScrollBottom(viewport);
      const distanceFromBottom = effectiveBottom - (targetTop + viewport.clientHeight);
      const tolerance = Math.max(12, bottomSpacerPx / 3);
      setShowScrollToBottom(!(distanceFromBottom <= tolerance));
      alignNextUserMessageToTopRef.current = null;

      scrollTimer = window.setTimeout(() => {
        viewport.scrollTo({ top: targetTop, behavior: "smooth" });
      }, 80);
    };

    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => requestAnimationFrame(doScroll));
    } else {
      doScroll();
    }

    return () => {
      cancelled = true;
      if (retryRaf && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(retryRaf);
      }
      if (scrollTimer) clearTimeout(scrollTimer);
      isProgrammaticScrollRef.current = false;
    };
  }, [
    alignTrigger,
    messages.length,
    bottomSpacerPx,
    computeRequiredSpacerForMessage,
    getEffectiveScrollBottom,
    open,
  ]);

  useEffect(() => {
    if (lockedScrollHeightRef.current) return;
    if (pinToPromptRef.current) return;
    pinnedScrollTopRef.current = null;
    const pinnedId = pinnedMessageIdRef.current;
    if (!pinnedId) return;
    const desiredSpacer = computeRequiredSpacerForMessage(pinnedId);
    if (typeof desiredSpacer !== "number") return;
    const nextSpacer = Math.max(baseBottomSpacerPx, desiredSpacer);
    if (nextSpacer > bottomSpacerPx) {
      setBottomSpacerPx(nextSpacer);
    }
  }, [messages.length, bottomSpacerPx, computeRequiredSpacerForMessage]);

  useEffect(() => {
    const ensureSpacer = () => {
      setBottomSpacerPx((prev) => Math.max(baseBottomSpacerPx, prev));
    };
    ensureSpacer();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", ensureSpacer);
    return () => {
      window.removeEventListener("resize", ensureSpacer);
    };
  }, [messages.length]);

  useEffect(() => {
    if (!open) return;
    if (initialScrollDoneRef.current) return;
    if (alignNextUserMessageToTopRef.current || pinToPromptRef.current) {
      initialScrollDoneRef.current = true;
      return;
    }
    scrollToBottom("auto");
    setShowScrollToBottom(false);
    initialScrollDoneRef.current = true;
  }, [open, scrollToBottom, messages.length]);

  const handleSendChat = (inputContent: string) => {
    const content = inputContent.trim();
    if (!content) return;
    const messageId = onSend(content);
    if (!messageId) return;
    pinToPromptRef.current = true;
    pinnedMessageIdRef.current = messageId;
    pinnedScrollTopRef.current = null;
    setPinSpacerHeight(0);
    alignNextUserMessageToTopRef.current = messageId;
    setAlignTrigger((prev) => prev + 1);
    setIsAutoScroll(false);
    setShowScrollToBottom(true);
    setPrefillValue(null);
  };

  return (
    <div className={panelClass} aria-hidden={!open}>
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-col border-l border-white/10 bg-[#050505] px-0 text-foreground backdrop-blur-xl transition-opacity duration-300",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      >
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-white/60">Conversation</p>
            <p className="text-lg font-semibold text-white">Talk to SGA</p>
            <p className="text-[11px] text-muted-foreground">Send directives or request a status update.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="hidden md:inline-flex">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
          <div className="relative flex-1 min-h-0 overflow-hidden" style={{ minWidth: 0 }}>
            <div
              ref={chatListRef}
              className="h-full min-h-0 overflow-y-auto overflow-x-hidden space-y-1 agent-chat-message-list agent-chat-scroll-area"
              onScroll={handleChatScroll}
              style={{ overflowAnchor: "none" }}
            >
              {pinSpacerHeight > 0 && (
                <div aria-hidden className="w-full" style={{ height: pinSpacerHeight }} />
              )}
              {isLoading ? (
                <p className="px-2 text-xs text-muted-foreground">Loading chat...</p>
              ) : error ? (
                <p className="px-2 text-xs text-rose-300">{error}</p>
              ) : messages.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">
                  Use chat to refine the thesis, adjust alerts, or request a report.
                </p>
              ) : (
                messages.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    messageId={msg.id}
                    role={msg.role === "sga" ? "assistant" : "user"}
                    content={msg.content}
                    metadata={asMetadataRecord(msg.metadata)}
                    forceFullWidth
                    forceStaticBubble
                  />
                ))
              )}
              {isStreaming && showThinkingIndicator ? (
                <div className="px-1 pb-1 text-white/80">
                  <p className="text-base leading-relaxed">
                    <span className="inline-block thinking-shimmer-text">{indicatorLabel}</span>
                  </p>
                </div>
              ) : null}
              <div aria-hidden className="w-full" style={{ height: bottomSpacerPx }} />
            </div>
            {showScrollToBottom && (
              <div
                className={`scroll-tip pointer-events-none fixed inset-x-0 z-30 transition-opacity duration-200 ${
                  showScrollToBottom ? "opacity-100 scroll-tip-visible" : "opacity-0"
                }`}
                style={{ bottom: scrollTipBottomPosition }}
              >
                <div className="flex w-full justify-center">
                  <Button
                    type="button"
                    size="icon"
                    className={`${showScrollToBottom ? "scroll-tip-button" : ""} pointer-events-auto h-10 w-10 rounded-full border border-border bg-card/90 text-foreground shadow-md backdrop-blur hover:bg-background`}
                    onClick={() => scrollToBottom()}
                  >
                    <ArrowDown className="h-4 w-4 text-foreground" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className={composerWrapperClass} style={composerStickyStyle}>
            {showStarterPrompts ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-white/[0.02] px-3 py-3">
                <p className="text-xs text-muted-foreground">
                  Use chat to refine the thesis, adjust alerts, or request a report.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {starterPrompts.map((prompt) => (
                    <Button
                      key={prompt}
                      size="sm"
                      variant="secondary"
                      className="bg-white/5 text-xs text-white/90 hover:bg-white/10"
                      onClick={() => setPrefillValue(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            {error && !isLoading ? <p className="text-xs text-rose-300 mb-1">{error}</p> : null}
            <div className="mx-auto w-full max-w-3xl">
              <ChatComposer
                onSendMessage={handleSendChat}
                isStreaming={isStreaming}
                placeholder="Ask the agent..."
                disableAccentStyles
                showAttachmentButton={false}
                sendButtonStyle={{
                  backgroundColor: "#ffffff",
                  color: "#050505",
                  border: "1px solid rgba(15, 20, 25, 0.35)",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
                }}
                prefillValue={prefillValue}
                onPrefillUsed={() => setPrefillValue(null)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
