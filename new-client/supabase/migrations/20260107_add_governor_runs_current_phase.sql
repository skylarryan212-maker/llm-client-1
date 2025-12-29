-- Track the current phase on governor_runs rows for fast filtering.
ALTER TABLE public.governor_runs
  ADD COLUMN IF NOT EXISTS current_phase int4 NOT NULL DEFAULT 0;
