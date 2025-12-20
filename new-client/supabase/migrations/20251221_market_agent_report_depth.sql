ALTER TABLE public.market_agent_instances
ADD COLUMN IF NOT EXISTS report_depth text NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'market_agent_instances_report_depth_check'
      AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.market_agent_instances
    ADD CONSTRAINT market_agent_instances_report_depth_check
      CHECK (report_depth IN ('short', 'standard', 'deep'));
  END IF;
END;
$$;
