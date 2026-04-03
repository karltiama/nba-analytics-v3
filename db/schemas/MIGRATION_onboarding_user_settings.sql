-- Onboarding: profile completion flag + extended user_settings.
-- Safe to re-run with IF NOT EXISTS guards.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS odds_format text
    DEFAULT 'american'
    CHECK (odds_format IS NULL OR odds_format IN ('american', 'decimal', 'fractional'));

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS paper_display_mode text
    DEFAULT 'units'
    CHECK (paper_display_mode IS NULL OR paper_display_mode IN ('dollars', 'units', 'off'));

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS primary_goal text
    CHECK (primary_goal IS NULL OR primary_goal IN ('find_edges', 'track_picks', 'learn'));

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS experience_level text
    CHECK (experience_level IS NULL OR experience_level IN ('novice', 'intermediate', 'advanced'));

-- Optional: one-time backfill for existing users (run manually in SQL editor once after deploy).
-- See: db/scripts/backfill-onboarding-completed.sql
