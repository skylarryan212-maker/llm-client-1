export type SgaStatus =
  | "idle"
  | "analyzing"
  | "planning"
  | "coordinating"
  | "executing"
  | "paused"
  | "error";

export type SgaAuthorityLevel = 0 | 1 | 2 | 3 | 4;
export type SgaConnectionPermission = "read" | "write" | "read_write" | "custom";
export type SgaConnectionAuthType = "none" | "api_key" | "bearer" | "basic";

export interface SgaPolicy {
  allowedActions: string[];
  forbiddenActions: string[];
  approvalRequiredActions: string[];
  riskBudget: {
    maxHighRiskActionsPerWeek: number;
    maxMediumRiskPerDay: number;
  };
  costBudget: {
    monthlyUsdCap: number;
    dailyUsdCap: number;
    perTaskUsdCap: number;
  };
  timeBudget: {
    dailyActiveWindowMinutes: number;
    maxCycleSeconds: number;
  };
  throttleRules: {
    minMinutesBetweenCyclesNormal: number;
    minMinutesBetweenCyclesAlert: number;
    maxCyclesPerDay: number;
  };
}

export interface SgaConnection {
  id: string;
  name: string;
  baseUrl: string;
  permission: SgaConnectionPermission;
  allowList: string[];
  denyList: string[];
  readEndpoints: string[];
  headers: Record<string, string>;
  authType: SgaConnectionAuthType;
  authHeader?: string | null;
  authValue?: string | null;
  hasAuthValue?: boolean;
}

export interface SgaInstance {
  id: string;
  name: string;
  environmentLabel: string;
  status: SgaStatus;
  assuranceLevel: 0 | 1 | 2 | 3;
  authorityLevel: SgaAuthorityLevel;
  policy?: SgaPolicy;
  connections?: SgaConnection[];
  primaryObjective: string;
  lastDecisionAt: string | null;
  createdAt: string;
  updatedAt: string;
  dailyTimeBudgetHours: number | null;
  dailyCostBudgetUsd: number | null;
  todayEstimatedSpendUsd: number | null;
}

export type SgaEventKind =
  | "situation_scan"
  | "risk_update"
  | "plan_update"
  | "delegated_task"
  | "external_action"
  | "verification"
  | "human_feedback"
  | "system_pause"
  | "system_resume"
  | "error";

export interface SgaEvent {
  id: string;
  instanceId: string;
  kind: SgaEventKind;
  createdAt: string;
  title: string;
  summary: string;
  severity?: "info" | "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
}

export interface SgaWorldState {
  instanceId: string;
  lastUpdatedAt: string;
  currentObjective: string;
  constraints: string[];
  riskRegister: {
    id: string;
    label: string;
    level: "low" | "medium" | "high";
    note: string;
  }[];
  capabilitiesSummary: {
    id: string;
    displayName: string;
    kind: "data_source" | "action" | "agent" | "monitor";
    domainTags: string[];
    riskLevel: "low" | "medium" | "high";
  }[];
  openTasks: {
    id: string;
    label: string;
    status: "planned" | "in_progress" | "blocked" | "done";
  }[];
  budgets: {
    dailyTimeBudgetHours: number | null;
    dailyCostBudgetUsd: number | null;
    todayEstimatedSpendUsd: number | null;
  };
}
