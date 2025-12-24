"use client";

import { useMemo, useState, type ReactNode, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Literata, Manrope } from "next/font/google";
import { ArrowLeft, ArrowUp, BookOpen, PenLine, Repeat, ShieldCheck, Sparkles } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ModelChoice = "undetectable" | "seo" | "custom";
type DetectorMode = "overall" | "depth";

type QuickStart = {
  title: string;
  assignmentType: string;
  audience: string;
  purpose: string;
  wordTarget: string;
  citationStyle: string;
  checklist: Array<"thesis" | "sources" | "outline">;
  brief: string;
};

const literata = Literata({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const assignmentTypes = [
  { value: "argument", label: "Argument essay" },
  { value: "analysis", label: "Literary analysis" },
  { value: "lab", label: "Lab report" },
  { value: "summary", label: "Research summary" },
  { value: "scholarship", label: "Scholarship essay" },
  { value: "discussion", label: "Discussion post" },
];

const audienceLevels = [
  { value: "middle-school", label: "Middle school" },
  { value: "high-school", label: "High school" },
  { value: "college", label: "College" },
  { value: "graduate", label: "Graduate" },
  { value: "general", label: "General" },
];

const purposes = [
  { value: "explain", label: "Explain" },
  { value: "analyze", label: "Analyze" },
  { value: "persuade", label: "Persuade" },
  { value: "reflect", label: "Reflect" },
  { value: "summarize", label: "Summarize" },
];

const citationStyles = [
  { value: "none", label: "None" },
  { value: "mla", label: "MLA" },
  { value: "apa", label: "APA" },
  { value: "chicago", label: "Chicago" },
];

const quickStarts: QuickStart[] = [
  {
    title: "Argument essay",
    assignmentType: "argument",
    audience: "high-school",
    purpose: "persuade",
    wordTarget: "900",
    citationStyle: "mla",
    checklist: ["thesis", "sources"],
    brief:
      "Argue whether social media should be limited for students. Use two sources and include a clear thesis in the first paragraph.",
  },
  {
    title: "Lab report",
    assignmentType: "lab",
    audience: "college",
    purpose: "explain",
    wordTarget: "700",
    citationStyle: "apa",
    checklist: ["sources"],
    brief:
      "Write a lab report on photosynthesis that includes hypothesis, method, results, and a short discussion.",
  },
  {
    title: "Scholarship essay",
    assignmentType: "scholarship",
    audience: "high-school",
    purpose: "reflect",
    wordTarget: "550",
    citationStyle: "none",
    checklist: ["outline"],
    brief:
      "Describe a challenge you faced in school and what you learned. Keep the tone honest and personal.",
  },
  {
    title: "Literary analysis",
    assignmentType: "analysis",
    audience: "college",
    purpose: "analyze",
    wordTarget: "1000",
    citationStyle: "mla",
    checklist: ["thesis", "sources"],
    brief: "Analyze how symbolism is used in The Great Gatsby. Reference at least two quotes.",
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
  const [wordsPricing, setWordsPricing] = useState<boolean>(false);
  const [returnCosts, setReturnCosts] = useState<boolean>(false);
  const [detectorMode, setDetectorMode] = useState<DetectorMode>("overall");
  const [composerText, setComposerText] = useState<string>("");
  const [assignmentType, setAssignmentType] = useState<string>("argument");
  const [audienceLevel, setAudienceLevel] = useState<string>("high-school");
  const [purpose, setPurpose] = useState<string>("explain");
  const [citationStyle, setCitationStyle] = useState<string>("none");
  const [wordTarget, setWordTarget] = useState<string>("");
  const [includeThesis, setIncludeThesis] = useState<boolean>(true);
  const [requireSources, setRequireSources] = useState<boolean>(false);
  const [includeOutline, setIncludeOutline] = useState<boolean>(false);

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
  const wordCount = useMemo(() => {
    if (!hasText) return 0;
    return composerText.trim().split(/\s+/).filter(Boolean).length;
  }, [composerText, hasText]);

  const applyTemplate = (template: QuickStart) => {
    setAssignmentType(template.assignmentType);
    setAudienceLevel(template.audience);
    setPurpose(template.purpose);
    setWordTarget(template.wordTarget);
    setCitationStyle(template.citationStyle);
    setIncludeThesis(template.checklist.includes("thesis"));
    setRequireSources(template.checklist.includes("sources"));
    setIncludeOutline(template.checklist.includes("outline"));
    setComposerText(template.brief);
  };

  const buildBriefPayload = () => {
    const lines: string[] = [];
    const assignmentLabel = assignmentTypes.find((item) => item.value === assignmentType)?.label;
    const audienceLabel = audienceLevels.find((item) => item.value === audienceLevel)?.label;
    const purposeLabel = purposes.find((item) => item.value === purpose)?.label;
    const citationLabel = citationStyles.find((item) => item.value === citationStyle)?.label;

    if (assignmentLabel) lines.push(`Assignment type: ${assignmentLabel}`);
    if (audienceLabel) lines.push(`Audience level: ${audienceLabel}`);
    if (purposeLabel) lines.push(`Goal: ${purposeLabel}`);
    if (wordTarget.trim()) lines.push(`Target length: ${wordTarget.trim()} words`);
    if (citationLabel && citationLabel !== "None") lines.push(`Citation style: ${citationLabel}`);

    const checklist: string[] = [];
    if (includeThesis) checklist.push("Include thesis");
    if (requireSources) checklist.push("Use sources");
    if (includeOutline) checklist.push("Provide outline");
    if (checklist.length) lines.push(`Checklist: ${checklist.join(", ")}`);

    if (composerText.trim()) {
      lines.push("", "Brief:", composerText.trim());
    }

    return lines.join("\n");
  };

  const handleSend = () => {
    if (!hasText) return;
    const payload = buildBriefPayload();
    const id = `hw-${Date.now()}`;
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(`hw-init-${id}`, payload);
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
                  Build a clean, student-friendly brief first, then draft, humanize, and verify in one flow.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <BadgePill icon={<BookOpen className="h-4 w-4" />}>Student ready</BadgePill>
              <BadgePill icon={<ShieldCheck className="h-4 w-4" />}>Detector check</BadgePill>
              <BadgePill icon={<Repeat className="h-4 w-4" />}>Iterative loop</BadgePill>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr,0.65fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-[var(--hw-line)] bg-[color:var(--hw-surface)] p-6 shadow-lg shadow-black/30">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Assignment brief</h2>
                  <p className="text-sm text-[color:var(--hw-muted)]">Not a chat. Think worksheet.</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                  Ready in minutes
                </span>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70">Assignment type</label>
                  <Select value={assignmentType} onValueChange={setAssignmentType}>
                    <SelectTrigger className="w-full border border-white/10 bg-black/20 text-white">
                      <SelectValue placeholder="Choose type" />
                    </SelectTrigger>
                    <SelectContent className="border border-white/10 bg-[#0f0d12] text-white">
                      {assignmentTypes.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70">Audience</label>
                  <Select value={audienceLevel} onValueChange={setAudienceLevel}>
                    <SelectTrigger className="w-full border border-white/10 bg-black/20 text-white">
                      <SelectValue placeholder="Choose level" />
                    </SelectTrigger>
                    <SelectContent className="border border-white/10 bg-[#0f0d12] text-white">
                      {audienceLevels.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70">Goal</label>
                  <Select value={purpose} onValueChange={setPurpose}>
                    <SelectTrigger className="w-full border border-white/10 bg-black/20 text-white">
                      <SelectValue placeholder="Pick a goal" />
                    </SelectTrigger>
                    <SelectContent className="border border-white/10 bg-[#0f0d12] text-white">
                      {purposes.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70">Target length</label>
                  <Input
                    value={wordTarget}
                    onChange={(event) => setWordTarget(event.target.value)}
                    placeholder="e.g. 800"
                    type="number"
                    className="border border-white/10 bg-black/20 text-white placeholder:text-white/40"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70">Citation style</label>
                  <Select value={citationStyle} onValueChange={setCitationStyle}>
                    <SelectTrigger className="w-full border border-white/10 bg-black/20 text-white">
                      <SelectValue placeholder="Select style" />
                    </SelectTrigger>
                    <SelectContent className="border border-white/10 bg-[#0f0d12] text-white">
                      {citationStyles.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold text-white/70">Brief</label>
                <Textarea
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Describe the assignment, constraints, and any must-have details..."
                  className="mt-2 min-h-[160px] resize-none rounded-xl border border-white/10 bg-black/20 text-white placeholder:text-white/40"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 text-white/70 transition hover:text-white"
                    onClick={() =>
                      setComposerText(
                        "Write an essay about the importance of healthy sleep for teens. Include one statistic and end with a short conclusion."
                      )
                    }
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Insert example brief
                  </button>
                  <span>{wordCount} words</span>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">Checklist</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <ChecklistItem label="Include thesis" checked={includeThesis} onChange={setIncludeThesis} />
                  <ChecklistItem label="Use sources" checked={requireSources} onChange={setRequireSources} />
                  <ChecklistItem label="Provide outline" checked={includeOutline} onChange={setIncludeOutline} />
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  onClick={handleSend}
                  disabled={!hasText}
                  className={`h-12 w-full gap-2 sm:w-auto ${
                    hasText
                      ? "bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg shadow-amber-500/30"
                      : "bg-white/10 text-white/50"
                  }`}
                >
                  <ArrowUp className="h-4 w-4" />
                  Start draft
                </Button>
                <span className="text-xs text-white/50">Press Enter to send, Shift + Enter for new line.</span>
              </div>
            </div>

            <details className="rounded-2xl border border-[var(--hw-line)] bg-[color:var(--hw-surface)] p-5">
              <summary className="cursor-pointer text-sm font-semibold text-white">Quality + Safety</summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">Humanizer model</p>
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
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">Language</p>
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

                {modelChoice === "custom" && (
                  <Input
                    value={customStyleId}
                    onChange={(event) => setCustomStyleId(event.target.value)}
                    placeholder="Writing Style ID"
                    className="border border-white/10 bg-black/20 text-white placeholder:text-white/40 sm:col-span-2"
                  />
                )}

                <div className="space-y-2 sm:col-span-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">Detector mode</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <OptionCard
                      selected={detectorMode === "overall"}
                      label="Overall score"
                      helper="Fast summary score for student drafts."
                      onClick={() => setDetectorMode("overall")}
                    />
                    <OptionCard
                      selected={detectorMode === "depth"}
                      label="Depth analysis"
                      helper="More detailed breakdown and signals."
                      onClick={() => setDetectorMode("depth")}
                    />
                  </div>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ToggleRow
                      label="Return costs"
                      helper="Adds costs: true to the request"
                      checked={returnCosts}
                      onChange={setReturnCosts}
                    />
                    <ToggleRow
                      label="Word-based pricing"
                      helper="words: true (flat + per-100-word pricing)"
                      checked={wordsPricing}
                      onChange={setWordsPricing}
                    />
                  </div>
                </div>
              </div>
            </details>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-[var(--hw-line)] bg-[color:var(--hw-surface)] p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Quick starts</h3>
                <span className="text-xs text-white/50">Tap to load</span>
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
              <h3 className="text-sm font-semibold text-white">Student tips</h3>
              <div className="mt-3 space-y-2 text-sm text-[color:var(--hw-muted)]">
                <p>Start with a clear goal and the required format.</p>
                <p>List sources or quotes you must include.</p>
                <p>Keep the brief short; the agent will ask follow-ups if needed.</p>
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

function ChecklistItem({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm text-white/80 transition hover:border-white/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 cursor-pointer accent-amber-400"
      />
      <span>{label}</span>
    </label>
  );
}

function OptionCard({
  selected,
  label,
  helper,
  onClick,
}: {
  selected: boolean;
  label: string;
  helper: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
        selected
          ? "border-amber-400/40 bg-amber-500/10 text-white"
          : "border-white/10 bg-black/15 text-white/70 hover:border-white/30"
      }`}
    >
      <div className="font-semibold">{label}</div>
      <div className="mt-1 text-xs text-white/50">{helper}</div>
    </button>
  );
}

function ToggleRow({
  label,
  helper,
  checked,
  onChange,
}: {
  label: string;
  helper: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/15 p-3 text-white/80 transition hover:border-amber-400/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 cursor-pointer accent-amber-400"
      />
      <div className="space-y-1">
        <div className="text-sm font-medium text-white">{label}</div>
        <p className="text-xs text-white/60">{helper}</p>
      </div>
    </label>
  );
}
