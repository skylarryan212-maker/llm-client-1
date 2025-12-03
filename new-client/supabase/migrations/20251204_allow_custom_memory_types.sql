-- Allow router to store dynamic memory categories while preventing blanks

-- Drop legacy enum-style constraint if it still exists
alter table public.memories
  drop constraint if exists memories_type_check;

-- Drop previous non-empty check (if any) to avoid duplicates
alter table public.memories
  drop constraint if exists memories_type_nonempty_check;

-- Enforce only that the value is non-empty after trimming whitespace
alter table public.memories
  add constraint memories_type_nonempty_check
  check (char_length(trim(type)) > 0);
