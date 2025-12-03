-- Permanent instructions feature: allows users to persist "always-on" directives
-- that are injected into the system prompt each turn without re-querying Supabase.

-- 1) Storage table for permanent instructions
create table if not exists public.permanent_instructions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  scope text not null default 'user' check (scope in ('user','conversation')),
  title text,
  content text not null,
  enabled boolean not null default true,
  priority smallint not null default 50,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists permanent_instructions_user_idx
  on public.permanent_instructions (user_id);

create index if not exists permanent_instructions_conversation_idx
  on public.permanent_instructions (conversation_id)
  where conversation_id is not null;

alter table public.permanent_instructions enable row level security;

create policy if not exists permanent_instructions_select_own
  on public.permanent_instructions
  for select
  using (auth.uid() = user_id);

create policy if not exists permanent_instructions_insert_own
  on public.permanent_instructions
  for insert
  with check (auth.uid() = user_id);

create policy if not exists permanent_instructions_update_own
  on public.permanent_instructions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy if not exists permanent_instructions_delete_own
  on public.permanent_instructions
  for delete
  using (auth.uid() = user_id);

create or replace function public.set_permanent_instruction_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_permanent_instructions_updated_at on public.permanent_instructions;
create trigger trg_permanent_instructions_updated_at
  before update on public.permanent_instructions
  for each row
  execute function public.set_permanent_instruction_updated_at();

-- 2) Lightweight version table used for cache invalidation
create table if not exists public.permanent_instruction_versions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  version timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.permanent_instruction_versions enable row level security;

create policy if not exists permanent_instruction_versions_select_own
  on public.permanent_instruction_versions
  for select
  using (auth.uid() = user_id);

create or replace function public.bump_permanent_instruction_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
begin
  target_user := coalesce(new.user_id, old.user_id);
  if target_user is null then
    return null;
  end if;

  insert into public.permanent_instruction_versions (user_id, version, updated_at)
  values (target_user, now(), now())
  on conflict (user_id)
  do update set
    version = excluded.version,
    updated_at = excluded.updated_at;

  return null;
end;
$$;

drop trigger if exists trg_permanent_instruction_version on public.permanent_instructions;
create trigger trg_permanent_instruction_version
  after insert or update or delete on public.permanent_instructions
  for each row
  execute function public.bump_permanent_instruction_version();
