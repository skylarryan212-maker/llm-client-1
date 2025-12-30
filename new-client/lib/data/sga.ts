import { supabaseServer, supabaseServerAdmin } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { Database, Json } from "@/lib/supabase/types";
import type {
  SgaAuthorityLevel,
  SgaConnection,
  SgaConnectionAuthType,
  SgaConnectionPermission,
  SgaEvent,
  SgaEventKind,
  SgaInstance,
  SgaPolicy,
  SgaStatus,
  SgaWorldState,
} from "@/lib/types/sga";

type RowRecord = Record<string, unknown>;
type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

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

export type SgaChatMessage = {
  id: string;
  role: "user" | "agent" | "system" | "assistant";
  content: string;
  created_at: string | null;
  metadata: Json | null;
};

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

function coerceAuthorityLevel(value: unknown): SgaAuthorityLevel {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4) {
    return parsed as SgaAuthorityLevel;
  }
  return 2;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string") as string[];
}

function parseFlexibleStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return parseStringArray(value);
  if (typeof value === "string") {
    return value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
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

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizePermission(value: unknown): SgaConnectionPermission {
  if (value === "read" || value === "write" || value === "read_write" || value === "custom") {
    return value;
  }
  return "read";
}

function normalizeAuthType(value: unknown): SgaConnectionAuthType {
  if (value === "none" || value === "api_key" || value === "bearer" || value === "basic") {
    return value;
  }
  return "none";
}

function parseHeaders(value: unknown): Record<string, string> {
  const record = parseJsonRecord(value);
  if (!record) return {};
  const entries = Object.entries(record);
  const next: Record<string, string> = {};
  entries.forEach(([key, entryValue]) => {
    if (typeof entryValue === "string") {
      next[key] = entryValue;
    }
  });
  return next;
}

function parsePolicy(value: unknown): SgaPolicy {
  const record = parseJsonRecord(value) ?? {};
  const risk = parseJsonRecord(record.risk_budget ?? record.riskBudget) ?? {};
  const cost = parseJsonRecord(record.cost_budget ?? record.costBudget) ?? {};
  const time = parseJsonRecord(record.time_budget ?? record.timeBudget) ?? {};
  const throttle = parseJsonRecord(record.throttle_rules ?? record.throttleRules) ?? {};

  return {
    allowedActions: parseStringArray(record.allowed_actions ?? record.allowedActions ?? DEFAULT_POLICY.allowedActions),
    forbiddenActions: parseStringArray(record.forbidden_actions ?? record.forbiddenActions ?? DEFAULT_POLICY.forbiddenActions),
    approvalRequiredActions: parseStringArray(
      record.approval_required_actions ?? record.approvalRequiredActions ?? DEFAULT_POLICY.approvalRequiredActions
    ),
    riskBudget: {
      maxHighRiskActionsPerWeek:
        pickNumber(risk, ["max_high_risk_actions_per_week", "maxHighRiskActionsPerWeek"]) ??
        DEFAULT_POLICY.riskBudget.maxHighRiskActionsPerWeek,
      maxMediumRiskPerDay:
        pickNumber(risk, ["max_medium_risk_per_day", "maxMediumRiskPerDay"]) ??
        DEFAULT_POLICY.riskBudget.maxMediumRiskPerDay,
    },
    costBudget: {
      monthlyUsdCap:
        pickNumber(cost, ["monthly_usd_cap", "monthlyUsdCap"]) ?? DEFAULT_POLICY.costBudget.monthlyUsdCap,
      dailyUsdCap: pickNumber(cost, ["daily_usd_cap", "dailyUsdCap"]) ?? DEFAULT_POLICY.costBudget.dailyUsdCap,
      perTaskUsdCap:
        pickNumber(cost, ["per_task_usd_cap", "perTaskUsdCap"]) ?? DEFAULT_POLICY.costBudget.perTaskUsdCap,
    },
    timeBudget: {
      dailyActiveWindowMinutes:
        pickNumber(time, ["daily_active_window_minutes", "dailyActiveWindowMinutes"]) ??
        DEFAULT_POLICY.timeBudget.dailyActiveWindowMinutes,
      maxCycleSeconds:
        pickNumber(time, ["max_cycle_seconds", "maxCycleSeconds"]) ?? DEFAULT_POLICY.timeBudget.maxCycleSeconds,
    },
    throttleRules: {
      minMinutesBetweenCyclesNormal:
        pickNumber(throttle, ["min_minutes_between_cycles_normal", "minMinutesBetweenCyclesNormal"]) ??
        DEFAULT_POLICY.throttleRules.minMinutesBetweenCyclesNormal,
      minMinutesBetweenCyclesAlert:
        pickNumber(throttle, ["min_minutes_between_cycles_alert", "minMinutesBetweenCyclesAlert"]) ??
        DEFAULT_POLICY.throttleRules.minMinutesBetweenCyclesAlert,
      maxCyclesPerDay:
        pickNumber(throttle, ["max_cycles_per_day", "maxCyclesPerDay"]) ?? DEFAULT_POLICY.throttleRules.maxCyclesPerDay,
    },
  };
}

function parseConnections(value: unknown, options?: { includeSecrets?: boolean }): SgaConnection[] {
  const records = parseRecordArray(value);
  return records.map((record, index) => {
    const id = pickString(record, ["id"]) ?? `conn-${index + 1}`;
    const name = pickString(record, ["name", "label"]) ?? "Connection";
    const permission = normalizePermission(pickString(record, ["permission", "access"]));
    const allowList = parseFlexibleStringArray(record.allow_list ?? record.allowList ?? record.allow);
    const denyList = parseFlexibleStringArray(record.deny_list ?? record.denyList ?? record.deny);
    const baseUrl = pickString(record, ["base_url", "baseUrl"]) ?? "";
    const readEndpoints = parseFlexibleStringArray(record.read_endpoints ?? record.readEndpoints ?? record.endpoints);
    const headers = parseHeaders(record.headers);
    const authType = normalizeAuthType(pickString(record, ["auth_type", "authType"]));
    const authHeader = pickString(record, ["auth_header", "authHeader"]);
    const rawAuthValue = pickString(record, ["auth_value", "authValue"]);
    return {
      id,
      name,
      baseUrl,
      permission,
      allowList,
      denyList,
      readEndpoints,
      headers,
      authType,
      authHeader,
      authValue: options?.includeSecrets ? rawAuthValue ?? null : null,
      hasAuthValue: !!rawAuthValue,
    };
  });
}

function normalizeRiskLevel(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "low";
}

function normalizeCapabilityKind(value: unknown): "data_source" | "action" | "agent" | "monitor" {
  if (
    value === "data_source" ||
    value === "action" ||
    value === "agent" ||
    value === "monitor"
  ) {
    return value;
  }
  return "monitor";
}

function normalizeTaskStatus(value: unknown): "planned" | "in_progress" | "blocked" | "done" {
  if (value === "planned" || value === "in_progress" || value === "blocked" || value === "done") {
    return value;
  }
  return "planned";
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

function mapInstanceRow(row: RowRecord, options?: { includeSecrets?: boolean }): SgaInstance {
  const id = pickString(row, ["id", "instance_id"]) ?? fallbackId("sga");
  const config = parseJsonRecord(row.config) ?? {};
  const statusOverride = pickString(config, ["sga_status", "status", "sgaStatus"]);
  const governorStatus = pickString(row, ["status"]) ?? "active";
  const status = statusOverride
    ? coerceStatus(statusOverride)
    : governorStatus === "paused"
      ? "paused"
      : governorStatus === "not_started"
        ? "idle"
        : governorStatus === "archived"
          ? "error"
          : "coordinating";
  const lastDecision =
    pickString(config, ["last_decision_at", "lastDecisionAt"]) ??
    pickString(row, ["last_decision_at", "lastDecisionAt", "updated_at", "updatedAt"]);
  const policy = parsePolicy(config.policy ?? config.policy_settings);
  const connections = parseConnections(config.connections ?? config.connection_map, options);
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
    authorityLevel: coerceAuthorityLevel(
      pickNumber(config, ["authority_level", "authorityLevel"]) ??
        pickNumber(row, ["authority_level", "authorityLevel"]) ??
        2
    ),
    policy,
    connections,
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
    metadata,
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

function stripQueryString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
  }
}

function mergeEventLists(primary: SgaEvent[], secondary: SgaEvent[]): SgaEvent[] {
  const map = new Map<string, SgaEvent>();
  const add = (event: SgaEvent) => {
    const key = `${event.kind}-${event.createdAt}-${event.title}-${event.summary}`;
    if (!map.has(key)) {
      map.set(key, event);
    }
  };
  primary.forEach(add);
  secondary.forEach(add);
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

function buildObservationEventsFromRuns(runs: RowRecord[], instanceId: string): SgaEvent[] {
  const events: SgaEvent[] = [];
  runs.forEach((row, runIndex) => {
    const runId = pickString(row, ["id", "run_id"]) ?? `run-${runIndex + 1}`;
    const phaseData = parseJsonRecord(row.phase_data) ?? {};
    const observation = parseJsonRecord(phaseData.observation) ?? {};
    const createdAt =
      pickString(row, ["updated_at", "created_at"]) ?? new Date().toISOString();
    const summary =
      pickString(observation, ["summary"]) ??
      pickString(phaseData, ["summary"]) ??
      "Observation cycle completed.";
    const failures = pickNumber(observation, ["failures"]) ?? 0;
    const severity: SgaEvent["severity"] =
      failures > 3 ? "high" : failures > 0 ? "medium" : "info";

    events.push({
      id: `${runId}-summary`,
      instanceId,
      kind: "situation_scan",
      createdAt,
      title: "Observation cycle",
      summary,
      severity,
    });

    const resultsRaw =
      observation.results ??
      observation.result ??
      observation.connections ??
      [];
    const reports = parseRecordArray(parseJsonArray(resultsRaw));
    reports.forEach((report, reportIndex) => {
      const name =
        pickString(report, ["name", "connection", "label"]) ??
        `Connection ${reportIndex + 1}`;
      const skipped = report.skipped === true || report.skipped === "true";
      const reason = pickString(report, ["reason"]) ?? "Skipped";
      if (skipped) {
        events.push({
          id: `${runId}-connection-${reportIndex}-skipped`,
          instanceId,
          kind: "situation_scan",
          createdAt,
          title: `Connection ${name}`,
          summary: `Skipped: ${reason}`,
          severity: "info",
          metadata: report,
        });
        return;
      }

      const endpointsRaw =
        report.endpoints ??
        report.endpointResults ??
        report.endpoint_results ??
        [];
      const endpoints = parseRecordArray(parseJsonArray(endpointsRaw));
      const failuresForConnection = endpoints.filter(
        (endpoint) => endpoint.ok === false || endpoint.ok === "false"
      ).length;
      events.push({
        id: `${runId}-connection-${reportIndex}`,
        instanceId,
        kind: "situation_scan",
        createdAt,
        title: `Connection ${name}`,
        summary: `${endpoints.length} endpoints, ${failuresForConnection} failures`,
        severity: failuresForConnection > 0 ? "medium" : "info",
        metadata: report,
      });

      endpoints.forEach((endpoint, endpointIndex) => {
        const url = pickString(endpoint, ["url", "endpoint"]) ?? "";
        const endpointLabel = url ? stripQueryString(url) : "endpoint";
        const ok = endpoint.ok === true || endpoint.ok === "true";
        const statusValue = pickNumber(endpoint, ["status"]);
        const statusLabel =
          statusValue !== null ? String(statusValue) : ok ? "ok" : "error";
        const durationMs = pickNumber(endpoint, ["durationMs", "duration_ms"]);
        const durationLabel =
          durationMs !== null ? `${Math.round(durationMs)}ms` : "n/a";
        const preview = pickString(endpoint, ["preview"]) ?? "";
        const metadata: Record<string, unknown> = {
          connection: name,
          endpoint: pickString(endpoint, ["endpoint"]) ?? null,
          url: url ? stripQueryString(url) : null,
          ok,
          status: statusValue,
          durationMs,
        };
        if (preview) {
          metadata.preview = preview;
        }

        events.push({
          id: `${runId}-endpoint-${reportIndex}-${endpointIndex}`,
          instanceId,
          kind: "situation_scan",
          createdAt,
          title: `GET ${endpointLabel} -> ${statusLabel} (${durationLabel})`,
          summary: "",
          severity: ok ? "info" : "medium",
          metadata,
        });
      });
    });
  });
  return events;
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
    const kind = normalizeCapabilityKind(kindRaw);
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
    const status = normalizeTaskStatus(statusRaw);
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
      authorityLevel: 2,
      policy: { ...DEFAULT_POLICY },
      connections: [],
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
      authorityLevel: 1,
      policy: { ...DEFAULT_POLICY },
      connections: [],
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
    authorityLevel: 2,
    policy: { ...DEFAULT_POLICY },
    connections: [],
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

    return (data ?? []).map((row: RowRecord) => mapInstanceRow(row));
  } catch (error) {
    if (isMissingTableError(error)) {
      // TODO: Replace mock instances with Supabase-backed data when governor_instances is ready.
      return mockInstances();
    }
    // If Supabase is unavailable, fall back to mocks for now.
    return mockInstances();
  }
}

export async function loadSgaInstance(
  instanceId: string,
  options?: { includeSecrets?: boolean }
): Promise<SgaInstance | null> {
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
      return mapInstanceRow(data as RowRecord, options);
    }
    return null;
  } catch (error) {
    if (isMissingTableError(error)) {
      // TODO: Replace mock instance with Supabase-backed data when governor_instances is ready.
      return (
        mockInstances().find((instance) => instance.id === instanceId) ?? buildFallbackInstance(instanceId)
      );
    }
    return null;
  }
}

