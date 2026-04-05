-- Fix: mutable search_path on public.set_updated_at (Supabase linter).
-- Run once in Supabase SQL Editor if the function already exists without SET search_path.

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
