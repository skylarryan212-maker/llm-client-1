-- Enable pgvector for embedding support
create extension if not exists vector;

-- Memories table
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid null,
  type text not null check (type in ('preference','identity','constraint','workflow','project','instruction','other')),
  title text not null,
  content text not null,
  -- raw numeric embedding we write from the app
  embedding_raw float8[] null,
  -- pgvector column maintained in the database from embedding_raw
  embedding vector(1536),
  importance int not null default 50,
  enabled boolean not null default true,
  source text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_user_id_idx on public.memories (user_id);
create index if not exists memories_user_enabled_idx on public.memories (user_id, enabled);
create index if not exists memories_type_idx on public.memories (type);
create index if not exists memories_created_at_idx on public.memories (created_at desc);
create index if not exists memories_metadata_gin_idx on public.memories using gin (metadata);

-- keep pgvector column in sync with raw array
create or replace function public.sync_memory_embedding()
returns trigger
language plpgsql
as $$
begin
  if NEW.embedding_raw is not null then
    NEW.embedding := NEW.embedding_raw::vector(1536);
  else
    NEW.embedding := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_memory_embedding on public.memories;

create trigger trg_sync_memory_embedding
before insert or update of embedding_raw on public.memories
for each row
execute procedure public.sync_memory_embedding();

-- Optional ANN index for embedding similarity (future-proofing)
create index if not exists memories_embedding_idx
on public.memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.memories enable row level security;

create policy "memories select own"
on public.memories for select
using (auth.uid() = user_id);

create policy "memories insert own"
on public.memories for insert
with check (auth.uid() = user_id);

create policy "memories update own"
on public.memories for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "memories delete own"
on public.memories for delete
using (auth.uid() = user_id);
