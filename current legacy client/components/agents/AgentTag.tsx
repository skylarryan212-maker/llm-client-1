type AgentTagProps = {
  label: string;
};

export function AgentTag({ label }: AgentTagProps) {
  return (
    <span className="rounded-full border border-white/10 bg-[#1b1b21] px-3 py-1 text-xs text-zinc-300">
      {label}
    </span>
  );
}
