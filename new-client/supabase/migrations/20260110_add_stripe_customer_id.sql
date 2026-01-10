-- Add Stripe customer reference to user_plans so we can reuse payment data.

alter table if exists public.user_plans
  add column if not exists stripe_customer_id text null;
