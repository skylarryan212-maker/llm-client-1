-- Default new SGA instances to not_started and backfill untouched rows.
ALTER TABLE public.governor_instances
  ALTER COLUMN status SET DEFAULT 'not_started';

UPDATE public.governor_instances
SET status = 'not_started'
WHERE status IN ('active', 'paused', 'never_run')
  AND COALESCE(NULLIF((config->>'last_decision_at'), ''), NULLIF((config->>'last_cycle_at'), '')) IS NULL;
