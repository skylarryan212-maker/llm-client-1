create table if not exists public.admin_settings (
  id text primary key default 'singleton',
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  admin_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_settings enable row level security;
