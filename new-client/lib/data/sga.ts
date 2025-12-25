import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { SgaEvent, SgaEventKind, SgaInstance, SgaStatus, SgaWorldState } from "@/lib/types/sga";

type RowRecord = Record<string, unknown>;

const STATUS_VALUES: SgaStatus[] = [
  "idle",
  "analyzing",
  "planning",
  "coordinating",
  "executing",
  "paused",
  "error",
];

const EVENT_KIND_VALUES: SgaEventKind[] = [
  "situation_scan",
  "risk_update",
  "plan_update",
  "delegated_task",
  "external_action",
  "verification",
  "human_feedback",
  "system_pause",
  "system_resume",
  "error",
];

function isRecord(value: unknown): value is RowRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(record: RowRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function pickNumber(record: RowRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function coerceStatus(value: unknown): SgaStatus {
  if (typeof value === "string" && STATUS_VALUES.includes(value as SgaStatus)) {
    return value as SgaStatus;
  }
  return "idle";
}

function coerceEventKind(value: unknown): SgaEventKind {
  if (typeof value === "string" && EVENT_KIND_VALUES.includes(value as SgaEventKind)) {
    return value as SgaEventKind;
  }
  return "plan_update";
}

function coerceAssurance(value: unknown): 0 | 1 | 2 | 3 {
  if (value === 0 || value === 1 || value === 2 || value === 3) {
    return value;
  }
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3) {
    return parsed as 0 | 1 | 2 | 3;
  }
  return 1;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string") as string[];
}

function parseRecordArray(value: unknown): RowRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isRecord(entry)) as RowRecord[];
}

