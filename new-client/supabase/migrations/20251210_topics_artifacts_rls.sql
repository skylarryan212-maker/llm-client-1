-- Enable RLS and add policies for conversation_topics and artifacts

alter table if exists public.conversation_topics enable row level security;
alter table if exists public.artifacts enable row level security;

-- Conversation topics policies
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
        and c.user_id::uuid = (select auth.uid())
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
        and c.user_id::uuid = (select auth.uid())
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
        and c.user_id::uuid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_topics.conversation_id
        and c.user_id::uuid = (select auth.uid())
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
        and c.user_id::uuid = (select auth.uid())
    )
  );

-- Artifact policies
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
        and c.user_id::uuid = (select auth.uid())
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
        and c.user_id::uuid = (select auth.uid())
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
        and c.user_id::uuid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = artifacts.conversation_id
        and c.user_id::uuid = (select auth.uid())
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
        and c.user_id::uuid = (select auth.uid())
    )
  );

