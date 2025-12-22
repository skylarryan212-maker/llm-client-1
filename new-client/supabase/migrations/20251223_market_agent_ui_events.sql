-- Market Agent UI events schema
CREATE TABLE IF NOT EXISTS public.market_agent_ui_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_instance_id uuid NOT NULL REFERENCES public.market_agent_instances(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  kind text NOT NULL DEFAULT 'market_suggestion',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_agent_ui_events_status_check CHECK (status IN ('proposed', 'dismissed', 'applied')),
  CONSTRAINT market_agent_ui_events_unique_event UNIQUE (agent_instance_id, event_id)
);

CREATE INDEX IF NOT EXISTS market_agent_ui_events_instance_status_created_idx
  ON public.market_agent_ui_events (agent_instance_id, status, created_at DESC);

ALTER TABLE public.market_agent_ui_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'market_agent_ui_events'
      AND policyname = 'Market agent UI events select'
  ) THEN
    CREATE POLICY "Market agent UI events select"
      ON public.market_agent_ui_events
      FOR SELECT
      USING (public.market_agent_instance_belongs_to_user(agent_instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'market_agent_ui_events'
      AND policyname = 'Market agent UI events insert'
  ) THEN
    CREATE POLICY "Market agent UI events insert"
      ON public.market_agent_ui_events
      FOR INSERT
      WITH CHECK (public.market_agent_instance_belongs_to_user(agent_instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'market_agent_ui_events'
      AND policyname = 'Market agent UI events update'
  ) THEN
    CREATE POLICY "Market agent UI events update"
      ON public.market_agent_ui_events
      FOR UPDATE
      USING (public.market_agent_instance_belongs_to_user(agent_instance_id))
      WITH CHECK (public.market_agent_instance_belongs_to_user(agent_instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'market_agent_ui_events'
      AND policyname = 'Market agent UI events delete'
  ) THEN
    CREATE POLICY "Market agent UI events delete"
      ON public.market_agent_ui_events
      FOR DELETE
      USING (public.market_agent_instance_belongs_to_user(agent_instance_id));
  END IF;
END $$;
