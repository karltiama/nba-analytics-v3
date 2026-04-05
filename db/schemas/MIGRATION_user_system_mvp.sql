-- User system MVP: profiles, settings, and saved props.
-- Safe to re-run with IF NOT EXISTS guards.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferred_sportsbook text,
  bankroll numeric(12,2),
  risk_tolerance text check (risk_tolerance is null or risk_tolerance in ('low', 'medium', 'high')),
  min_edge_percent numeric(5,2),
  favorite_teams text[] not null default '{}'::text[],
  notification_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_saved_props (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id text not null,
  player_id bigint not null,
  player_name text,
  sportsbook text,
  prop_type text,
  market_type text,
  side text,
  line_value numeric(8,3),
  odds_american integer,
  implied_probability numeric,
  snapshot_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_saved_props_user_prop_unique
  on public.user_saved_props (
    user_id,
    game_id,
    player_id,
    coalesce(sportsbook, ''),
    coalesce(prop_type, ''),
    coalesce(side, ''),
    coalesce(line_value, -999999.999),
    coalesce(snapshot_at, '1970-01-01 00:00:00+00'::timestamptz)
  );

create index if not exists user_saved_props_user_created_idx
  on public.user_saved_props (user_id, created_at desc);

create index if not exists user_saved_props_game_idx
  on public.user_saved_props (game_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row
execute function public.set_updated_at();

drop trigger if exists user_saved_props_set_updated_at on public.user_saved_props;
create trigger user_saved_props_set_updated_at
before update on public.user_saved_props
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_saved_props enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own
on public.profiles
for delete
using (id = auth.uid());

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
on public.user_settings
for select
using (user_id = auth.uid());

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own
on public.user_settings
for insert
with check (user_id = auth.uid());

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
on public.user_settings
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own
on public.user_settings
for delete
using (user_id = auth.uid());

drop policy if exists user_saved_props_select_own on public.user_saved_props;
create policy user_saved_props_select_own
on public.user_saved_props
for select
using (user_id = auth.uid());

drop policy if exists user_saved_props_insert_own on public.user_saved_props;
create policy user_saved_props_insert_own
on public.user_saved_props
for insert
with check (user_id = auth.uid());

drop policy if exists user_saved_props_update_own on public.user_saved_props;
create policy user_saved_props_update_own
on public.user_saved_props
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists user_saved_props_delete_own on public.user_saved_props;
create policy user_saved_props_delete_own
on public.user_saved_props
for delete
using (user_id = auth.uid());
