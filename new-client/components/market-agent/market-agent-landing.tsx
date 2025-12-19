"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Pause, Play, Plus, Sparkles, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MarketEventCard } from "@/components/market-agent/market-event-card";
import type { MarketAgentFeedEvent, MarketAgentInstanceWithWatchlist } from "@/lib/data/market-agent";
import { cn } from "@/lib/utils";

type LandingProps = {
  initialInstances: MarketAgentInstanceWithWatchlist[];
  initialEvents: MarketAgentFeedEvent[];
};

const cadenceOptions = [
  { label: "1m", value: 60 },
  { label: "2m", value: 120 },
  { label: "5m", value: 300 },
  { label: "10m", value: 600 },
  { label: "30m", value: 1800 },
  { label: "60m", value: 3600 },
];

function formatUpdated(ts?: string | null) {
  if (!ts) return "n/a";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function MarketAgentLanding({ initialInstances, initialEvents }: LandingProps) {
  const router = useRouter();
  const [instances, setInstances] = useState<MarketAgentInstanceWithWatchlist[]>(initialInstances ?? []);
  const [feedEvents, setFeedEvents] = useState<MarketAgentFeedEvent[]>(initialEvents ?? []);
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formLabel, setFormLabel] = useState("Market Agent");
  const [formWatchlist, setFormWatchlist] = useState("");
  const [cadenceSeconds, setCadenceSeconds] = useState<number>(300);
  const [startRunning, setStartRunning] = useState(true);

  const refreshFeed = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch("/api/market-agent/feed?limit=14");
      if (!res.ok) throw new Error("Failed to refresh feed");
      const payload = await res.json();
      setFeedEvents(Array.isArray(payload?.events) ? payload.events : []);
      if (Array.isArray(payload?.instances)) {
        setInstances(payload.instances);
      }
    } catch (err) {
      console.warn(err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // Opportunistic refresh to pick up new events created elsewhere
    void refreshFeed();
  }, []);

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/market-agent/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: formLabel.trim() || "Market Agent",
          watchlist: formWatchlist,
          cadenceSeconds,
          status: startRunning ? "running" : "paused",
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Failed to create instance");
      }
      const payload = await res.json();
      const created = payload?.instance as MarketAgentInstanceWithWatchlist;
      if (created) {
        setInstances((prev) => [created, ...prev]);
        setFormWatchlist("");
        setFormLabel("Market Agent");
        void refreshFeed();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create instance");
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleStatus = async (instanceId: string, nextStatus: "running" | "paused") => {
    try {
      const res = await fetch(`/api/market-agent/instances/${instanceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      setInstances((prev) =>
        prev.map((inst) => (inst.id === instanceId ? { ...inst, status: nextStatus } : inst))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update status");
    }
  };

  const activeCount = useMemo(
    () => instances.filter((i) => i.status === "running").length,
    [instances]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-foreground">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-12 space-y-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">
              <TrendingUp className="h-4 w-4" />
              Market Agent
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white">Autonomous market intelligence</h1>
              <p className="mt-1 max-w-2xl text-base text-muted-foreground">
                Spin up agents to watch your symbols, generate reports, and route follow-ups without flooding your chat timeline.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-100">
                {activeCount} running
              </Badge>
              <span className="text-muted-foreground/80">{instances.length} total agents</span>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => void refreshFeed()}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Refresh feed
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50 shadow-lg shadow-emerald-900/30">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-emerald-200/70">
              <AlarmClock className="h-4 w-4" />
              Cadence templates
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {cadenceOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCadenceSeconds(opt.value)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition",
                    cadenceSeconds === opt.value
                      ? "bg-emerald-500 text-emerald-50 shadow-lg shadow-emerald-900/40"
                      : "bg-emerald-500/10 text-emerald-50/80 hover:bg-emerald-500/20"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-2xl border border-border/70 bg-card/50 p-5 shadow-lg shadow-black/30 backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-white">Your Market Agents</h2>
                  <p className="text-sm text-muted-foreground">Manage cadences, watchlists, and run state.</p>
                </div>
                <Button size="sm" onClick={() => router.push("/agents/market-agent")} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  Manage
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {instances.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
                    No market agents yet. Create one to start tracking.
                  </div>
                ) : (
                  instances.map((instance) => {
                    const running = instance.status === "running";
                    return (
                      <div
                        key={instance.id}
                        className="rounded-xl border border-border/70 bg-background/70 p-4 transition hover:border-primary/30 hover:bg-background/80"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="text-base font-semibold text-white">{instance.label || "Market Agent"}</h3>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "border px-2 py-0.5 text-[11px] font-semibold",
                                  running
                                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                                    : "border-amber-400/40 bg-amber-500/10 text-amber-100"
                                )}
                              >
                                {running ? "Running" : "Paused"}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] uppercase tracking-[0.15em]">
                                {instance.cadence_seconds / 60}m cadence
                              </span>
                              <span className="text-muted-foreground/80">Updated {formatUpdated(instance.updated_at)}</span>
                            </div>
                            {instance.watchlist.length ? (
                              <div className="flex flex-wrap gap-1.5">
                                {instance.watchlist.slice(0, 6).map((symbol) => (
                                  <span key={symbol} className="rounded-full bg-muted/40 px-2 py-0.5 text-[11px] uppercase text-foreground/80">
                                    {symbol}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              onClick={() => router.push(`/agents/market-agent/${instance.id}`)}
                            >
                              Open
                            </Button>
                            <Button
                              variant={running ? "ghost" : "secondary"}
                              size="sm"
                              className="gap-1"
                              onClick={() => handleToggleStatus(instance.id, running ? "paused" : "running")}
                            >
                              {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                              {running ? "Pause" : "Resume"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/60 p-5 shadow-lg shadow-black/25 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Latest updates</h2>
                  <p className="text-sm text-muted-foreground">Reports across all running instances.</p>
                </div>
              </div>
              <div className="space-y-3">
                {feedEvents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
                    No market events yet. Agents will drop updates here once running.
                  </div>
                ) : (
                  feedEvents.map((event) => (
                    <MarketEventCard
                      key={event.id}
                      event={event}
                      instance={event.instance}
                      onOpen={(evt) => router.push(`/agents/market-agent/${evt.instance_id}`)}
                      showInstanceMeta
                      compact
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/15 via-emerald-500/10 to-background p-5 shadow-lg shadow-emerald-900/40">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/80">Create new</p>
                  <h3 className="text-lg font-semibold text-white">Market Agent</h3>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-100">Autonomous</span>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Label</label>
                  <Input
                    value={formLabel}
                    onChange={(e) => setFormLabel(e.target.value)}
                    placeholder="Market Agent"
                    className="bg-background/60"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Watchlist tickers</label>
                  <Input
                    value={formWatchlist}
                    onChange={(e) => setFormWatchlist(e.target.value)}
                    placeholder="NVDA, AAPL, SPY"
                    className="bg-background/60"
                  />
                  <p className="text-[11px] text-muted-foreground/80">Comma or newline separated.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Cadence</label>
                  <div className="flex flex-wrap gap-2">
                    {cadenceOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setCadenceSeconds(opt.value)}
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold transition",
                          cadenceSeconds === opt.value
                            ? "bg-emerald-500 text-emerald-50 shadow-lg shadow-emerald-900/40"
                            : "bg-background/80 text-foreground/80 hover:bg-background/60"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-background/50 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Start running</p>
                    <p className="text-[11px] text-muted-foreground">Toggle off to create paused.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStartRunning((prev) => !prev)}
                    className={cn(
                      "inline-flex h-8 w-14 items-center rounded-full border transition",
                      startRunning
                        ? "bg-emerald-500/90 text-white border-emerald-500/60 justify-end pr-1"
                        : "bg-muted text-muted-foreground border-border justify-start pl-1"
                    )}
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-foreground shadow" />
                  </button>
                </div>

                {error ? <p className="text-xs text-rose-300">{error}</p> : null}

                <Button
                  className="w-full gap-2"
                  onClick={handleCreate}
                  disabled={isCreating}
                >
                  {isCreating ? (
                    <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create agent
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
