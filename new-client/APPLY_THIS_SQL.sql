-- IMPORTANT: Run this SQL in your Supabase SQL Editor to fix memory system
-- This updates the match_memories function to accept user_id parameter

-- Function to search memories by semantic similarity
create or replace function match_memories(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 8,
  filter_type text default 'all',
  p_user_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  project_id uuid,
  type text,
  title text,
  content text,
  embedding vector(1536),
  importance int,
  enabled boolean,
  source text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    memories.id,
    memories.user_id,
    memories.project_id,
    memories.type,
    memories.title,
    memories.content,
    memories.embedding,
    memories.importance,
    memories.enabled,
    memories.source,
    memories.metadata,
    memories.created_at,
    memories.updated_at,
    1 - (memories.embedding <=> query_embedding) as similarity
  from memories
  where memories.user_id = coalesce(p_user_id, auth.uid())
    and memories.enabled = true
    and memories.embedding is not null
    and (filter_type = 'all' or memories.type = filter_type)
    and 1 - (memories.embedding <=> query_embedding) > match_threshold
  order by memories.embedding <=> query_embedding
  limit match_count;
$$;
