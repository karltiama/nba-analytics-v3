-- Fix: mutable search_path on analytics odds helpers (Supabase linter / security hardening).
-- Run once in Supabase SQL Editor if functions already exist without SET search_path.

create or replace function analytics.american_to_decimal(odds_american integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when odds_american > 0 then 1 + (odds_american::numeric / 100)
    when odds_american < 0 then 1 + (100::numeric / abs(odds_american))
    else null
  end;
$$;

create or replace function analytics.american_to_implied_prob(odds_american integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when odds_american <= 0 then abs(odds_american)::numeric / (abs(odds_american) + 100)
    when odds_american > 0 then 100::numeric / (odds_american + 100)
    else null
  end;
$$;
