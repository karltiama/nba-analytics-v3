/**
 * Historical opening player props S3 archive. Do not execute until GOAT is authorized.
 * Queue is research.prop_decision_lines game_ids. Not the live props endpoint.
 *
 *   npx tsx scripts/archive/backfill-opening-player-props.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-opening-player-props.ts --execute
 */
import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';
import { acquireBdlAcquisitionLock } from '@/lib/balldontlie/acquisition-lock';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import { assertTrialExecuteAllowed } from '@/lib/balldontlie/trial-limiter';
import {
  DISTINCT_DECISION_LINE_GAMES_SQL,
  MATCHABILITY_KEYS,
  OPENING_PLAYER_PROPS_PATH,
  planOpeningPlayerPropsArchive,
} from '@/lib/archive/opening-player-props';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';
import pool from '@/lib/db';

async function loadQueue(): Promise<string[]> {
  try {
    const res = await pool.query<{ game_id: string }>(DISTINCT_DECISION_LINE_GAMES_SQL);
    return res.rows.map((r) => String(r.game_id));
  } catch (e) {
    console.warn('[warn] could not load research.prop_decision_lines; dry-run with empty queue');
    console.warn(e instanceof Error ? e.message : String(e));
    return [];
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const gameIds = await loadQueue();
  const plan = planOpeningPlayerPropsArchive({ argv, gameIds });
  console.log(JSON.stringify({ ...plan, matchabilityKeys: MATCHABILITY_KEYS }, null, 2));
  const { execute } = parseExecuteFlag(argv);
  if (!execute) {
    console.log('[dry-run] no opening player props requests.');
    await pool.end().catch(() => undefined);
    return;
  }
  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  try {
    const s3 = new S3Storage({ bucket: process.env.NBA_DATA_BUCKET!.trim() });
    const client = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
    let written = 0;
    let skipped = 0;
    for (const gameId of gameIds) {
      const key = `${plan.s3Prefix}/game_id=${gameId}.json`;
      if (await s3.objectExists(key)) {
        skipped += 1;
        continue;
      }
      const pages: unknown[] = [];
      for await (const page of client.paginate({
        path: OPENING_PLAYER_PROPS_PATH,
        params: { game_id: gameId },
        paginationStyle: 'cursor',
        perPage: 100,
      })) {
        pages.push(page.body);
      }
      await archiveJsonObjectToS3({ s3, key, body: { game_id: gameId, pages } });
      written += 1;
    }
    await archiveJsonObjectToS3({
      s3,
      key: `${plan.s3Prefix}/_manifest.json`,
      body: {
        schemaVersion: 1,
        entity: 'opening_player_props',
        endpoint: OPENING_PLAYER_PROPS_PATH,
        queued: gameIds.length,
        written,
        skipped,
        matchabilityKeys: MATCHABILITY_KEYS,
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
