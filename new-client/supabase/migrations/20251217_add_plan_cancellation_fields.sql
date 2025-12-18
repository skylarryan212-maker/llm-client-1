-- Add cancellation tracking fields to user_plans
-- These support "cancel at period end" messaging and enforcement.

alter table if exists public.user_plans
  add column if not exists cancel_at timestamptz null,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists canceled_at timestamptz null;

