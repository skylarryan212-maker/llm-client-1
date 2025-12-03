-- Remove CHECK constraint to allow dynamic memory types
-- The type column remains text but can now accept any category name

ALTER TABLE public.memories 
DROP CONSTRAINT IF EXISTS memories_type_check;

-- Index still works with dynamic types
-- No need to recreate existing indexes
