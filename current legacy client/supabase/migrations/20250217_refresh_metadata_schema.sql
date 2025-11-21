-- Ensure the metadata column exists and refresh PostgREST's schema cache so the
-- Messages API can query/update it without runtime errors.
alter table if exists public.messages
  add column if not exists metadata jsonb;

comment on column public.messages.metadata is 'Structured metadata persisted for each message, such as attachments, sources, and timing information.';

-- PostgREST caches the database schema. After adding new columns we need to
-- signal it to reload so it becomes aware of the metadata column.
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when undefined_object then
    -- If the pgrst channel is not registered (e.g. in tests), ignore the error.
    null;
end $$;
