-- SGA governor schema
-- Tables: governor_instances, governor_runs, governor_logs
-- Includes RLS policies and helper function.

CREATE TABLE IF NOT EXISTS public.governor_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Self-Governing Agent',
  status text NOT NULL DEFAULT 'active',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS governor_instances_user_updated_idx
  ON public.governor_instances (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.governor_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.governor_instances(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'completed',
  cycle_id text,
  mode text,
  phase_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure expected columns exist on older installs
ALTER TABLE public.governor_runs ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE public.governor_runs ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed';
ALTER TABLE public.governor_runs ADD COLUMN IF NOT EXISTS cycle_id text;
ALTER TABLE public.governor_runs ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE public.governor_runs ADD COLUMN IF NOT EXISTS phase_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.governor_runs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.governor_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS governor_runs_instance_updated_idx
  ON public.governor_runs (instance_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.governor_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.governor_runs(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.governor_instances(id) ON DELETE CASCADE,
  log_type text NOT NULL DEFAULT 'situation_scan',
  severity text NOT NULL DEFAULT 'info',
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Ensure expected columns exist on older installs
ALTER TABLE public.governor_logs ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE public.governor_logs ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE public.governor_logs ADD COLUMN IF NOT EXISTS log_type text DEFAULT 'situation_scan';
ALTER TABLE public.governor_logs ADD COLUMN IF NOT EXISTS severity text DEFAULT 'info';
ALTER TABLE public.governor_logs ADD COLUMN IF NOT EXISTS content text DEFAULT '';
ALTER TABLE public.governor_logs ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.governor_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Backfill instance_id if missing and run_id is present
UPDATE public.governor_logs gl
SET instance_id = gr.instance_id
FROM public.governor_runs gr
WHERE gl.instance_id IS NULL
  AND gl.run_id = gr.id;

CREATE INDEX IF NOT EXISTS governor_logs_run_idx
  ON public.governor_logs (run_id);

CREATE INDEX IF NOT EXISTS governor_logs_instance_created_idx
  ON public.governor_logs (instance_id, created_at DESC);

ALTER TABLE public.governor_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governor_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governor_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_instances' AND policyname = 'Governor instances select'
  ) THEN
    CREATE POLICY "Governor instances select"
      ON public.governor_instances
      FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_instances' AND policyname = 'Governor instances insert'
  ) THEN
    CREATE POLICY "Governor instances insert"
      ON public.governor_instances
      FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_instances' AND policyname = 'Governor instances update'
  ) THEN
    CREATE POLICY "Governor instances update"
      ON public.governor_instances
      FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_instances' AND policyname = 'Governor instances delete'
  ) THEN
    CREATE POLICY "Governor instances delete"
      ON public.governor_instances
      FOR DELETE
      USING (user_id = auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.governor_instance_belongs_to_user(target_instance_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.governor_instances i
    WHERE i.id = target_instance_id
      AND i.user_id = auth.uid()
  );
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_runs' AND policyname = 'Governor runs select'
  ) THEN
    CREATE POLICY "Governor runs select"
      ON public.governor_runs
      FOR SELECT
      USING (public.governor_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_runs' AND policyname = 'Governor runs insert'
  ) THEN
    CREATE POLICY "Governor runs insert"
      ON public.governor_runs
      FOR INSERT
      WITH CHECK (public.governor_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_runs' AND policyname = 'Governor runs update'
  ) THEN
    CREATE POLICY "Governor runs update"
      ON public.governor_runs
      FOR UPDATE
      USING (public.governor_instance_belongs_to_user(instance_id))
      WITH CHECK (public.governor_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_runs' AND policyname = 'Governor runs delete'
  ) THEN
    CREATE POLICY "Governor runs delete"
      ON public.governor_runs
      FOR DELETE
      USING (public.governor_instance_belongs_to_user(instance_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_logs' AND policyname = 'Governor logs select'
  ) THEN
    CREATE POLICY "Governor logs select"
      ON public.governor_logs
      FOR SELECT
      USING (public.governor_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_logs' AND policyname = 'Governor logs insert'
  ) THEN
    CREATE POLICY "Governor logs insert"
      ON public.governor_logs
      FOR INSERT
      WITH CHECK (public.governor_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_logs' AND policyname = 'Governor logs update'
  ) THEN
    CREATE POLICY "Governor logs update"
      ON public.governor_logs
      FOR UPDATE
      USING (public.governor_instance_belongs_to_user(instance_id))
      WITH CHECK (public.governor_instance_belongs_to_user(instance_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'governor_logs' AND policyname = 'Governor logs delete'
  ) THEN
    CREATE POLICY "Governor logs delete"
      ON public.governor_logs
      FOR DELETE
      USING (public.governor_instance_belongs_to_user(instance_id));
  END IF;
END $$;
