"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
});

const badges = [
  "Runs locally",
  "Multi-model orchestration",
  "Long-horizon planning",
  "Enterprise-ready",
];

const heroStats = [
  { value: "24h", label: "Autonomy cycles" },
  { value: "Level 3", label: "Default assurance" },
  { value: "IDE + CLI", label: "Execution surface" },
];

const heroSignals = [
  {
    title: "Persistent context",
    text: "State survives across phases and long timelines.",
  },
  {
    title: "Cost-aware routing",
    text: "Planning, execution, and verification stay separated.",
  },
  {
    title: "Audit trails",
    text: "Every action is logged and reviewable.",
  },
];

const problemPoints = [
  "Chat sessions lose context across long timelines and large codebases.",
  "One-shot generation fails when builds, tests, and integration steps are required.",
  "Manual handoffs between design, implementation, and verification slow delivery.",
  "Short prompts cannot capture evolving requirements and system constraints.",
];

const impactPoints = [
  "Higher coordination cost across long-lived projects.",
  "Verification drift when changes outpace review cycles.",
  "Slow iteration without real tooling or automation loops.",
];

const failureCards = [
  {
    title: "Context decay",
    description: "Weeks of decisions vanish inside short chat threads.",
  },
  {
    title: "Tooling gap",
    description: "Prompts cannot run builds, migrations, or dependency updates.",
  },
  {
    title: "Verification drag",
    description: "Manual QA slows delivery and hides regressions.",
  },
  {
    title: "Coordination noise",
    description: "Multi-stakeholder requirements get fragmented and lost.",
  },
];

const steps = [
  {
    title: "Interprets goal",
    detail: "Captures scope, constraints, and expected outcomes.",
  },
  {
    title: "Plans phases",
    detail: "Builds milestones, checkpoints, and dependencies.",
  },
  {
    title: "Modifies real code",
    detail: "Applies changes directly inside the repository.",
  },
  {
    title: "Runs builds/tests",
    detail: "Executes toolchains, checks, and validations.",
  },
  {
    title: "Diagnoses failures",
    detail: "Triages errors, logs, and regressions with context.",
  },
  {
    title: "Iterates until done or limits",
    detail: "Replans and retries under configured guardrails.",
  },
];

const persistencePoints = [
  "Maintains a long-horizon plan across cycles.",
  "Continuously verifies each phase before moving on.",
  "Stops only when objectives or limits are reached.",
];

const assuranceLevels = [
  {
    level: "Assurance 1",
    description: "Fast execution with minimal verification and lightweight logging.",
  },
  {
    level: "Assurance 2",
    description: "Basic test runs and sanity checks for routine changes.",
  },
  {
    level: "Assurance 3",
    description: "Balanced verification, traceable actions, and structured reviews.",
    isDefault: true,
  },
  {
    level: "Assurance 4",
    description: "Deep test coverage, dependency analysis, and stricter guardrails.",
  },
  {
    level: "Assurance 5",
    description: "Maximum scrutiny with formal verification and exhaustive checks.",
  },
];

const assuranceNotes = [
  "Default level is Assurance 3 for balanced risk and velocity.",
  "Escalate depth automatically on risky changes.",
  "Traceable actions and replayable logs throughout.",
];

const orchestrationRoles = [
  {
    title: "Planning models",
    text: "Generate phased execution plans, milestones, and resource forecasts.",
  },
  {
    title: "Execution models",
    text: "Modify source code, configure tooling, and run builds or tests.",
  },
  {
    title: "Verification models",
    text: "Inspect diffs, validate outcomes, and confirm reliability targets.",
  },
];

const orchestrationPrinciples = [
  "Route tasks based on cost, complexity, and risk.",
  "Separate planning from execution to reduce drift.",
  "Verify results with independent validation steps.",
];

