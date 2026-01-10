create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid null references public.conversations(id) on delete set null,
  event_type text not null,
  model text not null,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_id_idx on public.usage_events (user_id);
create index if not exists usage_events_created_at_idx on public.usage_events (created_at desc);
create index if not exists usage_events_model_idx on public.usage_events (model);
create index if not exists usage_events_event_type_idx on public.usage_events (event_type);
create index if not exists usage_events_conversation_id_idx on public.usage_events (conversation_id);

alter table public.usage_events enable row level security;

create policy "usage_events_select_own" on public.usage_events
  for select
  using (auth.uid() = user_id);

create policy "usage_events_insert_own" on public.usage_events
  for insert
  with check (auth.uid() = user_id);

create policy "usage_events_update_own" on public.usage_events
  for update
  using (auth.uid() = user_id);
