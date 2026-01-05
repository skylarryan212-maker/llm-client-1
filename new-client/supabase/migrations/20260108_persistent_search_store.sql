-- Persistent web search store: queries + documents + chunks (with embeddings)
create extension if not exists "uuid-ossp";

-- Query catalog: stores normalized queries, embeddings, and SERP payloads
create table if not exists web_search_query_catalog (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  normalized_query text not null unique,
  provider text,
  serp_payload jsonb,
  urls text[] default '{}',
  first_seen_at timestamptz default now(),
  last_used_at timestamptz default now(),
  is_time_sensitive boolean default false,
  embedding vector(1536),
  embedding_raw float8[]
);

-- Keep embedding in sync with embedding_raw
create or replace function public.sync_web_search_query_embedding()
returns trigger
language plpgsql
as $$
begin
  if NEW.embedding_raw is not null then
    NEW.embedding := NEW.embedding_raw::vector(1536);
  else
    NEW.embedding := null;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_sync_web_search_query_embedding on web_search_query_catalog;
create trigger trg_sync_web_search_query_embedding
before insert or update of embedding_raw on web_search_query_catalog
for each row
execute procedure public.sync_web_search_query_embedding();

create index if not exists web_search_query_catalog_embedding_idx
  on web_search_query_catalog using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Documents: per-URL metadata and cleaned text
create table if not exists web_search_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  url text not null unique,
  domain text,
  title text,
  text_content text,
  first_seen_at timestamptz default now(),
  last_crawled_at timestamptz,
  last_used_at timestamptz,
  source_type text,
  metadata jsonb
);

-- Chunks: overlapping slices + embeddings tied to documents
create table if not exists web_search_chunks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  last_used_at timestamptz,
  document_id uuid references web_search_documents(id) on delete cascade,
  chunk_index int,
  chunk_hash text not null,
  chunk_text text not null,
  embedding vector(1536),
  embedding_raw float8[],
  unique (document_id, chunk_hash)
);

create or replace function public.sync_web_search_chunk_embedding()
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

drop trigger if exists trg_sync_web_search_chunk_embedding on web_search_chunks;
create trigger trg_sync_web_search_chunk_embedding
before insert or update of embedding_raw on web_search_chunks
for each row
execute procedure public.sync_web_search_chunk_embedding();

create index if not exists web_search_chunks_embedding_idx
  on web_search_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Semantic lookup for cached queries
create or replace function match_web_search_queries(
  query_embedding vector(1536),
  match_threshold float default 0.85,
  match_count int default 3
)
returns table (
  id uuid,
  normalized_query text,
  serp_payload jsonb,
  urls text[],
  first_seen_at timestamptz,
  last_used_at timestamptz,
  is_time_sensitive boolean,
  similarity float
)
language sql stable
as $$
  select
    q.id,
    q.normalized_query,
    q.serp_payload,
    q.urls,
    q.first_seen_at,
    q.last_used_at,
    q.is_time_sensitive,
    1 - (q.embedding <=> query_embedding) as similarity
  from web_search_query_catalog q
  where q.embedding is not null
    and 1 - (q.embedding <=> query_embedding) >= match_threshold
  order by q.embedding <=> query_embedding
  limit match_count;
$$;

-- RLS: allow authenticated users to read/write
alter table web_search_query_catalog enable row level security;
alter table web_search_documents enable row level security;
alter table web_search_chunks enable row level security;

create policy "web_search_query_catalog_read" on web_search_query_catalog
  for select
  to authenticated
  using (true);

create policy "web_search_query_catalog_write" on web_search_query_catalog
  for insert
  to authenticated
  with check (true);

create policy "web_search_query_catalog_update" on web_search_query_catalog
  for update
  to authenticated
  using (true);

create policy "web_search_documents_read" on web_search_documents
  for select
  to authenticated
  using (true);

create policy "web_search_documents_write" on web_search_documents
  for insert
  to authenticated
  with check (true);

create policy "web_search_documents_update" on web_search_documents
  for update
  to authenticated
  using (true);

create policy "web_search_chunks_read" on web_search_chunks
  for select
  to authenticated
  using (true);

create policy "web_search_chunks_write" on web_search_chunks
  for insert
  to authenticated
  with check (true);

create policy "web_search_chunks_update" on web_search_chunks
  for update
  to authenticated
  using (true);
