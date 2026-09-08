/**
 * WP7.2 orchestrator: compact historical serving backfill for 2024 or 2023.
 *
 * Option B: BDL API → S3 raw/source=balldontlie → analytics serving tables.
 * Never writes raw.player_game_stats. stagingMode=none.
 *
 * Usage:
 *   npx tsx scripts/ingestion/backfill-historical-season-serving.ts --season=2024 --dry-run
 *   npx tsx scripts/ingestion/backfill-historical-season-serving.ts --season=2023 --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/ingestion/backfill-historical-season-serving.ts --season=2024 --execute
 *   npx tsx scripts/ingestion/backfill-historical-season-serving.ts --season=2024 --execute --skip-probe --skip-archive
 *     (Step 3C: existing S3 only — no BDL HTTP)

 */
import 'dotenv/config';
import { runHistoricalServingBackfill } from '@/lib/ingestion/historical-serving/orchestrate';

runHistoricalServingBackfill(process.argv.slice(2))
  .then((r) => process.exit(r.exitCode))
  .catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
