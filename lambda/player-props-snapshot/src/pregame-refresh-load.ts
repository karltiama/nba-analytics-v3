import type { Pool } from 'pg';
import { pregameRefreshMigrated, type InFlightExposure, type PregameCandidate, type PregameRunSnapshot } from './pregame-refresh';
import { isPregameCollectionStatus, type PropUniverse } from './game-discovery';

export type SlateRow = {
  gameId: string;
  tipMs: number;
  status: string | null;
};

const RUN_SQL = `
SELECT game_id, universe, status, error_message, provider_attempts, started_at
  FROM raw.player_prop_game_runs
 WHERE game_id = ANY($1::text[])
   AND started_at > now() - interval '18 hours'`;

const ATTEMPT_SQL = `
SELECT attempts
  FROM raw.player_prop_daily_attempts
 WHERE et_day = (clock_timestamp() AT TIME ZONE 'America/New_York')::date`;

const SLATE_SQL = `
SELECT g.game_id, g.start_time, g.status
  FROM analytics.games g
 WHERE g.start_time > $1::timestamptz
   AND g.start_time < $1::timestamptz + interval '18 hours'`;

export async function loadPregamePlanningInputs(
  pool: Pool,
  candidates: readonly PregameCandidate[],
  now: Date
): Promise<{
  runs: PregameRunSnapshot[];
  consumedAttempts: number;
  inFlight: InFlightExposure[];
  closingGames: number;
  nearTipGames: number;
}> {
  const slate = await pool.query<{ game_id: string; start_time: Date | string; status: string | null }>(SLATE_SQL, [
    now.toISOString(),
  ]);
  const games: SlateRow[] = slate.rows.map((row) => ({
    gameId: String(row.game_id),
    tipMs: new Date(row.start_time).getTime(),
    status: row.status ?? null,
  }));
  const ids = [...new Set([...games.map((game) => game.gameId), ...candidates.map((game) => game.gameId)])];
  const attempt = await pool.query<{ attempts: number }>(ATTEMPT_SQL);
  const consumedAttempts = Number(attempt.rows[0]?.attempts ?? 0);
  if (ids.length === 0) {
    return { runs: [], consumedAttempts, inFlight: [], closingGames: 0, nearTipGames: 0 };
  }
  const listed = await pool.query<{
    game_id: string;
    universe: string | null;
    status: string;
    error_message: string | null;
    provider_attempts: number | null;
    started_at: Date | string;
  }>(RUN_SQL, [ids]);
  const runs: PregameRunSnapshot[] = [];
  for (const row of listed.rows) {
    const universe = row.universe;
    if (universe !== 'broad' && universe !== 'near_tip' && universe !== 'closing' && universe !== 'pregame_refresh') continue;
    if (row.status !== 'started' && row.status !== 'success' && row.status !== 'error') continue;
    runs.push({
      gameId: String(row.game_id),
      universe,
      status: row.status,
      errorMessage: row.error_message,
      startedAtMs: new Date(row.started_at).getTime(),
      providerAttempts: Number(row.provider_attempts ?? 0),
    });
  }
  return {
    runs,
    consumedAttempts,
    inFlight: runs
      .filter((run) => run.status === 'started')
      .map((run) => ({ gameId: run.gameId, attemptsReserved: run.providerAttempts })),
    closingGames: countRemaining(games, runs, now.getTime(), 'closing'),
    nearTipGames: countRemaining(games, runs, now.getTime(), 'near_tip'),
  };
}

function countRemaining(games: readonly SlateRow[], runs: readonly PregameRunSnapshot[], nowMs: number, universe: PropUniverse): number {
  return games.filter((game) => {
    if (!isPregameCollectionStatus(game.status)) return false;
    const delta = game.tipMs - nowMs;
    if (delta <= 0) return false;
    if (universe === 'near_tip' && delta < 60 * 60_000) return false;
    if (universe !== 'near_tip' && universe !== 'closing') return false;
    return !runs.some((run) => run.gameId === game.gameId && run.universe === universe && run.status === 'success');
  }).length;
}

const UNIVERSE_CHECK_SQL = `
SELECT pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conname = 'player_prop_game_runs_universe_check'`;

/** False when the check is missing, unreadable, or still the pre-refresh list. */
export async function pregameRefreshSchemaReady(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query<{ definition: string | null }>(UNIVERSE_CHECK_SQL);
    return pregameRefreshMigrated(result.rows[0]?.definition ?? null);
  } catch {
    return false;
  }
}

export function clusterBytesFromEnv(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  if (!/^[0-9]+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}
