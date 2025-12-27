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
  ShieldAlert,
  ShieldCheck,
  Target,
  Timer,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Json } from "@/lib/supabase/types";
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
  const [messages, setMessages] = useState<SgaMessage[]>(() => [
    {
      id: "sga-greeting",
      role: "sga",
      content: DEFAULT_SGA_GREETING,
      createdAt: new Date().toISOString(),
      metadata: null,
    },
  ]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
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
  const timelineEndRef = useRef<HTMLDivElement | null>(null);

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
    setStatusError(null);
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
      setStatusError(err instanceof Error ? err.message : "Unable to update status");
    }
  };

  const handleAssuranceChange = (value: string) => {
    const nextValue = Number(value) as SgaInstance["assuranceLevel"];
    setAssuranceLevel(nextValue);
    // TODO: Persist assurance level to Supabase config for this instance.
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
    <div className="flex min-h-screen md:h-screen md:overflow-hidden flex-col bg-gradient-to-b from-[#05070b] via-[#050607] to-black text-foreground">
      <header className="sticky top-0 z-40 flex w-full items-center justify-between border-b border-white/10 bg-black/80 px-4 py-0 backdrop-blur" style={{ minHeight: "56px" }}>
        <div className="flex items-center">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white">
            <Link href="/sga">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="flex items-center">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-8"
            onClick={() => setIsChatSidebarOpen((prev) => !prev)}
          >
            <MessageCircle className="h-4 w-4" />
            {isChatSidebarOpen ? "Hide chat" : "Chat"}
          </Button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0 h-full items-stretch md:overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <main className="space-y-6">

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
    [baseBottomSpacerPx, bottomSpacerPx]
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
    baseBottomSpacerPx,
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
  }, [messages.length, bottomSpacerPx, baseBottomSpacerPx, computeRequiredSpacerForMessage]);

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
  }, [baseBottomSpacerPx, messages.length]);

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
                    metadata={msg.metadata}
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
