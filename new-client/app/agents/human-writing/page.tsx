"use client";

import { useMemo, useState, type ReactNode, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Literata, Manrope } from "next/font/google";
import { ArrowLeft, ArrowUp, PenLine, Sparkles, Wand2 } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ModelChoice = "undetectable" | "seo" | "custom";

type QuickStart = {
  title: string;
  modelChoice: ModelChoice;
  language: string;
  brief: string;
  note: string;
};

const literata = Literata({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const quickStarts: QuickStart[] = [
  {
    title: "Student-friendly polish",
    modelChoice: "undetectable",
    language: "English",
    note: "Clean rewrite with a natural academic voice.",
    brief:
      "Paste a draft paragraph and make it sound more human while keeping the same meaning and citations intact.",
  },
  {
    title: "Professional clarity",
    modelChoice: "seo",
    language: "English",
    note: "Sharper structure and smoother transitions.",
    brief:
      "Rewrite this update as a concise professional memo. Keep tone neutral and remove repetitive phrasing.",
  },
  {
    title: "Personal voice",
    modelChoice: "undetectable",
    language: "English",
    note: "Warmer tone, less formal.",
    brief:
      "Rephrase this short reflection so it sounds genuine and conversational without changing the core points.",
  },
];

export default function HumanWritingAgentPage() {
  const router = useRouter();
  const fetcher = (url: string) => fetch(url).then((res) => res.json());

  const { data: tasksResponse } = useSWR("/api/human-writing/tasks", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });

  const [modelChoice, setModelChoice] = useState<ModelChoice>("undetectable");
  const [language, setLanguage] = useState<string>("auto");
  const [customStyleId, setCustomStyleId] = useState<string>("");
  const [composerText, setComposerText] = useState<string>("");

  const tasks = useMemo(() => {
    const items =
      (tasksResponse?.tasks as Array<{
        id: string;
        title: string | null;
        created_at: string | null;
        metadata?: Record<string, unknown> | null;
      }>) || [];
    return items.map((item) => {
      const taskId = (item.metadata as any)?.task_id || item.id;
      const fallbackTitle = (item.metadata as any)?.task_id || item.title || "Human Writing Task";
      const ts = item.created_at ? new Date(item.created_at).toLocaleString() : "";
      return { id: item.id, taskId, title: fallbackTitle, timestamp: ts };
    });
  }, [tasksResponse]);

  const hasText = composerText.trim().length > 0;
  const hasCustomStyle = modelChoice !== "custom" || customStyleId.trim().length > 0;
  const canSend = hasText && hasCustomStyle;
  const wordCount = useMemo(() => {
    if (!hasText) return 0;
    return composerText.trim().split(/\s+/).filter(Boolean).length;
  }, [composerText, hasText]);

  const applyTemplate = (template: QuickStart) => {
    setModelChoice(template.modelChoice);
    setLanguage(template.language);
    setComposerText(template.brief);
  };

  const buildBriefPayload = () => {
    return composerText.trim();
  };

  const handleSend = () => {
    if (!canSend) return;
    const payload = buildBriefPayload();
    const id = `hw-${Date.now()}`;
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(`hw-init-${id}`, payload);
        sessionStorage.setItem(
          `hw-settings-${id}`,
          JSON.stringify({
            model: modelChoice,
            language,
            customStyleId: customStyleId.trim(),
          })
        );
      } catch {
        // ignore storage failures
      }
    }
    router.push(`/agents/human-writing/c/${id}`);
    setComposerText("");
  };

  return (
    <div
      className={`${manrope.className} relative min-h-screen overflow-hidden bg-[color:var(--hw-bg)] text-foreground`}
      style={
        {
          "--hw-bg": "#0c0d10",
          "--hw-surface": "#14161b",
          "--hw-muted": "rgba(226,232,240,0.75)",
          "--hw-line": "rgba(148,163,184,0.24)",
          "--hw-accent": "#f59e0b",
          "--hw-ink": "#f8fafc",
        } as CSSProperties
      }
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(245,158,11,0.12),transparent_40%),radial-gradient(circle_at_85%_0%,rgba(14,165,233,0.12),transparent_45%)]" />

      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="mb-6">
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Agents
          </Link>
        </div>

        <div className="rounded-2xl border border-[var(--hw-line)] bg-[color:var(--hw-surface)] p-6 shadow-[0_30px_80px_-60px_rgba(0,0,0,0.7)] sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-amber-200 ring-1 ring-white/15">
                <PenLine className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-white/50">Writing studio</p>
                <h1 className={`${literata.className} text-3xl font-semibold text-[color:var(--hw-ink)] sm:text-4xl`}>
                  Human Writing Studio
                </h1>
                <p className="max-w-2xl text-base text-[color:var(--hw-muted)] sm:text-lg">
                  Launch a humanization task, keep your Rephrasy settings ready, and revisit every draft in one place.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <BadgePill icon={<Wand2 className="h-4 w-4" />}>Rephrasy settings</BadgePill>
              <BadgePill icon={<Sparkles className="h-4 w-4" />}>Quick launch</BadgePill>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr,0.65fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-[var(--hw-line)] bg-[color:var(--hw-surface)] p-6 shadow-lg shadow-black/30">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Start a task</h2>
                  <p className="text-sm text-[color:var(--hw-muted)]">
                    Paste text to humanize or describe the draft you want. Settings below apply to the Rephrasy
                    humanizer.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                  Ready in minutes
                </span>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70">Humanizer model</label>
                  <Select value={modelChoice} onValueChange={(value) => setModelChoice(value as ModelChoice)}>
                    <SelectTrigger className="w-full border border-white/10 bg-black/20 text-white">
                      <SelectValue placeholder="Choose model" />
                    </SelectTrigger>
                    <SelectContent className="border border-white/10 bg-[#0f0d12] text-white">
                      <SelectItem value="undetectable">Undetectable Model v2 (default)</SelectItem>
                      <SelectItem value="seo">SEO Model</SelectItem>
                      <SelectItem value="custom">Custom Writing Style ID</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70">Language</label>
                  <Select value={language} onValueChange={(value) => setLanguage(value)}>
                    <SelectTrigger className="w-full border border-white/10 bg-black/20 text-white">
                      <SelectValue placeholder="Auto-detect" />
                    </SelectTrigger>
                    <SelectContent className="border border-white/10 bg-[#0f0d12] text-white">
                      <SelectItem value="auto">Auto-detect</SelectItem>
                      <SelectItem value="English">English</SelectItem>
                      <SelectItem value="German">German</SelectItem>
                      <SelectItem value="French">French</SelectItem>
                      <SelectItem value="Spanish">Spanish</SelectItem>
                      <SelectItem value="Italian">Italian</SelectItem>
                      <SelectItem value="Portuguese">Portuguese</SelectItem>
                      <SelectItem value="Dutch">Dutch</SelectItem>
                      <SelectItem value="Polish">Polish</SelectItem>
                      <SelectItem value="Japanese">Japanese</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {modelChoice === "custom" && (
                <div className="mt-4">
                  <label className="text-xs font-semibold text-white/70">Custom Writing Style ID</label>
                  <Input
                    value={customStyleId}
                    onChange={(event) => setCustomStyleId(event.target.value)}
                    placeholder="Style ID from Rephrasy"
                    className="mt-2 border border-white/10 bg-black/20 text-white placeholder:text-white/40"
                  />
                  {!hasCustomStyle && (
                    <p className="mt-2 text-xs text-amber-200/80">Enter a style ID to use the custom model.</p>
                  )}
                </div>
              )}

              <div className="mt-4">
                <label className="text-xs font-semibold text-white/70">Source or brief</label>
                <Textarea
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Paste the text you want humanized, or describe the draft you want started..."
                  className="mt-2 min-h-[160px] resize-none rounded-xl border border-white/10 bg-black/20 text-white placeholder:text-white/40"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 text-white/70 transition hover:text-white"
                    onClick={() =>
                      setComposerText(
                        "Please humanize this paragraph while keeping the meaning and citations intact. Keep the tone academic but natural."
                      )
                    }
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Insert example text
                  </button>
                  <span>{wordCount} words</span>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  className={`h-12 w-full gap-2 sm:w-auto ${
                    canSend
                      ? "bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg shadow-amber-500/30"
                      : "bg-white/10 text-white/50"
                  }`}
                >
                  <ArrowUp className="h-4 w-4" />
                  Create task
                </Button>
                <span className="text-xs text-white/50">Press Enter to send, Shift + Enter for new line.</span>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-[var(--hw-line)] bg-[color:var(--hw-surface)] p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Presets</h3>
                <span className="text-xs text-white/50">One tap to load</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {quickStarts.map((template) => (
                  <button
                    key={template.title}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-white/80 transition hover:border-white/30 hover:bg-white/10"
                  >
                    {template.title}
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-2 text-xs text-[color:var(--hw-muted)]">
                {quickStarts.map((template) => (
                  <div key={`${template.title}-note`} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-400/80" />
                    <div>
                      <span className="font-semibold text-white/80">{template.title}:</span> {template.note}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--hw-line)] bg-[color:var(--hw-surface)] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Task history</h3>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">
                  {tasks.length}
                </span>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {tasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-sm text-white/60">
                    No tasks yet. Start a brief to create one.
                  </div>
                ) : (
                  tasks.map((task) => (
                    <a
                      key={task.id}
                      href={`/agents/human-writing/c/${task.taskId}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/90 transition hover:border-white/30 hover:bg-white/5"
                    >
                      <span className="truncate">{task.title}</span>
                      <span className="text-[11px] text-white/60">{task.timestamp}</span>
                    </a>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--hw-line)] bg-[color:var(--hw-surface)] p-5">
              <h3 className="text-sm font-semibold text-white">How it works</h3>
              <div className="mt-3 space-y-2 text-sm text-[color:var(--hw-muted)]">
                <p>Start with a short prompt or paste your text.</p>
                <p>We draft first, then you can run the Rephrasy humanizer.</p>
                <p>Every task keeps its settings and history in one place.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BadgePill({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80">
      {icon}
      {children}
    </span>
  );
}
