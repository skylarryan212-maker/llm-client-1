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
