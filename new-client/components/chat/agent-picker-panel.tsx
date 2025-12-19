"use client";

import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { FEATURED_AGENTS } from "@/lib/agents/featuredAgents";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

export function AgentPickerPanel({
  selectedAgentId,
  onSelectAgentId,
  onClearAgentId,
  title = "Select an agent",
  maxAgents = 4,
}: {
  selectedAgentId: string | null;
  onSelectAgentId: (agentId: string) => void;
  onClearAgentId?: () => void;
  title?: string;
  maxAgents?: number;
}) {
  const agents = FEATURED_AGENTS.slice(0, Math.max(0, Math.min(4, maxAgents)));
  const canClear = Boolean(onClearAgentId && selectedAgentId);
  const [flashAgentId, setFlashAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (!flashAgentId) return;
    const timer = setTimeout(() => setFlashAgentId(null), 520);
    return () => clearTimeout(timer);
  }, [flashAgentId]);

  const handleSelect = (agentId: string) => {
    setFlashAgentId(agentId);
    onSelectAgentId(agentId);
  };

  return (
    <div className="w-[340px]">
      <DropdownMenuLabel className="px-3 py-2 text-sm font-semibold text-foreground">
        {title}
      </DropdownMenuLabel>

      <div className="grid grid-cols-2 gap-2 px-2 pb-2">
        {agents.map((agent) => {
          const Icon = agent.icon;
          const selected = agent.id === selectedAgentId;
          const isFlashing = flashAgentId === agent.id;
          return (
            <DropdownMenuItem
              key={agent.id}
              onSelect={() => handleSelect(agent.id)}
              className={cn(
                "group relative h-auto cursor-pointer flex-col items-start gap-2 rounded-xl border p-3 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0",
                selected
                  ? "border-primary/70 bg-accent/40 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] ring-1 ring-primary/25"
                  : "border-border/60 bg-card/10 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/25 hover:shadow-[0_18px_40px_-28px_rgba(0,0,0,0.65)] active:translate-y-0"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 rounded-xl border border-primary/30 bg-primary/5 opacity-0 transition duration-300",
                  isFlashing ? "opacity-100 animate-pulse" : ""
                )}
              />
              <div className="flex w-full items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30 transition-colors duration-200 group-hover:border-primary/50 group-hover:bg-primary/10">
                  <Icon className="h-4 w-4 text-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {agent.name}
                    </div>
                    {selected ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary shadow-sm transition-transform duration-150">
                        <Check className={cn("h-3.5 w-3.5", isFlashing ? "scale-110" : "")} />
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {agent.description}
                  </div>
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
      </div>

      {canClear ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="group cursor-pointer px-3 py-2 text-xs text-muted-foreground/80 hover:text-foreground/80 focus:bg-transparent focus-visible:outline-none"
            onSelect={() => onClearAgentId?.()}
          >
            <X className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="tracking-tight">Clear agent</span>
          </DropdownMenuItem>
        </>
      ) : null}
    </div>
  );
}

