/**
 * One-off: this season's finished games → analytics.game_starters, from BDL /nba/v1/lineups.
 * Same certification as the postgame starters stage (evaluateStartersStage): exactly 5+5
 * starters, top-level team.id only, canonical identity gate. Post-tip confirmed, never pregame.
 * One GET per game through fetchBdlLive. Skips games that already have starters.
 * No S3 writes. Payloads are cached under reports/trial (gitignored) for review.
 *
 *   npx tsx scripts/ingestion/backfill-game-starters-2026.ts                 # dry run
 *   npx tsx scripts/ingestion/backfill-game-starters-2026.ts --execute --i-understand-production-write
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import pool from '@/lib/db';
import { evaluateStartersStage } from '@/lib/postgame/starters-stage';
import { fetchBdlLineupsForGame } from '@/lib/postgame/starters-provider';
import { GAME_STARTERS_DELETE_FOR_GAME_SQL, GAME_STARTERS_UPSERT_SQL } from '@/lib/postgame/writes';
import { extractStarterCandidatesFromArchive } from '@/lib/archive/game-starters-from-lineups';
import { loadPartialIdentityIndex, type SqlQuery } from '@/lib/identity/player-identity-store';

const SEASON = '2026';
const SOURCE = 'bdl_lineups_api_2026';
const OUT_DIR = 'reports/trial';
const OUT_JSON = `${OUT_DIR}/game-starters-2026-backfill.json`;

type GameRow = { game_id: string; season: string; home_team_id: string; away_team_id: string; start_time: string };

async function main() {
  const argv = process.argv.slice(2);
  const execute = argv.includes('--execute');
  if (execute && !argv.includes('--i-understand-production-write')) {
    throw new Error('Safety stop: --execute requires --i-understand-production-write');
  }
  const key = (process.env.BALLDONTLIE_API_KEY ?? process.env.BALDONTLIE_API_KEY ?? '').trim();
  if (!key) throw new Error('BALLDONTLIE_API_KEY required');

  const games = (
    await pool.query<GameRow>(
      `select g.game_id, g.season, g.home_team_id, g.away_team_id, g.start_time::text
         from analytics.games g
        where g.season = $1
          and g.status = 'Final'
          and not exists (select 1 from analytics.game_starters s where s.game_id = g.game_id)
        order by g.start_time, g.game_id`,
      [SEASON]
    )
  ).rows;

  const payloads = new Map<string, { httpStatus: number | null; payload: unknown }>();
  let consecutiveRefused = 0;
  for (const g of games) {
    const fetched = await fetchBdlLineupsForGame(g.game_id, key);
    if (fetched.httpStatus == null) {
      throw new Error('Safety stop: live BDL HTTP is disabled in this environment (DATA_MODE / OFFSEASON_MODE / CRON_DRY_RUN).');
    }
    payloads.set(g.game_id, { httpStatus: fetched.httpStatus, payload: fetched.payload });
    consecutiveRefused = fetched.httpStatus === 429 || fetched.httpStatus === 0 ? consecutiveRefused + 1 : 0;
    if (consecutiveRefused >= 3) {
      throw new Error(`Safety stop: ${consecutiveRefused} BDL refusals in a row (last http ${fetched.httpStatus}, game ${g.game_id}). No writes.`);
    }
  }

  const providerIds = [...payloads.entries()].flatMap(([gameId, p]) =>
    extractStarterCandidatesFromArchive(gameId, p.payload, SEASON).starterCandidates.map((r) => r.playerId)
  );
  const sqlQuery: SqlQuery = (text, params) => pool.query(text, params);
  const identityIndex = await loadPartialIdentityIndex(sqlQuery, 'balldontlie', providerIds);
  const observedAt = new Date().toISOString();

  const results = games.map((g) => {
    const p = payloads.get(g.game_id)!;
    const r = evaluateStartersStage({
      game: { gameId: g.game_id, season: g.season, homeTeamId: g.home_team_id, awayTeamId: g.away_team_id },
      payload: p.payload,
      httpStatus: p.httpStatus,
      identityIndex,
      observedAt,
      attempt: 1,
      maxAttempts: 1,
    });
    return { game: g, result: r, writes: r.writes.map((w) => ({ ...w, season: g.season, source: SOURCE })) };
  });

  const ready = results.filter((r) => r.result.status === 'READY');
  const notReady = results
    .filter((r) => r.result.status !== 'READY')
    .map((r) => ({ gameId: r.game.game_id, start: r.game.start_time, status: r.result.status, reason: r.result.reasonCode, http: r.result.httpStatus, starters: r.result.inputCount }));

  let rowsWritten = 0;
  if (execute) {
    for (const r of ready) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(GAME_STARTERS_DELETE_FOR_GAME_SQL, [r.game.game_id, r.game.season]);
        const res = await client.query(GAME_STARTERS_UPSERT_SQL, [
          r.writes.map((w) => w.gameId),
          r.writes.map((w) => w.teamId),
          r.writes.map((w) => w.playerId),
          r.writes.map((w) => w.position),
          r.writes.map((w) => w.season),
          r.writes.map((w) => w.source),
        ]);
        await client.query('commit');
        rowsWritten += res.rowCount ?? 0;
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    }
  }

  const summary = {
    generatedAt: observedAt,
    dryRun: !execute,
    season: SEASON,
    source: SOURCE,
    candidateGames: games.length,
    bdlRequests: payloads.size,
    readyGames: ready.length,
    readyRows: ready.reduce((n, r) => n + r.writes.length, 0),
    identitySkipped: results.reduce((n, r) => n + r.result.identitySkipped, 0),
    notReady,
    rowsWritten,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(
    `${OUT_DIR}/game-starters-2026-payloads.json`,
    JSON.stringify(Object.fromEntries(payloads), null, 0) + '\n'
  );
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
