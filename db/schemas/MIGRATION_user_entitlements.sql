-- WP6.2: provider-neutral entitlements. Safe to re-run.
-- Missing row = Free. Do not backfill anyone to Pro.

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free'
    check (plan in ('free', 'founding_pro')),
  status text not null default 'none'
    check (status in ('none', 'active', 'canceled', 'past_due', 'unpaid', 'expired', 'trialing')),
  current_period_end timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_entitlements_plan_status_idx
  on public.user_entitlements (plan, status);

comment on table public.user_entitlements is
  'Internal entitlement state. Application code uses plan/status, not Stripe price IDs.';

alter table public.user_entitlements enable row level security;

drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own
on public.user_entitlements
for select
using (user_id = auth.uid());
