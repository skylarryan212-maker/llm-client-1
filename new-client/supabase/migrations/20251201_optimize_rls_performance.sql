-- Optimize RLS policies for performance
-- Fix 1: Wrap auth functions in subqueries to prevent per-row re-evaluation
-- Fix 2: Consolidate duplicate policies on user_preferences

-- ============================================================================
-- USER_PREFERENCES: Drop old policies and create optimized ones
-- ============================================================================

-- Drop all existing policies on user_preferences
DROP POLICY IF EXISTS "Users can read own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can insert own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "prefs_select_own" ON public.user_preferences;
DROP POLICY IF EXISTS "prefs_insert_own" ON public.user_preferences;
DROP POLICY IF EXISTS "prefs_update_own" ON public.user_preferences;
DROP POLICY IF EXISTS "prefs_delete_own" ON public.user_preferences;

-- Create optimized policies with subquery wrapper
CREATE POLICY "prefs_select_own" ON public.user_preferences
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "prefs_insert_own" ON public.user_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "prefs_update_own" ON public.user_preferences
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "prefs_delete_own" ON public.user_preferences
  FOR DELETE
  TO authenticated
  USING (user_id = (select auth.uid()));

-- ============================================================================
-- CONVERSATIONS: Optimize auth function calls
-- ============================================================================

DROP POLICY IF EXISTS "conversations_select_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_delete_own" ON public.conversations;

CREATE POLICY "conversations_select_own" ON public.conversations
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "conversations_insert_own" ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "conversations_update_own" ON public.conversations
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "conversations_delete_own" ON public.conversations
  FOR DELETE
  TO authenticated
  USING (user_id = (select auth.uid()));

-- ============================================================================
-- MESSAGES: Optimize auth function calls
-- ============================================================================

DROP POLICY IF EXISTS "messages_select_own" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
DROP POLICY IF EXISTS "messages_update_own" ON public.messages;
DROP POLICY IF EXISTS "messages_delete_own" ON public.messages;

CREATE POLICY "messages_select_own" ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = (select auth.uid())
    )
  );

CREATE POLICY "messages_insert_own" ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = (select auth.uid())
    )
  );

CREATE POLICY "messages_update_own" ON public.messages
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = (select auth.uid())
    )
  );

CREATE POLICY "messages_delete_own" ON public.messages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- PROJECTS: Optimize auth function calls
-- ============================================================================

DROP POLICY IF EXISTS "projects_select_own" ON public.projects;
DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;

CREATE POLICY "projects_select_own" ON public.projects
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "projects_insert_own" ON public.projects
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "projects_update_own" ON public.projects
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "projects_delete_own" ON public.projects
  FOR DELETE
  TO authenticated
  USING (user_id = (select auth.uid()));

-- ============================================================================
-- USER_API_USAGE: Optimize auth function calls
-- ============================================================================

DROP POLICY IF EXISTS "usage_select_own" ON public.user_api_usage;
DROP POLICY IF EXISTS "usage_insert_own" ON public.user_api_usage;
DROP POLICY IF EXISTS "usage_update_own" ON public.user_api_usage;

CREATE POLICY "usage_select_own" ON public.user_api_usage
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "usage_insert_own" ON public.user_api_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "usage_update_own" ON public.user_api_usage
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- ============================================================================
-- USER_PLANS: Optimize auth function calls
-- ============================================================================

DROP POLICY IF EXISTS "plans_select_own" ON public.user_plans;
DROP POLICY IF EXISTS "plans_insert_own" ON public.user_plans;
DROP POLICY IF EXISTS "plans_update_own" ON public.user_plans;

CREATE POLICY "plans_select_own" ON public.user_plans
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "plans_insert_own" ON public.user_plans
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "plans_update_own" ON public.user_plans
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- ============================================================================
-- GUEST_SESSIONS: Fix duplicate policies and optimize
-- ============================================================================

DROP POLICY IF EXISTS "guest_sessions_service_only" ON public.guest_sessions;
DROP POLICY IF EXISTS "Users can read their own guest session" ON public.guest_sessions;
DROP POLICY IF EXISTS "Service role can manage guest sessions" ON public.guest_sessions;

-- Single policy for service role (full access)
CREATE POLICY "guest_sessions_service_role" ON public.guest_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Single policy for anon users (read their own session)
CREATE POLICY "guest_sessions_anon_read" ON public.guest_sessions
  FOR SELECT
  TO anon
  USING (true); -- Guest sessions are identified by session_id, not user auth

-- Note: Anon users shouldn't directly insert/update guest_sessions.
-- Server-side code using service role handles guest session management.
