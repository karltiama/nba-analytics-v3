import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PLAYER_PROPS_MAX_HTTP_ATTEMPTS, reserveProviderAttempt } from '../attempt-budget';
import { PLAYER_PROPS_MAX_PAGES } from '../fetch';
import {
  bulkInsertRawV2,
  bulkUpsertCurrent,
  promoteServingProps,
  refreshPreferredVendorCurrent,
} from '../bulk-writers';
import type { NormalizedPropRow } from '../types';

/**
 * Local Postgres only. PROPS_PG_TEST_URL overrides the disposable docker database.
 * Nothing here talks to production.
 */
const databaseUrl = process.env.PROPS_PG_TEST_URL ?? 'postgres://postgres:propstest@127.0.0.1:55433/propstest';

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE IF NOT EXISTS analytics.games (
  game_id text PRIMARY KEY,
  start_time timestamptz,
  status text
);
CREATE TABLE IF NOT EXISTS analytics.player_props_current (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id integer NOT NULL,
  player_id integer NOT NULL,
  player_name text,
  team_id integer,
  sportsbook text,
  prop_type text,
  market_type text,
  side text,
  line_value numeric,
  odds_american integer,
  odds_decimal numeric,
  implied_probability numeric,
  snapshot_at timestamptz NOT NULL,
  observed_at timestamptz,
  controller_enqueued_at timestamptz,
  provider_updated_at timestamptz,
  observation_clock text,
  UNIQUE (game_id, player_id, sportsbook, prop_type, side, line_value)
);
CREATE TABLE IF NOT EXISTS analytics.player_prop_current (
  id bigserial PRIMARY KEY,
  game_id text NOT NULL,
  player_id text NOT NULL,
  vendor text NOT NULL,
  prop_type text NOT NULL,
  line_value numeric NOT NULL,
  market_type text NOT NULL,
  over_odds integer,
  under_odds integer,
  snapshot_at timestamptz NOT NULL,
  pull_run_id bigint
);
CREATE TABLE IF NOT EXISTS raw.player_prop_snapshots_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id integer NOT NULL,
  player_id integer NOT NULL,
  player_name text,
  team_id integer,
  sportsbook text,
  prop_type text,
  market_type text,
  side text,
  line_value numeric,
  odds_american integer,
  odds_decimal numeric,
  implied_probability numeric,
  fetched_at timestamptz NOT NULL,
  raw_json jsonb,
  pull_run_id bigint,
  observed_at timestamptz,
  controller_enqueued_at timestamptz,
  provider_updated_at timestamptz,
  observation_clock text
);
CREATE UNIQUE INDEX IF NOT EXISTS raw_player_prop_snapshots_v2_pull_observation_uidx
  ON raw.player_prop_snapshots_v2 (pull_run_id, game_id, player_id, sportsbook, prop_type, side, line_value)
  WHERE pull_run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS raw.player_prop_daily_attempts (
  et_day date PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempts >= 0)
);
CREATE TABLE IF NOT EXISTS raw.player_prop_game_runs (
  pull_run_id bigint NOT NULL,
  game_id text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  provider_attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pull_run_id, game_id),
  CHECK (provider_attempts >= 0)
);
`;

const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });

function line(odds = -110, observedAt = new Date('2026-10-21T22:00:00.000Z')): NormalizedPropRow {
  return {
    game_id: 101,
    player_id: 77,
    player_name: 'Tester',
    team_id: 14,
    sportsbook: 'draftkings',
    prop_type: 'points',
    market_type: 'over_under',
    side: 'over',
    line_value: 27.5,
    odds_american: odds,
    odds_decimal: 1.91,
    implied_probability: 0.524,
    raw_json: { id: 1 },
    provider_updated_at: new Date('2026-10-21T21:00:00.000Z'),
  };
}

const clocks = (observedAt: Date) => ({
  controllerEnqueuedAt: new Date('2026-10-21T21:50:00.000Z'),
  observedAt,
});

const snapshotAt = new Date('2026-10-21T21:50:00.000Z');
const laterSnapshot = new Date('2026-10-21T21:55:00.000Z');

async function seedGame(status: string, startSql: string): Promise<void> {
  await pool.query(
    `INSERT INTO analytics.games (game_id, start_time, status)
     VALUES ('101', ${startSql}, $1)`,
    [status]
  );
}

describe('props serving writes on local Postgres', () => {
  beforeAll(async () => {
    await pool.query(SCHEMA);
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE analytics.player_props_current, analytics.player_prop_current, analytics.games,
               raw.player_prop_snapshots_v2, raw.player_prop_game_runs
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('promotes both serving tables while the game is still scheduled', async () => {
    await seedGame('Scheduled', "clock_timestamp() + interval '3 hours'");
    const observed = new Date();
    const result = await promoteServingProps(pool, {
      gameId: '101',
      pullRunId: 9,
      rows: [line(-110, observed)],
      preferred: [{
        game_id: '101',
        player_id: '77',
        vendor: 'draftkings',
        prop_type: 'points',
        line_value: 27.5,
        market_type: 'over_under',
        over_odds: -110,
        under_odds: -110,
        snapshot_at: snapshotAt,
      }],
      snapshotAt,
      clocks: clocks(observed),
    });
    expect(result.outcome).toBe('promoted');
    expect(result.current).toBe(1);
    expect(result.legacyCurrent).toBe(1);
    const current = await pool.query(`SELECT odds_american FROM analytics.player_props_current`);
    const legacy = await pool.query(`SELECT over_odds FROM analytics.player_prop_current`);
    expect(current.rows).toEqual([{ odds_american: -110 }]);
    expect(legacy.rows).toEqual([{ over_odds: -110 }]);
  });

  it('a write after tip stores raw history and leaves both current tables unchanged', async () => {
    await seedGame('Scheduled', "clock_timestamp() - interval '1 minute'");
    await pool.query(
      `INSERT INTO analytics.player_props_current (
         game_id, player_id, sportsbook, prop_type, side, line_value, odds_american, snapshot_at, observed_at, observation_clock
       ) VALUES (101, 77, 'draftkings', 'points', 'over', 27.5, -105, $1, $2, 'RESPONSE_RECEIVED')`,
      [snapshotAt, new Date('2026-10-21T21:40:00.000Z')]
    );
    await pool.query(
      `INSERT INTO analytics.player_prop_current (
         game_id, player_id, vendor, prop_type, line_value, market_type, over_odds, under_odds, snapshot_at, pull_run_id
       ) VALUES ('101', '77', 'draftkings', 'points', 27.5, 'over_under', -105, -115, $1, 1)`,
      [snapshotAt]
    );
    const observed = new Date();
    const raw = await bulkInsertRawV2(pool, [line(-130, observed)], snapshotAt, { enabled: false, sampleRate: 0 }, 9, clocks(observed));
    const currentWrites = await bulkUpsertCurrent(pool, [line(-130, observed)], laterSnapshot, clocks(observed));
    const legacyWrites = await refreshPreferredVendorCurrent(pool, 9, '101', [{
      game_id: '101',
      player_id: '77',
      vendor: 'draftkings',
      prop_type: 'points',
      line_value: 27.5,
      market_type: 'over_under',
      over_odds: -130,
      under_odds: -130,
      snapshot_at: laterSnapshot,
    }], laterSnapshot);
    const promotion = await promoteServingProps(pool, {
      gameId: '101',
      pullRunId: 9,
      rows: [line(-130, observed)],
      preferred: [],
      snapshotAt: laterSnapshot,
      clocks: clocks(observed),
    });
    expect(raw).toBe(1);
    expect(currentWrites).toBe(0);
    expect(legacyWrites).toBe(0);
    expect(promotion).toMatchObject({ outcome: 'post_tip', current: 0, legacyCurrent: 0 });
    const current = await pool.query(`SELECT odds_american::int AS odds FROM analytics.player_props_current`);
    const legacy = await pool.query(`SELECT over_odds FROM analytics.player_prop_current`);
    const history = await pool.query(`SELECT count(*)::int AS n FROM raw.player_prop_snapshots_v2`);
    expect(current.rows).toEqual([{ odds: -105 }]);
    expect(legacy.rows).toEqual([{ over_odds: -105 }]);
    expect(history.rows[0].n).toBe(1);
  });

  it.each([
    ['InProgress', "clock_timestamp() + interval '3 hours'"],
    ['Final', "clock_timestamp() + interval '3 hours'"],
    ['Scheduled', "clock_timestamp() - interval '1 minute'"],
    ['', "clock_timestamp() + interval '3 hours'"],
  ])('status %j at %s does not update current markets', async (status, startSql) => {
    await seedGame(status, startSql);
    const writes = await bulkUpsertCurrent(pool, [line()], snapshotAt, clocks(new Date()));
    expect(writes).toBe(0);
    const count = await pool.query(`SELECT count(*)::int AS n FROM analytics.player_props_current`);
    expect(count.rows[0].n).toBe(0);
  });

  it('missing game metadata fails closed for both serving tables', async () => {
    const promotion = await promoteServingProps(pool, {
      gameId: '101',
      pullRunId: 9,
      rows: [line()],
      preferred: [{
        game_id: '101',
        player_id: '77',
        vendor: 'draftkings',
        prop_type: 'points',
        line_value: 27.5,
        market_type: 'over_under',
        over_odds: -110,
        under_odds: -110,
        snapshot_at: snapshotAt,
      }],
      snapshotAt,
      clocks: clocks(new Date()),
    });
    expect(promotion.outcome).toBe('missing_game');
    const current = await pool.query(`SELECT count(*)::int AS n FROM analytics.player_props_current`);
    const legacy = await pool.query(`SELECT count(*)::int AS n FROM analytics.player_prop_current`);
    expect(current.rows[0].n).toBe(0);
    expect(legacy.rows[0].n).toBe(0);
  });

  it('an older observation does not replace a newer current price', async () => {
    await seedGame('Scheduled', "clock_timestamp() + interval '3 hours'");
    const newer = new Date('2026-10-21T22:10:00.000Z');
    const older = new Date('2026-10-21T22:00:00.000Z');
    expect(await bulkUpsertCurrent(pool, [line(-120, newer)], laterSnapshot, clocks(newer))).toBe(1);
    expect(await bulkUpsertCurrent(pool, [line(-140, older)], snapshotAt, clocks(older))).toBe(0);
    const current = await pool.query(`SELECT odds_american FROM analytics.player_props_current`);
    expect(current.rows).toEqual([{ odds_american: -120 }]);
  });

  it('an older preferred-vendor snapshot does not delete the newer pregame rows', async () => {
    await seedGame('Scheduled', "clock_timestamp() + interval '3 hours'");
    await refreshPreferredVendorCurrent(pool, 1, '101', [{
      game_id: '101', player_id: '77', vendor: 'draftkings', prop_type: 'points', line_value: 27.5,
      market_type: 'over_under', over_odds: -120, under_odds: -120, snapshot_at: laterSnapshot,
    }], laterSnapshot);
    const replaced = await refreshPreferredVendorCurrent(pool, 2, '101', [{
      game_id: '101', player_id: '77', vendor: 'draftkings', prop_type: 'points', line_value: 27.5,
      market_type: 'over_under', over_odds: -180, under_odds: -180, snapshot_at: snapshotAt,
    }], snapshotAt);
    expect(replaced).toBe(0);
    const legacy = await pool.query(`SELECT over_odds FROM analytics.player_prop_current`);
    expect(legacy.rows).toEqual([{ over_odds: -120 }]);
  });

  it('a later pregame snapshot replaces the preferred-vendor rows', async () => {
    await seedGame('Scheduled', "clock_timestamp() + interval '3 hours'");
    await refreshPreferredVendorCurrent(pool, 1, '101', [{
      game_id: '101', player_id: '77', vendor: 'draftkings', prop_type: 'points', line_value: 27.5,
      market_type: 'over_under', over_odds: -110, under_odds: -110, snapshot_at: snapshotAt,
    }], snapshotAt);
    const replaced = await refreshPreferredVendorCurrent(pool, 2, '101', [{
      game_id: '101', player_id: '77', vendor: 'draftkings', prop_type: 'points', line_value: 20.5,
      market_type: 'over_under', over_odds: -125, under_odds: -105, snapshot_at: laterSnapshot,
    }], laterSnapshot);
    expect(replaced).toBe(1);
    const legacy = await pool.query(`SELECT line_value::float8 AS line, over_odds, count(*)::int AS n FROM analytics.player_prop_current GROUP BY 1, 2`);
    expect(legacy.rows).toEqual([{ line: 20.5, over_odds: -125, n: 1 }]);
  });

  it('stops at 10 cumulative attempts across overlapping reserves', async () => {
    expect(PLAYER_PROPS_MAX_HTTP_ATTEMPTS).toBe(PLAYER_PROPS_MAX_PAGES);
    await pool.query(
      `INSERT INTO raw.player_prop_game_runs (pull_run_id, game_id, status) VALUES (4, '101', 'started')`
    );
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        reserveProviderAttempt(pool, 4, '101').then(() => 'ok' as const).catch(() => 'no' as const)
      )
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(10);
    const stored = await pool.query(`SELECT provider_attempts FROM raw.player_prop_game_runs WHERE pull_run_id = 4`);
    expect(stored.rows[0].provider_attempts).toBe(10);
    await expect(reserveProviderAttempt(pool, 4, '101')).rejects.toThrow(/attempt budget exhausted/);
  });
});
