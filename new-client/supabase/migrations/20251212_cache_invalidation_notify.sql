-- Cache invalidation notifications for memory/permanent instruction changes
-- Emits NOTIFY cache_invalidation with a JSON payload so app processes can drop caches.

set search_path = public;

create or replace function public.cache_invalidation_notify()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  payload jsonb;
  user_id uuid;
  conversation_id uuid;
begin
  -- Determine user/conversation ids when available
  if (TG_TABLE_NAME = 'memories') then
    user_id := coalesce(new.user_id, old.user_id);
    conversation_id := coalesce(new.conversation_id, old.conversation_id);
  elsif (TG_TABLE_NAME = 'permanent_instructions') then
    user_id := coalesce(new.user_id, old.user_id);
    conversation_id := coalesce(new.conversation_id, old.conversation_id);
  elsif (TG_TABLE_NAME = 'permanent_instruction_versions') then
    user_id := coalesce(new.user_id, old.user_id);
  end if;

  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'operation', TG_OP,
    'user_id', user_id,
    'conversation_id', conversation_id,
    'changed_at', now()
  );

  perform pg_notify('cache_invalidation', payload::text);
  return null;
end;
$$;

-- Memories trigger
drop trigger if exists trg_cache_invalidate_memories on public.memories;
create trigger trg_cache_invalidate_memories
after insert or update or delete on public.memories
for each row execute function public.cache_invalidation_notify();

-- Permanent instructions trigger
drop trigger if exists trg_cache_invalidate_permanent_instructions on public.permanent_instructions;
create trigger trg_cache_invalidate_permanent_instructions
after insert or update or delete on public.permanent_instructions
for each row execute function public.cache_invalidation_notify();

-- Permanent instruction versions trigger (version bump)
drop trigger if exists trg_cache_invalidate_permanent_instruction_versions on public.permanent_instruction_versions;
create trigger trg_cache_invalidate_permanent_instruction_versions
after insert or update or delete on public.permanent_instruction_versions
for each row execute function public.cache_invalidation_notify();
