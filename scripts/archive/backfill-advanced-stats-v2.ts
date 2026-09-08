/**
 * Advanced Stats V2 resumable S3 archive. Postgres-free.
 *
 *   npx tsx scripts/archive/backfill-advanced-stats-v2.ts --season=2025 --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-advanced-stats-v2.ts --season=2025 --execute
 *
 * Step 5B uses this runner via archive-2025-advanced-stats-v2.ts. Do not pass --season=2024/2023
 * until those steps are authorized.
 */
import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';
import { acquireBdlAcquisitionLock } from '@/lib/balldontlie/acquisition-lock';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import { assertTrialExecuteAllowed } from '@/lib/balldontlie/trial-limiter';
import { ADVANCED_STATS_V2_PATH, planAdvancedStatsV2Archive } from '@/lib/archive/advanced-stats-v2';
import { archiveCursorEndpointToS3, type ResumableArchiveResult } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';

export async function runAdvancedStatsV2Archive(args: {
  season: number;
  client: BdlArchiveClient;
  s3: S3Storage;
  logger?: (msg: string) => void;
}): Promise<ResumableArchiveResult> {
  const plan = planAdvancedStatsV2Archive([`--season=${args.season}`, '--execute']);
  return archiveCursorEndpointToS3({
    client: args.client,
    s3: args.s3,
    prefix: plan.s3Prefix,
    path: ADVANCED_STATS_V2_PATH,
    params: { 'seasons[]': String(args.season), period: 0 },
    logger: args.logger,
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const plan = planAdvancedStatsV2Archive(argv);
  console.log(JSON.stringify(plan, null, 2));
  const { execute } = parseExecuteFlag(argv);
  if (!execute) {
    console.log('[dry-run] no Advanced Stats V2 requests.');
    return;
  }
  if (plan.season == null) throw new Error('season required');
  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  try {
    const s3 = new S3Storage({ bucket: process.env.NBA_DATA_BUCKET!.trim() });
    const client = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
    const result = await runAdvancedStatsV2Archive({ season: plan.season, client, s3 });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    lock.release();
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').includes('backfill-advanced-stats-v2');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
}