const runtimeLeft = [
  {
    title: "IDE extension",
    text: "Operates where engineers work with full file awareness.",
  },
  {
    title: "CLI runner",
    text: "Executes builds, tests, and scripts directly.",
  },
  {
    title: "Repository access",
    text: "Reads and updates code, configs, and docs.",
  },
  {
    title: "Toolchain hooks",
    text: "Integrates with linters, package managers, and CI.",
  },
];

const runtimeRight = [
  {
    title: "Config & policy",
    text: "Define guardrails, approvals, and safe boundaries.",
  },
  {
    title: "Limits control",
    text: "Set time, cost, and iteration caps per cycle.",
  },
  {
    title: "Analytics surface",
    text: "Monitor throughput, spend, and outcomes.",
  },
  {
    title: "Fleet oversight",
    text: "Coordinate multiple agents across programs.",
  },
];

const ctaCards = [
  {
    title: "IDE-native execution",
    text: "Operate in the real repo with tool access and guardrails.",
  },
  {
    title: "Control-plane governance",
    text: "Configure limits, approvals, and risk thresholds centrally.",
  },
  {
    title: "Enterprise-grade assurance",
    text: "Audit trails and verification levels for critical systems.",
  },
];

const heroRailCards = [
  { tag: "Autonomy", title: "Autonomy tuned", text: "24h cycles with checkpoints and gates." },
  { tag: "Verification", title: "Verified output", text: "Diffs, logs, and guardrails every loop." },
  {
    tag: "Routing",
    title: "Model orchestration",
    text: "Routes planning, execution, and QA separately.",
  },
  { tag: "Control", title: "Human control", text: "Escalations, approvals, and pause switches." },
];

const capabilityTiles = [
  {
    title: "Plan with intent",
    text: "Phased roadmaps, dependencies, and budgets mapped as cards not chat logs.",
    chips: ["Milestones", "Dependencies", "Cost windows"],
  },
  {
    title: "Execute in place",
    text: "Edits real files, installs deps, and runs toolchains from your repo.",
    chips: ["IDE aware", "Toolchain hooks", "Repo diffing"],
  },
  {
    title: "Verify relentlessly",
    text: "Independent validation per phase with assurance levels and logs.",
    chips: ["Assurance ladder", "Replayable logs", "Risk-aware"],
  },
];

