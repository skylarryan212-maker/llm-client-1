import type { LucideIcon } from "lucide-react";
import { ClipboardList, Code2, PenLine, TrendingUp } from "lucide-react";

export type FeaturedAgent = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
};

export const FEATURED_AGENTS: FeaturedAgent[] = [
  {
    id: "market-analysis",
    name: "Market Analysis",
    description: "Sizing, competitors, positioning, and insights.",
    icon: TrendingUp,
  },
  {
    id: "product-spec",
    name: "Product Spec",
    description: "Turn ideas into clear, actionable requirements.",
    icon: ClipboardList,
  },
  {
    id: "code-review",
    name: "Code Review",
    description: "Review code for bugs, style, and structure.",
    icon: Code2,
  },
  {
    id: "writing-coach",
    name: "Writing Coach",
    description: "Improve clarity, tone, and structure quickly.",
    icon: PenLine,
  },
];

export function getFeaturedAgentById(id: string | null | undefined): FeaturedAgent | null {
  if (!id) return null;
  return FEATURED_AGENTS.find((agent) => agent.id === id) ?? null;
}

