-- Debug script to check memory embeddings
-- Run this in Supabase SQL Editor to see what's in the database

-- 1. Check all memories and their embedding status
SELECT 
  id,
  title,
  type,
  CASE 
    WHEN embedding IS NULL THEN 'NULL'
    WHEN pg_typeof(embedding)::text = 'vector' THEN 'VECTOR (valid)'
    ELSE 'OTHER: ' || pg_typeof(embedding)::text
  END as embedding_status,
  created_at
FROM memories
ORDER BY created_at DESC
LIMIT 10;

-- 2. Try a simple vector search manually
-- First get an embedding dimension
SELECT 
  title,
  array_length(embedding::text::float[], 1) as dimension
FROM memories
WHERE embedding IS NOT NULL
LIMIT 1;

-- 3. Check if the match_memories function exists
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'match_memories';
