import type { LucideIcon } from "lucide-react";
import { AVAILABLE_AGENTS } from "@/lib/agents/agentCatalog";

export type FeaturedAgent = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
};

// Featured agents = the ones that actually exist under `/agents` (have an href).
// Keep it capped for the compact picker UI.
export const FEATURED_AGENTS: FeaturedAgent[] = AVAILABLE_AGENTS.slice(0, 4).map((agent) => ({
  id: agent.slug,
  name: agent.title,
  description: agent.description,
  icon: agent.icon,
}));

export function getFeaturedAgentById(id: string | null | undefined): FeaturedAgent | null {
  if (!id) return null;
  return FEATURED_AGENTS.find((agent) => agent.id === id) ?? null;
}
