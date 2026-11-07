/**
 * 2025-26 canonical Plays archive (S3) → analytics.player_period_scoring.
 * Read-only S3. No BDL HTTP. Dry run by default.
 *
 *   npx tsx scripts/ingestion/materialize-player-period-scoring-2025.ts
 *   npx tsx scripts/ingestion/materialize-player-period-scoring-2025.ts --apply-schema
 *   npx tsx scripts/ingestion/materialize-player-period-scoring-2025.ts --execute --i-understand-production-write
 *
 * Env: SUPABASE_DB_URL, NBA_DATA_BUCKET (+ AWS credentials).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { S3Storage } from '@/lib/aws/s3';
import { plays2025CanonicalPrefix } from '@/lib/archive/plays';
import { gameIdFromCanonicalPlaysKey, readCanonicalPlaysObject } from '@/lib/archive/plays-2025-read';
import {
  playerPeriodLinesFromPlays,
  reconcileGameWithBox,
  type BoxTotals,
  type PlayerPeriodLine,
} from '@/lib/quarters/player-period-scoring';
import pool from '@/lib/db';

const SEASON = '2025';
const SOURCE = 'bdl_plays_2025_canonical';
const CONCURRENCY = 8;

type GameResult = {
  gameId: string;
  lines: PlayerPeriodLine[];
  teamByPlayer: Map<string, string>;
  reconciled: boolean;
  mismatches: string[];
};

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) await fn(items[next++]!);
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

async function applySchema() {
  const sql = fs.readFileSync(path.join('db', 'schemas', 'MIGRATION_player_period_scoring.sql'), 'utf8');
  await pool.query(sql);
  const r = await pool.query<{ rel: string | null }>(
    `select to_regclass('analytics.player_period_scoring')::text as rel`
  );
  console.log(`MIGRATION_OK player_period_scoring=${r.rows[0]?.rel}`);
}

async function writeGame(g: GameResult) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`delete from analytics.player_period_scoring where game_id = $1`, [g.gameId]);
    if (g.lines.length > 0) {
      await client.query(
        `insert into analytics.player_period_scoring
           (game_id, season, player_id, team_id, period, points, fgm, fg3m, ftm, game_reconciled, source)
         select $1, $2, u.player_id, u.team_id, u.period, u.points, u.fgm, u.fg3m, u.ftm, $3, $4
         from unnest($5::text[], $6::text[], $7::int[], $8::int[], $9::int[], $10::int[], $11::int[])
           as u(player_id, team_id, period, points, fgm, fg3m, ftm)`,
        [
          g.gameId,
          SEASON,
          g.reconciled,
          SOURCE,
          g.lines.map((l) => l.playerId),
          g.lines.map((l) => g.teamByPlayer.get(l.playerId) ?? null),
          g.lines.map((l) => l.period),
          g.lines.map((l) => l.points),
          g.lines.map((l) => l.fgm),
          g.lines.map((l) => l.fg3m),
          g.lines.map((l) => l.ftm),
        ]
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--apply-schema')) {
    await applySchema();
    return;
  }
  const execute = argv.includes('--execute');
  if (execute && !argv.includes('--i-understand-production-write')) {
    throw new Error('--execute also needs --i-understand-production-write');
  }
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  if (execute) {
    const rel = await pool.query<{ rel: string | null }>(
      `select to_regclass('analytics.player_period_scoring')::text as rel`
    );
    if (!rel.rows[0]?.rel) throw new Error('Run with --apply-schema first');
  }

  const s3 = new S3Storage({ bucket });
  const gameIds: string[] = [];
  for await (const obj of s3.listByPrefix(plays2025CanonicalPrefix())) {
    const id = gameIdFromCanonicalPlaysKey(obj.key);
    if (id) gameIds.push(id);
  }
  gameIds.sort();

  const logs = await pool.query<{
    game_id: string;
    player_id: string;
    team_id: string | null;
    points: number | null;
    fgm: number | null;
    fg3m: number | null;
    ftm: number | null;
  }>(
    `select game_id, player_id, team_id, points,
            field_goals_made as fgm, three_pointers_made as fg3m, free_throws_made as ftm
     from analytics.player_game_logs
     where game_id = any($1::text[])`,
    [gameIds]
  );
  const boxByGame = new Map<string, { box: BoxTotals[]; teams: Map<string, string> }>();
  for (const r of logs.rows) {
    const entry = boxByGame.get(r.game_id) ?? { box: [], teams: new Map() };
    entry.box.push({
      playerId: String(r.player_id),
      points: r.points ?? 0,
      fgm: r.fgm ?? 0,
      fg3m: r.fg3m ?? 0,
      ftm: r.ftm ?? 0,
    });
    if (r.team_id) entry.teams.set(String(r.player_id), r.team_id);
    boxByGame.set(r.game_id, entry);
  }

  const results: GameResult[] = [];
  const readFailures: string[] = [];
  const noBox: string[] = [];
  await mapPool(gameIds, CONCURRENCY, async (gameId) => {
    const read = await readCanonicalPlaysObject(s3, gameId);
    if (!read.ok) {
      readFailures.push(gameId);
      return;
    }
    const box = boxByGame.get(gameId);
    if (!box) {
      noBox.push(gameId);
      return;
    }
    const lines = playerPeriodLinesFromPlays(read.rows as Record<string, unknown>[]);
    const rec = reconcileGameWithBox(lines, box.box);
    results.push({ gameId, lines, teamByPlayer: box.teams, reconciled: rec.reconciled, mismatches: rec.mismatches });
  });
  results.sort((a, b) => a.gameId.localeCompare(b.gameId));

  const notReconciled = results.filter((r) => !r.reconciled);
  console.log(
    JSON.stringify(
      {
        mode: execute ? 'execute' : 'dry-run',
        season: SEASON,
        archiveGames: gameIds.length,
        processed: results.length,
        reconciledGames: results.length - notReconciled.length,
        notReconciledGames: notReconciled.length,
        readFailures: readFailures.length,
        gamesWithoutBoxScore: noBox.length,
        rows: results.reduce((n, r) => n + r.lines.length, 0),
        notReconciledSample: notReconciled.slice(0, 5).map((r) => ({ gameId: r.gameId, mismatches: r.mismatches.slice(0, 3) })),
      },
      null,
      2
    )
  );

  if (!execute) {
    console.log('Dry run. Nothing written.');
    return;
  }

  let done = 0;
  for (const g of results) {
    await writeGame(g);
    done++;
    if (done % 200 === 0) console.log(`  wrote ${done}/${results.length} games`);
  }
  const after = await pool.query<{ games: string; rows: string; reconciled: string }>(
    `select count(distinct game_id)::text games, count(*)::text rows,
            count(distinct game_id) filter (where game_reconciled)::text reconciled
     from analytics.player_period_scoring where season = $1`,
    [SEASON]
  );
  console.log(`Done. ${JSON.stringify(after.rows[0])}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