function parseJsonRecord(value: unknown): RowRecord | null {
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeRiskLevel(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "low";
}

function isMissingTableError(error: unknown) {
  if (!error) return false;
  const code = isRecord(error) ? error.code : null;
  if (typeof code === "string" && code === "42P01") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("relation") && message.includes("governor_");
}

function fallbackId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mapInstanceRow(row: RowRecord): SgaInstance {
  const id = pickString(row, ["id", "instance_id"]) ?? fallbackId("sga");
  const config = parseJsonRecord(row.config) ?? {};
  const statusOverride = pickString(config, ["sga_status", "status", "sgaStatus"]);
  const governorStatus = pickString(row, ["status"]) ?? "active";
  const status = statusOverride
    ? coerceStatus(statusOverride)
    : governorStatus === "paused"
      ? "paused"
      : governorStatus === "archived"
        ? "error"
        : "coordinating";
  const lastDecision =
    pickString(config, ["last_decision_at", "lastDecisionAt"]) ??
    pickString(row, ["last_decision_at", "lastDecisionAt", "updated_at", "updatedAt"]);
  return {
    id,
    name: pickString(row, ["name", "label"]) ?? "Self-Governing Agent",
    environmentLabel:
      pickString(config, ["environment_label", "environmentLabel"]) ??
      pickString(row, ["environment_label", "environmentLabel"]) ??
      "Primary Ops",
    status,
    assuranceLevel: coerceAssurance(
      pickNumber(config, ["assurance_level", "assuranceLevel"]) ??
        pickNumber(row, ["assurance_level", "assuranceLevel"]) ??
        1
    ),
    primaryObjective:
      pickString(config, ["primary_objective", "primaryObjective"]) ??
      pickString(row, ["primary_objective", "primaryObjective"]) ??
      "Maintain system stability.",
    lastDecisionAt: lastDecision,
    createdAt: pickString(row, ["created_at", "createdAt"]) ?? new Date().toISOString(),
    updatedAt: pickString(row, ["updated_at", "updatedAt"]) ?? new Date().toISOString(),
    dailyTimeBudgetHours:
      pickNumber(config, ["daily_time_budget_hours", "dailyTimeBudgetHours"]) ??
      pickNumber(row, ["daily_time_budget_hours", "dailyTimeBudgetHours"]),
    dailyCostBudgetUsd:
      pickNumber(config, ["daily_cost_budget_usd", "dailyCostBudgetUsd"]) ??
      pickNumber(row, ["daily_cost_budget_usd", "dailyCostBudgetUsd"]),
    todayEstimatedSpendUsd:
      pickNumber(config, ["today_estimated_spend_usd", "todayEstimatedSpendUsd"]) ??
      pickNumber(row, ["today_estimated_spend_usd", "todayEstimatedSpendUsd"]),
  };
}

function mapEventRow(row: RowRecord): SgaEvent {
  const id = pickString(row, ["id", "event_id"]) ?? fallbackId("sga-event");
  const kindRaw =
    pickString(row, ["kind", "event_kind", "event_type", "type"]) ?? "plan_update";
  const severityRaw = pickString(row, ["severity", "severity_label"]);
  const severity =
    severityRaw === "info" || severityRaw === "low" || severityRaw === "medium" || severityRaw === "high"
      ? severityRaw
      : undefined;
  return {
    id,
    instanceId: pickString(row, ["instance_id", "instanceId"]) ?? "",
    kind: coerceEventKind(kindRaw),
    createdAt: pickString(row, ["created_at", "createdAt", "ts"]) ?? new Date().toISOString(),
    title: pickString(row, ["title", "label"]) ?? "Plan update",
    summary: pickString(row, ["summary", "description", "body"]) ?? "",
    severity,
  };
}

function mapGovernorLogRow(row: RowRecord, instanceId: string): SgaEvent {
  const id = pickString(row, ["id"]) ?? fallbackId("sga-log");
  const logType = pickString(row, ["log_type", "type"]) ?? "log";
  const metadata = parseJsonRecord(row.metadata) ?? {};
  const severityRaw = pickString(metadata, ["severity"]) ?? pickString(row, ["severity"]);
  const severity =
    severityRaw === "info" || severityRaw === "low" || severityRaw === "medium" || severityRaw === "high"
      ? severityRaw
      : undefined;

  const normalized = logType.replace(/_/g, " ").trim();
  const title = normalized
    ? normalized.replace(/\b\w/g, (char) => char.toUpperCase())
    : "Governor log";

  return {
    id,
    instanceId,
    kind: coerceEventKind(mapLogTypeToKind(logType)),
    createdAt: pickString(row, ["created_at", "createdAt"]) ?? new Date().toISOString(),
    title,
    summary: pickString(row, ["content"]) ?? "",
    severity,
  };
}

function mapLogTypeToKind(logType: string): SgaEventKind {
  const lower = logType.toLowerCase();
  if (lower.includes("risk")) return "risk_update";
  if (lower.includes("plan")) return "plan_update";
  if (lower.includes("delegate") || lower.includes("task")) return "delegated_task";
  if (lower.includes("verify")) return "verification";
  if (lower.includes("pause")) return "system_pause";
  if (lower.includes("resume")) return "system_resume";
  if (lower.includes("error") || lower.includes("fail")) return "error";
  if (lower.includes("feedback")) return "human_feedback";
  if (lower.includes("action")) return "external_action";
  return "situation_scan";
}

function mapWorldState(row: RowRecord, instanceId: string): SgaWorldState {
  const payload =
    parseJsonRecord(row.phase_data) ??
    parseJsonRecord(row.state) ??
    parseJsonRecord(row.snapshot) ??
    parseJsonRecord(row.world_state) ??
    {};
  const constraints = parseStringArray(payload.constraints ?? payload.constraint_list);
  const risks = parseRecordArray(payload.riskRegister ?? payload.risk_register).map((item, index) => {
    const levelRaw = pickString(item, ["level", "risk_level"]) ?? "low";
    const level = normalizeRiskLevel(levelRaw);
    return {
      id: pickString(item, ["id"]) ?? `risk-${index + 1}`,
      label: pickString(item, ["label", "title"]) ?? "Unlabeled risk",
      level,
      note: pickString(item, ["note", "summary", "description"]) ?? "",
    };
  });
  const capabilities = parseRecordArray(payload.capabilitiesSummary ?? payload.capabilities).map((item, index) => {
    const kindRaw = pickString(item, ["kind", "type"]) ?? "monitor";
    const kind =
      kindRaw === "data_source" || kindRaw === "action" || kindRaw === "agent" || kindRaw === "monitor"
        ? kindRaw
        : "monitor";
    const riskRaw = pickString(item, ["riskLevel", "risk_level"]) ?? "low";
    const riskLevel = normalizeRiskLevel(riskRaw);
    return {
      id: pickString(item, ["id"]) ?? `cap-${index + 1}`,
      displayName: pickString(item, ["displayName", "name", "label"]) ?? "Unnamed capability",
      kind,
      domainTags: parseStringArray(item.domainTags ?? item.domain_tags),
      riskLevel,
    };
  });
  const openTasks = parseRecordArray(payload.openTasks ?? payload.open_tasks).map((item, index) => {
    const statusRaw = pickString(item, ["status"]) ?? "planned";
    const status =
      statusRaw === "planned" || statusRaw === "in_progress" || statusRaw === "blocked" || statusRaw === "done"
        ? statusRaw
        : "planned";
    return {
      id: pickString(item, ["id"]) ?? `task-${index + 1}`,
      label: pickString(item, ["label", "title"]) ?? "Untitled task",
      status,
    };
  });

  const budgetsRecord = parseJsonRecord(payload.budgets) ?? {};

  return {
    instanceId,
    lastUpdatedAt:
      pickString(row, ["updated_at", "last_updated_at", "lastUpdatedAt"]) ?? new Date().toISOString(),
    currentObjective:
      pickString(payload, ["currentObjective", "current_objective"]) ?? "Maintain continuity across operations.",
    constraints,
    riskRegister: risks,
    capabilitiesSummary: capabilities,
    openTasks,
    budgets: {
      dailyTimeBudgetHours:
        pickNumber(budgetsRecord, ["dailyTimeBudgetHours", "daily_time_budget_hours"]) ??
        pickNumber(row, ["daily_time_budget_hours"]),
      dailyCostBudgetUsd:
        pickNumber(budgetsRecord, ["dailyCostBudgetUsd", "daily_cost_budget_usd"]) ??
        pickNumber(row, ["daily_cost_budget_usd"]),
      todayEstimatedSpendUsd:
        pickNumber(budgetsRecord, ["todayEstimatedSpendUsd", "today_estimated_spend_usd"]) ??
        pickNumber(row, ["today_estimated_spend_usd"]),
    },
  };
}

function mockInstances(): SgaInstance[] {
  const now = new Date();
  return [
    {
      id: "sga-prod-ops",
      name: "Production Ops",
      environmentLabel: "Prod App Ops",
      status: "coordinating",
      assuranceLevel: 2,
      primaryObjective: "Prevent incident regression while coordinating the Q1 rollout.",
      lastDecisionAt: new Date(now.getTime() - 1000 * 60 * 12).toISOString(),
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 12).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 20).toISOString(),
      dailyTimeBudgetHours: 6,
      dailyCostBudgetUsd: 120,
      todayEstimatedSpendUsd: 38.2,
    },
    {
      id: "sga-uat",
      name: "UAT Steering",
      environmentLabel: "Side Project UAT",
      status: "planning",
      assuranceLevel: 1,
      primaryObjective: "Coordinate release readiness checks for the UAT cluster.",
      lastDecisionAt: new Date(now.getTime() - 1000 * 60 * 55).toISOString(),
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 4).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 45).toISOString(),
      dailyTimeBudgetHours: 3,
      dailyCostBudgetUsd: 45,
      todayEstimatedSpendUsd: 12.8,
    },
  ];
}

