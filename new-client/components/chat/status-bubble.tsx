"use client";

import { cn } from "@/lib/utils";

type StatusVariant = "default" | "extended" | "search" | "reading" | "error";

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
};

const dotClassMap: Record<StatusVariant, string> = {
  default: "bg-zinc-500",
  extended: "bg-[#8ab4ff]",
  search: "bg-[#8ab4ff]",
  reading: "bg-[#53f2c7]",
  error: "bg-red-400",
};

export function StatusBubble({ label, variant = "default", subtext }: StatusBubbleProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 rounded-full border px-3 py-1 text-xs sm:flex-row sm:items-center sm:gap-2",
        baseClassMap[variant]
      )}
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn("h-2 w-2 rounded-full animate-pulse", dotClassMap[variant])}
          aria-hidden
        />
        <span>{label}</span>
      </div>
      {subtext ? <span className="text-[11px] opacity-80">{subtext}</span> : null}
    </div>
  );
}
