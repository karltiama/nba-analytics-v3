-- WP6.3 billing support. Safe to re-run.
-- Unique provider identities + webhook idempotency. Does not grant Pro.

alter table public.user_entitlements
  add column if not exists last_provider_event_at timestamptz;

create unique index if not exists user_entitlements_provider_customer_uidx
  on public.user_entitlements (provider_customer_id)
  where provider_customer_id is not null;

create unique index if not exists user_entitlements_provider_subscription_uidx
  on public.user_entitlements (provider_subscription_id)
  where provider_subscription_id is not null;

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  provider_event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text,
  error text,
  unique (provider, provider_event_id)
);

create index if not exists billing_webhook_events_received_idx
  on public.billing_webhook_events (received_at desc);

comment on table public.billing_webhook_events is
  'Durable Stripe (and later) webhook idempotency. Unique provider_event_id.';

comment on column public.user_entitlements.last_provider_event_at is
  'Audit: newest Stripe event.created observed. Not write authority; live subscription reconcile + provider_event_id idempotency are.';

alter table public.billing_webhook_events enable row level security;