function buildFallbackInstance(instanceId: string): SgaInstance {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    name: "Self-Governing Agent",
    environmentLabel: "Primary Ops",
    status: "idle",
    assuranceLevel: 1,
    primaryObjective: "Define objectives for this SGA instance.",
    lastDecisionAt: null,
    createdAt: now,
    updatedAt: now,
    dailyTimeBudgetHours: null,
    dailyCostBudgetUsd: null,
    todayEstimatedSpendUsd: null,
  };
}

function mockEvents(instanceId: string): SgaEvent[] {
  const now = Date.now();
  return [
    {
      id: `${instanceId}-evt-1`,
      instanceId,
      kind: "situation_scan",
      createdAt: new Date(now - 1000 * 60 * 90).toISOString(),
      title: "System scan complete",
      summary: "Detected elevated latency in two API regions. Queue depth stabilized after cache warm-up.",
      severity: "low",
    },
    {
      id: `${instanceId}-evt-2`,
      instanceId,
      kind: "risk_update",
      createdAt: new Date(now - 1000 * 60 * 50).toISOString(),
      title: "Risk register refreshed",
      summary: "Added new risk for deployment overlap with billing pipeline maintenance window.",
      severity: "medium",
    },
    {
      id: `${instanceId}-evt-3`,
      instanceId,
      kind: "plan_update",
      createdAt: new Date(now - 1000 * 60 * 30).toISOString(),
      title: "Plan re-sequenced",
      summary: "Shifted rollout tasks to align with infra freeze. Delegations queued for verification agents.",
      severity: "info",
    },
  ];
}

