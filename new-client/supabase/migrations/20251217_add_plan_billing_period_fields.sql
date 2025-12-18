-- Add billing period tracking fields to user_plans.
-- These are used to keep renewal dates stable across cancel/reactivate.

alter table if exists public.user_plans
  add column if not exists current_period_start timestamptz null,
  add column if not exists current_period_end timestamptz null;

