-- Persist saved-research snapshot context so historical bookmarks stay historical
-- after the live current table changes. Safe to re-run.

alter table public.user_saved_props
  add column if not exists market_context text;

alter table public.user_saved_props
  add column if not exists date_et date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_saved_props_market_context_check'
  ) then
    alter table public.user_saved_props
      add constraint user_saved_props_market_context_check
      check (market_context is null or market_context in ('live', 'historical'));
  end if;
end
$$;
