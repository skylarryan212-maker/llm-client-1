"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AgentCard } from "./AgentCard";

const AGENT_FILTERS = [
  "All",
  "Coding",
  "Markets",
  "Automation",
  "Data",
] as const;

type AgentFilter = (typeof AGENT_FILTERS)[number];
type AgentCategory = Exclude<AgentFilter, "All">;

type FeaturedAgent = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  iconLabel: string;
  iconHint?: string;
  category: AgentCategory;
};

const FEATURED_AGENTS: FeaturedAgent[] = [
  {
    id: "codex",
    name: "Codex",
    description:
      "Deep code assistant for debugging, refactoring, repo analysis, and large-scale project modifications.",
    tags: ["Coding", "Refactors", "TypeScript"],
    iconLabel: "CX",
    iconHint: "Code intelligence",
    category: "Coding",
  },
  {
    id: "market-agent",
    name: "Market Agent",
    description:
      "Volatility-aware market watcher for intraday monitoring, pre-open predictions, and end-of-day summaries.",
    tags: ["Markets", "Live monitoring", "Summaries"],
    iconLabel: "MA",
    iconHint: "Financial analysis",
    category: "Markets",
  },
  {
    id: "automation-builder",
    name: "Automation Builder",
    description:
      "Creates task workflows, scripts, and automations. Converts your instructions into repeatable, executable processes.",
    tags: ["Automation", "Workflows", "Scripting"],
    iconLabel: "AB",
    iconHint: "Process builder",
    category: "Automation",
  },
  {
    id: "data-interpreter",
    name: "Data Interpreter",
    description:
      "Processes spreadsheets and datasets to surface trends, detect anomalies, and generate charts and interpretations.",
    tags: ["Data", "Charts", "Analytics"],
    iconLabel: "DI",
    iconHint: "Data analysis",
    category: "Data",
  },
];

export function AgentsCatalog() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<AgentFilter>("All");

  const filteredAgents = useMemo(() => {
    if (activeFilter === "All") {
      return FEATURED_AGENTS;
    }
    return FEATURED_AGENTS.filter((agent) => agent.category === activeFilter);
  }, [activeFilter]);

  return (
    <section className="flex flex-1 flex-col overflow-y-auto px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-5xl space-y-8 text-center">
        <div className="space-y-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-white md:text-3xl">Agents</h1>
            <p className="mx-auto max-w-2xl text-sm text-zinc-400">
              Choose a specialized assistant that matches your workflow. Catalog previews are read-only for now.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {AGENT_FILTERS.map((filter) => {
              const isActive = activeFilter === filter;
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    isActive
                      ? "border border-white/20 bg-[#202123] text-zinc-100"
                      : "border border-[#2a2a30] text-zinc-400 hover:text-zinc-200"
                  }`}
                  aria-pressed={isActive}
                >
                  {filter}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              {...agent}
              onOpen={
                agent.id === "codex"
                  ? () => {
                      router.push("/codex");
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}
