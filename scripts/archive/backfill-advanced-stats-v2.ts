/**
 * Advanced Stats V2 resumable S3 archive. Do not execute until GOAT is authorized.
 *
 *   npx tsx scripts/archive/backfill-advanced-stats-v2.ts --season=2024 --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-advanced-stats-v2.ts --season=2024 --execute
 */
import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';
import { acquireBdlAcquisitionLock } from '@/lib/balldontlie/acquisition-lock';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import { assertTrialExecuteAllowed } from '@/lib/balldontlie/trial-limiter';
import { ADVANCED_STATS_V2_PATH, planAdvancedStatsV2Archive } from '@/lib/archive/advanced-stats-v2';
import { archiveCursorEndpointToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';

async function main() {
  const argv = process.argv.slice(2);
  const plan = planAdvancedStatsV2Archive(argv);
  console.log(JSON.stringify(plan, null, 2));
  const { execute } = parseExecuteFlag(argv);
  if (!execute) {
    console.log('[dry-run] no Advanced Stats V2 requests.');
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
      path: ADVANCED_STATS_V2_PATH,
      params: { 'seasons[]': String(plan.season), period: 0 },
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
