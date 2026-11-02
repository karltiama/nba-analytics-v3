import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { pregameMarketEligibleSql, promotePullOdds } from '../pregame-market';

/**
 * Isolated Postgres. Offsets are measured from clock_timestamp() at the write,
 * which is the 7:15 PM slate: 15/10/5 minutes after the 7:00, 7:05, and 7:10 tips,
 * 15 minutes before 7:30, and 2h15m before 9:30.
 */
const databaseUrl = process.env.ODDS_PG_TEST_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/odds_pregame';
const OLD_AT = '2026-10-21T22:45:00.000Z';
const NEW_AT = '2026-10-21T23:15:00.000Z';

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE IF NOT EXISTS analytics.games (
  game_id text PRIMARY KEY,
  season text NOT NULL,
  start_time timestamptz,
  status text,
  home_team_id text NOT NULL,
  away_team_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS raw.odds_pull_runs (
  pull_run_id bigserial PRIMARY KEY,
  status text NOT NULL DEFAULT 'started'
);
CREATE TABLE IF NOT EXISTS raw.odds_snapshots (
  snapshot_id bigserial PRIMARY KEY,
  pull_run_id bigint NOT NULL REFERENCES raw.odds_pull_runs(pull_run_id),
  game_id text NOT NULL,
  vendor text NOT NULL,
  spread_home_value numeric,
  spread_home_odds integer,
  spread_away_value numeric,
  spread_away_odds integer,
  moneyline_home_odds integer,
  moneyline_away_odds integer,
  total_value numeric,
  total_over_odds integer,
  total_under_odds integer,
  provider_updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS analytics.game_odds_current (
  game_id text PRIMARY KEY,
  home_moneyline integer,
  away_moneyline integer,
  home_spread numeric,
  home_spread_odds integer,
  away_spread numeric,
  away_spread_odds integer,
  total numeric,
  over_odds integer,
  under_odds integer,
  vendor text NOT NULL,
  snapshot_at timestamptz NOT NULL,
  pull_run_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS analytics.game_odds_history (
  id bigserial PRIMARY KEY,
  game_id text NOT NULL,
  home_moneyline integer,
  away_moneyline integer,
  home_spread numeric,
  home_spread_odds integer,
  away_spread numeric,
  away_spread_odds integer,
  total numeric,
  over_odds integer,
  under_odds integer,
  vendor text NOT NULL,
  snapshot_at timestamptz NOT NULL,
  pull_run_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_game_odds_history_unique_idx
  ON analytics.game_odds_history (game_id, vendor, snapshot_at);
CREATE TABLE IF NOT EXISTS analytics.game_line_movement_summary (
  game_id text PRIMARY KEY,
  open_home_spread numeric,
  open_total numeric,
  open_home_ml integer,
  current_home_spread numeric,
  current_total numeric,
  current_home_ml integer,
  spread_movement numeric,
  total_movement numeric,
  snapshots_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

let pool: Pool;

beforeAll(async () => {
  if (/supabase\.co|amazonaws\.com/i.test(databaseUrl)) {
    throw new Error('refusing a non-local odds test database');
  }
  pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  await pool.query('SELECT 1');
  await pool.query(SCHEMA);
});

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE
    raw.odds_snapshots,
    analytics.game_odds_current,
    analytics.game_odds_history,
    analytics.game_line_movement_summary,
    analytics.games,
    raw.odds_pull_runs
    RESTART IDENTITY CASCADE`);
});

async function withWrite<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function addGame(gameId: string, startSql: string, status: string | null) {
  await pool.query(
    `INSERT INTO analytics.games (game_id, season, start_time, status, home_team_id, away_team_id)
     VALUES ($1, '2026', ${startSql}, $2, 'home', 'away')`,
    [gameId, status]
  );
}

async function addQuote(gameId: string, total: number, moneyline: number, snapshotAt: string) {
  await pool.query(
    `INSERT INTO analytics.game_odds_current (
       game_id, home_moneyline, away_moneyline, home_spread, home_spread_odds, away_spread, away_spread_odds,
       total, over_odds, under_odds, vendor, snapshot_at, pull_run_id, updated_at
     ) VALUES ($1, $2, 100, -3.5, -110, 3.5, -110, $3, -110, -110, 'draftkings', $4, 1, $4)`,
    [gameId, moneyline, total, snapshotAt]
  );
  await pool.query(
    `INSERT INTO analytics.game_odds_history (
       game_id, home_moneyline, away_moneyline, home_spread, home_spread_odds, away_spread, away_spread_odds,
       total, over_odds, under_odds, vendor, snapshot_at, pull_run_id
     ) VALUES ($1, $2, 100, -3.5, -110, 3.5, -110, $3, -110, -110, 'draftkings', $4, 1)`,
    [gameId, moneyline, total, snapshotAt]
  );
  await pool.query(
    `INSERT INTO analytics.game_line_movement_summary (
       game_id, open_home_spread, open_total, open_home_ml,
       current_home_spread, current_total, current_home_ml,
       spread_movement, total_movement, snapshots_count, first_seen_at, last_seen_at, updated_at
     ) VALUES ($1, -3.5, 210, -105, -3.5, $2::numeric, $3, 0, $2::numeric - 210, 1, $4, $4, $4)`,
    [gameId, total, moneyline, snapshotAt]
  );
}

async function pull(rows: { gameId: string; total: number; moneyline: number; snapshotAt: string | null }[]) {
  const created = await pool.query(`INSERT INTO raw.odds_pull_runs (status) VALUES ('started') RETURNING pull_run_id`);
  const pullRunId = Number(created.rows[0].pull_run_id);
  for (const row of rows) {
    await pool.query(
      `INSERT INTO raw.odds_snapshots (
         pull_run_id, game_id, vendor,
         spread_home_value, spread_home_odds, spread_away_value, spread_away_odds,
         moneyline_home_odds, moneyline_away_odds,
         total_value, total_over_odds, total_under_odds,
         provider_updated_at
       ) VALUES ($1, $2, 'draftkings', -4.5, -115, 4.5, -105, $3, 100, $4, -115, -105, $5)`,
      [pullRunId, row.gameId, row.moneyline, row.total, row.snapshotAt]
    );
  }
  return pullRunId;
}

async function currentTotal(gameId: string) {
  const result = await pool.query(
    `SELECT total::float8 AS total, home_moneyline, snapshot_at FROM analytics.game_odds_current WHERE game_id = $1`,
    [gameId]
  );
  return result.rows[0] as { total: number; home_moneyline: number; snapshot_at: Date } | undefined;
}

async function historyCount(gameId: string) {
  const result = await pool.query(`SELECT count(*)::int AS n FROM analytics.game_odds_history WHERE game_id = $1`, [gameId]);
  return result.rows[0].n as number;
}

async function movementOf(gameId: string) {
  const result = await pool.query(
    `SELECT current_total::float8 AS current_total, open_total::float8 AS open_total, snapshots_count, updated_at
     FROM analytics.game_line_movement_summary WHERE game_id = $1`,
    [gameId]
  );
  return result.rows[0] as { current_total: number; open_total: number; snapshots_count: number; updated_at: Date } | undefined;
}

describe('pregame market persistence', () => {
  it('keeps tipped games and writes the games that have not tipped', async () => {
    const slate = [
      ['700', "clock_timestamp() - interval '15 minutes'"],
      ['705', "clock_timestamp() - interval '10 minutes'"],
      ['710', "clock_timestamp() - interval '5 minutes'"],
      ['730', "clock_timestamp() + interval '15 minutes'"],
      ['930', "clock_timestamp() + interval '135 minutes'"],
    ] as const;
    for (const [gameId, startSql] of slate) {
      await addGame(gameId, startSql, 'Scheduled');
      await addQuote(gameId, 220.5, -110, OLD_AT);
    }
    const pullRunId = await pull(slate.map(([gameId]) => ({
      gameId,
      total: 224.5,
      moneyline: -120,
      snapshotAt: NEW_AT,
    })));
    const counts = await withWrite((client) => promotePullOdds(client, pullRunId, 'draftkings'));

    expect(counts).toMatchObject({
      acquiredRows: 5,
      pregameEligibleRows: 2,
      postTipRowsSkipped: 3,
      currentRowsUpdated: 2,
      historyRowsInserted: 2,
      movementRowsInserted: 2,
    });
    const raw = await pool.query(`SELECT count(*)::int AS n FROM raw.odds_snapshots WHERE pull_run_id = $1`, [pullRunId]);
    expect(raw.rows[0].n).toBe(5);

    for (const gameId of ['700', '705', '710']) {
      const current = await currentTotal(gameId);
      expect(current?.total).toBe(220.5);
      expect(current?.home_moneyline).toBe(-110);
      expect(current?.snapshot_at.toISOString()).toBe(OLD_AT);
      expect(await historyCount(gameId)).toBe(1);
      const movement = await movementOf(gameId);
      expect(movement?.current_total).toBe(220.5);
      expect(movement?.open_total).toBe(210);
      expect(movement?.snapshots_count).toBe(1);
      expect(movement?.updated_at.toISOString()).toBe(OLD_AT);
    }
    for (const gameId of ['730', '930']) {
      const current = await currentTotal(gameId);
      expect(current?.total).toBe(224.5);
      expect(current?.home_moneyline).toBe(-120);
      expect(current?.snapshot_at.toISOString()).toBe(NEW_AT);
      expect(await historyCount(gameId)).toBe(2);
      const movement = await movementOf(gameId);
      expect(movement?.current_total).toBe(224.5);
      expect(movement?.open_total).toBe(210);
      expect(movement?.snapshots_count).toBe(2);
    }
  });

  it('rejects a game that reaches tip before the write', async () => {
    await addGame('slow', "clock_timestamp() - interval '1 second'", 'Scheduled');
    await addQuote('slow', 220.5, -110, OLD_AT);
    const duringFetch = await pull([{ gameId: 'slow', total: 224.5, moneyline: -120, snapshotAt: NEW_AT }]);
    const during = await withWrite((client) => promotePullOdds(client, duringFetch, 'draftkings'));
    expect(during.postTipRowsSkipped).toBe(1);
    expect((await currentTotal('slow'))?.total).toBe(220.5);

    await addGame('race', "clock_timestamp() + interval '2 hours'", 'Scheduled');
    await addQuote('race', 220.5, -110, OLD_AT);
    const afterFetch = await pull([{ gameId: 'race', total: 224.5, moneyline: -120, snapshotAt: NEW_AT }]);
    await pool.query(`UPDATE analytics.games SET start_time = clock_timestamp() - interval '1 second' WHERE game_id = 'race'`);
    const raced = await withWrite((client) => promotePullOdds(client, afterFetch, 'draftkings'));
    expect(raced.postTipRowsSkipped).toBe(1);
    expect(raced.currentRowsUpdated).toBe(0);
    expect(raced.historyRowsInserted).toBe(0);
    expect((await currentTotal('race'))?.snapshot_at.toISOString()).toBe(OLD_AT);
    expect(await historyCount('race')).toBe(1);
  });

  it('rejects live, final, postponed, canceled, and missing metadata', async () => {
    await addGame('live', "clock_timestamp() + interval '30 minutes'", 'In Progress');
    await addGame('final', "clock_timestamp() + interval '30 minutes'", 'Final');
    await addGame('postponed', "clock_timestamp() + interval '1 day'", 'Postponed');
    await addGame('canceled', "clock_timestamp() + interval '1 day'", 'Canceled');
    await addGame('missing-start', 'NULL', 'Scheduled');
    await addGame('unknown-status', "clock_timestamp() + interval '1 day'", 'TBD');
    await addGame('tipoff-label', "clock_timestamp() + interval '1 day'", '7:00 pm ET');
    await addGame('period', "clock_timestamp() + interval '1 day'", '1st Qtr');
    await addGame('quarter', "clock_timestamp() + interval '1 day'", 'End of Q4');
    for (const gameId of ['live', 'final', 'postponed', 'canceled', 'missing-start', 'unknown-status', 'period', 'quarter']) {
      await addQuote(gameId, 220.5, -110, OLD_AT);
    }
    const pullRunId = await pull([
      'live', 'final', 'postponed', 'canceled', 'missing-start', 'unknown-status', 'tipoff-label', 'period', 'quarter', 'no-game',
    ].map((gameId) => ({ gameId, total: 230, moneyline: -140, snapshotAt: NEW_AT })));
    const counts = await withWrite((client) => promotePullOdds(client, pullRunId, 'draftkings'));
    expect(counts.pregameEligibleRows).toBe(1);
    expect(counts.postTipRowsSkipped).toBe(9);
    expect(counts.currentRowsUpdated).toBe(1);
    expect((await currentTotal('tipoff-label'))?.total).toBe(230);
    for (const gameId of ['live', 'final', 'postponed', 'canceled', 'missing-start', 'unknown-status', 'period', 'quarter']) {
      expect((await currentTotal(gameId))?.total).toBe(220.5);
      expect(await historyCount(gameId)).toBe(1);
    }
    expect(await currentTotal('no-game')).toBeUndefined();
    expect(await historyCount('no-game')).toBe(0);
    const raw = await pool.query(`SELECT count(*)::int AS n FROM raw.odds_snapshots WHERE pull_run_id = $1`, [pullRunId]);
    expect(raw.rows[0].n).toBe(10);
  });

  it('does not create a current row for a tipped game that has none', async () => {
    await addGame('new-tipped', "clock_timestamp() - interval '1 minute'", 'Scheduled');
    const pullRunId = await pull([{ gameId: 'new-tipped', total: 224.5, moneyline: -120, snapshotAt: NEW_AT }]);
    const counts = await withWrite((client) => promotePullOdds(client, pullRunId, 'draftkings'));
    expect(counts.currentRowsUpdated).toBe(0);
    expect(counts.historyRowsInserted).toBe(0);
    expect(counts.movementRowsInserted).toBe(0);
    expect(await currentTotal('new-tipped')).toBeUndefined();
    expect(await historyCount('new-tipped')).toBe(0);
    expect(await movementOf('new-tipped')).toBeUndefined();
  });

  it('keeps a newer current line when an older quote arrives for a future game', async () => {
    await addGame('future', "clock_timestamp() + interval '2 hours'", 'Scheduled');
    await addQuote('future', 220.5, -110, NEW_AT);
    const pullRunId = await pull([{ gameId: 'future', total: 199, moneyline: -101, snapshotAt: OLD_AT }]);
    const counts = await withWrite((client) => promotePullOdds(client, pullRunId, 'draftkings'));
    expect(counts.pregameEligibleRows).toBe(1);
    expect(counts.currentRowsUpdated).toBe(0);
    expect(counts.historyRowsInserted).toBe(1);
    expect((await currentTotal('future'))?.total).toBe(220.5);
    expect((await currentTotal('future'))?.snapshot_at.toISOString()).toBe(NEW_AT);
    expect((await movementOf('future'))?.current_total).toBe(220.5);
    expect((await movementOf('future'))?.open_total).toBe(210);
  });

  it('does not duplicate a quote delivered twice for the same snapshot', async () => {
    await addGame('dup', "clock_timestamp() + interval '2 hours'", 'Scheduled');
    const first = await pull([{ gameId: 'dup', total: 224.5, moneyline: -120, snapshotAt: NEW_AT }]);
    const opened = await withWrite((client) => promotePullOdds(client, first, 'draftkings'));
    expect(opened.currentRowsUpdated).toBe(1);
    expect(opened.movementRowsInserted).toBe(1);
    const second = await pull([{ gameId: 'dup', total: 224.5, moneyline: -120, snapshotAt: NEW_AT }]);
    const again = await withWrite((client) => promotePullOdds(client, second, 'draftkings'));
    expect(again.currentRowsUpdated).toBe(0);
    expect(again.historyRowsInserted).toBe(0);
    expect(await historyCount('dup')).toBe(1);
    expect((await currentTotal('dup'))?.total).toBe(224.5);
  });

  it('writes a rescheduled game only after canonical status is scheduled in the future', async () => {
    await addGame('moved', "clock_timestamp() + interval '1 day'", 'Postponed');
    const blocked = await pull([{ gameId: 'moved', total: 224.5, moneyline: -120, snapshotAt: OLD_AT }]);
    const first = await withWrite((client) => promotePullOdds(client, blocked, 'draftkings'));
    expect(first.postTipRowsSkipped).toBe(1);
    expect(await currentTotal('moved')).toBeUndefined();

    await pool.query(
      `UPDATE analytics.games
       SET status = 'Scheduled', start_time = clock_timestamp() + interval '2 days'
       WHERE game_id = 'moved'`
    );
    const released = await pull([{ gameId: 'moved', total: 224.5, moneyline: -120, snapshotAt: NEW_AT }]);
    const second = await withWrite((client) => promotePullOdds(client, released, 'draftkings'));
    expect(second.currentRowsUpdated).toBe(1);
    expect(second.historyRowsInserted).toBe(1);
    expect(second.movementRowsInserted).toBe(1);
    expect((await currentTotal('moved'))?.total).toBe(224.5);
    expect((await movementOf('moved'))?.open_total).toBe(224.5);
    expect((await movementOf('moved'))?.current_total).toBe(224.5);
  });

  it('ignores a raw row with no provider timestamp', async () => {
    await addGame('blank', "clock_timestamp() + interval '1 hour'", 'Scheduled');
    const pullRunId = await pull([{ gameId: 'blank', total: 224.5, moneyline: -120, snapshotAt: null }]);
    const counts = await withWrite((client) => promotePullOdds(client, pullRunId, 'draftkings'));
    expect(counts.acquiredRows).toBe(1);
    expect(counts.pregameEligibleRows).toBe(0);
    expect(counts.postTipRowsSkipped).toBe(0);
    expect(await currentTotal('blank')).toBeUndefined();
  });

  it('uses the same predicate the write uses', async () => {
    await addGame('probe', "clock_timestamp() + interval '1 hour'", 'Scheduled');
    const open = await pool.query<{ eligible: boolean }>(
      `SELECT ${pregameMarketEligibleSql('g')} AS eligible FROM analytics.games g WHERE g.game_id = 'probe'`
    );
    expect(open.rows[0]?.eligible).toBe(true);
    await pool.query(`UPDATE analytics.games SET start_time = clock_timestamp() - interval '1 second' WHERE game_id = 'probe'`);
    const closed = await pool.query<{ eligible: boolean }>(
      `SELECT ${pregameMarketEligibleSql('g')} AS eligible FROM analytics.games g WHERE g.game_id = 'probe'`
    );
    expect(closed.rows[0]?.eligible).toBe(false);
  });
});
