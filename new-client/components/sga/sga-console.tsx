"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Clock3,
  ListChecks,
  MessageCircle,
  Pause,
  Play,
  ShieldAlert,
  ShieldCheck,
  Target,
  Timer,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SgaEvent, SgaInstance, SgaStatus, SgaWorldState } from "@/lib/types/sga";

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
};

type ConstraintSource = "User" | "Policy" | "Safety";

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

const ASSURANCE_LABELS: Record<SgaInstance["assuranceLevel"], string> = {
  0: "Fast",
  1: "Standard",
  2: "High",
  3: "Max",
};

const QUICK_ACTIONS = [
  {
    label: "Clarify current objective",
    message: "Clarify the current objective and what success looks like for this cycle.",
  },
  {
    label: "Request daily summary",
    message: "Provide the daily summary, including decisions, risks, and outstanding tasks.",
  },
  {
    label: "Pause non-critical work",
    message: "Pause non-critical work and report what is safe to defer.",
  },
  {
    label: "List pending delegations",
    message: "List pending delegations and who is responsible for each item.",
  },
];

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

export function SgaConsole({ instance, events, worldState }: SgaConsoleProps) {
  const [status, setStatus] = useState<SgaStatus>(instance.status);
  const [assuranceLevel, setAssuranceLevel] = useState<SgaInstance["assuranceLevel"]>(instance.assuranceLevel);
  const [messageText, setMessageText] = useState("");
  const [messages, setMessages] = useState<SgaMessage[]>(() => [
    {
      id: "sga-greeting",
      role: "sga",
      content: "Standing by for governance directives and timeline updates.",
      createdAt: new Date().toISOString(),
    },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false);
  const [openSections, setOpenSections] = useState({
    objective: false,
    constraints: false,
    risks: false,
    delegations: false,
    capabilities: false,
    timeline: false,
  });

  const replyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsChatSidebarOpen(query.matches);
    sync();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", sync);
      return () => query.removeEventListener("change", sync);
    }

    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  useEffect(() => {
    return () => {
      if (replyTimeoutRef.current) {
        clearTimeout(replyTimeoutRef.current);
      }
    };
  }, []);

  const groupedEvents = useMemo(() => {
    if (!events?.length) return [] as { dateLabel: string; events: SgaEvent[] }[];
    const sorted = [...events].sort(
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
  }, [events]);

  const latestEvent = useMemo(() => {
    if (!events?.length) return null;
    return [...events].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }, [events]);

  const currentTask = useMemo(() => {
    return (
      worldState.openTasks.find((task) => task.status === "in_progress") ??
      worldState.openTasks.find((task) => task.status === "planned") ??
      null
    );
  }, [worldState.openTasks]);

  const pendingDelegations = useMemo(
    () => worldState.openTasks.filter((task) => task.status !== "done").length,
    [worldState.openTasks]
  );

  const highestRisk = useMemo(() => {
    if (!worldState.riskRegister.length) return null;
    const priority: Record<"low" | "medium" | "high", number> = { low: 1, medium: 2, high: 3 };
    return worldState.riskRegister.reduce((acc, risk) =>
      priority[risk.level] > priority[acc.level] ? risk : acc
    );
  }, [worldState.riskRegister]);

  const confidenceScore = useMemo(() => {
    let score = 88;
    worldState.riskRegister.forEach((risk) => {
      if (risk.level === "high") score -= 20;
      if (risk.level === "medium") score -= 10;
    });
    return Math.max(52, Math.min(96, score));
  }, [worldState.riskRegister]);

  const modeLabel = getModeLabel(status);
  const latestAction = latestEvent?.title ?? "Awaiting first operational cycle";
  const reasoningSnapshot = latestEvent?.summary ?? "No activity logged yet for this SGA.";
  const loopIteration = `C${Math.max(1, events.length)}`;
  const loopClockSeconds = useMemo(() => {
    const reference = instance.lastDecisionAt ?? instance.updatedAt;
    const start = new Date(reference).getTime();
    if (Number.isNaN(start)) return null;
    return Math.max(0, Math.floor((Date.now() - start) / 1000));
  }, [instance.lastDecisionAt, instance.updatedAt]);
  const loopClockLabel = loopClockSeconds !== null ? formatElapsed(loopClockSeconds) : "n/a";
  const timeRemainingMinutes = worldState.budgets.dailyTimeBudgetHours
    ? Math.round(worldState.budgets.dailyTimeBudgetHours * 60)
    : null;

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggleStatus = async () => {
    const nextStatus: SgaStatus = status === "paused" ? "coordinating" : "paused";
    setError(null);
    try {
      const res = await fetch(`/api/sga/instances/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Failed to update status");
      }
      setStatus(nextStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update status");
    }
  };

  const handleAssuranceChange = (value: string) => {
    const nextValue = Number(value) as SgaInstance["assuranceLevel"];
    setAssuranceLevel(nextValue);
    // TODO: Persist assurance level to Supabase config for this instance.
  };

  const handleSend = () => {
    const trimmed = messageText.trim();
    if (!trimmed) return;
    const createdAt = new Date().toISOString();
    const outgoing: SgaMessage = {
      id: generateId(),
      role: "user",
      content: trimmed,
      createdAt,
    };
    setMessages((prev) => [...prev, outgoing]);
    setMessageText("");
    // TODO: Persist outbound message to Supabase once sga_messages exists.

    if (replyTimeoutRef.current) {
      clearTimeout(replyTimeoutRef.current);
    }
    replyTimeoutRef.current = setTimeout(() => {
      const inbound: SgaMessage = {
        id: generateId(),
        role: "sga",
        content: "Acknowledged. Logging this for the next decision cycle.",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, inbound]);
      // TODO: Replace mock response with real SGA response pipeline.
    }, 700);
  };

  const applyQuickAction = (message: string) => {
    setMessageText(message);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#05070b] via-[#050607] to-black text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link href="/sga">
              <ArrowLeft className="h-4 w-4" />
              Back to fleet
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-white">{instance.name}</h1>
              <Badge variant="outline" className={cn("border px-2 py-0.5 text-xs", getStatusTone(status))}>
                {STATUS_LABELS[status]}
              </Badge>
              <Badge variant="outline" className="border-white/20 bg-white/5 text-white/80">
                Assurance {assuranceLevel} - {ASSURANCE_LABELS[assuranceLevel]}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{instance.environmentLabel}</p>
          </div>
        </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs text-muted-foreground">Today active: {loopClockLabel}</div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setIsChatSidebarOpen((prev) => !prev)}
            >
              <MessageCircle className="h-4 w-4" />
              Chat
            </Button>
          </div>
        </header>

        <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-2 text-xs text-muted-foreground">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-sky-200" />
              Iteration: {loopIteration} - {modeLabel}
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-200" />
              Assurance {assuranceLevel}
            </div>
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-sky-200" />
              Run clock {loopClockLabel}
            </div>
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-amber-200" />
              Pending {pendingDelegations}
            </div>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-200" />
              Last decision {formatTime(instance.lastDecisionAt)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr,0.8fr]">
          <section className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-gradient-to-b from-white/5 via-transparent to-transparent p-5 shadow-lg shadow-black/30 backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">
                    <Target className="h-3.5 w-3.5" />
                    Now
                  </div>
                  <h2 className="text-2xl font-semibold text-white">{latestAction}</h2>
                  <p className="text-sm text-muted-foreground">{reasoningSnapshot}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge variant="outline" className={cn("border px-2 py-0.5 text-xs", getStatusTone(status))}>
                    {STATUS_LABELS[status]}
                  </Badge>
                  {highestRisk ? (
                    <Badge variant="outline" className={cn("border px-2 py-0.5 text-xs", getRiskTone(highestRisk.level))}>
                      {highestRisk.level} risk
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-400/40 bg-emerald-500/10 text-emerald-100">
                      Low risk
                    </Badge>
                  )}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                  <p className="text-xs text-muted-foreground">Mode</p>
                  <p className="text-sm font-semibold text-white">{modeLabel}</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                  <p className="text-xs text-muted-foreground">Current task</p>
                  <p className="text-sm font-semibold text-white">{currentTask?.label ?? "No active task"}</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                  <p className="text-xs text-muted-foreground">Confidence</p>
                  <p className="text-sm font-semibold text-white">{confidenceScore}%</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                  <p className="text-xs text-muted-foreground">Time remaining</p>
                  <p className="text-sm font-semibold text-white">{formatRemaining(timeRemainingMinutes)}</p>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Primary objective</p>
                <p className="mt-2 text-sm text-slate-100">
                  {worldState.currentObjective || instance.primaryObjective}
                </p>
              </div>
            </div>

            <CollapsibleCard
              title="Objective"
              subtitle={`State snapshot updated ${formatTime(worldState.lastUpdatedAt)}`}
              icon={<Target className="h-4 w-4" />}
              isOpen={openSections.objective}
              onToggle={() => toggleSection("objective")}
            >
              <div className="space-y-3">
                <p className="text-sm text-slate-100">{worldState.currentObjective}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-muted-foreground">Daily time budget</p>
                    <p className="text-sm font-semibold text-white">
                      {formatHours(worldState.budgets.dailyTimeBudgetHours)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-muted-foreground">Daily cost budget</p>
                    <p className="text-sm font-semibold text-white">
                      {formatCurrency(worldState.budgets.dailyCostBudgetUsd)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-muted-foreground">Today spend</p>
                    <p className="text-sm font-semibold text-white">
                      {formatCurrency(worldState.budgets.todayEstimatedSpendUsd)}
                    </p>
                  </div>
                </div>
              </div>
            </CollapsibleCard>

            <CollapsibleCard
              title="Constraints"
              subtitle="Operational guardrails and policy overrides"
              icon={<ShieldCheck className="h-4 w-4" />}
              isOpen={openSections.constraints}
              onToggle={() => toggleSection("constraints")}
            >
              {worldState.constraints.length === 0 ? (
                <p className="text-sm text-muted-foreground">No constraints recorded.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {worldState.constraints.map((constraint) => {
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
            </CollapsibleCard>
            <CollapsibleCard
              title="Risk register"
              subtitle="Active risk items and mitigation status"
              icon={<ShieldAlert className="h-4 w-4" />}
              isOpen={openSections.risks}
              onToggle={() => toggleSection("risks")}
            >
              {worldState.riskRegister.length === 0 ? (
                <p className="text-sm text-muted-foreground">No risks logged for this cycle.</p>
              ) : (
                <div className="space-y-3">
                  {worldState.riskRegister.map((risk) => (
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
              title="Delegations and active work"
              subtitle="Tasks queued or in progress"
              icon={<ListChecks className="h-4 w-4" />}
              isOpen={openSections.delegations}
              onToggle={() => toggleSection("delegations")}
            >
              {worldState.openTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open tasks tracked right now.</p>
              ) : (
                <div className="space-y-3">
                  {worldState.openTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <p className="text-sm font-semibold text-white">{task.label}</p>
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
              title="Capabilities"
              subtitle="Available tools and data sources"
              icon={<Activity className="h-4 w-4" />}
              isOpen={openSections.capabilities}
              onToggle={() => toggleSection("capabilities")}
            >
              {worldState.capabilitiesSummary.length === 0 ? (
                <p className="text-sm text-muted-foreground">No capabilities registered yet.</p>
              ) : (
                <ScrollArea className="h-56">
                  <div className="space-y-3 pr-3">
                    {worldState.capabilitiesSummary.map((capability) => (
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

          <aside className="space-y-4 hidden lg:block">
            <div className="rounded-2xl border border-border/70 bg-card/50 p-4 shadow-lg shadow-black/20 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Loop status</p>
                  <p className="text-sm font-semibold text-white">Governance controls</p>
                </div>
                <Badge variant="outline" className={cn("border px-2 py-0.5 text-xs", getStatusTone(status))}>
                  {STATUS_LABELS[status]}
                </Badge>
              </div>
              <div className="mt-4 space-y-3">
                <Button onClick={handleToggleStatus} className="w-full justify-center gap-2">
                  {status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {status === "paused" ? "Resume loop" : "Pause loop"}
                </Button>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">Assurance level</label>
                  <Select value={String(assuranceLevel)} onValueChange={handleAssuranceChange}>
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
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    Run clock: {loopClockLabel}
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    Remaining: {formatRemaining(timeRemainingMinutes)}
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    Pending: {pendingDelegations}
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    Spend: {formatCurrency(worldState.budgets.todayEstimatedSpendUsd)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    View history
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <Activity className="h-4 w-4" />
                    Export log
                  </Button>
                </div>
                {error ? <p className="text-xs text-rose-300">{error}</p> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/50 p-4 shadow-lg shadow-black/20 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Quick actions</p>
                  <p className="text-sm font-semibold text-white">Interventions</p>
                </div>
                <Activity className="h-4 w-4 text-slate-300" />
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {QUICK_ACTIONS.map((action) => (
                  <Button
                    key={action.label}
                    variant="secondary"
                    size="sm"
                    className="justify-start"
                    onClick={() => applyQuickAction(action.message)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
      <SgaChatSidebar
        open={isChatSidebarOpen}
        onClose={() => setIsChatSidebarOpen(false)}
        messages={messages}
        messageText={messageText}
        onMessageTextChange={(value) => setMessageText(value)}
        onSend={handleSend}
        messageEndRef={messageEndRef}
      />
    </div>
  );
}

type SgaChatSidebarProps = {
  open: boolean;
  onClose: () => void;
  messages: SgaMessage[];
  messageText: string;
  onMessageTextChange: (value: string) => void;
  onSend: () => void;
  messageEndRef: RefObject<HTMLDivElement | null>;
};

function SgaChatSidebar({
  open,
  onClose,
  messages,
  messageText,
  onMessageTextChange,
  onSend,
  messageEndRef,
}: SgaChatSidebarProps) {
  const sidebarShellClass = cn(
    "fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] transition-transform duration-300",
    open ? "translate-x-0" : "translate-x-full"
  );

  const panelClass = cn(
    "flex h-full min-h-0 flex-col border-l border-white/10 bg-[#050505] text-foreground shadow-2xl transition-opacity duration-300",
    open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
  );

  return (
    <div className={sidebarShellClass} aria-hidden={!open}>
      <div className={panelClass}>
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-white/60">Conversation</p>
            <p className="text-lg font-semibold text-white">Talk to SGA</p>
            <p className="text-[11px] text-muted-foreground">Send directives or request a status update.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 px-6 py-4">
          <ScrollArea className="h-full min-h-0">
            <div className="space-y-3 pr-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "rounded-xl border p-3 transition",
                    message.role === "user" ? "border-sky-400/30 bg-sky-500/10" : "border-white/10 bg-white/5"
                  )}
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{message.role === "user" ? "You" : "SGA"}</span>
                    <span>{formatTime(message.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-100">{message.content}</p>
                </div>
              ))}
              <div ref={messageEndRef} />
            </div>
          </ScrollArea>
        </div>
        <div className="border-t border-white/10 px-6 py-4">
          <Textarea
            value={messageText}
            onChange={(event) => onMessageTextChange(event.target.value)}
            placeholder="Send a directive or ask for a status update..."
            className="min-h-[90px] bg-background/60"
          />
          <Button onClick={onSend} className="mt-3 w-full gap-2">
            <MessageCircle className="h-4 w-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
