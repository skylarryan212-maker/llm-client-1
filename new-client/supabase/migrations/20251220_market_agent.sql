-- Market Agent core schema
-- Tables: market_agent_instances, market_agent_watchlist_items, market_agent_events, market_agent_state
-- Includes RLS, indexes, and a helper function for inserting events.

-- 1) Instances
CREATE TABLE IF NOT EXISTS public.market_agent_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Market Agent',
  status text NOT NULL DEFAULT 'draft',
  cadence_seconds integer NOT NULL,
  report_depth text NOT NULL DEFAULT 'standard',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT market_agent_instances_status_check CHECK (status IN ('draft', 'running', 'paused')),
  CONSTRAINT market_agent_instances_cadence_check CHECK (cadence_seconds IN (60, 120, 300, 600, 1800, 3600)),
  CONSTRAINT market_agent_instances_report_depth_check CHECK (report_depth IN ('short', 'standard', 'deep'))
);

CREATE INDEX IF NOT EXISTS market_agent_instances_user_updated_idx
  ON public.market_agent_instances (user_id, updated_at DESC);

-- 2) Watchlist items
CREATE TABLE IF NOT EXISTS public.market_agent_watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.market_agent_instances(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_agent_watchlist_items_instance_idx
  ON public.market_agent_watchlist_items (instance_id);

CREATE UNIQUE INDEX IF NOT EXISTS market_agent_watchlist_items_unique_symbol
  ON public.market_agent_watchlist_items (instance_id, symbol);

-- 3) Events
CREATE TABLE IF NOT EXISTS public.market_agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.market_agent_instances(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  summary text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_used text NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT market_agent_events_severity_check CHECK (severity IN ('info', 'important', 'critical'))
);

CREATE INDEX IF NOT EXISTS market_agent_events_instance_ts_idx
  ON public.market_agent_events (instance_id, ts DESC);

CREATE INDEX IF NOT EXISTS market_agent_events_instance_type_ts_idx
  ON public.market_agent_events (instance_id, event_type, ts DESC);

-- 4) State
CREATE TABLE IF NOT EXISTS public.market_agent_state (
  instance_id uuid PRIMARY KEY REFERENCES public.market_agent_instances(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_agent_state_updated_idx
  ON public.market_agent_state (updated_at DESC);

-- Enable RLS
ALTER TABLE public.market_agent_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_agent_watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_agent_state ENABLE ROW LEVEL SECURITY;

-- Instances policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_instances' AND policyname = 'Market agent instances select'
  ) THEN
    CREATE POLICY "Market agent instances select"
      ON public.market_agent_instances
      FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_instances' AND policyname = 'Market agent instances insert'
  ) THEN
    CREATE POLICY "Market agent instances insert"
      ON public.market_agent_instances
      FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_instances' AND policyname = 'Market agent instances update'
  ) THEN
    CREATE POLICY "Market agent instances update"
      ON public.market_agent_instances
      FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_instances' AND policyname = 'Market agent instances delete'
  ) THEN
    CREATE POLICY "Market agent instances delete"
      ON public.market_agent_instances
      FOR DELETE
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Helper for policies on dependent tables
CREATE OR REPLACE FUNCTION public.market_agent_instance_belongs_to_user(target_instance_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.market_agent_instances i
    WHERE i.id = target_instance_id
      AND i.user_id = auth.uid()
  );
$$;

-- Watchlist policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_watchlist_items' AND policyname = 'Market agent watchlist select'
  ) THEN
    CREATE POLICY "Market agent watchlist select"
      ON public.market_agent_watchlist_items
      FOR SELECT
      USING (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_watchlist_items' AND policyname = 'Market agent watchlist insert'
  ) THEN
    CREATE POLICY "Market agent watchlist insert"
      ON public.market_agent_watchlist_items
      FOR INSERT
      WITH CHECK (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_watchlist_items' AND policyname = 'Market agent watchlist update'
  ) THEN
    CREATE POLICY "Market agent watchlist update"
      ON public.market_agent_watchlist_items
      FOR UPDATE
      USING (public.market_agent_instance_belongs_to_user(instance_id))
      WITH CHECK (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_watchlist_items' AND policyname = 'Market agent watchlist delete'
  ) THEN
    CREATE POLICY "Market agent watchlist delete"
      ON public.market_agent_watchlist_items
      FOR DELETE
      USING (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;
END $$;

-- Events policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_events' AND policyname = 'Market agent events select'
  ) THEN
    CREATE POLICY "Market agent events select"
      ON public.market_agent_events
      FOR SELECT
      USING (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_events' AND policyname = 'Market agent events insert'
  ) THEN
    CREATE POLICY "Market agent events insert"
      ON public.market_agent_events
      FOR INSERT
      WITH CHECK (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_events' AND policyname = 'Market agent events update'
  ) THEN
    CREATE POLICY "Market agent events update"
      ON public.market_agent_events
      FOR UPDATE
      USING (public.market_agent_instance_belongs_to_user(instance_id))
      WITH CHECK (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_events' AND policyname = 'Market agent events delete'
  ) THEN
    CREATE POLICY "Market agent events delete"
      ON public.market_agent_events
      FOR DELETE
      USING (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;
END $$;

-- State policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_state' AND policyname = 'Market agent state select'
  ) THEN
    CREATE POLICY "Market agent state select"
      ON public.market_agent_state
      FOR SELECT
      USING (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_state' AND policyname = 'Market agent state insert'
  ) THEN
    CREATE POLICY "Market agent state insert"
      ON public.market_agent_state
      FOR INSERT
      WITH CHECK (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_state' AND policyname = 'Market agent state update'
  ) THEN
    CREATE POLICY "Market agent state update"
      ON public.market_agent_state
      FOR UPDATE
      USING (public.market_agent_instance_belongs_to_user(instance_id))
      WITH CHECK (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_state' AND policyname = 'Market agent state delete'
  ) THEN
    CREATE POLICY "Market agent state delete"
      ON public.market_agent_state
      FOR DELETE
      USING (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;
END $$;

-- Helper function to insert events with auth guard
CREATE OR REPLACE FUNCTION public.insert_market_agent_event(
  _instance_id uuid,
  _event_type text,
  _severity text DEFAULT 'info',
  _summary text DEFAULT '',
  _payload jsonb DEFAULT '{}'::jsonb,
  _model_used text DEFAULT NULL,
  _ts timestamptz DEFAULT now()
) RETURNS public.market_agent_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  instance_owner uuid;
  new_event public.market_agent_events;
BEGIN
  SELECT user_id INTO instance_owner
  FROM public.market_agent_instances
  WHERE id = _instance_id;

  IF instance_owner IS NULL THEN
    RAISE EXCEPTION 'Unknown market agent instance %', _instance_id;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> instance_owner THEN
    RAISE EXCEPTION 'Not authorized to write events for this instance';
  END IF;

  INSERT INTO public.market_agent_events (
    instance_id, ts, event_type, severity, summary, payload, model_used
  ) VALUES (
    _instance_id,
    COALESCE(_ts, now()),
    _event_type,
    COALESCE(_severity, 'info'),
    COALESCE(_summary, ''),
    COALESCE(_payload, '{}'::jsonb),
    _model_used
  )
  RETURNING * INTO new_event;

  RETURN new_event;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_market_agent_event(uuid, text, text, text, jsonb, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_market_agent_event(uuid, text, text, text, jsonb, text, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.insert_market_agent_event IS 'Helper to append a market agent event while enforcing instance ownership.';
