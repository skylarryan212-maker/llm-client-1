-- Optimize RLS policies to avoid per-row auth function calls and remove duplicates

--------------------------------------------------------------------------------
-- USER_PREFERENCES
--------------------------------------------------------------------------------
drop policy if exists "Users can read own preferences" on public.user_preferences;
drop policy if exists "Users can insert own preferences" on public.user_preferences;
drop policy if exists "Users can update own preferences" on public.user_preferences;
drop policy if exists "Users can delete own preferences" on public.user_preferences;
drop policy if exists "prefs_select_own" on public.user_preferences;
drop policy if exists "prefs_insert_own" on public.user_preferences;
drop policy if exists "prefs_update_own" on public.user_preferences;
drop policy if exists "prefs_delete_own" on public.user_preferences;

create policy "user_preferences_select_own" on public.user_preferences
  for select
  to authenticated
  using (user_id::uuid = (select auth.uid()));

create policy "user_preferences_insert_own" on public.user_preferences
  for insert
  to authenticated
  with check (user_id::uuid = (select auth.uid()));

create policy "user_preferences_update_own" on public.user_preferences
  for update
  to authenticated
  using (user_id::uuid = (select auth.uid()))
  with check (user_id::uuid = (select auth.uid()));

create policy "user_preferences_delete_own" on public.user_preferences
  for delete
  to authenticated
  using (user_id::uuid = (select auth.uid()));

--------------------------------------------------------------------------------
-- CONVERSATIONS
--------------------------------------------------------------------------------
drop policy if exists "conversations_select_own" on public.conversations;
drop policy if exists "conversations_insert_own" on public.conversations;
drop policy if exists "conversations_update_own" on public.conversations;
drop policy if exists "conversations_delete_own" on public.conversations;

create policy "conversations_select_own" on public.conversations
  for select
  to authenticated
  using (user_id::uuid = (select auth.uid()));

create policy "conversations_insert_own" on public.conversations
  for insert
  to authenticated
  with check (user_id::uuid = (select auth.uid()));

create policy "conversations_update_own" on public.conversations
  for update
  to authenticated
  using (user_id::uuid = (select auth.uid()))
  with check (user_id::uuid = (select auth.uid()));

create policy "conversations_delete_own" on public.conversations
  for delete
  to authenticated
  using (user_id::uuid = (select auth.uid()));

--------------------------------------------------------------------------------
-- MESSAGES
--------------------------------------------------------------------------------
drop policy if exists "messages_select_own" on public.messages;
drop policy if exists "messages_insert_own" on public.messages;
drop policy if exists "messages_update_own" on public.messages;
drop policy if exists "messages_delete_own" on public.messages;

create policy "messages_select_own" on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id::uuid = (select auth.uid())
    )
  );

create policy "messages_insert_own" on public.messages
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id::uuid = (select auth.uid())
    )
  );

create policy "messages_update_own" on public.messages
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id::uuid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id::uuid = (select auth.uid())
    )
  );

create policy "messages_delete_own" on public.messages
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id::uuid = (select auth.uid())
    )
  );

--------------------------------------------------------------------------------
-- PROJECTS
--------------------------------------------------------------------------------
drop policy if exists "projects_select_own" on public.projects;
drop policy if exists "projects_insert_own" on public.projects;
drop policy if exists "projects_update_own" on public.projects;
drop policy if exists "projects_delete_own" on public.projects;

create policy "projects_select_own" on public.projects
  for select
  to authenticated
  using (user_id::uuid = (select auth.uid()));

create policy "projects_insert_own" on public.projects
  for insert
  to authenticated
  with check (user_id::uuid = (select auth.uid()));

create policy "projects_update_own" on public.projects
  for update
  to authenticated
  using (user_id::uuid = (select auth.uid()))
  with check (user_id::uuid = (select auth.uid()));

create policy "projects_delete_own" on public.projects
  for delete
  to authenticated
  using (user_id::uuid = (select auth.uid()));

--------------------------------------------------------------------------------
-- USER_API_USAGE
--------------------------------------------------------------------------------
drop policy if exists "usage_select_own" on public.user_api_usage;
drop policy if exists "usage_insert_own" on public.user_api_usage;
drop policy if exists "usage_update_own" on public.user_api_usage;

create policy "user_api_usage_select_own" on public.user_api_usage
  for select
  to authenticated
  using (user_id::uuid = (select auth.uid()));

create policy "user_api_usage_insert_own" on public.user_api_usage
  for insert
  to authenticated
  with check (user_id::uuid = (select auth.uid()));

create policy "user_api_usage_update_own" on public.user_api_usage
  for update
  to authenticated
  using (user_id::uuid = (select auth.uid()))
  with check (user_id::uuid = (select auth.uid()));

--------------------------------------------------------------------------------
-- USER_PLANS
--------------------------------------------------------------------------------
drop policy if exists "plans_select_own" on public.user_plans;
drop policy if exists "plans_insert_own" on public.user_plans;
drop policy if exists "plans_update_own" on public.user_plans;

create policy "user_plans_select_own" on public.user_plans
  for select
  to authenticated
  using (user_id::uuid = (select auth.uid()));

create policy "user_plans_insert_own" on public.user_plans
  for insert
  to authenticated
  with check (user_id::uuid = (select auth.uid()));

create policy "user_plans_update_own" on public.user_plans
  for update
  to authenticated
  using (user_id::uuid = (select auth.uid()))
  with check (user_id::uuid = (select auth.uid()));

--------------------------------------------------------------------------------
-- GUEST_SESSIONS
--------------------------------------------------------------------------------
drop policy if exists "guest_sessions_service_only" on public.guest_sessions;
drop policy if exists "guest_sessions_service_role" on public.guest_sessions;
drop policy if exists "guest_sessions_anon_read" on public.guest_sessions;
drop policy if exists "Users can read their own guest session" on public.guest_sessions;

create policy "guest_sessions_service_role" on public.guest_sessions
  for all
  to service_role
  using (true)
  with check (true);

create policy "guest_sessions_anon_read" on public.guest_sessions
  for select
  to anon
  using (true);

--------------------------------------------------------------------------------
-- MEMORIES
--------------------------------------------------------------------------------
drop policy if exists "memories select own" on public.memories;
drop policy if exists "memories insert own" on public.memories;
drop policy if exists "memories update own" on public.memories;
drop policy if exists "memories delete own" on public.memories;

create policy "memories_select_own" on public.memories
  for select
  to authenticated
  using (user_id::uuid = (select auth.uid()));

create policy "memories_insert_own" on public.memories
  for insert
  to authenticated
  with check (user_id::uuid = (select auth.uid()));

create policy "memories_update_own" on public.memories
  for update
  to authenticated
  using (user_id::uuid = (select auth.uid()))
  with check (user_id::uuid = (select auth.uid()));

create policy "memories_delete_own" on public.memories
  for delete
  to authenticated
  using (user_id::uuid = (select auth.uid()));
