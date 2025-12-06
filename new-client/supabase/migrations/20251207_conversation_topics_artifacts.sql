-- Conversation topics hierarchy (topics + subtopics)
create table if not exists public.conversation_topics (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  parent_topic_id uuid null references public.conversation_topics(id) on delete cascade,
  label text not null,
  description text null,
  summary text null,
  token_estimate integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists conversation_topics_conversation_created_idx
  on public.conversation_topics (conversation_id, created_at);

create index if not exists conversation_topics_parent_idx
  on public.conversation_topics (parent_topic_id);

-- Messages belong to at most one topic/subtopic
alter table public.messages
  add column if not exists topic_id uuid null references public.conversation_topics(id) on delete set null;

create index if not exists messages_topic_idx
  on public.messages (topic_id);

-- Reusable artifacts (schemas, specs, code snippets, etc.)
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  topic_id uuid null references public.conversation_topics(id) on delete set null,
  created_by_message_id uuid null references public.messages(id) on delete set null,
  type text not null,
  title text not null,
  summary text null,
  content text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists artifacts_conversation_type_idx
  on public.artifacts (conversation_id, type);

create index if not exists artifacts_topic_idx
  on public.artifacts (topic_id);

create index if not exists artifacts_fulltext_idx
  on public.artifacts
  using gin (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))
  );
