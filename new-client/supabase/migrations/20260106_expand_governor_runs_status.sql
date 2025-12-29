-- Expand allowed governor_runs.status values to support scheduler states.
ALTER TABLE public.governor_runs
  DROP CONSTRAINT IF EXISTS governor_runs_status_check;

ALTER TABLE public.governor_runs
  ADD CONSTRAINT governor_runs_status_check
  CHECK (status IN (
    'not_started',
    'waiting',
    'running',
    'completed',
    'failed',
    'cancelled'
  ));
