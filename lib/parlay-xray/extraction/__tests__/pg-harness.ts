/**
 * Dedicated local Postgres for XRay guardrail certification.
 * Never uses SUPABASE_DB_URL / production.
 *
 * Resolution order:
 * 1. XRAY_PG_TEST_URL
 * 2. Docker container nba-xray-guardrail-pg on 127.0.0.1:55432
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

const execFileAsync = promisify(execFile);

export const XRAY_PG_CONTAINER = 'nba-xray-guardrail-pg';
export const XRAY_PG_PORT = 55432;
export const XRAY_PG_DOCKER_URL = `postgres://xray:xray@127.0.0.1:${XRAY_PG_PORT}/xray_guardrails`;

const SQL_PATH = join(process.cwd(), 'sql/proposed/parlay-xray-extraction-guardrails.sql');

function dockerAvailableMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

async function docker(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('docker', args, { timeout: 120_000 });
}

async function waitForReady(pool: Pool, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let last = 'not-tried';
  while (Date.now() - started < timeoutMs) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error(`XRay test Postgres was not ready: ${last.slice(0, 160)}`);
}

export async function startXrayTestPostgres(): Promise<{ pool: Pool; target: string; appliedSql: string }> {
  const fromEnv = process.env.XRAY_PG_TEST_URL?.trim();
  const connectionString = fromEnv || XRAY_PG_DOCKER_URL;
  const target = fromEnv ? 'XRAY_PG_TEST_URL' : `docker:${XRAY_PG_CONTAINER}`;

  if (!fromEnv) {
    try {
      await docker(['info']);
    } catch (error) {
      throw new Error(
        `Dedicated local Postgres unavailable (Docker daemon not running). ${dockerAvailableMessage(error)}`
      );
    }
    try {
      await docker(['inspect', '-f', '{{.State.Running}}', XRAY_PG_CONTAINER]);
      await docker(['start', XRAY_PG_CONTAINER]).catch(() => undefined);
    } catch {
      await docker([
        'run',
        '-d',
        '--name',
        XRAY_PG_CONTAINER,
        '-e',
        'POSTGRES_USER=xray',
        '-e',
        'POSTGRES_PASSWORD=xray',
        '-e',
        'POSTGRES_DB=xray_guardrails',
        '-p',
        `${XRAY_PG_PORT}:5432`,
        'postgres:16-alpine',
      ]);
    }
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    ssl: false,
    connectionTimeoutMillis: 8000,
  });
  await waitForReady(pool, 60_000);

  const sql = readFileSync(SQL_PATH, 'utf8');
  if (/^\s*DROP\s+/im.test(sql) || /^\s*DELETE\s+/im.test(sql) || /^\s*TRUNCATE\s+/im.test(sql)) {
    await pool.end();
    throw new Error('Refusing to apply XRay SQL that contains DROP/DELETE/TRUNCATE');
  }
  await pool.query(sql);

  return { pool, target, appliedSql: SQL_PATH };
}

export async function resetXrayGuardrailTables(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE
      parlay_xray_daily_counters,
      parlay_xray_inflight,
      parlay_xray_cooldowns,
      parlay_xray_dedupe,
      parlay_xray_extraction_usage
  `);
}

export async function listXrayTableColumns(
  pool: Pool
): Promise<Array<{ table_name: string; column_name: string; data_type: string }>> {
  const { rows } = await pool.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name LIKE 'parlay_xray_%'
     ORDER BY table_name, ordinal_position`
  );
  return rows;
}
