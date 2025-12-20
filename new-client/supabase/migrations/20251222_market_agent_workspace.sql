-- Market Agent workspace: thesis + rich events timeline

-- 1) Thesis table
CREATE TABLE IF NOT EXISTS public.market_agent_thesis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.market_agent_instances(id) ON DELETE CASCADE,
  bias text,
  watched text[] DEFAULT '{}'::text[],
  key_levels jsonb DEFAULT '{}'::jsonb,
  invalidation text,
  next_check text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_agent_thesis_instance_idx
  ON public.market_agent_thesis (instance_id);

-- 2) Extend events table for timeline use (keep existing columns for compatibility)
ALTER TABLE public.market_agent_events
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS body_md text,
  ADD COLUMN IF NOT EXISTS tickers text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS severity_label text;

CREATE INDEX IF NOT EXISTS market_agent_events_instance_created_idx
  ON public.market_agent_events (instance_id, created_at DESC);

-- 3) RLS for thesis
ALTER TABLE public.market_agent_thesis ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_thesis' AND policyname = 'Market agent thesis select'
  ) THEN
    CREATE POLICY "Market agent thesis select"
      ON public.market_agent_thesis
      FOR SELECT
      USING (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_thesis' AND policyname = 'Market agent thesis insert'
  ) THEN
    CREATE POLICY "Market agent thesis insert"
      ON public.market_agent_thesis
      FOR INSERT
      WITH CHECK (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_thesis' AND policyname = 'Market agent thesis update'
  ) THEN
    CREATE POLICY "Market agent thesis update"
      ON public.market_agent_thesis
      FOR UPDATE
      USING (public.market_agent_instance_belongs_to_user(instance_id))
      WITH CHECK (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_agent_thesis' AND policyname = 'Market agent thesis delete'
  ) THEN
    CREATE POLICY "Market agent thesis delete"
      ON public.market_agent_thesis
      FOR DELETE
      USING (public.market_agent_instance_belongs_to_user(instance_id));
  END IF;
END $$;
