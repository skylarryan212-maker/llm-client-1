-- Fix existing memories that have string embeddings instead of proper vector type
-- This updates memories where embedding was stored as JSON string

-- First, check if any memories have null embeddings or invalid format
-- (You can run this to see what needs fixing)
SELECT id, title, 
  CASE 
    WHEN embedding IS NULL THEN 'NULL embedding'
    ELSE 'Has embedding'
  END as status
FROM memories;

-- If you need to delete memories with invalid embeddings and recreate them,
-- you can delete them (they'll be recreated next time the AI processes that info):
-- DELETE FROM memories WHERE embedding IS NULL;

-- Note: The code fix in memory.ts now stores embeddings correctly as raw arrays.
-- Any NEW memories created after the code update will work properly.
-- Old memories with NULL or string embeddings may need to be recreated by telling
-- the AI the information again.
