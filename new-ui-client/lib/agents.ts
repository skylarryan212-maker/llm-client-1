export type AgentId = "default" | "codex" | "market" | "automation";

export const DEFAULT_AGENT_ID: AgentId = "default";
export const CODEX_AGENT_ID: AgentId = "codex";

const VALID_AGENT_IDS: AgentId[] = [
  DEFAULT_AGENT_ID,
  CODEX_AGENT_ID,
  "market",
  "automation",
];

export function parseAgentId(value: unknown): AgentId {
  if (typeof value !== "string") {
    return DEFAULT_AGENT_ID;
  }
  const normalized = value.trim().toLowerCase();
  const match = VALID_AGENT_IDS.find((agent) => agent === normalized);
  return match ?? DEFAULT_AGENT_ID;
}

export function agentIdFromMetadata(metadata: unknown): AgentId | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const candidate = (metadata as { agentId?: unknown }).agentId;
  if (typeof candidate !== "string") {
    return null;
  }
  const normalized = candidate.trim().toLowerCase();
  return VALID_AGENT_IDS.find((agent) => agent === normalized) ?? null;
}

export function isCodexAgent(agentId: AgentId | null | undefined) {
  return agentId === CODEX_AGENT_ID;
}
