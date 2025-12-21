"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { ArrowUpRight } from "lucide-react";

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
  { title: "Autonomy tuned", text: "24h cycles with checkpoints and gates." },
  { title: "Verified output", text: "Diffs, logs, and guardrails every loop." },
  { title: "Model orchestration", text: "Routes planning, execution, and QA separately." },
  { title: "Human control", text: "Escalations, approvals, and pause switches." },
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

const experienceMoments = [
  { title: "Ambient glow", text: "Background shifts with scroll for a living canvas." },
  { title: "Card-first", text: "Every idea lives in a tile—no walls of text." },
  { title: "Guided reveals", text: "Staggered animations keep the story flowing." },
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
          "--lhsa-bg": "#070b10",
          "--lhsa-surface": "#0f151c",
          "--lhsa-muted": "rgba(226,232,240,0.62)",
          "--lhsa-line": "rgba(148,163,184,0.18)",
          "--lhsa-accent": "#6ee7f9",
          "--lhsa-accent-strong": "#0ea5a8",
        } as CSSProperties
      }
    >
      <div className="lhsa-bg-layer" />

      <main className="relative z-10">
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-16 sm:pt-20">
          <div className="lhsa-section lhsa-hero-grid">
            <div className="lhsa-hero space-y-6">
              <div className={`${plexMono.className} lhsa-kicker`}>LHSA</div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-white">
                Long-Horizon Software Agent
              </h1>
              <p className="max-w-2xl text-base sm:text-lg text-[var(--lhsa-muted)] leading-relaxed">
                An autonomous system that plans, builds, tests, and refines entire software
                projects with minimal human input.
              </p>
              <div className="flex flex-wrap gap-2">
                {badges.map((badge) => (
                  <span key={badge} className="lhsa-chip">
                    {badge}
                  </span>
                ))}
              </div>
              <div className="lhsa-stat-grid">
                {heroStats.map((stat) => (
                  <div key={stat.label} className="lhsa-stat">
                    <div className={`${plexMono.className} lhsa-stat-value`}>{stat.value}</div>
                    <div className="lhsa-stat-label">{stat.label}</div>
                  </div>
                ))}
              </div>
              <div className="lhsa-hero-rail" data-animate="slide-right">
                {heroRailCards.map((card, index) => (
                  <div
                    key={card.title}
                    className="lhsa-hero-card"
                    style={{ "--delay": `${index * 90}ms` } as CSSProperties}
                  >
                    <div className={`${plexMono.className} lhsa-hero-tag`}>Pulse</div>
                    <div className="lhsa-hero-card-title">{card.title}</div>
                    <p className="lhsa-body">{card.text}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="lhsa-hero-panel space-y-4">
              <div className="lhsa-panel" data-animate="fade">
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
              <div className="lhsa-panel lhsa-panel-compact" data-animate="fade">
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
            <div className="lhsa-section-grid">
              <div className="space-y-4" data-animate="fade">
                <h2 className="lhsa-title">Why chat-based coding breaks down</h2>
                <div className="lhsa-pill-row">
                  <span className="lhsa-pill">Persistent context</span>
                  <span className="lhsa-pill">Tool-aware</span>
                  <span className="lhsa-pill">Verified loops</span>
                </div>
                <div className="lhsa-mini-grid lhsa-grid-cards">
                  {impactPoints.map((point, index) => (
                    <div
                      key={point}
                      className="lhsa-peek-card"
                      data-animate="fade"
                      style={{ "--delay": `${index * 80}ms` } as CSSProperties}
                    >
                      <div className={`${plexMono.className} lhsa-panel-label`}>Impact</div>
                      <p className="lhsa-body mt-2">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-5">
                <div className="lhsa-rail" data-animate="fade">
                  {problemPoints.map((point, index) => (
                    <div
                      key={point}
                      className="lhsa-peek-card"
                      style={{ "--delay": `${index * 70}ms` } as CSSProperties}
                    >
                      <div className={`${plexMono.className} lhsa-rail-index`}>
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <p className="lhsa-body mt-2">{point}</p>
                    </div>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {failureCards.map((card, index) => (
                    <div
                      key={card.title}
                      data-animate="fade"
                      style={{ "--delay": `${index * 110}ms` } as CSSProperties}
                      className="lhsa-card lhsa-card-floating"
                    >
                      <div className="text-sm font-semibold text-white">{card.title}</div>
                      <p className="lhsa-body mt-2">{card.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="lhsa-section">
            <div className="grid gap-10 lg:grid-cols-[1.05fr,1.4fr]">
              <div className="space-y-6" data-animate="fade">
                <h2 className="lhsa-title">What it does</h2>
                <p className="lhsa-body max-w-3xl">
                  LHSA operates as a persistent agent loop, not a single-response generator. It
                  plans work, executes in the real repository, and keeps iterating until objectives
                  or limits are reached.
                </p>
                <div className="lhsa-mini-grid lhsa-grid-cards">
                  {capabilityTiles.map((tile, index) => (
                    <div
                      key={tile.title}
                      className="lhsa-peek-card"
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
                <div className="lhsa-panel">
                  <div className={`${plexMono.className} lhsa-panel-label`}>Persistent agent loop</div>
                  <p className="lhsa-body mt-3">
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
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="lhsa-section lhsa-ribbon">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-4" data-animate="fade">
                <h2 className="lhsa-title">An experiential scroll</h2>
                <p className="lhsa-body max-w-2xl">
                  The page is built around motion and layered cards—background hues shift as you move
                  down the story, with each panel arriving in sequence.
                </p>
                <div className="lhsa-pill-row">
                  <span className="lhsa-pill">Animated canvas</span>
                  <span className="lhsa-pill">Card reveals</span>
                  <span className="lhsa-pill">No wall of text</span>
                </div>
              </div>
              <div className="lhsa-mini-grid lhsa-grid-cards">
                {experienceMoments.map((moment, index) => (
                  <div
                    key={moment.title}
                    className="lhsa-peek-card lhsa-peek-card-glow"
                    data-animate="fade"
                    style={{ "--delay": `${index * 90}ms` } as CSSProperties}
                  >
                    <div className={`${plexMono.className} lhsa-panel-label`}>Motion cue</div>
                    <div className="lhsa-mini-title mt-2">{moment.title}</div>
                    <p className="lhsa-body mt-2">{moment.text}</p>
                  </div>
                ))}
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
                  className={`lhsa-card ${
                    level.isDefault ? "lhsa-card-default" : ""
                  }`}
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

      <style jsx>{`
        :global(:root) {
          --lhsa-shift: 0;
        }

        :global(.lhsa-page) {
          background-color: var(--lhsa-bg);
        }

        .lhsa-bg-layer {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(
              circle at calc(18% + 22% * var(--lhsa-shift)) 12%,
              rgba(14, 165, 168, 0.18),
              transparent 45%
            ),
            radial-gradient(
              circle at calc(82% - 18% * var(--lhsa-shift)) 22%,
              rgba(56, 189, 248, 0.14),
              transparent 50%
            ),
            radial-gradient(
              circle at calc(55% + 10% * var(--lhsa-shift)) 70%,
              rgba(15, 23, 42, 0.5),
              transparent 64%
            );
          background-size: 130% 130%;
          filter: saturate(1.12);
          transition: background-position 0.35s ease, filter 0.35s ease;
          pointer-events: none;
          z-index: 0;
          animation: lhsa-bg-pan 24s ease-in-out infinite alternate;
        }

        .lhsa-bg-layer::after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(
            circle at 50% 40%,
            rgba(110, 231, 249, 0.1),
            transparent 40%
          );
          mix-blend-mode: screen;
          opacity: 0.8;
          filter: blur(70px);
          animation: lhsa-orbit 26s ease-in-out infinite alternate;
        }

        .lhsa-section {
          position: relative;
          border-radius: 1.5rem;
          border: 1px solid var(--lhsa-line);
          background: linear-gradient(160deg, rgba(15, 23, 42, 0.7), rgba(7, 11, 16, 0.92));
          padding: 2.5rem;
          overflow: hidden;
        }

        @media (max-width: 640px) {
          .lhsa-section {
            padding: 1.6rem;
          }
        }

        .lhsa-section::before {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at top left, rgba(110, 231, 249, 0.08), transparent 45%);
          opacity: 0.8;
          z-index: 0;
          pointer-events: none;
        }

        .lhsa-section > * {
          position: relative;
          z-index: 1;
        }

        .lhsa-hero-grid {
          display: grid;
          gap: 3rem;
        }

        @media (min-width: 1024px) {
          .lhsa-hero-grid {
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
            align-items: center;
          }
        }

        .lhsa-hero-panel {
          position: relative;
          z-index: 1;
        }

        .lhsa-hero {
          position: relative;
          z-index: 1;
          animation: hero-in 0.9s ease both;
        }

        .lhsa-kicker {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          text-transform: uppercase;
          letter-spacing: 0.3em;
          font-size: 0.7rem;
          color: var(--lhsa-accent);
        }

        .lhsa-chip {
          border: 1px solid var(--lhsa-line);
          color: rgba(226, 232, 240, 0.85);
          font-size: 0.75rem;
          padding: 0.35rem 0.65rem;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.4);
        }

        .lhsa-stat-grid {
          display: grid;
          gap: 0.9rem;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        }

        .lhsa-stat {
          border-radius: 0.9rem;
          border: 1px solid var(--lhsa-line);
          padding: 0.85rem 1rem;
          background: rgba(15, 23, 42, 0.5);
        }

        .lhsa-stat-value {
          color: var(--lhsa-accent);
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.2em;
        }

        .lhsa-stat-label {
          margin-top: 0.4rem;
          font-size: 0.95rem;
          color: rgba(226, 232, 240, 0.9);
        }

        .lhsa-hero-rail {
          display: grid;
          gap: 0.85rem;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }

        .lhsa-hero-card {
          position: relative;
          padding: 1rem 1.1rem;
          border-radius: 1rem;
          border: 1px solid rgba(110, 231, 249, 0.3);
          background: linear-gradient(145deg, rgba(15, 23, 42, 0.7), rgba(6, 10, 15, 0.9));
          overflow: hidden;
          box-shadow: 0 14px 40px rgba(6, 10, 15, 0.45);
        }

        .lhsa-hero-card::after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 20% 20%, rgba(110, 231, 249, 0.08), transparent 45%);
          opacity: 0.9;
          pointer-events: none;
        }

        .lhsa-hero-tag {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.25rem 0.55rem;
          border-radius: 999px;
          border: 1px solid rgba(110, 231, 249, 0.35);
          color: rgba(110, 231, 249, 0.9);
          font-size: 0.65rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .lhsa-hero-card-title {
          margin-top: 0.5rem;
          font-weight: 600;
          color: white;
          letter-spacing: -0.01em;
        }

        .lhsa-title {
          font-size: clamp(1.5rem, 1.2rem + 1vw, 2.1rem);
          font-weight: 600;
          color: white;
          letter-spacing: -0.01em;
        }

        .lhsa-body {
          color: var(--lhsa-muted);
          line-height: 1.7;
        }

        .lhsa-pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .lhsa-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.35rem 0.7rem;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(15, 23, 42, 0.45);
          color: rgba(226, 232, 240, 0.85);
          font-size: 0.8rem;
        }

        .lhsa-pill-ghost {
          background: rgba(110, 231, 249, 0.08);
          border-color: rgba(110, 231, 249, 0.35);
          color: rgba(226, 232, 240, 0.95);
        }

        .lhsa-pill-wrap {
          gap: 0.45rem;
        }

        .lhsa-panel {
          position: relative;
          border-radius: 1rem;
          border: 1px solid rgba(148, 163, 184, 0.2);
          background: rgba(6, 10, 15, 0.65);
          padding: 1.5rem;
        }

        .lhsa-panel-compact {
          padding: 1.25rem;
        }

        .lhsa-panel-label {
          font-size: 0.7rem;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: rgba(110, 231, 249, 0.7);
        }

        .lhsa-mini-grid {
          display: grid;
          gap: 0.75rem;
        }

        @media (min-width: 640px) {
          .lhsa-mini-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        .lhsa-mini-card {
          border-radius: 0.9rem;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(15, 23, 42, 0.55);
          padding: 0.95rem 1rem;
        }

        .lhsa-grid-cards {
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        }

        .lhsa-peek-card {
          position: relative;
          border-radius: 1rem;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: linear-gradient(160deg, rgba(15, 23, 42, 0.55), rgba(7, 11, 16, 0.85));
          padding: 1.1rem 1.25rem;
          box-shadow: 0 10px 28px rgba(6, 10, 15, 0.3);
          overflow: hidden;
        }

        .lhsa-peek-card::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(145deg, rgba(110, 231, 249, 0.08), transparent 55%);
          opacity: 0;
          transition: opacity 0.35s ease;
          pointer-events: none;
        }

        .lhsa-peek-card:hover::before {
          opacity: 1;
        }

        .lhsa-peek-card-glow {
          border-color: rgba(110, 231, 249, 0.35);
          box-shadow: 0 18px 44px rgba(14, 165, 168, 0.2);
        }

        .lhsa-mini-title {
          font-size: 0.85rem;
          font-weight: 600;
          color: white;
        }

        .lhsa-section-grid {
          display: grid;
          gap: 2.5rem;
          position: relative;
          z-index: 1;
        }

        @media (min-width: 1024px) {
          .lhsa-section-grid {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
            align-items: start;
          }
        }

        .lhsa-rail {
          display: grid;
          gap: 0.85rem;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }

        .lhsa-rail-index {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.2rem;
          height: 2.2rem;
          border-radius: 999px;
          border: 1px solid rgba(110, 231, 249, 0.25);
          color: rgba(110, 231, 249, 0.85);
          font-size: 0.8rem;
          letter-spacing: 0.15em;
          background: rgba(110, 231, 249, 0.1);
        }

        .lhsa-list-item {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.85rem 1rem;
          border-radius: 0.75rem;
          border: 1px solid transparent;
          background: rgba(15, 23, 42, 0.35);
          transition: border-color 0.4s ease;
        }

        .lhsa-list-item.is-visible {
          border-color: var(--lhsa-line);
        }

        .lhsa-bullet {
          width: 0.45rem;
          height: 0.45rem;
          margin-top: 0.4rem;
          border-radius: 999px;
          background: var(--lhsa-accent);
          box-shadow: 0 0 12px rgba(110, 231, 249, 0.35);
        }

        .lhsa-card {
          background: var(--lhsa-surface);
          border: 1px solid var(--lhsa-line);
          padding: 1.3rem 1.5rem;
          border-radius: 1rem;
          position: relative;
          overflow: hidden;
        }

        .lhsa-card-floating {
          box-shadow: 0 14px 40px rgba(6, 10, 15, 0.35);
          transform: translateY(0);
          transition: transform 0.4s ease, box-shadow 0.4s ease;
        }

        .lhsa-card-floating:hover {
          transform: translateY(-6px);
          box-shadow: 0 18px 50px rgba(14, 165, 168, 0.18);
        }

        .lhsa-ribbon {
          border-color: rgba(110, 231, 249, 0.35);
          background: linear-gradient(145deg, rgba(6, 10, 15, 0.75), rgba(7, 11, 16, 0.9));
        }

        .lhsa-flow {
          position: relative;
          padding-left: 1.25rem;
        }

        .lhsa-flow-line {
          position: absolute;
          left: 6px;
          top: 0.5rem;
          bottom: 0.5rem;
          width: 1px;
          background: rgba(148, 163, 184, 0.25);
        }

        .lhsa-flow-card {
          background: var(--lhsa-surface);
          border: 1px solid var(--lhsa-line);
          padding: 1.2rem 1.4rem;
          border-radius: 1rem;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 1rem;
          align-items: start;
          position: relative;
        }

        .lhsa-flow-index {
          border-radius: 999px;
          border: 1px solid rgba(110, 231, 249, 0.4);
          color: rgba(110, 231, 249, 0.9);
          font-size: 0.7rem;
          letter-spacing: 0.2em;
          padding: 0.3rem 0.55rem;
          background: rgba(110, 231, 249, 0.12);
          height: fit-content;
        }

        .lhsa-card::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(145deg, rgba(110, 231, 249, 0.06), transparent 55%);
          opacity: 0;
          transition: opacity 0.5s ease;
          pointer-events: none;
        }

        .lhsa-card:hover::after {
          opacity: 1;
        }

        .lhsa-card-default {
          border-color: rgba(110, 231, 249, 0.5);
          box-shadow: 0 0 24px rgba(14, 165, 168, 0.15);
        }

        .lhsa-default-tag {
          font-size: 0.6rem;
          padding: 0.2rem 0.55rem;
          border-radius: 999px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: rgba(110, 231, 249, 0.9);
          border: 1px solid rgba(110, 231, 249, 0.4);
          background: rgba(110, 231, 249, 0.12);
        }

        .lhsa-cta-shell {
          padding: 1.5rem;
          border-color: rgba(110, 231, 249, 0.25);
          background: linear-gradient(145deg, rgba(15, 23, 42, 0.4), rgba(7, 11, 16, 0.9));
        }

        .lhsa-cta {
          border-radius: 1.25rem;
          border: 1px solid var(--lhsa-line);
          background: linear-gradient(145deg, rgba(15, 23, 42, 0.6), rgba(7, 11, 16, 0.9));
          padding: 2.5rem;
        }

        @media (max-width: 640px) {
          .lhsa-cta {
            padding: 1.6rem;
          }
        }

        .lhsa-button-primary {
          background: linear-gradient(135deg, #0ea5a8, #38bdf8);
          color: #020617;
          border: none;
        }

        .lhsa-button-primary:hover {
          background: linear-gradient(135deg, #14b8a6, #7dd3fc);
        }

        .lhsa-button-secondary {
          border-color: rgba(148, 163, 184, 0.4);
          color: rgba(226, 232, 240, 0.85);
          background: transparent;
        }

        .lhsa-button-tertiary {
          color: rgba(226, 232, 240, 0.75);
        }

        .lhsa-note {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.25em;
          color: rgba(148, 163, 184, 0.6);
        }

        [data-animate] {
          opacity: 0;
          transform: translateY(18px);
          transition: opacity 0.7s ease, transform 0.7s ease;
          transition-delay: var(--delay, 0ms);
        }

        [data-animate="slide-left"] {
          transform: translateX(-22px);
        }

        [data-animate="slide-right"] {
          transform: translateX(22px);
        }

        [data-animate="scale"] {
          transform: scale(0.98);
        }

        [data-animate].is-visible {
          opacity: 1;
          transform: translate(0, 0) scale(1);
        }

        @keyframes hero-in {
          from {
            opacity: 0;
            transform: translateY(18px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes lhsa-bg-pan {
          0% {
            background-size: 130% 130%;
            filter: saturate(1.04);
          }
          100% {
            background-size: 142% 142%;
            filter: saturate(1.16);
          }
        }

        @keyframes lhsa-orbit {
          0% {
            transform: translate3d(-10px, -8px, 0) scale(0.98);
            opacity: 0.75;
          }
          100% {
            transform: translate3d(10px, 12px, 0) scale(1.06);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
