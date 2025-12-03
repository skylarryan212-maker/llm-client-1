-- Cache router context snapshots directly on conversations to avoid re-reading
-- the last 10 messages for every routing decision.

alter table public.conversations
  add column if not exists router_context_cache jsonb not null default '[]'::jsonb,
  add column if not exists router_context_cache_last_message_id uuid,
  add column if not exists router_context_cache_updated_at timestamptz;
