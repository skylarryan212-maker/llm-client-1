-- Ensure the metadata column exists on every "messages" table regardless of schema
-- and refresh PostgREST's schema cache afterwards so API queries stop failing.
--
-- Some Supabase projects keep their chat tables outside of the "public" schema,
-- so earlier migrations that only altered public.messages would silently no-op.
-- This migration loops over every regular table named "messages" that is not
-- part of PostgreSQL's internal schemas and adds the column when it is missing.

do $$
declare
  target_schema text;
begin
  for target_schema in
    select schemaname
    from pg_tables
    where tablename = 'messages'
      and schemaname not in ('pg_catalog', 'information_schema')
  loop
    execute format(
      'alter table if exists %I.messages add column if not exists metadata jsonb',
      target_schema
    );

    execute format(
      $$comment on column %I.messages.metadata is 'Structured metadata persisted for each message, such as attachments, sources, and timing information.'$$,
      target_schema
    );
  end loop;
end $$;

-- Reload PostgREST so it immediately notices the new column.
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when undefined_object then
    null;
end $$;
