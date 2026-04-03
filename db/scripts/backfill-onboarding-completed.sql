-- Run ONCE in production after MIGRATION_onboarding_user_settings.sql
-- to mark existing accounts as onboarded so only new signups see the modal.
--
-- Review row count before committing in a transaction.

UPDATE public.profiles
SET onboarding_completed_at = now()
WHERE onboarding_completed_at IS NULL;
