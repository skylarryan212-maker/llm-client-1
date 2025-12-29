-- Optimize RLS policies for governor/market_agent tables and remove duplicate permissive policies.

CREATE OR REPLACE FUNCTION public.governor_instance_belongs_to_user(target_instance_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.governor_instances i
    WHERE i.id = target_instance_id
      AND i.user_id = (select auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.market_agent_instance_belongs_to_user(target_instance_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.market_agent_instances i
    WHERE i.id = target_instance_id
      AND i.user_id = (select auth.uid())
  );
$$;

DO $$
BEGIN
  -- Drop duplicate permissive policies if they exist.
  DROP POLICY IF EXISTS "Users manage their own instances" ON public.governor_instances;
  DROP POLICY IF EXISTS "Users view their own logs" ON public.governor_logs;
  DROP POLICY IF EXISTS "Users view their own runs" ON public.governor_runs;

  -- Governor instances policies.
  DROP POLICY IF EXISTS "Governor instances select" ON public.governor_instances;
  CREATE POLICY "Governor instances select"
    ON public.governor_instances
    FOR SELECT
    USING (user_id = (select auth.uid()));

  DROP POLICY IF EXISTS "Governor instances insert" ON public.governor_instances;
  CREATE POLICY "Governor instances insert"
    ON public.governor_instances
    FOR INSERT
    WITH CHECK (user_id = (select auth.uid()));

  DROP POLICY IF EXISTS "Governor instances update" ON public.governor_instances;
  CREATE POLICY "Governor instances update"
    ON public.governor_instances
    FOR UPDATE
    USING (user_id = (select auth.uid()))
    WITH CHECK (user_id = (select auth.uid()));

  DROP POLICY IF EXISTS "Governor instances delete" ON public.governor_instances;
  CREATE POLICY "Governor instances delete"
    ON public.governor_instances
    FOR DELETE
    USING (user_id = (select auth.uid()));

  -- Governor runs policies.
  DROP POLICY IF EXISTS "Governor runs select" ON public.governor_runs;
  CREATE POLICY "Governor runs select"
    ON public.governor_runs
    FOR SELECT
    USING (public.governor_instance_belongs_to_user(instance_id));

  DROP POLICY IF EXISTS "Governor runs insert" ON public.governor_runs;
  CREATE POLICY "Governor runs insert"
    ON public.governor_runs
    FOR INSERT
    WITH CHECK (public.governor_instance_belongs_to_user(instance_id));

  DROP POLICY IF EXISTS "Governor runs update" ON public.governor_runs;
  CREATE POLICY "Governor runs update"
    ON public.governor_runs
    FOR UPDATE
    USING (public.governor_instance_belongs_to_user(instance_id))
    WITH CHECK (public.governor_instance_belongs_to_user(instance_id));

  DROP POLICY IF EXISTS "Governor runs delete" ON public.governor_runs;
  CREATE POLICY "Governor runs delete"
    ON public.governor_runs
    FOR DELETE
    USING (public.governor_instance_belongs_to_user(instance_id));

  -- Governor logs policies.
  DROP POLICY IF EXISTS "Governor logs select" ON public.governor_logs;
  CREATE POLICY "Governor logs select"
    ON public.governor_logs
    FOR SELECT
    USING (public.governor_instance_belongs_to_user(instance_id));

  DROP POLICY IF EXISTS "Governor logs insert" ON public.governor_logs;
  CREATE POLICY "Governor logs insert"
    ON public.governor_logs
    FOR INSERT
    WITH CHECK (public.governor_instance_belongs_to_user(instance_id));

  DROP POLICY IF EXISTS "Governor logs update" ON public.governor_logs;
  CREATE POLICY "Governor logs update"
    ON public.governor_logs
    FOR UPDATE
    USING (public.governor_instance_belongs_to_user(instance_id))
    WITH CHECK (public.governor_instance_belongs_to_user(instance_id));

  DROP POLICY IF EXISTS "Governor logs delete" ON public.governor_logs;
  CREATE POLICY "Governor logs delete"
    ON public.governor_logs
    FOR DELETE
    USING (public.governor_instance_belongs_to_user(instance_id));

  -- Market agent instances policies.
  DROP POLICY IF EXISTS "Market agent instances select" ON public.market_agent_instances;
  CREATE POLICY "Market agent instances select"
    ON public.market_agent_instances
    FOR SELECT
    USING (user_id = (select auth.uid()));

  DROP POLICY IF EXISTS "Market agent instances insert" ON public.market_agent_instances;
  CREATE POLICY "Market agent instances insert"
    ON public.market_agent_instances
    FOR INSERT
    WITH CHECK (user_id = (select auth.uid()));

  DROP POLICY IF EXISTS "Market agent instances update" ON public.market_agent_instances;
  CREATE POLICY "Market agent instances update"
    ON public.market_agent_instances
    FOR UPDATE
    USING (user_id = (select auth.uid()))
    WITH CHECK (user_id = (select auth.uid()));

  DROP POLICY IF EXISTS "Market agent instances delete" ON public.market_agent_instances;
  CREATE POLICY "Market agent instances delete"
    ON public.market_agent_instances
    FOR DELETE
    USING (user_id = (select auth.uid()));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sga_heuristics'
      AND column_name = 'user_id'
  ) THEN
    DROP POLICY IF EXISTS "Users manage their own heuristics" ON public.sga_heuristics;
    CREATE POLICY "Users manage their own heuristics"
      ON public.sga_heuristics
      FOR ALL
      USING (user_id::uuid = (select auth.uid()))
      WITH CHECK (user_id::uuid = (select auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'governor_tasks'
      AND column_name = 'user_id'
  ) THEN
    DROP POLICY IF EXISTS "Users view their own tasks" ON public.governor_tasks;
    CREATE POLICY "Users view their own tasks"
      ON public.governor_tasks
      FOR SELECT
      USING (user_id = (select auth.uid()));
  END IF;
END $$;
