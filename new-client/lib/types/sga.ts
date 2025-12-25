export type SgaStatus =
  | "idle"
  | "analyzing"
  | "planning"
  | "coordinating"
  | "executing"
  | "paused"
  | "error";

export interface SgaInstance {
  id: string;
  name: string;
  environmentLabel: string;
  status: SgaStatus;
  assuranceLevel: 0 | 1 | 2 | 3;
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
