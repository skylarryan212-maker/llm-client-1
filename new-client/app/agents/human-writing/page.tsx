"\"use client\";\n+\n+import { useState, type ReactNode } from \"react\";\n*** End Patch  (json) ***>### Note: apply_patch requires plain text not json? I attempted to use JSON; need plain patch text. We'll use apply_patch with actual patch. Let's re-run.**. Let's correct. We'll patch using apply_patch with correct formatting (not JSON).***
import Link from "next/link";
import { ArrowLeft, PenLine, Repeat, ShieldCheck, Sparkles, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ModelChoice = "undetectable" | "seo" | "custom";
type DetectorMode = "overall" | "depth";

export default function HumanWritingAgentPage() {
  const [modelChoice, setModelChoice] = useState<ModelChoice>("undetectable");
  const [language, setLanguage] = useState<string>("auto");
  const [customStyleId, setCustomStyleId] = useState<string>("");
  const [wordsPricing, setWordsPricing] = useState<boolean>(false);
  const [returnCosts, setReturnCosts] = useState<boolean>(false);
  const [detectorMode, setDetectorMode] = useState<DetectorMode>("overall");
  const [composerText, setComposerText] = useState("");
  const [tasks] = useState<Array<{ id: string; title: string; timestamp: string }>>([]);

  const dropdownButtonClass =
    "flex items-center justify-between gap-2 rounded-[14px] border border-white/10 bg-black/30 px-4 py-2 text-sm font-semibold text-white duration-200 hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400";

  return (
    <div className="min-h-screen bg-[#0f0d12] text-foreground">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="mb-6">
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Agents
          </Link>
        </div>

        <div className="relative mx-auto w-full max-w-[1180px] overflow-hidden rounded-[20px] border border-white/6 bg-gradient-to-br from-amber-500/25 via-orange-500/15 to-rose-500/25 p-6 sm:p-8 shadow-[0_24px_90px_-48px_rgba(0,0,0,0.6)]">
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.08),transparent_30%)]" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-amber-100 ring-1 ring-white/20 backdrop-blur">
                <PenLine className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl sm:text-4xl font-bold text-white drop-shadow-sm">Human Writing Agent</h1>
                <p className="max-w-2xl text-base sm:text-lg text-white/80">
                  Draft with GPT-5 Nano, humanize with Rephrasy, verify with detectors, and iterate until it reads like a human wrote it.
                </p>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap">
              <BadgePill icon={<Sparkles className="h-4 w-4" />}>Humanizer API</BadgePill>
              <BadgePill icon={<ShieldCheck className="h-4 w-4" />}>Detector Check</BadgePill>
              <BadgePill icon={<Repeat className="h-4 w-4" />}>Iterative Loop</BadgePill>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center gap-6">
          <div className="w-full max-w-[540px] rounded-[18px] border border-white/8 bg-white/6 p-6 shadow-lg shadow-black/40 backdrop-blur-sm">
            <h3 className="text-lg font-semibold text-white mb-4">Pipeline preview</h3>
            <ol className="space-y-3 text-white/85">
              {[
                "Draft with GPT-5 Nano",
                "Detector: overall / depth score",
                "Humanizer: Rephrasy (model + language)",
                "Detector: re-check for AI-ness",
                "Optional: repeat humanize + detect until pass",
                "Light corrections to maintain quality",
                "Export result",
              ].map((step, idx) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/10 text-xs font-semibold text-white/80">
                    {idx + 1}
                  </span>
                  <span className="leading-relaxed text-sm sm:text-base">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="w-full max-w-[540px] rounded-[18px] border border-white/8 bg-white/6 p-6 shadow-lg shadow-black/40 backdrop-blur-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Tasks</h3>
              <span className="text-xs text-white/60">Past tasks will appear here</span>
            </div>
            {tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-6 text-center text-white/70">
                No tasks yet. Send a task to start one.
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-white/85">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-white">{task.title}</div>
                      <div className="text-xs text-white/60">{task.timestamp}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-16 flex justify-center">
          <div className="relative w-full max-w-[960px] rounded-[22px] border border-white/10 bg-[#121217]/90 p-6 shadow-[0_40px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/5 backdrop-blur-3xl">
            <Textarea
              value={composerText}
              onChange={(event) => setComposerText(event.target.value)}
              placeholder="Describe the essay or writing task..."
              className="min-h-[180px] bg-transparent text-white placeholder:text-white/50 border border-white/10 focus-visible:border-amber-400 focus-visible:ring-4 focus-visible:ring-amber-400/30"
            />
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg shadow-amber-600/40 hover:shadow-amber-600/60"
              >
                Send
              </Button>
            </div>

            <div className="mt-4 border-t border-white/10 pt-4 grid gap-3 sm:grid-cols-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={dropdownButtonClass}>
                    <span>Humanizer settings</span>
                    <ChevronDown className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72 space-y-4 border border-white/10 bg-[#101014]/95 p-3 shadow-lg">
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.25em] text-white/50">Model</p>
                    <Select value={modelChoice} onValueChange={(value) => setModelChoice(value as ModelChoice)}>
                      <SelectTrigger className="w-full bg-black/20 text-white border border-white/10">
                        <SelectValue placeholder="Choose model" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#0f0d12] text-white border border-white/10">
                        <SelectItem value="undetectable">Undetectable Model v2 (default)</SelectItem>
                        <SelectItem value="seo">SEO Model</SelectItem>
                        <SelectItem value="custom">Custom Writing Style ID</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.25em] text-white/50">Language</p>
                    <Select value={language} onValueChange={(value) => setLanguage(value)}>
                      <SelectTrigger className="w-full bg-black/20 text-white border border-white/10">
                        <SelectValue placeholder="Auto-detect" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#0f0d12] text-white border border-white/10">
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
                      onChange={(e) => setCustomStyleId(e.target.value)}
                      placeholder="Writing Style ID"
                      className="bg-black/20 text-white placeholder:text-white/40 border border-white/10"
                    />
                  )}
                  <div className="space-y-2">
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
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={dropdownButtonClass}>
                    <span>Detector mode</span>
                    <ChevronDown className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64 space-y-3 border border-white/10 bg-[#101014]/95 p-3 shadow-lg">
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.25em] text-white/50">
                    Mode
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={detectorMode} onValueChange={setDetectorMode}>
                    <DropdownMenuRadioItem value="overall">Overall score</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="depth">Depth analysis</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={dropdownButtonClass}>
                    <div className="flex items-center gap-2">
                      <span>Task history</span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">
                        {tasks.length}
                      </span>
                    </div>
                    <ChevronDown className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72 space-y-3 border border-white/10 bg-[#101014]/95 p-3 shadow-lg">
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.25em] text-white/50">
                    Recent tasks
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="space-y-2">
                    {tasks.length === 0 ? (
                      <p className="text-xs text-white/60">No tasks recorded yet.</p>
                    ) : (
                      tasks.map((task) => (
                        <DropdownMenuItem key={task.id} className="text-sm text-white">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{task.title}</span>
                            <span className="text-[11px] text-white/60">{task.timestamp}</span>
                          </div>
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BadgePill({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/10 backdrop-blur">
      {icon}
      {children}
    </span>
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
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 cursor-pointer accent-amber-400"
      />
      <div className="space-y-1">
        <div className="text-sm font-medium text-white">{label}</div>
        <p className="text-xs text-white/60">{helper}</p>
      </div>
    </label>
  );
}
