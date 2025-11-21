-- Ensure the messages table can persist structured metadata used throughout the app.
alter table if exists public.messages
  add column if not exists metadata jsonb;

comment on column public.messages.metadata is 'Structured metadata persisted for each message, such as attachments, sources, and timing information.';
