"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Clock3, MessageCircle, Play, Square, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MarketAgentFeedEvent, MarketAgentInstanceWithWatchlist } from "@/lib/data/market-agent";
import { cn } from "@/lib/utils";

type MarketEventCardProps = {
  event: MarketAgentFeedEvent;
  instance?: MarketAgentInstanceWithWatchlist | null;
  onOpen?: (event: MarketAgentFeedEvent) => void;
  onAsk?: (event: MarketAgentFeedEvent) => void;
  compact?: boolean;
  showInstanceMeta?: boolean;
  showPayloadDetails?: boolean;
};

const severityStyles: Record<string, string> = {
  info: "bg-sky-600/10 text-sky-300 border-sky-500/30",
  important: "bg-amber-500/10 text-amber-200 border-amber-400/40",
  critical: "bg-rose-600/10 text-rose-100 border-rose-500/50",
};

function formatTimestamp(ts?: string | null) {
  if (!ts) return "Just now";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderPayloadPreview(payload: Record<string, unknown>): string | null {
  if (!payload || typeof payload !== "object") return null;
  const keys = Object.keys(payload);
  if (!keys.length) return null;
  if (Array.isArray((payload as any).highlights) && (payload as any).highlights.length) {
    return (payload as any).highlights.slice(0, 3).join(" | ");
  }
  if (typeof (payload as any).note === "string") {
    return (payload as any).note;
  }
  if (typeof (payload as any).summary === "string") {
    return (payload as any).summary;
  }
  return keys.slice(0, 3).join(", ");
}

export function MarketEventCard({
  event,
  instance,
  onOpen,
  onAsk,
  compact,
  showInstanceMeta = true,
  showPayloadDetails = false,
}: MarketEventCardProps) {
  const [expanded, setExpanded] = useState(false);

  const payloadPreview = useMemo(() => {
    const preview = event.payload && typeof event.payload === "object" ? renderPayloadPreview(event.payload as any) : null;
    return preview;
  }, [event.payload]);

  const watchlist = instance?.watchlist ?? [];
  const severityStyle = severityStyles[event.severity] ?? severityStyles.info;

  return (
    <div className={cn(
      "group relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-b from-background/80 via-background/70 to-background/60 p-4 shadow-[0_24px_60px_-35px_rgba(0,0,0,0.6)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-25px_rgba(0,0,0,0.55)]",
      compact ? "p-3" : "p-4"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="h-4 w-4" />
          <span className="font-medium text-foreground/90">{formatTimestamp(event.ts)}</span>
          <Badge variant="outline" className={cn("border px-2 py-0.5 text-[11px] font-semibold", severityStyle)}>
            {event.severity}
          </Badge>
        </div>
        {showInstanceMeta && instance ? (
          <Badge variant="outline" className="flex items-center gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-100">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold">{instance.label}</span>
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        <div className="text-base font-semibold leading-tight text-foreground">
          {event.summary || "Market update"}
        </div>
        {payloadPreview ? (
          <p className="text-sm text-muted-foreground line-clamp-2">{payloadPreview}</p>
        ) : null}

        {showPayloadDetails && event.payload && typeof event.payload === "object" ? (
          <div className="rounded-lg border border-border/70 bg-card/40 p-3 text-xs text-muted-foreground">
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed opacity-90">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>
        ) : null}

        {watchlist.length ? (
          <div className="flex flex-wrap gap-1.5">
            {watchlist.slice(0, 5).map((symbol) => (
              <span
                key={symbol}
                className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/80"
              >
                {symbol}
              </span>
            ))}
            {watchlist.length > 5 ? (
              <span className="rounded-full bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                +{watchlist.length - 5} more
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/80">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="font-semibold">{event.event_type}</span>
        </div>
        <div className="flex items-center gap-2">
          {onAsk ? (
            <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => onAsk(event)}>
              <MessageCircle className="h-4 w-4" />
              Ask
            </Button>
          ) : null}
          {onOpen ? (
            <Button size="sm" className="h-8 gap-1" onClick={() => onOpen(event)}>
              {compact ? <Play className="h-4 w-4" /> : "Open"}
            </Button>
          ) : null}
          {showPayloadDetails ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4 rotate-90" />}
              {expanded ? "Collapse" : "View details"}
            </Button>
          ) : null}
        </div>
      </div>

      {expanded && showPayloadDetails ? (
        <div className="mt-3 rounded-lg border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed opacity-90">
            {JSON.stringify(event.payload ?? {}, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
