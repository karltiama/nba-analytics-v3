-- Onboarding v3: where the user bets and which books they have accounts with.
-- Additive and nullable. Safe to re-run.
-- sportsbooks holds catalog ids from lib/onboarding/sportsbooks.ts (NULL = never answered, {} = answered none).

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS betting_country text
    CHECK (betting_country IS NULL OR betting_country IN ('US', 'CA', 'OTHER'));

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS betting_region text
    CHECK (betting_region IS NULL OR betting_region ~ '^[A-Z]{2}$');

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS sportsbooks text[];
