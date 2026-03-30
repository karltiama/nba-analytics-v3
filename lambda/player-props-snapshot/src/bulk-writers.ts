import type { Pool } from 'pg';
import type { NormalizedPropRow } from './types';

const CHUNK_SIZE = 500;

type RawJsonOptions = {
  enabled: boolean;
  sampleRate: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function createPullRun(pool: Pool, gameIdsQueried: string[]): Promise<number> {
  const result = await pool.query(
    `INSERT INTO raw.player_prop_pull_runs (pulled_at, provider, game_ids_queried, status)
     VALUES (now(), 'balldontlie', $1, 'started')
     RETURNING pull_run_id`,
    [gameIdsQueried]
  );
  return Number(result.rows[0].pull_run_id);
}

export async function completePullRun(
  pool: Pool,
  pullRunId: number,
  status: 'success' | 'error',
  rowsReturned: number,
  rowsStored: number,
  metadata?: Record<string, unknown>,
  errorMessage?: string
): Promise<void> {
  await pool.query(
    `UPDATE raw.player_prop_pull_runs
     SET rows_returned = $2, rows_stored = $3, status = $4,
         metadata = $5, error_message = $6, completed_at = now()
     WHERE pull_run_id = $1`,
    [pullRunId, rowsReturned, rowsStored, status, metadata ? JSON.stringify(metadata) : null, errorMessage ?? null]
  );
}

export async function createGameRun(pool: Pool, pullRunId: number, gameId: string): Promise<void> {
  await pool.query(
    `INSERT INTO raw.player_prop_game_runs (pull_run_id, game_id, status, started_at)
     VALUES ($1, $2, 'started', now())
     ON CONFLICT (pull_run_id, game_id) DO NOTHING`,
    [pullRunId, gameId]
  );
}

export async function completeGameRun(
  pool: Pool,
  pullRunId: number,
  gameId: string,
  status: 'success' | 'error',
  rowsFetched: number,
  rowsStored: number,
  errorMessage?: string
): Promise<void> {
  await pool.query(
    `UPDATE raw.player_prop_game_runs
     SET status = $3,
         rows_fetched = $4,
         rows_stored = $5,
         error_message = $6,
         completed_at = now()
     WHERE pull_run_id = $1 AND game_id = $2`,
    [pullRunId, gameId, status, rowsFetched, rowsStored, errorMessage ?? null]
  );
}

export async function finalizePullRunIfComplete(pool: Pool, pullRunId: number): Promise<void> {
  const summary = await pool.query(
    `SELECT
        count(*)::int as total_games,
        count(*) FILTER (WHERE status = 'success')::int as success_games,
        count(*) FILTER (WHERE status = 'error')::int as error_games,
        coalesce(sum(rows_fetched), 0)::int as rows_fetched,
        coalesce(sum(rows_stored), 0)::int as rows_stored,
        count(*) FILTER (WHERE status = 'started')::int as open_games
      FROM raw.player_prop_game_runs
      WHERE pull_run_id = $1`,
    [pullRunId]
  );
  const row = summary.rows[0] as {
    total_games: number;
    success_games: number;
    error_games: number;
    rows_fetched: number;
    rows_stored: number;
    open_games: number;
  };
  if (!row || row.total_games === 0 || row.open_games > 0) return;

  await completePullRun(
    pool,
    pullRunId,
    row.error_games > 0 ? 'error' : 'success',
    row.rows_fetched,
    row.rows_stored,
    {
      totalGames: row.total_games,
      successGames: row.success_games,
      errorGames: row.error_games,
    },
    row.error_games > 0 ? 'One or more game workers failed' : undefined
  );
}

export async function bulkInsertRawV2(
  pool: Pool,
  rows: NormalizedPropRow[],
  fetchedAt: Date,
  rawJsonOptions: RawJsonOptions
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (const group of chunk(rows, CHUNK_SIZE)) {
    const values: unknown[] = [];
    const tuples = group.map((r, i) => {
      const base = i * 14;
      values.push(
        r.game_id,
        r.player_id,
        r.player_name,
        r.team_id,
        r.sportsbook,
        r.prop_type,
        r.market_type,
        r.side,
        r.line_value,
        r.odds_american,
        r.odds_decimal,
        r.implied_probability,
        fetchedAt,
        rawJsonOptions.enabled && Math.random() < rawJsonOptions.sampleRate ? JSON.stringify(r.raw_json) : null
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`;
    });
    const result = await pool.query(
      `INSERT INTO raw.player_prop_snapshots_v2 (
         game_id, player_id, player_name, team_id, sportsbook, prop_type, market_type, side,
         line_value, odds_american, odds_decimal, implied_probability, fetched_at, raw_json
       ) VALUES ${tuples.join(',')}
       ON CONFLICT (
         game_id, player_id, sportsbook, prop_type, side, line_value, (date_trunc('hour', fetched_at at time zone 'UTC'))
       ) DO NOTHING`,
      values
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function bulkUpsertCurrent(pool: Pool, rows: NormalizedPropRow[], snapshotAt: Date): Promise<number> {
  if (rows.length === 0) return 0;
  let upserted = 0;
  for (const group of chunk(rows, CHUNK_SIZE)) {
    const values: unknown[] = [];
    const tuples = group.map((r, i) => {
      const base = i * 13;
      values.push(
        r.game_id,
        r.player_id,
        r.player_name,
        r.team_id,
        r.sportsbook,
        r.prop_type,
        r.market_type,
        r.side,
        r.line_value,
        r.odds_american,
        r.odds_decimal,
        r.implied_probability,
        snapshotAt
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13})`;
    });

    const result = await pool.query(
      `INSERT INTO analytics.player_props_current (
         game_id, player_id, player_name, team_id, sportsbook, prop_type, market_type, side,
         line_value, odds_american, odds_decimal, implied_probability, snapshot_at
       ) VALUES ${tuples.join(',')}
       ON CONFLICT (game_id, player_id, sportsbook, prop_type, side, line_value)
       DO UPDATE SET
         player_name = excluded.player_name,
         team_id = excluded.team_id,
         odds_american = excluded.odds_american,
         odds_decimal = excluded.odds_decimal,
         implied_probability = excluded.implied_probability,
         snapshot_at = excluded.snapshot_at`,
      values
    );
    upserted += result.rowCount ?? 0;
  }
  return upserted;
}

type PreferredLine = {
  game_id: string;
  player_id: string;
  vendor: string;
  prop_type: string;
  line_value: number;
  market_type: 'over_under';
  over_odds: number | null;
  under_odds: number | null;
  snapshot_at: Date;
};

export function buildPreferredVendorLines(
  normalized: NormalizedPropRow[],
  preferredVendor: string,
  snapshotAt: Date
): PreferredLine[] {
  const grouped = new Map<string, { over?: number; under?: number; line: number }>();
  for (const row of normalized) {
    if (row.sportsbook !== preferredVendor) continue;
    if (row.market_type !== 'over_under' || row.line_value == null) continue;
    const key = `${row.game_id}|${row.player_id}|${row.prop_type}|${row.line_value}`;
    const prev = grouped.get(key) ?? { line: row.line_value };
    if (row.side === 'over') prev.over = row.odds_american;
    if (row.side === 'under') prev.under = row.odds_american;
    grouped.set(key, prev);
  }
  const out: PreferredLine[] = [];
  for (const [key, value] of grouped.entries()) {
    const [gameId, playerId, propType] = key.split('|');
    out.push({
      game_id: gameId ?? '',
      player_id: playerId ?? '',
      vendor: preferredVendor,
      prop_type: propType ?? '',
      line_value: value.line,
      market_type: 'over_under',
      over_odds: value.over ?? null,
      under_odds: value.under ?? null,
      snapshot_at: snapshotAt,
    });
  }
  return out;
}

export async function refreshPreferredVendorCurrent(
  pool: Pool,
  pullRunId: number,
  gameId: string,
  preferredLines: PreferredLine[]
): Promise<number> {
  await pool.query(`DELETE FROM analytics.player_prop_current WHERE game_id = $1`, [gameId]);
  if (preferredLines.length === 0) return 0;

  let inserted = 0;
  for (const group of chunk(preferredLines, CHUNK_SIZE)) {
    const values: unknown[] = [];
    const tuples = group.map((r, i) => {
      const base = i * 10;
      values.push(
        r.game_id,
        r.player_id,
        r.vendor,
        r.prop_type,
        r.line_value,
        r.market_type,
        r.over_odds,
        r.under_odds,
        r.snapshot_at,
        pullRunId
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`;
    });
    const result = await pool.query(
      `INSERT INTO analytics.player_prop_current (
         game_id, player_id, vendor, prop_type, line_value, market_type,
         over_odds, under_odds, snapshot_at, pull_run_id
       ) VALUES ${tuples.join(',')}`,
      values
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}
