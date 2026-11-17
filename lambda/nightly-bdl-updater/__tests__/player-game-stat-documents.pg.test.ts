/**
 * Disposable Postgres 17 on 127.0.0.1 only. No production URL.
 * Applies the Stage A migration to the November 14 raw.player_game_stats
 * backup when that file is present, then checks parity, ingestion behavior,
 * referential integrity, and query time.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizedPlayerGameStatsEnabled, playerGameStatWriteSql } from '../player-game-stat-documents';

const root = path.resolve(__dirname, '../../..');
const pgBin = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const dataDir = path.join(root, 'tmp', 'pgs-normalize-7l9');
const logFile = path.join(root, 'tmp', 'pgs-normalize-7l9.log');
const port = 55444;
const backup = 'D:\\court-context-backups\\cc-pg-logical-20261114T191459Z\\postgres.backup';

function exe(name: string): string {
  return path.join(pgBin, `${name}.exe`);
}

function assertLocal(): void {
  if (port === 5432) throw new Error('refusing the local service port');
}

describe('normalized player-game stats on disposable Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertLocal();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    execFileSync(exe('initdb'), ['-D', dataDir, '-U', 'pgs_normalize', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync'], { stdio: 'ignore' });
    execFileSync(exe('pg_ctl'), ['-D', dataDir, '-l', logFile, '-o', `-c listen_addresses=127.0.0.1 -c port=${port}`, '-w', 'start'], { stdio: 'ignore' });
    execFileSync(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'pgs_normalize', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE SCHEMA raw;'], { stdio: 'ignore' });
    if (fs.existsSync(backup)) {
      execFileSync(exe('pg_restore'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'pgs_normalize', '-d', 'postgres', '--no-owner', '--no-privileges', '--schema=raw', '-t', 'player_game_stats', backup], { stdio: 'ignore' });
    } else {
      execFileSync(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'pgs_normalize', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE TABLE raw.player_game_stats (id integer primary key, min text, fgm integer, fga integer, fg_pct numeric, fg3m integer, fg3a integer, fg3_pct numeric, ftm integer, fta integer, ft_pct numeric, oreb integer, dreb integer, reb integer, ast integer, stl integer, blk integer, turnover integer, pf integer, pts integer, plus_minus integer, player_id integer, team_id integer, game_id integer, player jsonb, team jsonb, game jsonb, created_at timestamptz not null default now());`], { stdio: 'ignore' });
    }
    execFileSync(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'pgs_normalize', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', path.join(root, 'db/schemas/MIGRATION_player_game_stats_documents.sql')], { stdio: 'ignore' });
    pool = new Pool({ host: '127.0.0.1', port, user: 'pgs_normalize', database: 'postgres', max: 2 });
    const identity = await pool.query(`SELECT inet_server_addr()::text AS addr, inet_server_port() AS port, current_database() AS db, current_setting('server_version') AS version`);
    expect(String(identity.rows[0].addr)).toMatch(/^127\.0\.0\.1/);
    expect(Number(identity.rows[0].port)).toBe(port);
    expect(identity.rows[0].db).toBe('postgres');
    expect(String(identity.rows[0].version)).toMatch(/^17/);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    if (fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
      execFileSync(exe('pg_ctl'), ['-D', dataDir, 'stop', '-m', 'fast'], { stdio: 'pipe' });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps the legacy write unless the flag is exactly 1', () => {
    expect(normalizedPlayerGameStatsEnabled({})).toBe(false);
    expect(playerGameStatWriteSql({}).includes('insert into raw.player_game_stats')).toBe(true);
    expect(playerGameStatWriteSql({ PGS_NORMALIZED_STORAGE: '1' }).includes('raw.upsert_player_game_stat')).toBe(true);
  });

  it('copies every source row with zero mismatches and refuses a document delete', async () => {
    const copied = await pool.query(`SELECT * FROM raw.copy_player_game_stats_documents()`);
    const again = await pool.query(`SELECT * FROM raw.copy_player_game_stats_documents()`);
    const source = await pool.query(`SELECT count(*)::int AS rows FROM raw.player_game_stats`);
    const distinct = await pool.query(`
      SELECT
        count(DISTINCT player)::int AS players,
        count(DISTINCT team)::int AS teams,
        count(DISTINCT game)::int AS games
      FROM raw.player_game_stats`);
    const unionDocs = await pool.query(`
      SELECT count(*)::int AS rows FROM (
        SELECT player AS document FROM raw.player_game_stats WHERE player IS NOT NULL
        UNION
        SELECT team FROM raw.player_game_stats WHERE team IS NOT NULL
        UNION
        SELECT game FROM raw.player_game_stats WHERE game IS NOT NULL
      ) docs`);
    const orphanStats = await pool.query(`
      SELECT count(*)::int AS rows
        FROM raw.player_game_stats_row s
       WHERE (s.player_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM raw.player_game_stat_document d WHERE d.document_id = s.player_document_id))
          OR (s.team_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM raw.player_game_stat_document d WHERE d.document_id = s.team_document_id))
          OR (s.game_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM raw.player_game_stat_document d WHERE d.document_id = s.game_document_id))`);
    expect(Number(copied.rows[0].stat_rows)).toBe(source.rows[0].rows);
    expect(Number(copied.rows[0].mismatched_rows)).toBe(0);
    expect(Number(again.rows[0].stat_rows)).toBe(source.rows[0].rows);
    expect(Number(again.rows[0].document_rows)).toBe(Number(copied.rows[0].document_rows));
    expect(orphanStats.rows[0].rows).toBe(0);
    expect(Number(copied.rows[0].document_rows)).toBe(unionDocs.rows[0].rows);
    if (source.rows[0].rows === 50754) {
      expect(distinct.rows[0]).toEqual({ players: 969, teams: 60, games: 1496 });
    }
    const sizes = await pool.query(`
      SELECT c.relname,
             pg_relation_size(c.oid)::bigint AS heap_bytes,
             pg_indexes_size(c.oid)::bigint AS index_bytes,
             pg_total_relation_size(c.oid)::bigint AS total_bytes,
             pg_stat_get_dead_tuples(c.oid)::bigint AS dead_tuples
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'raw'
         AND c.relname IN ('player_game_stats_row', 'player_game_stat_document')`);
    console.log(JSON.stringify({
      statRows: source.rows[0].rows,
      documentRows: Number(copied.rows[0].document_rows),
      distinct: distinct.rows[0],
      afterSecondCopy: sizes.rows,
    }));
    const referenced = await pool.query(`SELECT player_document_id AS id FROM raw.player_game_stats_row WHERE player_document_id IS NOT NULL LIMIT 1`);
    await expect(pool.query(`DELETE FROM raw.player_game_stat_document WHERE document_id = $1`, [referenced.rows[0].id])).rejects.toThrow(/restrict|foreign key/i);
  }, 180_000);

  it('reuses a document, keeps a changed document, and rolls back a hash collision', async () => {
    const sample = await pool.query(`SELECT * FROM raw.player_game_stats ORDER BY id LIMIT 1`);
    const row = sample.rows[0];
    const beforeDocs = await pool.query(`SELECT count(*)::int AS rows FROM raw.player_game_stat_document`);
    await pool.query(
      `SELECT raw.upsert_player_game_stat($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26::jsonb,$27::jsonb)`,
      [row.id, row.min, row.fgm, row.fga, row.fg_pct, row.fg3m, row.fg3a, row.fg3_pct, row.ftm, row.fta, row.ft_pct, row.oreb, row.dreb, row.reb, row.ast, row.stl, row.blk, row.turnover, row.pf, row.pts, row.plus_minus, row.player_id, row.team_id, row.game_id, row.player, row.team, row.game]
    );
    const afterRepeat = await pool.query(`SELECT count(*)::int AS rows FROM raw.player_game_stat_document`);
    expect(afterRepeat.rows[0].rows).toBe(beforeDocs.rows[0].rows);

    const changed = { ...(row.player ?? {}), jersey_number: '99-test' };
    await pool.query(
      `SELECT raw.upsert_player_game_stat($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26::jsonb,$27::jsonb)`,
      [900000001, row.min, row.fgm, row.fga, row.fg_pct, row.fg3m, row.fg3a, row.fg3_pct, row.ftm, row.fta, row.ft_pct, row.oreb, row.dreb, row.reb, row.ast, row.stl, row.blk, row.turnover, row.pf, row.pts, row.plus_minus, row.player_id, row.team_id, row.game_id, changed, null, null]
    );
    const split = await pool.query(`
      SELECT a.player_document_id AS original_doc, b.player_document_id AS changed_doc, b.team_document_id AS team_doc
        FROM raw.player_game_stats_row a
        JOIN raw.player_game_stats_row b ON b.id = 900000001
       WHERE a.id = $1`, [row.id]);
    expect(split.rows[0].original_doc).not.toBe(split.rows[0].changed_doc);
    expect(split.rows[0].team_doc).toBeNull();
    const resolved = await pool.query(`SELECT player, team FROM raw.player_game_stats_resolved WHERE id = 900000001`);
    expect(resolved.rows[0].team).toBeNull();
    expect(resolved.rows[0].player.jersey_number).toBe('99-test');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO raw.player_game_stat_document (content_md5, document)
         VALUES (md5($1::jsonb::text), $2::jsonb)`,
        ['{"phase7l9":"left"}', '{"phase7l9":"right"}']
      );
      await expect(client.query(`SELECT raw.upsert_player_game_stat_document($1::jsonb)`, ['{"phase7l9":"left"}'])).rejects.toThrow(/hash_collision/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const collisionLeft = await pool.query(`SELECT count(*)::int AS rows FROM raw.player_game_stat_document WHERE document = '{"phase7l9":"right"}'::jsonb`);
    expect(collisionLeft.rows[0].rows).toBe(0);
  });

  it('measures packed storage and single-game plus full-table reads', async () => {
    await pool.query(`CREATE INDEX IF NOT EXISTS raw_player_game_stats_game_id_idx ON raw.player_game_stats (game_id)`);
    const game = await pool.query(`SELECT game_id FROM raw.player_game_stats GROUP BY game_id ORDER BY count(*) DESC LIMIT 1`);
    const gameId = game.rows[0].game_id;
    const originalOne = await pool.query(`EXPLAIN (ANALYZE) SELECT id, pts, player, team, game FROM raw.player_game_stats WHERE game_id = $1`, [gameId]);
    const resolvedOne = await pool.query(`EXPLAIN (ANALYZE) SELECT id, pts, player, team, game FROM raw.player_game_stats_resolved WHERE game_id = $1`, [gameId]);
    const originalAll = await pool.query(`EXPLAIN (ANALYZE) SELECT count(*), count(player), count(game) FROM raw.player_game_stats`);
    const resolvedAll = await pool.query(`EXPLAIN (ANALYZE) SELECT count(*), count(player), count(game) FROM raw.player_game_stats_resolved`);
    const sizes = await pool.query(`
      SELECT c.relname,
             pg_relation_size(c.oid)::bigint AS heap_bytes,
             pg_indexes_size(c.oid)::bigint AS index_bytes,
             pg_total_relation_size(c.oid)::bigint AS total_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'raw'
         AND c.relname IN ('player_game_stats', 'player_game_stats_row', 'player_game_stat_document')
       ORDER BY c.relname`);
    const plan = (rows: Array<{ 'QUERY PLAN': string }>) => rows.map((row) => row['QUERY PLAN']).filter((line) => /Scan|Execution Time/.test(line));
    const time = (rows: Array<{ 'QUERY PLAN': string }>) => plan(rows).join('\n').match(/Execution Time: ([0-9.]+) ms/)?.[1];
    const normalizedBytes = sizes.rows
      .filter((row) => row.relname !== 'player_game_stats')
      .reduce((sum, row) => sum + Number(row.total_bytes), 0);
    console.log(JSON.stringify({
      relations: sizes.rows,
      normalizedBytes,
      singleGame: { original: plan(originalOne.rows), resolved: plan(resolvedOne.rows) },
      fullTable: { original: plan(originalAll.rows), resolved: plan(resolvedAll.rows) },
    }));
    expect(normalizedBytes).toBeGreaterThan(0);
    expect(Number(time(resolvedAll.rows))).toBeLessThan(5000);
  }, 180_000);
});
