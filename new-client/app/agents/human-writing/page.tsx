"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, PenLine, Repeat, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ModelChoice = "undetectable" | "seo" | "custom";
type DetectorMode = "overall" | "depth";

export default function HumanWritingAgentPage() {
  const [modelChoice, setModelChoice] = useState<ModelChoice>("undetectable");
  const [language, setLanguage] = useState<string>("auto");
  const [customStyleId, setCustomStyleId] = useState<string>("");
  const [wordsPricing, setWordsPricing] = useState<boolean>(false);
  const [returnCosts, setReturnCosts] = useState<boolean>(false);
  const [detectorMode, setDetectorMode] = useState<DetectorMode>("overall");
  const [tasks] = useState<Array<{ id: string; title: string; timestamp: string }>>([]);

  return (
    <div className="min-h-screen bg-[#0f0d12] text-foreground">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-6">
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Agents
          </Link>
        </div>

        <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-amber-500/25 via-orange-500/15 to-rose-500/25 p-6 sm:p-8 shadow-[0_20px_80px_-40px_rgba(0,0,0,0.45)]">
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

        <div className="mt-10 grid gap-6 lg:grid-cols-12 items-start">
          <div className="space-y-6 col-span-12 lg:col-span-3">
            <div className="rounded-2xl border border-white/5 bg-white/5 p-6 shadow-lg shadow-black/30 backdrop-blur-sm space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Humanizer settings</h2>
                <p className="text-xs text-white/60">Matches Rephrasy API fields</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm text-white/80">Model</Label>
                  <Select value={modelChoice} onValueChange={(value) => setModelChoice(value as ModelChoice)}>
                    <SelectTrigger className="w-full bg-black/20 text-white border-white/10">
                      <SelectValue placeholder="Choose model" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0f0d12] text-white border-white/10">
                      <SelectItem value="undetectable">Undetectable Model v2 (default)</SelectItem>
                      <SelectItem value="seo">SEO Model</SelectItem>
                      <SelectItem value="custom">Custom Writing Style ID</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-white/80">Language</Label>
                  <Select value={language} onValueChange={(value) => setLanguage(value)}>
                    <SelectTrigger className="w-full bg-black/20 text-white border-white/10">
                      <SelectValue placeholder="Auto-detect" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0f0d12] text-white border-white/10">
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
                <div className="space-y-2">
                  <Label className="text-sm text-white/80">Writing Style ID</Label>
                  <Input
                    value={customStyleId}
                    onChange={(e) => setCustomStyleId(e.target.value)}
                    placeholder="Enter your custom Writing Style ID"
                    className="bg-black/20 text-white placeholder:text-white/40 border-white/10"
                  />
                </div>
              )}

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

            <div className="rounded-2xl border border-white/5 bg-white/5 p-6 shadow-lg shadow-black/30 backdrop-blur-sm space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Detector settings</h2>
                <p className="text-xs text-white/60">Maps to Rephrasy detector API</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <DetectorModeCard
                  mode="overall"
                  active={detectorMode === "overall"}
                  onSelect={() => setDetectorMode("overall")}
                  title="Overall score"
                  description="Single overall 0–100 score (0 = human, 100 = AI)."
                />
                <DetectorModeCard
                  mode="depth"
                  active={detectorMode === "depth"}
                  onSelect={() => setDetectorMode("depth")}
                  title="Depth"
                  description="Sentence-level scores plus overall; helpful for spotting weak spots."
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-white/70">
                  Pipeline concept: Detector → Humanizer → Detector (and repeat until score passes).
                </div>
                <Button
                  type="button"
                  className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg shadow-amber-500/30"
                  disabled
                >
                  Run pipeline (coming soon)
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-6 col-span-12 lg:col-span-6 lg:col-start-4">
            <div className="rounded-2xl border border-white/5 bg-white/5 p-6 shadow-lg shadow-black/30 backdrop-blur-sm">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-lg font-semibold text-white">Task brief</h2>
                <span className="text-xs text-white/60">Compose your task and send</span>
              </div>
              <div className="mt-3 space-y-3">
                <Textarea
                  placeholder="Example: Write a 600-word persuasive essay on the benefits of urban green spaces..."
                  className="min-h-[140px] bg-black/20 text-white placeholder:text-white/40 border-white/10 focus-visible:ring-amber-400/50"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg shadow-amber-500/30"
                    disabled
                  >
                    Send task (coming soon)
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-white/5 p-6 shadow-lg shadow-black/30 backdrop-blur-sm space-y-4">
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
                    <div
                      key={task.id}
                      className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-white/85"
                    >
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

          <div className="rounded-2xl border border-white/5 bg-white/10 p-6 shadow-lg shadow-black/30 backdrop-blur col-span-12 lg:col-span-3 lg:col-start-10">
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
                  <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/80 border border-white/10">
                    {idx + 1}
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
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

function DetectorModeCard({
  mode,
  active,
  onSelect,
  title,
  description,
}: {
  mode: DetectorMode;
  active: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition ${
        active
          ? "border-amber-400/60 bg-amber-500/10 text-white shadow-[0_10px_40px_-24px_rgba(251,191,36,0.6)]"
          : "border-white/10 bg-black/15 text-white/80 hover:border-white/30"
      }`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 text-xs text-white/60">{description}</p>
    </button>
  );
}
