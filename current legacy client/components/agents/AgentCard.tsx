import { AgentTag } from "./AgentTag";

type AgentCardProps = {
  name: string;
  description: string;
  tags: string[];
  iconLabel: string;
  iconHint?: string;
  onOpen?: () => void;
};

export function AgentCard({
  name,
  description,
  tags,
  iconLabel,
  iconHint,
  onOpen,
}: AgentCardProps) {
  const openEnabled = typeof onOpen === "function";

  return (
    <article className="flex h-full flex-col rounded-2xl border border-[#2a2a30] bg-[#111116] p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1b1b21] text-sm font-semibold uppercase text-white">
          {iconLabel}
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">{name}</h3>
          {iconHint ? (
            <p className="text-[12px] text-zinc-500">{iconHint}</p>
          ) : null}
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-zinc-400">{description}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <AgentTag key={`${name}-${tag}`} label={tag} />
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4 text-xs text-zinc-500">
        <span>Preview unavailable</span>
        <button
          type="button"
          onClick={onOpen}
          disabled={!openEnabled}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
            openEnabled
              ? "border border-white/30 bg-white/10 text-white hover:bg-white/20"
              : "cursor-not-allowed border border-white/15 bg-white/5 text-white/50"
          }`}
        >
          Open agent
        </button>
      </div>
    </article>
  );
}
