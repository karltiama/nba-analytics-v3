/**
 * BBRef player identity — DEFERRED in 13R.3.
 *
 * Boxscore scraper and bbref_player_game_stats resolve players by name against
 * public.players / rosters. There is no certified bbref provider-bridge population
 * on player_provider_ids. Names remain diagnostic only.
 *
 * Do not auto-match BBRef names into canonical bridges in this step.
 */

export const BBREF_IDENTITY_ADOPTION = 'DEFERRED' as const;

export const BBREF_IDENTITY_DEFER_REASON =
  'BBRef ingestion currently uses name matching against public.players; player_provider_ids has no certified bbref bridges. Forcing the canonical resolver would invent unsafe matches.';
