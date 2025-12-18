"use client";

import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { FEATURED_AGENTS } from "@/lib/agents/featuredAgents";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

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

  return (
    <div className="w-[340px]">
      <DropdownMenuLabel className="px-3 py-2 text-sm font-semibold text-foreground">
        {title}
      </DropdownMenuLabel>

      <div className="grid grid-cols-2 gap-2 px-2 pb-2">
        {agents.map((agent) => {
          const Icon = agent.icon;
          const selected = agent.id === selectedAgentId;
          return (
            <DropdownMenuItem
              key={agent.id}
              onSelect={() => onSelectAgentId(agent.id)}
              className={cn(
                "h-auto cursor-pointer flex-col items-start gap-2 rounded-xl border p-3 focus:bg-accent/40",
                selected
                  ? "border-primary/40 bg-accent/30"
                  : "border-border/50 bg-transparent hover:bg-accent/20"
              )}
            >
              <div className="flex w-full items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30">
                  <Icon className="h-4 w-4 text-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {agent.name}
                    </div>
                    {selected ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <Check className="h-3.5 w-3.5" />
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
            className="cursor-pointer px-3 py-2 text-sm text-muted-foreground"
            onSelect={() => onClearAgentId?.()}
          >
            <X className="h-4 w-4" />
            Clear agent
          </DropdownMenuItem>
        </>
      ) : null}
    </div>
  );
}

