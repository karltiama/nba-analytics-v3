/**
 * Trial remaining-31: GOAT `/v1/stats` for the 31 unrepaired games only.
 *
 * Queue source: reports/trial/2025-repair-manifest.json (requiresGoat IDs).
 * Excludes already acquired/validated:
 *   18447793, 21707973, 21716138
 * Expected remaining: exactly 31. STOP if math is not 34 − 3 = 31.
 *
 * Same game-scoped path as the 3-game proof:
 *   GET /v1/stats?game_ids[]=<id>&per_page=100
 * Archives to:
 *   raw/source=balldontlie/league=nba/season=2025/entity=player_stats/game_id=<id>.json
 * Repair manifest only:
 *   _repair_remaining31_manifest.json
 * Does NOT overwrite season-wide `_manifest.json`.
 * Never writes Postgres. Skip-existing S3. Concurrency 1. 13s trial spacing.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/ingestion/archive-goat-stats-remaining-31.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/ingestion/archive-goat-stats-remaining-31.ts --execute
 */
if (!process.argv.includes('--remaining-31')) {
  process.argv.push('--remaining-31');
}
void import('./archive-goat-stats-3game-batch.ts');
