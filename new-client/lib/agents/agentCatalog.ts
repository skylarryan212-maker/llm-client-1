import type { LucideIcon } from "lucide-react";
import { Code2, Database, PenLine, ShieldCheck, TrendingUp, Workflow } from "lucide-react";

export type AgentCatalogItem = {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  gradient?: string;
};

// This is the canonical agent list for the `/agents` experience.
// "Available" agents should have an `href` that points to an actual route.
export const AGENT_CATALOG: AgentCatalogItem[] = [
  {
    id: "sga",
    slug: "sga",
    icon: ShieldCheck,
    title: "Self-Governing Agent",
    description:
      "Observes objectives, orchestrates sub-tasks, and enforces guardrails without prompts. Keeps state, governance, and recovery flows aligned from day one.",
    href: "/sga",
    gradient: "bg-gradient-to-br from-sky-500 via-indigo-600 to-purple-700",
  },
  {
    id: "LHSA",
    slug: "LHSA",
    icon: Code2,
    title: "Long Horizon Software Agent (LHSA)",
    description:
      "Fully autonomous 24-hour engineering cycles. Deploy HOOTL protocols to build complete systems, audit architectures, and verify logic while you sleep with Assurance Level 3 reliability.",
    href: "/agents/lhsa",
    gradient: "bg-gradient-to-br from-blue-500 to-purple-600",
  },
  {
    id: "market-agent",
    slug: "market-agent",
    icon: TrendingUp,
    title: "Market Agent",
    description:
      "Real-time market analysis and insights. Track trends, analyze data, generate reports, and make data-driven decisions with AI-powered market intelligence.",
    href: "/agents/market-agent",
    gradient: "bg-gradient-to-br from-emerald-500 via-cyan-500 to-blue-600",
  },
  {
    id: "automation-builder",
    slug: "automation-builder",
    icon: Workflow,
    title: "Automation Builder",
    description:
      "Design and deploy intelligent workflows. Connect APIs, automate tasks, orchestrate complex processes, and streamline operations effortlessly.",
  },
  {
    id: "human-writing",
    slug: "human-writing",
    icon: PenLine,
    title: "Human Writing Agent",
    description:
      "Produce clear, human-quality writing fast. Draft emails, docs, and narratives with tone control and structure that feels natural.",
    href: "/agents/human-writing",
    gradient: "bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500",
  },
  {
    id: "data-interpreter",
    slug: "data-interpreter",
    icon: Database,
    title: "Data Interpreter",
    description:
      "Transform raw data into actionable insights. Analyze datasets, create visualizations, run queries, and extract meaningful patterns from your data.",
  },
];

export const AVAILABLE_AGENTS = AGENT_CATALOG.filter((agent) => Boolean(agent.href));