export async function loadSgaInstanceAdmin(
  instanceId: string,
  options?: { includeSecrets?: boolean }
): Promise<SgaInstance | null> {
  if (!instanceId) return null;
  const supabase = await supabaseServerAdmin();
  const supabaseAny = supabase as any;
  const { data, error } = await supabaseAny
    .from("governor_instances")
    .select("*")
    .eq("id", instanceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load SGA instance (admin): ${error.message}`);
  }

  return data ? mapInstanceRow(data as RowRecord, options) : null;
}

export async function listSgaInstancesAdmin(): Promise<SgaInstance[]> {
  const supabase = await supabaseServerAdmin();
  const supabaseAny = supabase as any;
  const { data, error } = await supabaseAny
    .from("governor_instances")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load SGA instances (admin): ${error.message}`);
  }

  return (data ?? []).map((row: RowRecord) => mapInstanceRow(row));
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
      .select("id, created_at, updated_at, phase_data")
      .eq("instance_id", instanceId)
      .order("updated_at", { ascending: false });

    if (runsError) {
      throw runsError;
    }

    const runRows = (runs ?? []) as RowRecord[];
    const runIds = runRows.map((run: any) => run.id).filter(Boolean);
    const runEvents = buildObservationEventsFromRuns(runRows, instanceId);

    const { data: logsByInstance, error: logsByInstanceError } = await supabaseAny
      .from("governor_logs")
      .select("*")
      .eq("instance_id", instanceId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (logsByInstanceError) {
      throw logsByInstanceError;
    }

    let logEvents: SgaEvent[] = [];
    if (logsByInstance && logsByInstance.length > 0) {
      logEvents = logsByInstance.map((row: RowRecord) => mapGovernorLogRow(row, instanceId));
    }

    if (logEvents.length === 0 && runIds.length > 0) {
      const { data: logsByRun, error: logsByRunError } = await supabaseAny
        .from("governor_logs")
        .select("*")
        .in("run_id", runIds)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (logsByRunError) {
        throw logsByRunError;
      }

      if (logsByRun && logsByRun.length > 0) {
        logEvents = logsByRun.map((row: RowRecord) => mapGovernorLogRow(row, instanceId));
      }
    }

    const shouldAugmentFromRuns = logEvents.length < 3;
    const merged = shouldAugmentFromRuns
      ? mergeEventLists(logEvents, runEvents)
      : logEvents;
    if (merged.length === 0) {
      return [];
    }
    if (merged.length <= limit) {
      return merged;
    }
    return merged.slice(merged.length - limit);
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
  authorityLevel?: SgaAuthorityLevel;
  dailyTimeBudgetHours?: number | null;
  dailyCostBudgetUsd?: number | null;
}): Promise<SgaInstance> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const config = {
    environment_label: params.environmentLabel ?? "Primary Ops",
    assurance_level: params.assuranceLevel ?? 1,
    authority_level: params.authorityLevel ?? 2,
    primary_objective: "Define the primary objective for this SGA.",
    daily_time_budget_hours: params.dailyTimeBudgetHours ?? null,
    daily_cost_budget_usd: params.dailyCostBudgetUsd ?? null,
    sga_status: "idle",
  };

  const payload = {
    user_id: userId,
    label: params.name ?? "Self-Governing Agent",
    status: "not_started",
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

export async function updateSgaAssuranceLevel(instanceId: string, assuranceLevel: 0 | 1 | 2 | 3) {
  if (!instanceId) {
    throw new Error("Invalid instance id");
  }
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

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
  const nextConfig = { ...config, assurance_level: assuranceLevel };

  const { error } = await supabaseAny
    .from("governor_instances")
    .update({ config: nextConfig, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update assurance level: ${error.message}`);
  }
}

export async function updateSgaAuthorityLevel(instanceId: string, authorityLevel: SgaAuthorityLevel) {
  if (!instanceId) {
    throw new Error("Invalid instance id");
  }
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

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
  const nextConfig = { ...config, authority_level: authorityLevel };

  const { error } = await supabaseAny
    .from("governor_instances")
    .update({ config: nextConfig, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update authority level: ${error.message}`);
  }
}

export async function updateSgaBudgets(instanceId: string, params: { dailyTimeBudgetHours: number | null; dailyCostBudgetUsd: number | null }) {
  if (!instanceId) {
    throw new Error("Invalid instance id");
  }
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

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
  const nextConfig = {
    ...config,
    daily_time_budget_hours: params.dailyTimeBudgetHours,
    daily_cost_budget_usd: params.dailyCostBudgetUsd,
  };

  const { error } = await supabaseAny
    .from("governor_instances")
    .update({ config: nextConfig, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update budgets: ${error.message}`);
  }
}

export async function updateSgaPolicy(instanceId: string, policy: SgaPolicy) {
  if (!instanceId) {
    throw new Error("Invalid instance id");
  }
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

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
  const nextConfig = { ...config, policy };

  const { error } = await supabaseAny
    .from("governor_instances")
    .update({ config: nextConfig, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update policy: ${error.message}`);
  }
}

export async function updateSgaConnections(instanceId: string, connections: SgaConnection[]) {
  if (!instanceId) {
    throw new Error("Invalid instance id");
  }
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

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
  const previousConnections = parseConnections(config.connections ?? config.connection_map, {
    includeSecrets: true,
  });
  const normalizedConnections = connections.map((conn) => {
    const previous = previousConnections.find((item) => item.id === conn.id);
    const trimmedAuthValue = conn.authValue?.trim();
    const nextAuthType = conn.authType ?? previous?.authType ?? "none";
    const nextAuthValue =
      nextAuthType === "none"
        ? null
        : trimmedAuthValue && trimmedAuthValue.length > 0
          ? trimmedAuthValue
          : previous?.authValue ?? null;
    const nextAuthHeaderRaw =
      conn.authHeader && conn.authHeader.trim()
        ? conn.authHeader.trim()
        : previous?.authHeader ?? null;
    const nextAuthHeader = nextAuthType === "none" ? null : nextAuthHeaderRaw;
    return {
      id: conn.id || previous?.id || fallbackId("conn"),
      name: conn.name?.trim() || previous?.name || "Connection",
      baseUrl: conn.baseUrl?.trim() || previous?.baseUrl || "",
      permission: conn.permission ?? previous?.permission ?? "read",
      allowList: conn.allowList ?? previous?.allowList ?? [],
      denyList: conn.denyList ?? previous?.denyList ?? [],
      readEndpoints: conn.readEndpoints ?? previous?.readEndpoints ?? [],
      headers: conn.headers ?? previous?.headers ?? {},
      authType: nextAuthType,
      authHeader: nextAuthHeader,
      authValue: nextAuthValue,
    };
  });
  const nextConfig = { ...config, connections: normalizedConnections };

  const { error } = await supabaseAny
    .from("governor_instances")
    .update({ config: nextConfig, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update connections: ${error.message}`);
  }
}

export async function renameSgaInstance(instanceId: string, name: string) {
  if (!instanceId) {
    throw new Error("Invalid instance id");
  }
  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new Error("Instance name is required");
  }
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  const { error } = await supabase
    .from("governor_instances")
    .update({ label: trimmedName, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to rename SGA instance: ${error.message}`);
  }
}

export async function deleteSgaInstance(instanceId: string) {
  if (!instanceId) {
    throw new Error("Invalid instance id");
  }
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  const { error } = await supabase
    .from("governor_instances")
    .delete()
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete SGA instance: ${error.message}`);
  }
}

export async function findSgaConversation(instanceId: string): Promise<ConversationRow | null> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const { data, error } = await supabaseAny
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .eq("metadata->>agent", "sga")
    .eq("metadata->>sga_instance_id", instanceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (String((error as any)?.code || "").startsWith("PGRST") || error.message?.includes("Results contain 0 rows")) {
      return null;
    }
    throw new Error(`Failed to lookup SGA conversation: ${error.message}`);
  }

  return data ?? null;
}

export async function ensureSgaConversation(instanceId: string): Promise<ConversationRow> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const existing = await findSgaConversation(instanceId);
  if (existing) return existing;

  const metadata = {
    agent: "sga",
    agent_type: "sga",
    sga_instance_id: instanceId,
    agent_chat: true,
  };

  const { data, error } = await supabaseAny
    .from("conversations")
    .insert([
      {
        user_id: userId,
        title: "Self-Governing Agent",
        project_id: null,
        metadata,
      },
    ])
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create SGA conversation: ${error?.message ?? "Unknown error"}`);
  }

  return data as ConversationRow;
}

