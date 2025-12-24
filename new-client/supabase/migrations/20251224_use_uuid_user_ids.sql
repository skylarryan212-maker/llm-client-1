-- Normalize user_id columns to UUID and align RLS policies with UUID types.

do $$
begin
  if exists (
    select 1 from public.conversations
    where user_id is not null
      and user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Invalid public.conversations.user_id values; clean these before migration.';
  end if;

  if exists (
    select 1 from public.messages
    where user_id is not null
      and user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Invalid public.messages.user_id values; clean these before migration.';
  end if;

  if exists (
    select 1 from public.projects
    where user_id is not null
      and user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Invalid public.projects.user_id values; clean these before migration.';
  end if;

  if exists (
    select 1 from public.sga_heuristics
    where user_id is not null
      and user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Invalid public.sga_heuristics.user_id values; clean these before migration.';
  end if;

  if exists (
    select 1 from public.user_preferences
    where user_id is not null
      and user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Invalid public.user_preferences.user_id values; clean these before migration.';
  end if;
end
$$;

alter table public.conversations
  alter column user_id type uuid using user_id::uuid;

alter table public.conversations
  drop constraint if exists conversations_user_id_fkey,
  add constraint conversations_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.messages
  alter column user_id drop default,
  alter column user_id type uuid using user_id::uuid;

alter table public.messages
  drop constraint if exists messages_user_id_fkey,
  add constraint messages_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.projects
  alter column user_id type uuid using user_id::uuid;

alter table public.projects
  drop constraint if exists projects_user_id_fkey,
  add constraint projects_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.sga_heuristics
  alter column user_id type uuid using user_id::uuid;

alter table public.sga_heuristics
  drop constraint if exists sga_heuristics_user_id_fkey,
  add constraint sga_heuristics_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.user_preferences
  alter column user_id type uuid using user_id::uuid;

alter table public.user_preferences
  drop constraint if exists user_preferences_user_id_fkey,
  add constraint user_preferences_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

--------------------------------------------------------------------------------
-- RLS policy updates (remove ::uuid casts now that columns are UUID)
--------------------------------------------------------------------------------

-- USER_PREFERENCES
drop policy if exists "user_preferences_select_own" on public.user_preferences;
drop policy if exists "user_preferences_insert_own" on public.user_preferences;
drop policy if exists "user_preferences_update_own" on public.user_preferences;
drop policy if exists "user_preferences_delete_own" on public.user_preferences;

create policy "user_preferences_select_own" on public.user_preferences
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_preferences_insert_own" on public.user_preferences
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_preferences_update_own" on public.user_preferences
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_preferences_delete_own" on public.user_preferences
  for delete
  to authenticated
  using (user_id = auth.uid());

-- CONVERSATIONS
drop policy if exists "conversations_select_own" on public.conversations;
drop policy if exists "conversations_insert_own" on public.conversations;
drop policy if exists "conversations_update_own" on public.conversations;
drop policy if exists "conversations_delete_own" on public.conversations;

create policy "conversations_select_own" on public.conversations
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "conversations_insert_own" on public.conversations
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "conversations_update_own" on public.conversations
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "conversations_delete_own" on public.conversations
  for delete
  to authenticated
  using (user_id = auth.uid());

-- MESSAGES
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
        and c.user_id = auth.uid()
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
        and c.user_id = auth.uid()
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
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
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
        and c.user_id = auth.uid()
    )
  );

-- PROJECTS
drop policy if exists "projects_select_own" on public.projects;
drop policy if exists "projects_insert_own" on public.projects;
drop policy if exists "projects_update_own" on public.projects;
drop policy if exists "projects_delete_own" on public.projects;

create policy "projects_select_own" on public.projects
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "projects_insert_own" on public.projects
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "projects_update_own" on public.projects
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "projects_delete_own" on public.projects
  for delete
  to authenticated
  using (user_id = auth.uid());

-- USER_API_USAGE
drop policy if exists "user_api_usage_select_own" on public.user_api_usage;
drop policy if exists "user_api_usage_insert_own" on public.user_api_usage;
drop policy if exists "user_api_usage_update_own" on public.user_api_usage;

create policy "user_api_usage_select_own" on public.user_api_usage
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_api_usage_insert_own" on public.user_api_usage
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_api_usage_update_own" on public.user_api_usage
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- USER_PLANS
drop policy if exists "user_plans_select_own" on public.user_plans;
drop policy if exists "user_plans_insert_own" on public.user_plans;
drop policy if exists "user_plans_update_own" on public.user_plans;

create policy "user_plans_select_own" on public.user_plans
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_plans_insert_own" on public.user_plans
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_plans_update_own" on public.user_plans
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- MEMORIES
drop policy if exists "memories_select_own" on public.memories;
drop policy if exists "memories_insert_own" on public.memories;
drop policy if exists "memories_update_own" on public.memories;
drop policy if exists "memories_delete_own" on public.memories;

create policy "memories_select_own" on public.memories
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "memories_insert_own" on public.memories
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "memories_update_own" on public.memories
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "memories_delete_own" on public.memories
  for delete
  to authenticated
  using (user_id = auth.uid());

-- CONVERSATION_TOPICS
drop policy if exists "conversation_topics_select_own" on public.conversation_topics;
drop policy if exists "conversation_topics_insert_own" on public.conversation_topics;
drop policy if exists "conversation_topics_update_own" on public.conversation_topics;
drop policy if exists "conversation_topics_delete_own" on public.conversation_topics;

create policy "conversation_topics_select_own" on public.conversation_topics
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_topics.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "conversation_topics_insert_own" on public.conversation_topics
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_topics.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "conversation_topics_update_own" on public.conversation_topics
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_topics.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_topics.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "conversation_topics_delete_own" on public.conversation_topics
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_topics.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- ARTIFACTS
drop policy if exists "artifacts_select_own" on public.artifacts;
drop policy if exists "artifacts_insert_own" on public.artifacts;
drop policy if exists "artifacts_update_own" on public.artifacts;
drop policy if exists "artifacts_delete_own" on public.artifacts;

create policy "artifacts_select_own" on public.artifacts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = artifacts.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "artifacts_insert_own" on public.artifacts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = artifacts.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "artifacts_update_own" on public.artifacts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = artifacts.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = artifacts.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "artifacts_delete_own" on public.artifacts
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = artifacts.conversation_id
        and c.user_id = auth.uid()
    )
  );
