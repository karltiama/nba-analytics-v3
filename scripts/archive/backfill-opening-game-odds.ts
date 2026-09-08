/**
 * Historical opening game odds S3 archive. Do not execute until GOAT is authorized.
 *
 *   npx tsx scripts/archive/backfill-opening-game-odds.ts --season=2024 --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-opening-game-odds.ts --season=2024 --execute
 */
import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';
import { acquireBdlAcquisitionLock } from '@/lib/balldontlie/acquisition-lock';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import { assertTrialExecuteAllowed } from '@/lib/balldontlie/trial-limiter';
import { OPENING_GAME_ODDS_PATH, planOpeningGameOddsArchive } from '@/lib/archive/opening-game-odds';
import { archiveCursorEndpointToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';

async function main() {
  const argv = process.argv.slice(2);
  const plan = planOpeningGameOddsArchive(argv);
  console.log(JSON.stringify(plan, null, 2));
  const { execute } = parseExecuteFlag(argv);
  if (!execute) {
    console.log('[dry-run] no opening odds requests.');
    return;
  }
  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  try {
    const s3 = new S3Storage({ bucket: process.env.NBA_DATA_BUCKET!.trim() });
    const client = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
    const result = await archiveCursorEndpointToS3({
      client,
      s3,
      prefix: plan.s3Prefix,
      path: OPENING_GAME_ODDS_PATH,
      params: {},
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    lock.release();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
