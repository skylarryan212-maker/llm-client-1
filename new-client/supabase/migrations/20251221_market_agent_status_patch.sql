-- Update market agent instance status to include 'draft' and set default accordingly

ALTER TABLE public.market_agent_instances
  ALTER COLUMN status SET DEFAULT 'draft';

-- Drop old constraint if present and recreate with draft/running/paused
ALTER TABLE public.market_agent_instances
  DROP CONSTRAINT IF EXISTS market_agent_instances_status_check;

ALTER TABLE public.market_agent_instances
  ADD CONSTRAINT market_agent_instances_status_check
  CHECK (status IN ('draft', 'running', 'paused'));

-- Optional: normalize existing rows (set null/unknown to draft)
UPDATE public.market_agent_instances
SET status = 'draft'
WHERE status NOT IN ('draft', 'running', 'paused') OR status IS NULL;
