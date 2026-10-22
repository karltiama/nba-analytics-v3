import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { reserveProviderAttempt } from '../attempt-budget';
import { completeGameRun } from '../bulk-writers';

/**
 * Applies the prepared migration to a table that does not yet have
 * provider_attempts. Local Postgres only. PROPS_PG_ADMIN_URL is the
 * maintenance database; the test creates propsmig beside it.
 */
const adminUrl = process.env.PROPS_PG_ADMIN_URL ?? 'postgres://postgres:propstest@127.0.0.1:55433/postgres';
const databaseUrl = process.env.PROPS_PG_MIG_URL ?? 'postgres://postgres:propstest@127.0.0.1:55433/propsmig';
const migrationPath = path.resolve(
  __dirname,
  '../../../../db/schemas/MIGRATION_player_prop_provider_attempts.sql'
);
const dailyMigrationPath = path.resolve(
  __dirname,
  '../../../../db/schemas/MIGRATION_player_prop_daily_attempts.sql'
);

const PRE_MIGRATION = `
CREATE SCHEMA IF NOT EXISTS raw;
CREATE TABLE IF NOT EXISTS raw.player_prop_pull_runs (
  pull_run_id bigint PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS raw.player_prop_game_runs (
  pull_run_id bigint NOT NULL REFERENCES raw.player_prop_pull_runs(pull_run_id) ON DELETE CASCADE,
  game_id text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  rows_fetched integer NOT NULL DEFAULT 0,
  rows_stored integer NOT NULL DEFAULT 0,
  rows_archived integer NOT NULL DEFAULT 0,
  archive_object_count integer NOT NULL DEFAULT 0,
  archive_completed_at timestamptz,
  archive_status text NOT NULL DEFAULT 'pending',
  archive_error text,
  archive_key text,
  error_message text,
  universe text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pull_run_id, game_id)
);
CREATE TABLE IF NOT EXISTS raw.player_prop_snapshots_v2 (
  id integer PRIMARY KEY,
  game_id integer NOT NULL,
  pull_run_id bigint NOT NULL,
  odds_american integer NOT NULL
);
`;

const admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });

function applySqlFile(filePath: string): void {
  const sql = fs.readFileSync(filePath);
  const result = spawnSync(
    'docker',
    ['exec', '-i', 'props-p2-pg', 'psql', '-U', 'postgres', '-d', 'propsmig', '-v', 'ON_ERROR_STOP=1'],
    { input: sql }
  );
  if (result.status !== 0) {
    const detail = Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]).toString('utf8');
    throw new Error(detail || 'migration psql failed');
  }
}

function applyMigrationFile(): void {
  applySqlFile(migrationPath);
}