function mockWorldState(instanceId: string): SgaWorldState {
  return {
    instanceId,
    lastUpdatedAt: new Date().toISOString(),
    currentObjective: "Hold system reliability while coordinating Q1 launch checkpoints.",
    constraints: [
      "Do not modify billing infrastructure directly.",
      "Escalate approvals for any database schema changes.",
      "Avoid production deploys during the 02:00-04:00 UTC window.",
    ],
    riskRegister: [
      { id: "risk-1", label: "Release overlap", level: "medium", note: "Two services share a migration window." },
      { id: "risk-2", label: "On-call fatigue", level: "low", note: "Rotation coverage below target mid-week." },
    ],
    capabilitiesSummary: [
      {
        id: "cap-1",
        displayName: "Incident telemetry",
        kind: "data_source",
        domainTags: ["observability", "alerts"],
        riskLevel: "low",
      },
      {
        id: "cap-2",
        displayName: "Deployment coordinator",
        kind: "agent",
        domainTags: ["release", "change-mgmt"],
        riskLevel: "medium",
      },
      {
        id: "cap-3",
        displayName: "Human escalation",
        kind: "action",
        domainTags: ["approval", "review"],
        riskLevel: "low",
      },
    ],
    openTasks: [
      { id: "task-1", label: "Review canary telemetry", status: "in_progress" },
      { id: "task-2", label: "Confirm rollback checklist", status: "planned" },
      { id: "task-3", label: "Validate billing impact summary", status: "blocked" },
    ],
    budgets: {
      dailyTimeBudgetHours: 6,
      dailyCostBudgetUsd: 120,
      todayEstimatedSpendUsd: 38.2,
    },
  };
}

export async function loadSgaInstances(): Promise<SgaInstance[]> {
  try {
    const supabase = await supabaseServer();
    const userId = await requireUserIdServer();
    const supabaseAny = supabase as any;
    const { data, error } = await supabaseAny
      .from("governor_instances")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => mapInstanceRow(row as RowRecord));
  } catch (error) {
    if (isMissingTableError(error)) {
      // TODO: Replace mock instances with Supabase-backed data when governor_instances is ready.
      return mockInstances();
    }
    // If Supabase is unavailable, fall back to mocks for now.
    return mockInstances();
  }
}

