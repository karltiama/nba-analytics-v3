/**
 * Disposable PostgreSQL 17. Proves default writes and deletes use the original
 * table, and the flag-on statements use the normalized table. No production connection.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { playerGameStatDeleteSql, playerGameStatWriteSql } from '../player-game-stat-documents';

const root = path.resolve(__dirname, '../../..');
const pgBin = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const dataDir = path.join(root, 'tmp', 'pgs-writer-7l10a');
const logFile = path.join(root, 'tmp', 'pgs-writer-7l10a.log');
const port = 55446;
const off = {};
const on = { PGS_NORMALIZED_STORAGE: '1' };

function exe(name: string): string {
  return path.join(pgBin, `${name}.exe`);
}

function statArgs(id: number, gameId: number): unknown[] {
  const values = Array(27).fill(null);
  values[0] = id;
  values[23] = gameId;
  return values;
}

describe('writer selection on disposable Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    execFileSync(exe('initdb'), ['-D', dataDir, '-U', 'pgs_writer', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync'], { stdio: 'ignore' });
    execFileSync(exe('pg_ctl'), ['-D', dataDir, '-l', logFile, '-o', `-c listen_addresses=127.0.0.1 -c port=${port}`, '-w', 'start'], { stdio: 'ignore' });
    execFileSync(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'pgs_writer', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `
      create schema raw;
      create table raw.player_game_stats (
        id integer primary key,
        min text, fgm integer, fga integer, fg_pct numeric, fg3m integer, fg3a integer, fg3_pct numeric,
        ftm integer, fta integer, ft_pct numeric, oreb integer, dreb integer, reb integer, ast integer,
        stl integer, blk integer, turnover integer, pf integer, pts integer, plus_minus integer,
        player_id integer, team_id integer, game_id integer, player jsonb, team jsonb, game jsonb,
        created_at timestamptz not null default now()
      );
    `], { stdio: 'ignore' });
    execFileSync(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'pgs_writer', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', path.join(root, 'db/schemas/MIGRATION_player_game_stats_documents.sql')], { stdio: 'ignore' });
    pool = new Pool({ host: '127.0.0.1', port, user: 'pgs_writer', database: 'postgres', max: 1 });
    const identity = await pool.query(`select inet_server_addr()::text as addr, inet_server_port() as port`);
    expect(String(identity.rows[0].addr)).toMatch(/^127\.0\.0\.1/);
    expect(Number(identity.rows[0].port)).toBe(port);
  }, 60_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    if (fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
      execFileSync(exe('pg_ctl'), ['-D', dataDir, 'stop', '-m', 'fast'], { stdio: 'ignore' });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(logFile, { force: true });
  });

  it('keeps the default insert and delete on the original table', async () => {
    await pool.query(playerGameStatWriteSql(off), statArgs(1, 10));
    await pool.query(playerGameStatWriteSql(off), statArgs(2, 11));
    await pool.query(`insert into raw.player_game_stats_row (id, game_id) values (1, 10), (2, 11)`);
    await pool.query(playerGameStatDeleteSql(off), [10]);
    const original = await pool.query(`select id from raw.player_game_stats order by id`);
    const normalized = await pool.query(`select id from raw.player_game_stats_row order by id`);
    expect(original.rows.map((row) => row.id)).toEqual([2]);
    expect(normalized.rows.map((row) => row.id)).toEqual([1, 2]);
  });

  it('rolls back a failed original insert', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(playerGameStatWriteSql(off), statArgs(4, 13));
      await expect(client.query(`insert into raw.player_game_stats (id) values (4)`)).rejects.toThrow(/duplicate key/);
    } finally {
      await client.query('rollback');
      client.release();
    }
    const left = await pool.query(`select count(*)::int as n from raw.player_game_stats where id = 4`);
    expect(left.rows[0].n).toBe(0);
  });

  it('writes and deletes the normalized stat table only when the flag is exactly 1', async () => {
    await pool.query(playerGameStatWriteSql(on), statArgs(5, 15));
    const written = await pool.query(`select game_id from raw.player_game_stats_row where id = 5`);
    expect(written.rows[0].game_id).toBe(15);
    const originalBefore = await pool.query(`select count(*)::int as n from raw.player_game_stats where id = 5`);
    expect(originalBefore.rows[0].n).toBe(0);
    await pool.query(playerGameStatDeleteSql(on), [15]);
    const gone = await pool.query(`select count(*)::int as n from raw.player_game_stats_row where game_id = 15`);
    const original = await pool.query(`select count(*)::int as n from raw.player_game_stats where id = 2`);
    expect(gone.rows[0].n).toBe(0);
    expect(original.rows[0].n).toBe(1);
  });
});
