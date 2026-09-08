/**
 * Remaining-31 Postgres materialize from validated S3 `/v1/stats` archives.
 *
 * Exact queue: 31 GOAT repair IDs excluding already repaired
 *   18447793, 21707973, 21716138
 * Never touches 21681993. No BALLDONTLIE HTTP. No 2024.
 *
 *   npx tsx scripts/ingestion/materialize-goat-stats-remaining-31-postgres.ts --dry-run
 *   npx tsx scripts/ingestion/materialize-goat-stats-remaining-31-postgres.ts --execute --i-understand-production-write
 */
if (!process.argv.includes('--remaining-31')) {
  process.argv.push('--remaining-31');
}
void import('./materialize-goat-stats-3game-postgres.ts');
