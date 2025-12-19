"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Layers, MessageSquare, PanelRightClose, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarketEventCard } from "@/components/market-agent/market-event-card";
import type { MarketAgentFeedEvent, MarketAgentInstanceWithWatchlist } from "@/lib/data/market-agent";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onAsk: (event: MarketAgentFeedEvent) => void;
  onManage?: () => void;
  defaultInstanceId?: string | null;
};

export function MarketFeedSidebar({ isOpen, onClose, onAsk, onManage, defaultInstanceId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<MarketAgentFeedEvent[]>([]);
  const [instances, setInstances] = useState<MarketAgentInstanceWithWatchlist[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(defaultInstanceId ?? null);

  const filteredEvents = useMemo(() => {
    if (!selectedInstanceId) return events;
    return events.filter((evt) => evt.instance_id === selectedInstanceId);
  }, [events, selectedInstanceId]);

  const loadFeed = async (instanceId?: string | null) => {
    try {
      setLoading(true);
      const qs = instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : "";
      const res = await fetch(`/api/market-agent/feed${qs}`);
      if (!res.ok) throw new Error("Failed to load market feed");
      const payload = await res.json();
      setEvents(Array.isArray(payload?.events) ? payload.events : []);
      setInstances(Array.isArray(payload?.instances) ? payload.instances : []);
    } catch (err) {
      console.warn(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFeed(selectedInstanceId);
  }, [selectedInstanceId]);

  useEffect(() => {
    if (defaultInstanceId && defaultInstanceId !== selectedInstanceId) {
      setSelectedInstanceId(defaultInstanceId);
    }
  }, [defaultInstanceId, selectedInstanceId]);

  return (
    <div
      className={`h-full flex-shrink-0 border-l border-border bg-background/95 backdrop-blur transition-all duration-300 ${
        isOpen ? "w-[360px] max-w-[80vw] opacity-100" : "w-0 opacity-0 pointer-events-none"
      }`}
    >
      <div className={`flex h-full flex-col ${isOpen ? "opacity-100" : "opacity-0"} transition-opacity duration-150`}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-foreground" />
            <div>
              <p className="text-sm font-semibold text-foreground">Market Feed</p>
              <p className="text-xs text-muted-foreground">Latest reports, no chat spam.</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b border-border px-4 py-3 space-y-2">
          <Select
            value={selectedInstanceId ?? "all"}
            onValueChange={(value) => setSelectedInstanceId(value === "all" ? null : value)}
          >
            <SelectTrigger className="h-9 w-full bg-background">
              <SelectValue placeholder="All instances" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All instances</SelectItem>
              {instances.map((inst) => (
                <SelectItem key={inst.id} value={inst.id}>
                  {inst.label || "Market Agent"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => void loadFeed(selectedInstanceId)} disabled={loading}>
              {loading ? (
                <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => (onManage ? onManage() : router.push("/agents/market-agent"))}>
              <Settings2 className="h-4 w-4" />
              Manage
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {filteredEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
              {loading ? "Loading feed..." : "No market events yet."}
            </div>
          ) : (
            filteredEvents.map((event) => (
              <MarketEventCard
                key={event.id}
                event={event}
                instance={event.instance}
                compact
                onOpen={(evt) => router.push(`/agents/market-agent/${evt.instance_id}`)}
                onAsk={(evt) => onAsk(evt)}
                showInstanceMeta
              />
            ))
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-2 text-muted-foreground"
            onClick={() => router.push("/agents/market-agent")}
          >
            <ExternalLink className="h-4 w-4" />
            Manage Market Agents
          </Button>
        </div>
      </div>
    </div>
  );
}
