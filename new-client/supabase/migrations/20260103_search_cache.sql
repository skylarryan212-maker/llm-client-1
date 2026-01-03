create table if not exists web_search_serp_cache (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  cache_key text not null unique,
  query text not null,
  provider text not null,
  payload jsonb not null
);

create index if not exists web_search_serp_cache_created_at_idx on web_search_serp_cache(created_at);

create table if not exists web_search_page_cache (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  cache_key text not null unique,
  url text not null,
  status integer,
  truncated boolean default false,
  html text,
  text_content text
);

create index if not exists web_search_page_cache_created_at_idx on web_search_page_cache(created_at);

alter table web_search_serp_cache enable row level security;
alter table web_search_page_cache enable row level security;

create policy "web_search_serp_cache_read" on web_search_serp_cache
  for select
  to authenticated
  using (true);

create policy "web_search_serp_cache_write" on web_search_serp_cache
  for insert
  to authenticated
  with check (true);

create policy "web_search_serp_cache_update" on web_search_serp_cache
  for update
  to authenticated
  using (true);

create policy "web_search_page_cache_read" on web_search_page_cache
  for select
  to authenticated
  using (true);

create policy "web_search_page_cache_write" on web_search_page_cache
  for insert
  to authenticated
  with check (true);

create policy "web_search_page_cache_update" on web_search_page_cache
  for update
  to authenticated
  using (true);
