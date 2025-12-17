-- Add a preamble column to store tool preamble text alongside messages
alter table public.messages
  add column if not exists preamble text;
