/**
 * Season 2025 lineups raw archive. Reuses fetchLineupsFromBallDontLie.
 * Do not fetch until GOAT is authorized.
 *
 *   npx tsx scripts/archive/backfill-lineups-2025.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-lineups-2025.ts --execute
 */
import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';
import { acquireBdlAcquisitionLock } from '@/lib/balldontlie/acquisition-lock';
import { readBdlApiKey } from '@/lib/balldontlie/archive-client';
import { fetchLineupsFromBallDontLie } from '@/lib/balldontlie/lineups';
import { assertTrialExecuteAllowed, resolveBdlRequestDelayMs } from '@/lib/balldontlie/trial-limiter';
import { LINEUPS_SEASON_GAMES_SQL, planLineups2025ArchiveFromArgv } from '@/lib/archive/lineups-2025';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';
import pool from '@/lib/db';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadGameIds(): Promise<string[]> {
  try {
    const res = await pool.query<{ game_id: string }>(LINEUPS_SEASON_GAMES_SQL);
    return res.rows.map((r) => String(r.game_id));
  } catch (e) {
    console.warn('[warn] could not load analytics.games 2025 inventory');
    console.warn(e instanceof Error ? e.message : String(e));
    return [];
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const gameIds = await loadGameIds();
  const plan = planLineups2025ArchiveFromArgv(argv, gameIds);
  console.log(JSON.stringify(plan, null, 2));
  const { execute } = parseExecuteFlag(argv);
  if (!execute) {
    console.log(`[dry-run] estimated lineup requests: ${gameIds.length}. No fetches.`);
    await pool.end().catch(() => undefined);
    return;
  }
  assertTrialExecuteAllowed();
  const delay = resolveBdlRequestDelayMs();
  const lock = acquireBdlAcquisitionLock();
  try {
    const s3 = new S3Storage({ bucket: process.env.NBA_DATA_BUCKET!.trim() });
    const apiKey = readBdlApiKey();
    let written = 0;
    let skipped = 0;
    let n = 0;
    for (const gameId of gameIds) {
      const key = `${plan.s3Prefix}/game_id=${gameId}.json`;
      if (await s3.objectExists(key)) {
        skipped += 1;
        continue;
      }
      if (n > 0) await sleep(delay.delayMs);
      n += 1;
      console.log(`[bdl-trial] request #${n} delayMs=${delay.delayMs} lineups game_id=${gameId}`);
      const body = await fetchLineupsFromBallDontLie(gameId, apiKey);
      await archiveJsonObjectToS3({ s3, key, body: body ?? { game_id: gameId, data: [], error: 'empty' } });
      written += 1;
    }
    await archiveJsonObjectToS3({
      s3,
      key: `${plan.s3Prefix}/_manifest.json`,
      body: {
        schemaVersion: 1,
        entity: 'lineups',
        season: 2025,
        queued: gameIds.length,
        written,
        skipped,
        status: 'success',
      },
      overwrite: true,
    });
    console.log(JSON.stringify({ written, skipped, queued: gameIds.length }, null, 2));
  } finally {
    lock.release();
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
