"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Pause, Play, Settings2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MarketEventCard } from "@/components/market-agent/market-event-card";
import type {
  MarketAgentFeedEvent,
  MarketAgentInstanceWithWatchlist,
} from "@/lib/data/market-agent";
import type { Database } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type MarketAgentStateRow = Database["public"]["Tables"]["market_agent_state"]["Row"];

type Props = {
  instance: MarketAgentInstanceWithWatchlist;
  events: MarketAgentFeedEvent[];
  state: MarketAgentStateRow | null;
};

const quickPrompts = [
  "What changed since the last report?",
  "What invalidates the current base case?",
  "Summarize key levels and triggers.",
  "List the top risks I'm watching.",
];

function formatCadence(seconds: number) {
  if (!seconds) return "n/a";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m cadence`;
}

function extractStateSummary(state: any) {
  if (!state || typeof state !== "object") return [];
  const sections: Array<{ label: string; value: string }> = [];
  if (typeof state.assessment === "string") sections.push({ label: "Assessment", value: state.assessment });
  if (typeof state.regime === "string") sections.push({ label: "Regime", value: state.regime });
  if (typeof state.bias === "string") sections.push({ label: "Bias", value: state.bias });
  if (Array.isArray(state.alerts) && state.alerts.length) {
    sections.push({ label: "Alerts", value: state.alerts.join(" | ") });
  }
  if (typeof state.note === "string") {
    sections.push({ label: "Note", value: state.note });
  }
  return sections;
}

function renderLevels(state: any) {
  const levels = state?.key_levels || state?.levels || null;
  if (!levels || typeof levels !== "object") return null;
  return Object.entries(levels as Record<string, unknown>).map(([symbol, value]) => ({
    symbol,
    text: Array.isArray(value) ? (value as any[]).join(" | ") : typeof value === "object" ? JSON.stringify(value) : String(value),
  }));
}

export function MarketAgentInstanceView({ instance, events, state }: Props) {
  const router = useRouter();
  const [composerValue, setComposerValue] = useState("");
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const stateSummary = useMemo(() => extractStateSummary(state?.state), [state]);
  const keyLevels = useMemo(() => renderLevels(state?.state), [state]);

  const handleStatusChange = async (next: "running" | "paused") => {
    try {
      setIsBusy(true);
      const res = await fetch(`/api/market-agent/instances/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      setStatusError(null);
      router.refresh();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this market agent and its data?")) return;
    try {
      setIsBusy(true);
      const res = await fetch(`/api/market-agent/instances/${instance.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete agent");
      router.push("/agents/market-agent");
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setIsBusy(false);
    }
  };

  const handleSend = async () => {
    const prompt = composerValue.trim();
    if (!prompt) return;
    setIsBusy(true);
    try {
      const res = await fetch("/api/market-agent/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: instance.id }),
      });
      if (!res.ok) throw new Error("Unable to start agent chat");
      const payload = await res.json();
      const conversationId = payload?.conversationId as string | undefined;
      if (!conversationId) throw new Error("Missing conversation id");

      const params = new URLSearchParams();
      params.set("prefill", prompt);
      params.set("autoSend", "1");
      params.set("marketInstanceId", instance.id);
      if (pendingEventId) params.set("marketEventId", pendingEventId);

      router.push(`/c/${conversationId}?${params.toString()}`);
      setComposerValue("");
      setPendingEventId(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to send follow-up");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card/60 p-5 shadow-lg shadow-black/30 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-emerald-400/40 bg-emerald-500/10 text-emerald-50">
                Market Agent
              </Badge>
              <span className="text-xs text-muted-foreground/80">{formatCadence(instance.cadence_seconds)}</span>
            </div>
            <h1 className="text-2xl font-semibold text-white">{instance.label || "Market Agent"}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "px-2 py-0.5 text-[11px] font-semibold",
                  instance.status === "running"
                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                    : "border-amber-400/40 bg-amber-500/10 text-amber-100"
                )}
              >
                {instance.status}
              </Badge>
              {instance.watchlist.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {instance.watchlist.slice(0, 6).map((symbol) => (
                    <span
                      key={symbol}
                      className="rounded-full bg-muted/30 px-2 py-0.5 text-[11px] uppercase tracking-wide text-foreground/80"
                    >
                      {symbol}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={instance.status === "running" ? "ghost" : "secondary"}
              size="sm"
              className="gap-1"
              disabled={isBusy}
              onClick={() => handleStatusChange(instance.status === "running" ? "paused" : "running")}
            >
              {instance.status === "running" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {instance.status === "running" ? "Pause" : "Resume"}
            </Button>
            <Button variant="outline" size="sm" className="gap-1" disabled={isBusy}>
              <Settings2 className="h-4 w-4" />
              Settings
            </Button>
            <Button variant="ghost" size="sm" className="gap-1 text-rose-200 hover:text-rose-50" onClick={handleDelete} disabled={isBusy}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
        {statusError ? <p className="mt-3 text-sm text-rose-300">{statusError}</p> : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
              No reports yet for this agent.
            </div>
          ) : (
            events.map((event) => (
              <div key={event.id} id={event.id}>
                <MarketEventCard
                  event={event}
                  instance={event.instance ?? instance}
                  onOpen={(evt) => router.push(`/agents/market-agent/${evt.instance_id}#${evt.id}`)}
                  onAsk={(evt) => {
                    setComposerValue(evt.summary || "Ask the market agent about this event");
                    setPendingEventId(evt.id);
                  }}
                  showInstanceMeta={false}
                  showPayloadDetails
                />
              </div>
            ))
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-lg shadow-black/25">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">Agent state</h3>
              <Badge variant="outline" className="gap-1 border border-white/10 text-[11px] text-muted-foreground/80">
                <AlarmClock className="h-3.5 w-3.5" />
                {state?.updated_at ? new Date(state.updated_at).toLocaleTimeString() : "n/a"}
              </Badge>
            </div>
            {state ? (
              <div className="mt-3 space-y-3 text-sm text-foreground">
                {stateSummary.length ? (
                  <div className="space-y-1">
                    {stateSummary.map((item) => (
                      <div key={item.label} className="flex items-start gap-2">
                        <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{item.label}</span>
                        <span className="font-medium text-foreground">{item.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No assessment yet.</p>
                )}

                {keyLevels && keyLevels.length ? (
                  <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Key levels</p>
                    <div className="mt-2 space-y-1.5">
                      {keyLevels.map((level) => (
                        <div key={level.symbol} className="flex items-center justify-between text-sm">
                          <span className="font-semibold text-foreground">{level.symbol}</span>
                          <span className="text-muted-foreground">{level.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No state recorded yet.</p>
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-card/60 p-4 shadow-lg shadow-black/25">
            <h3 className="text-sm font-semibold text-white">Ask follow-up</h3>
            <div className="mt-2 space-y-2">
              <Input
                value={composerValue}
                onChange={(e) => setComposerValue(e.target.value)}
                placeholder="Ask the Market Agent about the latest report..."
                className="bg-background/60"
              />
              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => {
                      setComposerValue(prompt);
                      setPendingEventId(events[0]?.id ?? null);
                    }}
                    className="rounded-full bg-muted/50 px-3 py-1 text-[11px] text-foreground/80 hover:bg-muted/60"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <Button onClick={handleSend} disabled={isBusy || !composerValue.trim()} className="w-full">
                Send to chat
              </Button>
              {pendingEventId ? (
                <p className="text-[11px] text-muted-foreground">
                  Linking to report {pendingEventId.slice(0, 6)} for context.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