beforeAll(async () => {
  const existing = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'propsmig'`);
  if (existing.rowCount === 0) {
    await admin.query('CREATE DATABASE propsmig');
  }
  await pool.query(PRE_MIGRATION);
  await pool.query(`
    INSERT INTO raw.player_prop_pull_runs (pull_run_id) VALUES (1), (2), (3)
    ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO raw.player_prop_game_runs (
      pull_run_id, game_id, status, rows_fetched, rows_stored, error_message, universe
    ) VALUES
      (1, '101', 'success', 40, 40, NULL, 'broad'),
      (1, '202', 'error', 0, 0, 'provider_429', 'near_tip'),
      (2, '101', 'started', 0, 0, NULL, 'broad')
    ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO raw.player_prop_snapshots_v2 (id, game_id, pull_run_id, odds_american)
    VALUES (7, 101, 1, -110)
    ON CONFLICT DO NOTHING
  `);
  applyMigrationFile();
  applySqlFile(dailyMigrationPath);
});

afterAll(async () => {
  await pool.end();
  await admin.end();
});

it('gives existing game runs a zero attempt count and keeps their lifecycle columns', async () => {
  const runs = await pool.query(`
    SELECT pull_run_id, game_id, status, rows_fetched, rows_stored, error_message, provider_attempts
    FROM raw.player_prop_game_runs
    ORDER BY pull_run_id, game_id
  `);
  expect(runs.rows).toEqual([
    { pull_run_id: '1', game_id: '101', status: 'success', rows_fetched: 40, rows_stored: 40, error_message: null, provider_attempts: 0 },
    { pull_run_id: '1', game_id: '202', status: 'error', rows_fetched: 0, rows_stored: 0, error_message: 'provider_429', provider_attempts: 0 },
    { pull_run_id: '2', game_id: '101', status: 'started', rows_fetched: 0, rows_stored: 0, error_message: null, provider_attempts: 0 },
  ]);
  const history = await pool.query(`SELECT id, odds_american FROM raw.player_prop_snapshots_v2`);
  expect(history.rows).toEqual([{ id: 7, odds_american: -110 }]);
});

it('declares provider_attempts integer, not null, default 0, and rejects a negative value', async () => {
  const column = await pool.query<{ attnotnull: boolean; default_expr: string | null; typname: string }>(`
    SELECT a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr, t.typname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'raw' AND c.relname = 'player_prop_game_runs' AND a.attname = 'provider_attempts'
  `);
  expect(column.rows[0]).toMatchObject({ attnotnull: true, default_expr: '0', typname: 'int4' });
  await pool.query(`
    INSERT INTO raw.player_prop_pull_runs (pull_run_id) VALUES (9) ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO raw.player_prop_game_runs (pull_run_id, game_id, status)
    VALUES (9, '303', 'started')
  `);
  const inserted = await pool.query(`SELECT provider_attempts FROM raw.player_prop_game_runs WHERE pull_run_id = 9`);
  expect(inserted.rows[0].provider_attempts).toBe(0);
  await expect(
    pool.query(`UPDATE raw.player_prop_game_runs SET provider_attempts = -1 WHERE pull_run_id = 9`)
  ).rejects.toThrow(/provider_attempts/);
});

it('keeps a failed request on the same run counter and shares that counter across a redelivery', async () => {
  expect(await reserveProviderAttempt(pool, 2, '101')).toBe(1);
  await completeGameRun(pool, 2, '101', 'error', 0, 0, 'provider_429');
  const afterFailure = await pool.query(`
    SELECT status, error_message, rows_fetched, provider_attempts
    FROM raw.player_prop_game_runs WHERE pull_run_id = 2 AND game_id = '101'
  `);
  expect(afterFailure.rows[0]).toMatchObject({
    status: 'error',
    error_message: 'provider_429',
    rows_fetched: 0,
    provider_attempts: 1,
  });
  expect(await reserveProviderAttempt(pool, 2, '101')).toBe(2);
  expect(await reserveProviderAttempt(pool, 1, '101')).toBe(1);
});

it('stops 25 concurrent reservations at 10 for one run id', async () => {
  await pool.query(`
    INSERT INTO raw.player_prop_pull_runs (pull_run_id) VALUES (4) ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO raw.player_prop_game_runs (pull_run_id, game_id, status)
    VALUES (4, '101', 'started')
  `);
  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      reserveProviderAttempt(pool, 4, '101').then(() => 'ok' as const).catch(() => 'no' as const)
    )
  );
  expect(results.filter((result) => result === 'ok')).toHaveLength(10);
  const stored = await pool.query(`SELECT provider_attempts FROM raw.player_prop_game_runs WHERE pull_run_id = 4`);
  expect(stored.rows[0].provider_attempts).toBe(10);
  await expect(reserveProviderAttempt(pool, 4, '101')).rejects.toThrow(/attempt budget exhausted/);
});

it('can be applied again without resetting a counter the worker already incremented', async () => {
  applyMigrationFile();
  const stored = await pool.query(`
    SELECT provider_attempts FROM raw.player_prop_game_runs WHERE pull_run_id = 2 AND game_id = '101'
  `);
  expect(stored.rows[0].provider_attempts).toBe(2);
  const history = await pool.query(`SELECT count(*)::int AS n FROM raw.player_prop_snapshots_v2`);
  expect(history.rows[0].n).toBe(1);
});
