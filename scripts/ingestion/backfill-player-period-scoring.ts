/**
 * Backfill analytics.player_period_scoring for one season from BDL play-by-play.
 * For each Final game with a box score: fetch /nba/v1/plays (all pages), archive the raw
 * pages to S3 (when NBA_DATA_BUCKET is set), check against the box score, write rows.
 * Skips games already in the table unless --refresh. Dry run by default (still calls BDL).
 *
 *   npx tsx scripts/ingestion/backfill-player-period-scoring.ts --season 2026 --limit 3
 *   npx tsx scripts/ingestion/backfill-player-period-scoring.ts --season 2026 --execute --i-understand-production-write
 *
 * Env: SUPABASE_DB_URL, BALLDONTLIE_API_KEY, optional NBA_DATA_BUCKET (+ AWS credentials).
 */
import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { playsCanonicalPrefix, plays2025GameObjectKey, validatePlaysArchiveBody } from '@/lib/archive/plays';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import {
  PLAYS_MAX_PAGES,
  loadBoxTotals,
  playRowsFromPages,
  playerPeriodLinesFromPlays,
  reconcileGameWithBox,
  replaceGamePlayerPeriodScoring,
} from '@/lib/quarters/player-period-scoring';
import pool from '@/lib/db';

const PLAYS_PATH = '/nba/v1/plays';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function fetchPlayPages(bdl: BdlArchiveClient, gameId: string): Promise<unknown[]> {
  const pages: unknown[] = [];
  let cursor: string | null = null;
  while (true) {
    const params = new URLSearchParams({ game_id: gameId });
    if (cursor) params.set('cursor', cursor);
    const res = await bdl.fetchWithRetry(`${bdl.baseUrl}${PLAYS_PATH}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: any = await res.json();
    pages.push(body);
    cursor = body?.meta?.next_cursor != null ? String(body.meta.next_cursor) : null;
    if (!cursor) return pages;
    if (pages.length >= PLAYS_MAX_PAGES) throw new Error(`more than ${PLAYS_MAX_PAGES} pages`);
  }
}

async function main() {
  const season = arg('--season');
  if (!season || !/^\d{4}$/.test(season)) throw new Error('Pass --season <start year>, e.g. --season 2026');
  const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;
  const refresh = process.argv.includes('--refresh');
  const execute = process.argv.includes('--execute');
  if (execute && !process.argv.includes('--i-understand-production-write')) {
    throw new Error('--execute also needs --i-understand-production-write');
  }
  const rel = await pool.query<{ rel: string | null }>(
    `select to_regclass('analytics.player_period_scoring')::text as rel`
  );
  if (!rel.rows[0]?.rel) throw new Error('analytics.player_period_scoring missing; apply MIGRATION_player_period_scoring.sql');

  const games = await pool.query<{ game_id: string }>(
    `select g.game_id
     from analytics.games g
     where g.season = $1
       and lower(coalesce(g.status, '')) = 'final'
       and exists (select 1 from analytics.player_game_logs l where l.game_id = g.game_id)
       and ($2::boolean or not exists (select 1 from analytics.player_period_scoring s where s.game_id = g.game_id))
     order by g.start_time, g.game_id`,
    [season, refresh]
  );
  const gameIds = games.rows.map((r) => r.game_id).slice(0, limit);
  console.log(`Season ${season}: ${games.rows.length} Final games to do; processing ${gameIds.length}.`);
  if (gameIds.length === 0) return;

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  const s3 = bucket ? new S3Storage({ bucket }) : null;
  const prefix = playsCanonicalPrefix(season);
  const bdl = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
  const box = await loadBoxTotals(pool, gameIds);

  let written = 0;
  let reconciled = 0;
  let archived = 0;
  const failed: string[] = [];
  const notReconciled: { gameId: string; mismatches: string[] }[] = [];

  for (const gameId of gameIds) {
    try {
      const pages = await fetchPlayPages(bdl, gameId);
      if (s3 && execute) {
        const body = { game_id: gameId, path: PLAYS_PATH, fetchedAt: new Date().toISOString(), truncated: false, pages: pages.map((b, i) => ({ pageIndex: i + 1, status: 200, body: b })) };
        const v = validatePlaysArchiveBody(gameId, body);
        if (!v.ok) throw new Error(`invalid plays body: ${v.reason}`);
        await archiveJsonObjectToS3({ s3, key: plays2025GameObjectKey(prefix, gameId), body, overwrite: true });
        archived++;
      }
      const lines = playerPeriodLinesFromPlays(playRowsFromPages(pages));
      const gameBox = box.get(gameId)!;
      const rec = reconcileGameWithBox(lines, gameBox.box);
      if (rec.reconciled) reconciled++;
      else notReconciled.push({ gameId, mismatches: rec.mismatches.slice(0, 3) });
      if (execute) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await replaceGamePlayerPeriodScoring(client, {
            gameId,
            season,
            source: `bdl_plays_${season}_backfill`,
            reconciled: rec.reconciled,
            lines,
            teamByPlayer: gameBox.teams,
          });
          await client.query('commit');
        } catch (e) {
          await client.query('rollback').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
        written++;
      }
    } catch (e) {
      failed.push(gameId);
      console.error(`  FAIL game ${gameId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const done = reconciled + notReconciled.length + failed.length;
    if (done % 25 === 0) console.log(`  ${done}/${gameIds.length}`);
  }

  console.log(
    JSON.stringify(
      {
        season,
        mode: execute ? 'execute' : 'dry-run',
        processed: gameIds.length,
        reconciled,
        notReconciled: notReconciled.length,
        failed: failed.length,
        written,
        archivedToS3: archived,
        notReconciledSample: notReconciled.slice(0, 5),
        failedIds: failed.slice(0, 20),
      },
      null,
      2
    )
  );
  if (!execute) console.log('Dry run. Nothing written.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
