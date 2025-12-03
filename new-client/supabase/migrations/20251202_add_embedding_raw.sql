-- Add embedding_raw column to existing memories table
alter table public.memories add column if not exists embedding_raw float8[] null;

-- Create function to sync embedding from embedding_raw
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

-- Drop existing trigger if it exists
drop trigger if exists trg_sync_memory_embedding on public.memories;

-- Create trigger to keep embedding in sync
create trigger trg_sync_memory_embedding
before insert or update of embedding_raw on public.memories
for each row
execute procedure public.sync_memory_embedding();

-- Optionally: migrate any existing embeddings (if you have valid ones)
-- This is commented out since your existing embeddings are likely malformed
-- update public.memories set embedding_raw = 
--   (select array_agg(elem::float8) from unnest(string_to_array(trim(both '[]' from embedding::text), ',')) as elem)
-- where embedding is not null;
