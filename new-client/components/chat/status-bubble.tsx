"use client";

import { cn } from "@/lib/utils";

type StatusVariant = "default" | "extended" | "search" | "reading" | "error" | "warning";

interface StatusBubbleProps {
  label: string;
  variant?: StatusVariant;
  subtext?: string;
}

const baseClassMap: Record<StatusVariant, string> = {
  default: "border-white/5 bg-[#1b1b20]/90 text-zinc-300",
  extended: "border-[#4b64ff]/30 bg-[#1a1c2b]/80 text-[#b7c6ff]",
  search: "border-[#4b64ff]/30 bg-[#152033]/80 text-[#9bb8ff]",
  reading: "border-[#2f9e89]/40 bg-[#0f1f1a]/85 text-[#b8ffe8]",
  error: "border-red-500/40 bg-[#30161a]/85 text-red-200",
  warning: "border-yellow-500/40 bg-[#2a2416]/85 text-yellow-200",
};

const dotClassMap: Record<StatusVariant, string> = {
  default: "bg-zinc-500",
  extended: "bg-[#8ab4ff]",
  search: "bg-[#8ab4ff]",
  reading: "bg-[#53f2c7]",
  error: "bg-red-400",
  warning: "bg-yellow-400",
};

export function StatusBubble({ label, variant = "default", subtext }: StatusBubbleProps) {
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs overflow-hidden",
        baseClassMap[variant]
      )}
      aria-live="polite"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn("h-2 w-2 flex-shrink-0 rounded-full animate-pulse", dotClassMap[variant])}
          aria-hidden
        />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      {subtext ? <span className="ml-2 text-[11px] opacity-80 truncate">{subtext}</span> : null}
    </div>
  );
}