export default function LhsaPage() {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-animate]"));
    if (targets.length === 0) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      targets.forEach((target) => target.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
    );

    targets.forEach((target) => observer.observe(target));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) return;

    const root = document.documentElement;
    let rafId = 0;

    const updateShift = () => {
      const maxScroll = document.body.scrollHeight - window.innerHeight;
      const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;
      root.style.setProperty("--lhsa-shift", ratio.toString());
      rafId = window.requestAnimationFrame(updateShift);
    };

    rafId = window.requestAnimationFrame(updateShift);

    return () => window.cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      className={`${spaceGrotesk.className} lhsa-page relative min-h-screen overflow-hidden text-slate-100`}
      style={
        {
          "--lhsa-bg": "#030712",
          "--lhsa-surface": "#0b1220",
          "--lhsa-muted": "rgba(226,232,240,0.7)",
          "--lhsa-line": "rgba(148,163,184,0.25)",
          "--lhsa-accent": "#f97316",
          "--lhsa-accent-strong": "#22d3ee",
          "--lhsa-amber": "#f59e0b",
        } as CSSProperties
      }
    >
      <div className="lhsa-bg-layer" />

      <main className="relative z-10">
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-6 sm:pt-12">
          <div className="mb-6 flex w-full">
            <Link
              href="/agents"
              className="inline-flex items-center gap-2 text-sm font-normal text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to agents
            </Link>
          </div>
          <div className="lhsa-section lhsa-hero-shell">
            <div className="lhsa-hero-main space-y-6" data-animate="fade">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-white">
                Long-Horizon Software Agent
              </h1>
              <p className="text-base sm:text-lg text-[var(--lhsa-muted)] leading-relaxed">
                An autonomous system that plans, builds, tests, and refines entire software
                projects with minimal human input.
              </p>
              <div className="lhsa-pill-row lhsa-pill-center">
                {badges.map((badge) => (
                  <span key={badge} className="lhsa-pill">
                    {badge}
                  </span>
                ))}
              </div>
              <div className="lhsa-stat-grid lhsa-hero-stats">
                {heroStats.map((stat) => (
                  <div key={stat.label} className="lhsa-stat">
                    <div className={`${plexMono.className} lhsa-stat-value`}>{stat.value}</div>
                    <div className="lhsa-stat-label">{stat.label}</div>
                  </div>
                ))}
              </div>
              <div className="lhsa-hero-callouts" data-animate="slide-right">
                {heroRailCards.map((card, index) => (
                  <div
                    key={card.title}
                    className="lhsa-hero-callout"
                    style={{ "--delay": `${index * 90}ms` } as CSSProperties}
                  >
                    <div className={`${plexMono.className} lhsa-hero-tag`}>{card.tag}</div>
                    <div className="lhsa-hero-callout-title">{card.title}</div>
                    <p className="lhsa-body">{card.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="lhsa-section">
            <div className="lhsa-panel-group" data-animate="fade">
              <div className="lhsa-panel">
                <div className={`${plexMono.className} lhsa-panel-label`}>Operational envelope</div>
                <h3 className="text-lg font-semibold text-white">Persistent agent loop</h3>
                <p className="lhsa-body mt-3">
                  Maintains long-term state, executes real tooling, and verifies every phase before
                  advancing.
                </p>
                <div className="mt-4 grid gap-3">
                  {heroSignals.map((signal) => (
                    <div key={signal.title} className="lhsa-mini-card">
                      <div className="text-sm font-semibold text-white">{signal.title}</div>
                      <p className="lhsa-body mt-2">{signal.text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="lhsa-panel lhsa-panel-compact">
                <div className={`${plexMono.className} lhsa-panel-label`}>Designed for scale</div>
                <div className="lhsa-mini-grid">
                  <div className="lhsa-mini-card">
                    <div className="lhsa-mini-title">Long-horizon planning</div>
                    <p className="lhsa-body mt-2">Phased roadmaps, checkpoints, and dependencies.</p>
                  </div>
                  <div className="lhsa-mini-card">
                    <div className="lhsa-mini-title">Enterprise guardrails</div>
                    <p className="lhsa-body mt-2">Policy, limits, and approvals baked in.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="lhsa-section">
            <div className="lhsa-band lhsa-band-stack">
              <div className="lhsa-prose" data-animate="fade">
                <div className={`${plexMono.className} lhsa-panel-label`}>Context</div>
                <h2 className="lhsa-title mt-2">Why chat-based coding breaks down</h2>
                <p className="lhsa-body mt-3">
                  Large initiatives need continuity, tooling, and verification - not short chats. Cards
                  below show the drag and where threads collapse.
                </p>
                <div className="lhsa-pill-row mt-3">
                  <span className="lhsa-pill">Persistent context</span>
                  <span className="lhsa-pill">Tool-aware</span>
                  <span className="lhsa-pill">Verified loops</span>
                </div>
              </div>

              <div className="lhsa-line-list" data-animate="fade">
                {impactPoints.map((point, index) => (
                  <div
                    key={point}
                    className="lhsa-line-item"
                    data-animate="fade"
                    style={{ "--delay": `${index * 80}ms` } as CSSProperties}
                  >
                    <div className={`${plexMono.className} lhsa-panel-label`}>Impact</div>
                    <p className="lhsa-body mt-2">{point}</p>
                  </div>
                ))}
              </div>

              <div className="lhsa-timeline" data-animate="fade">
                {problemPoints.map((point, index) => (
                  <div
                    key={point}
                    className="lhsa-timeline-card"
                    data-animate="fade"
                    style={{ "--delay": `${index * 70}ms` } as CSSProperties}
                  >
                    <div className={`${plexMono.className} lhsa-timeline-badge`}>
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <p className="lhsa-body">{point}</p>
                  </div>
                ))}
              </div>

              <div className="lhsa-line-grid" data-animate="fade">
                {failureCards.map((card, index) => (
                  <div
                    key={card.title}
                    className="lhsa-line-card"
                    data-animate="fade"
                    style={{ "--delay": `${index * 90}ms` } as CSSProperties}
                  >
                    <div className="text-sm font-semibold text-white">{card.title}</div>
                    <p className="lhsa-body mt-2">{card.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="lhsa-section">
            <div className="lhsa-band lhsa-band-grid">
              <div className="lhsa-stack">
                <div className="lhsa-prose" data-animate="fade">
                  <div className={`${plexMono.className} lhsa-panel-label`}>What it does</div>
                  <h2 className="lhsa-title mt-2">Persistent agent loop</h2>
                  <p className="lhsa-body mt-3">
                    LHSA plans, executes, and verifies inside your repo - iterating until objectives or
                    limits are reached.
                  </p>
                </div>

                <div className="lhsa-card lhsa-card-floating" data-animate="fade">
                  <div className={`${plexMono.className} lhsa-panel-label`}>Capabilities</div>
                  <div className="lhsa-feature-grid mt-4">
                    {capabilityTiles.map((tile, index) => (
                      <div
                        key={tile.title}
                        className="lhsa-feature-item"
                        data-animate="fade"
                        style={{ "--delay": `${index * 80}ms` } as CSSProperties}
                      >
                        <div className="lhsa-mini-title">{tile.title}</div>
                        <p className="lhsa-body mt-2">{tile.text}</p>
                        <div className="lhsa-pill-row mt-3">
                          {tile.chips.map((chip) => (
                            <span key={chip} className="lhsa-pill">
                              {chip}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lhsa-card lhsa-card-floating" data-animate="fade">
                  <div className={`${plexMono.className} lhsa-panel-label`}>Lifecycle</div>
                  <h3 className="text-lg font-semibold text-white mt-3">Persistent agent loop</h3>
                  <p className="lhsa-body mt-2">
                    The agent owns the full lifecycle: plan, execute, verify, and repeat with
                    structured checkpoints.
                  </p>
                  <div className="mt-4 grid gap-3">
                    {persistencePoints.map((point) => (
                      <div key={point} className="lhsa-mini-card">
                        <span className="lhsa-body">{point}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="lhsa-card lhsa-card-floating lhsa-flow-shell" data-animate="slide-right">
                <div className={`${plexMono.className} lhsa-panel-label`}>Steps</div>
                <div className="lhsa-flow">
                  <div className="lhsa-flow-line" />
                  <div className="space-y-4">
                    {steps.map((step, index) => (
                      <div
                        key={step.title}
                        data-animate="fade"
                        style={{ "--delay": `${index * 120}ms` } as CSSProperties}
                        className="lhsa-flow-card"
                      >
                        <div className={`${plexMono.className} lhsa-flow-index`}>
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div>
                          <div className="text-base font-semibold text-white">{step.title}</div>
                          <p className="lhsa-body mt-2">{step.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="lhsa-section">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="lhsa-panel" data-animate="slide-left">
                <div className={`${plexMono.className} lhsa-panel-label`}>Execution surface</div>
                <h3 className="text-lg font-semibold text-white">Runs in IDE + terminal</h3>
                <p className="lhsa-body mt-3">
                  LHSA operates where engineers work, with full repository access and real tooling.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {runtimeLeft.map((item) => (
                    <div key={item.title} className="lhsa-mini-card">
                      <div className="lhsa-mini-title">{item.title}</div>
                      <p className="lhsa-body mt-2">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="lhsa-panel" data-animate="slide-right">
                <div className={`${plexMono.className} lhsa-panel-label`}>Control plane</div>
                <h3 className="text-lg font-semibold text-white">Web governance layer</h3>
                <p className="lhsa-body mt-3">
                  The web app provides configuration, guardrails, limits, and analytics for long
                  running cycles.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {runtimeRight.map((item) => (
                    <div key={item.title} className="lhsa-mini-card">
                      <div className="lhsa-mini-title">{item.title}</div>
                      <p className="lhsa-body mt-2">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="lhsa-section">
            <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
              <div className="space-y-4" data-animate="fade">
                <h2 className="lhsa-title">Assurance levels</h2>
                <p className="lhsa-body max-w-2xl">
                  Configure the verification depth that matches your risk tolerance, from fast
                  iteration to rigorous validation.
                </p>
              </div>
              <div className="lhsa-panel lhsa-panel-compact" data-animate="fade">
                <div className={`${plexMono.className} lhsa-panel-label`}>Assurance defaults</div>
                <div className="lhsa-pill-row lhsa-pill-wrap mt-3">
                  {assuranceNotes.map((note) => (
                    <span key={note} className="lhsa-pill lhsa-pill-ghost">
                      {note}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {assuranceLevels.map((level, index) => (
                <div
                  key={level.level}
                  data-animate="scale"
                  style={{ "--delay": `${index * 110}ms` } as CSSProperties}
                  className={`lhsa-card ${level.isDefault ? "lhsa-card-default" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">{level.level}</h3>
                    {level.isDefault ? (
                      <span className={`${plexMono.className} lhsa-default-tag`}>Default</span>
                    ) : null}
                  </div>
                  <p className="lhsa-body mt-3">{level.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="lhsa-section">
            <div className="lhsa-section-grid">
              <div className="space-y-4" data-animate="fade">
                <h2 className="lhsa-title">Models & orchestration</h2>
                <p className="lhsa-body max-w-3xl">
                  LHSA coordinates multiple model roles to keep cycles reliable and cost-aware.
                  Planning remains separate from execution and verification, ensuring accuracy
                  without burning budget.
                </p>
              </div>
              <div className="lhsa-panel lhsa-panel-compact" data-animate="fade">
                <div className={`${plexMono.className} lhsa-panel-label`}>Orchestration principles</div>
                <ul className="mt-3 space-y-2">
                  {orchestrationPrinciples.map((principle) => (
                    <li key={principle} className="lhsa-body">
                      {principle}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {orchestrationRoles.map((role, index) => (
                <div
                  key={role.title}
                  data-animate="fade"
                  style={{ "--delay": `${index * 120}ms` } as CSSProperties}
                  className="lhsa-card lhsa-card-floating"
                >
                  <h3 className="text-base font-semibold text-white">{role.title}</h3>
                  <p className="lhsa-body mt-3">{role.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="lhsa-section lhsa-cta-shell">
            <div className="lhsa-cta" data-animate="fade">
              <div>
                <h2 className="text-2xl sm:text-3xl font-semibold text-white">
                  Bring LHSA into your engineering loop
                </h2>
                <p className="lhsa-body mt-3 max-w-2xl">
                  Deploy long-horizon autonomy where it belongs: inside the real repo, with real
                  tooling, under your policies.
                </p>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {ctaCards.map((card) => (
                  <div key={card.title} className="lhsa-mini-card">
                    <div className="lhsa-mini-title">{card.title}</div>
                    <p className="lhsa-body mt-2">{card.text}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button className="lhsa-button-primary">
                  Try in your IDE
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" className="lhsa-button-secondary">
                  View setup guide
                </Button>
                <Button variant="ghost" className="lhsa-button-tertiary">
                  Join waitlist
                </Button>
              </div>
              <p className={`${plexMono.className} lhsa-note mt-6`}>
                LHSA does not run in the browser.
              </p>
            </div>
          </div>
        </section>
      </main>

      </div>
  );
}
