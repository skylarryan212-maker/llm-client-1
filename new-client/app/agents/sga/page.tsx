import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

const heroStats = [
  { metric: "24/7", label: "Self-autonomous coverage that continuously monitors goals" },
  { metric: "Adaptive", label: "Self-healing loops that recover and reroute unfinished work" },
  { metric: "Policy-first", label: "Every decision checked against governance before action" },
];

const loopSteps = [
  {
    title: "Observe",
    detail: "Keeps an evolving world model with requirements, constraints, and open risks.",
  },
  {
    title: "Act",
    detail: "Plans, delegates, and executes using specialized workers while honoring limits.",
  },
  {
    title: "Govern",
    detail: "Evaluates results, logs outcomes, escalates when thresholds or exceptions appear.",
  },
];

const guardrails = [
  {
    title: "Policy lattice",
    detail: "Automates approvals, embargoes, and review checkpoints before modifying the repo.",
  },
  {
    title: "Limit watch",
    detail: "Tracks time, spend, and iteration budgets so runs pause or pause for review before overruns.",
  },
  {
    title: "Escalation dial",
    detail: "Routes edge cases to humans, replays logs, and restarts with tightened assurance if needed.",
  },
];

export default function SelfGoverningAgentPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.25),_transparent_45%),radial-gradient(circle_at_60%_20%,rgba(165,180,252,0.25),transparent_40%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950 to-slate-950/90" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-9 sm:px-6 lg:px-8">
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-sm text-slate-300 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to agents
        </Link>

        <section className="rounded-3xl border border-white/10 bg-slate-900/50 p-8 shadow-[0_25px_80px_rgba(15,23,42,0.8)] backdrop-blur">
          <div className="space-y-6">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Autonomous governance</p>
            <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Self-Governing Agent
            </h1>
            <p className="max-w-3xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Observes objectives, orchestrates sub-tasks, and enforces guardrails without prompts. Keeps state,
              recovery, and governance aligned so every run stays within your risk budget.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" className="py-3 px-4" asChild>
                <Link href="#governance">Inspect guardrails</Link>
              </Button>
              <Link href="#loops" className="text-sm font-semibold text-white underline-offset-4 transition hover:underline">
                Explore autonomy loop
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {heroStats.map((stat) => (
                <article
                  key={stat.metric}
                  className="rounded-2xl border border-white/5 bg-white/5 p-5 text-sm transition hover:border-white/30"
                >
                  <p className="text-2xl font-semibold text-white">{stat.metric}</p>
                  <p className="mt-2 text-xs text-slate-300">{stat.label}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="loops" className="space-y-6">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Autonomy loop</p>
            <h2 className="text-2xl font-semibold text-white">Observation → Action → Governance</h2>
            <p className="text-sm text-slate-300">
              This agent never stops monitoring. Every action is scored, logged, and fed back so future phases stay
              consistent with intent.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {loopSteps.map((step) => (
              <article key={step.title} className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{step.title}</p>
                <p className="text-sm leading-relaxed text-slate-200">{step.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="governance" className="space-y-6">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Governance</p>
            <h2 className="text-2xl font-semibold text-white">Policy-first guardrails</h2>
            <p className="text-sm text-slate-300">
              Configure approvals, budgets, and escalations once. The agent enforces them automatically and captures every
              decision for audit and recovery.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {guardrails.map((item) => (
              <article
                key={item.title}
                className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-5"
              >
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                <p className="text-sm leading-relaxed text-slate-300">{item.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/60 to-slate-800/60 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.85)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Control plane</p>
              <h3 className="text-2xl font-semibold text-white">Deploy, audit, repeat</h3>
              <p className="text-sm text-slate-300">
                Ship safe autonomy by delegating visibility, approvals, and recovery to a self-governing system that
                reports every decision in real time.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="#loops">Review loop details</Link>
              </Button>
              <Button variant="ghost" className="border-white/20 text-white/90" asChild>
                <Link href="/agents">See other agents</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
