-- Expand allowed governor_instances.status values to include not_started.
ALTER TABLE public.governor_instances
  DROP CONSTRAINT IF EXISTS governor_instances_status_check;

ALTER TABLE public.governor_instances
  ADD CONSTRAINT governor_instances_status_check
  CHECK (status IN (
    'active',
    'paused',
    'archived',
    'not_started'
  ));
