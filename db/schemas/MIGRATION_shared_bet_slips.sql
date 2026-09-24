-- Shared bet slips: immutable public share snapshots (prop-slip / handoff Phase 1F).
-- Safe to re-run with IF NOT EXISTS / OR REPLACE guards.
--
-- Security model:
-- 1) RLS enabled; no anon/authenticated SELECT policy on the base table
--    (denies PostgREST/direct client reads of created_by).
-- 2) Authenticated INSERT only when created_by = auth.uid().
-- 3) Public lookup via SECURITY DEFINER function that returns ONLY safe columns.
-- 4) App create/read uses server-side pg (SUPABASE_DB_URL) and never maps id/created_by
--    into PublicSharedBetSlip responses.

create extension if not exists pgcrypto;

create table if not exists public.shared_bet_slips (
  id uuid primary key default gen_random_uuid(),
  share_id text not null,
  title text null,
  source text not null,
  snapshot_version smallint not null default 1,
  legs_snapshot jsonb not null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint shared_bet_slips_share_id_nonempty check (length(trim(share_id)) > 0),
  constraint shared_bet_slips_legs_is_array check (jsonb_typeof(legs_snapshot) = 'array'),
  constraint shared_bet_slips_snapshot_version_positive check (snapshot_version >= 1)
);

create unique index if not exists shared_bet_slips_share_id_uidx
  on public.shared_bet_slips (share_id);

create index if not exists shared_bet_slips_created_at_idx
  on public.shared_bet_slips (created_at desc);

comment on table public.shared_bet_slips is
  'Immutable shared prop-slip snapshots. Public clients must use get_shared_bet_slip_public; never expose created_by.';
comment on column public.shared_bet_slips.share_id is
  'Opaque public URL token for /slip/[shareId]. Not a sequential integer.';
comment on column public.shared_bet_slips.legs_snapshot is
  'Frozen CanonicalBetLeg[] at share time (line/odds/book as selected). Never mutate in place.';
comment on column public.shared_bet_slips.created_by is
  'Optional auth.users.id of creator. Must never appear in public API responses.';

alter table public.shared_bet_slips enable row level security;

drop policy if exists shared_bet_slips_insert_own on public.shared_bet_slips;
create policy shared_bet_slips_insert_own
on public.shared_bet_slips
for insert
to authenticated
with check (created_by = auth.uid());

-- Intentionally no SELECT / UPDATE / DELETE policies for anon or authenticated.
-- Base-table reads via PostgREST are denied. Public reads use the function below.

create or replace function public.get_shared_bet_slip_public(p_share_id text)
returns table (
  share_id text,
  title text,
  source text,
  snapshot_version smallint,
  legs_snapshot jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.share_id,
    s.title,
    s.source,
    s.snapshot_version,
    s.legs_snapshot,
    s.created_at
  from public.shared_bet_slips s
  where s.share_id = p_share_id;
$$;

revoke all on function public.get_shared_bet_slip_public(text) from public;
grant execute on function public.get_shared_bet_slip_public(text) to anon, authenticated;

comment on function public.get_shared_bet_slip_public(text) is
  'Public shared-slip lookup by opaque share_id. Returns safe columns only (no id, no created_by).';
