-- Create conversation_topics table (topics + subtopics hierarchy)
create table if not exists public.conversation_topics (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  parent_topic_id uuid null references public.conversation_topics(id) on delete cascade,
  label text not null,
  description text,
  summary text,
  token_estimate integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversation_topics_conversation_id_created_at_idx
  on public.conversation_topics (conversation_id, created_at);

create index if not exists conversation_topics_parent_topic_id_idx
  on public.conversation_topics (parent_topic_id);

-- Add topic_id to messages
alter table public.messages
  add column if not exists topic_id uuid null references public.conversation_topics(id) on delete set null;

create index if not exists messages_topic_id_idx on public.messages(topic_id);

-- Create artifacts table
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  topic_id uuid null references public.conversation_topics(id) on delete set null,
  created_by_message_id uuid null references public.messages(id) on delete set null,
  type text not null,
  title text not null,
  summary text,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists artifacts_conversation_id_type_idx
  on public.artifacts(conversation_id, type);

create index if not exists artifacts_topic_id_idx
  on public.artifacts(topic_id);