export async function listSgaMessages(instanceId: string, limit = 200): Promise<SgaChatMessage[]> {
  if (!instanceId) return [];
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const conversation = await ensureSgaConversation(instanceId);

  const { data, error } = await supabaseAny
    .from("messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .eq("user_id", userId)
    .eq("metadata->>agent", "sga")
    .eq("metadata->>sga_instance_id", instanceId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load SGA chat messages: ${error.message}`);
  }

  return (data ?? []).map((row: MessageRow) => ({
    id: row.id,
    role: (row.role as SgaChatMessage["role"]) ?? "user",
    content: row.content ?? "",
    created_at: row.created_at ?? null,
    metadata: (row as any).metadata ?? null,
  }));
}

export async function insertSgaMessage(params: {
  instanceId: string;
  role: "user" | "agent" | "system" | "assistant";
  content: string;
  modelUsed?: string | null;
  resolvedFamily?: string | null;
}): Promise<SgaChatMessage> {
  if (!params.instanceId) {
    throw new Error("Invalid instance id");
  }
  const content = (params.content ?? "").trim();
  if (!content.length) {
    throw new Error("Message content is required");
  }
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const conversation = await ensureSgaConversation(params.instanceId);
  const metadata: Record<string, unknown> = {
    agent: "sga",
    sga_instance_id: params.instanceId,
  };
  if (params.modelUsed) {
    metadata.modelUsed = params.modelUsed;
  }
  if (params.resolvedFamily) {
    metadata.resolvedFamily = params.resolvedFamily;
  }

  const { data, error } = await supabaseAny
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: conversation.id,
        role: params.role,
        content,
        metadata,
      },
    ])
    .select()
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to insert SGA chat message: ${error?.message ?? "Unknown error"}`);
  }

  return {
    id: data.id,
    role: (data.role as SgaChatMessage["role"]) ?? params.role,
    content: data.content ?? content,
    created_at: data.created_at ?? null,
    metadata: (data as any).metadata ?? metadata,
  };
}