export async function loadSgaInstance(instanceId: string): Promise<SgaInstance | null> {
  if (!instanceId) return null;
  try {
    const supabase = await supabaseServer();
    const userId = await requireUserIdServer();
    const supabaseAny = supabase as any;
    const { data, error } = await supabaseAny
      .from("governor_instances")
      .select("*")
      .eq("id", instanceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return mapInstanceRow(data as RowRecord);
    }
    return null;
  } catch (error) {
    if (isMissingTableError(error)) {
      // TODO: Replace mock instance with Supabase-backed data when governor_instances is ready.
      return mockInstances().find((instance) => instance.id === instanceId) ?? buildFallbackInstance(instanceId);
    }
    return null;
  }
}

export async function loadSgaEvents(instanceId: string, limit = 50): Promise<SgaEvent[]> {
  if (!instanceId) return [];
  try {
    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;
    const owner = await loadSgaInstance(instanceId);
    if (!owner) return [];

    const { data: runs, error: runsError } = await supabaseAny
      .from("governor_runs")
      .select("id")
      .eq("instance_id", instanceId)
      .order("updated_at", { ascending: false });

    if (runsError) {
      throw runsError;
    }

    const runIds = (runs ?? []).map((run: any) => run.id).filter(Boolean);
    if (!runIds.length) return [];

    const { data, error } = await supabaseAny
      .from("governor_logs")
      .select("*")
      .in("run_id", runIds)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => mapGovernorLogRow(row as RowRecord, instanceId));
  } catch (error) {
    if (isMissingTableError(error)) {
      // TODO: Replace mock events with Supabase-backed data when governor_logs is ready.
      return mockEvents(instanceId);
    }
    return mockEvents(instanceId);
  }
}

export async function loadSgaWorldState(instanceId: string): Promise<SgaWorldState | null> {
  if (!instanceId) return null;
  try {
    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;
    const owner = await loadSgaInstance(instanceId);
    if (!owner) return null;
    const { data, error } = await supabaseAny
      .from("governor_runs")
      .select("*")
      .eq("instance_id", instanceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapWorldState(data as RowRecord, instanceId) : null;
  } catch (error) {
    if (isMissingTableError(error)) {
      // TODO: Replace mock world state with Supabase-backed data when governor_runs is ready.
      return mockWorldState(instanceId);
    }
    return mockWorldState(instanceId);
  }
}

export async function createSgaInstance(params: {
  name?: string | null;
  environmentLabel?: string | null;
  assuranceLevel?: 0 | 1 | 2 | 3;
  dailyTimeBudgetHours?: number | null;
  dailyCostBudgetUsd?: number | null;
}): Promise<SgaInstance> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const config = {
    environment_label: params.environmentLabel ?? "Primary Ops",
    assurance_level: params.assuranceLevel ?? 1,
    primary_objective: "Define the primary objective for this SGA.",
    daily_time_budget_hours: params.dailyTimeBudgetHours ?? null,
    daily_cost_budget_usd: params.dailyCostBudgetUsd ?? null,
    sga_status: "idle",
  };

  const payload = {
    user_id: userId,
    label: params.name ?? "Self-Governing Agent",
    status: "active",
    config,
  };

  const { data, error } = await supabaseAny
    .from("governor_instances")
    .insert([payload])
    .select("*")
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to create SGA instance: ${error?.message ?? "Unknown error"}`);
  }

  return mapInstanceRow(data as RowRecord);
}

export async function updateSgaStatus(instanceId: string, status: SgaStatus) {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const nextSgaStatus = STATUS_VALUES.includes(status) ? status : "idle";
  const governorStatus = nextSgaStatus === "paused" ? "paused" : "active";

  const { data: existing, error: existingError } = await supabaseAny
    .from("governor_instances")
    .select("config")
    .eq("id", instanceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to load SGA instance: ${existingError.message}`);
  }

  const config = parseJsonRecord((existing as RowRecord | null)?.config) ?? {};
  const nextConfig = { ...config, sga_status: nextSgaStatus };

  const { error } = await supabaseAny
    .from("governor_instances")
    .update({ status: governorStatus, config: nextConfig, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update SGA instance status: ${error.message}`);
  }
}
