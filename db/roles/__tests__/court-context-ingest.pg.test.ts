/**
 * Applies db/roles/court_context_ingest.sql to a disposable PostgreSQL 17.
 * The cluster listens on 127.0.0.1 only. It refuses a Supabase host or port 5432.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const port = 55445;
const host = '127.0.0.1';
const database = 'court_context_f31';
const pgBin = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const dataDir = 'D:\\court-context-backups\\f31\\contract-pgdata';
const logFile = 'D:\\court-context-backups\\f31\\contract-pg.log';
const sqlPath = path.resolve(__dirname, '../court_context_ingest.sql');

function exe(name: string): string {
  return path.join(pgBin, `${name}.exe`);
}

function psql(db: string, args: string[]): string {
  if (host !== '127.0.0.1' || port === 5432 || port === 6543) {
    throw new Error('refusing a non-disposable database target');
  }
  return execFileSync(exe('psql'), ['-h', host, '-p', String(port), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
  });
}

function psqlFails(db: string, args: string[], pattern: RegExp): void {
  try {
    psql(db, args);
    throw new Error('expected the SQL to fail');
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '');
    const stdout = String((error as { stdout?: string }).stdout ?? '');
    expect(`${stderr}\n${stdout}`).toMatch(pattern);
  }
}

const fixture = `
create schema raw;
create schema analytics;
create schema display;

create table raw.acquisition_requests (
  request_id text primary key,
  archive_status text not null
);
create function raw.acquisition_requests_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'raw.acquisition_requests is append-only';
  end if;
  return new;
end $$;
create trigger acquisition_requests_guard_trg
  before delete on raw.acquisition_requests
  for each row execute function raw.acquisition_requests_guard();
create function raw.acquisition_requests_block_truncate() returns trigger language plpgsql as $$
begin
  raise exception 'raw.acquisition_requests is append-only (truncate rejected)';
end $$;
create trigger acquisition_requests_block_truncate_trg
  before truncate on raw.acquisition_requests
  for each statement execute function raw.acquisition_requests_block_truncate();

create table raw.games (id integer primary key);
create table raw.players (id integer primary key);
create table raw.game_period_scores (game_id integer primary key);
create table raw.player_game_stat_document (
  document_id bigint generated always as identity primary key,
  document jsonb not null
);
create table raw.player_game_stats_row (
  id integer primary key,
  game_id integer not null
);
create function raw.upsert_player_game_stat_document(p_document jsonb) returns bigint
language plpgsql as $$
declare new_id bigint;
begin
  insert into raw.player_game_stat_document (document) values (p_document) returning document_id into new_id;
  return new_id;
end $$;
create function raw.upsert_player_game_stat(
  p_id integer, p_min text, p_fgm integer, p_fga integer, p_fg_pct numeric,
  p_fg3m integer, p_fg3a integer, p_fg3_pct numeric, p_ftm integer, p_fta integer,
  p_ft_pct numeric, p_oreb integer, p_dreb integer, p_reb integer, p_ast integer,
  p_stl integer, p_blk integer, p_turnover integer, p_pf integer, p_pts integer,
  p_plus_minus integer, p_player_id integer, p_team_id integer, p_game_id integer,
  p_player jsonb, p_team jsonb, p_game jsonb
) returns void language plpgsql as $$
begin
  perform raw.upsert_player_game_stat_document(p_player);
  insert into raw.player_game_stats_row (id, game_id) values (p_id, p_game_id)
  on conflict (id) do update set game_id = excluded.game_id;
end $$;

create table analytics.players (player_id integer primary key);
create table analytics.games (
  game_id text primary key,
  status text not null
);
create function analytics.games_preserve_final() returns trigger language plpgsql as $$
begin
  if old.status = 'Final' and new.status is distinct from old.status then
    raise exception 'final status is preserved';
  end if;
  return new;
end $$;
create trigger games_preserve_final_trg
  before update on analytics.games
  for each row execute function analytics.games_preserve_final();
create table analytics.player_game_logs (
  game_id text not null,
  player_id text not null,
  points integer not null,
  primary key (game_id, player_id)
);
create table analytics.team_game_stats (team_id integer, game_id integer, primary key (team_id, game_id));
create table analytics.team_season_averages (team_id integer, season integer, primary key (team_id, season));
create table analytics.player_season_averages (player_id integer, season integer, primary key (player_id, season));
create table analytics.player_period_scoring (player_id integer, game_id integer, primary key (player_id, game_id));
create table analytics.not_granted (id integer primary key);

create table display.scoreboard_games (game_id text primary key, status text not null);
create table display.scoreboard_player_lines (
  game_id text not null,
  player_id text not null,
  name text not null,
  primary key (game_id, player_id)
);
create table display.scoreboard_game_odds (game_id text primary key);
create table display.scoreboard_odds_state (scope text primary key);
create table display.scoreboard_collector_state (season_type text primary key);
`;

describe('court_context_ingest on disposable Postgres', () => {
  let ingest: Pool;

  beforeAll(() => {
    if (fs.existsSync(path.join(dataDir, 'postmaster.pid'))) {
      execFileSync(exe('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    execFileSync(exe('initdb'), ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync'], {
      stdio: 'ignore',
    });
    execFileSync(exe('pg_ctl'), ['-D', dataDir, '-l', logFile, '-o', `-c listen_addresses=${host} -c port=${port}`, '-w', 'start'], {
      stdio: 'ignore',
    });
    psql('postgres', ['-c', `create database ${database}`]);
    const fixturePath = 'D:\\court-context-backups\\f31\\fixture.sql';
    fs.writeFileSync(fixturePath, fixture);
    psql(database, ['-f', fixturePath]);
    psql(database, ['-f', sqlPath]);
    psql(database, ['-f', sqlPath]);
    ingest = new Pool({ host, port, database, user: 'court_context_ingest', max: 1 });
  }, 60_000);

  afterAll(async () => {
    await ingest?.end().catch(() => undefined);
    if (fs.existsSync(path.join(dataDir, 'postmaster.pid'))) {
      execFileSync(exe('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
    }
  });

  it('uses a real restricted login and the catalog attributes from the SQL file', async () => {
    const identity = await ingest.query('select current_user as current_user, session_user as session_user');
    expect(identity.rows[0]).toEqual({ current_user: 'court_context_ingest', session_user: 'court_context_ingest' });
    const attributes = psql('postgres', ['-c', `select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolinherit, rolcanlogin from pg_roles where rolname = 'court_context_ingest'`]);
    expect(attributes).toContain('f');
    expect(attributes).toMatch(/f\s+\|\s+f\s+\|\s+f\s+\|\s+f\s+\|\s+f\s+\|\s+t/);
  });

  it('runs the ingestion writes, the stat function, and the cluster measurement', async () => {
    await ingest.query(`insert into display.scoreboard_games values ('g1', 'live')`);
    await ingest.query(`insert into display.scoreboard_games values ('g1', 'final') on conflict (game_id) do update set status = excluded.status`);
    await ingest.query(`insert into display.scoreboard_player_lines values ('g1', 'p1', 'A'), ('g1', 'p2', 'B')`);
    await ingest.query(`delete from display.scoreboard_player_lines where game_id = 'g1' and player_id = 'p1'`);
    await ingest.query(`insert into raw.acquisition_requests values ('req-1', 'pending')`);
    await ingest.query(`update raw.acquisition_requests set archive_status = 'archived' where request_id = 'req-1'`);
    await ingest.query(`insert into analytics.games values ('g1', 'Live') on conflict (game_id) do update set status = excluded.status`);
    await ingest.query(`insert into analytics.player_game_logs values ('g1', 'p1', 10) on conflict (game_id, player_id) do update set points = excluded.points`);
    const client = await ingest.connect();
    try {
      await client.query('begin');
      await client.query(`insert into display.scoreboard_games values ('g-rollback', 'live')`);
      await client.query('rollback');
      await client.query('begin read only');
      await client.query(`set local statement_timeout = '15s'`);
      const measured = await client.query(`select coalesce(sum(pg_database_size(d.oid)), 0)::bigint::text as cluster_bytes, clock_timestamp() as observed_at from pg_database d`);
      await client.query('rollback');
      expect(Number(measured.rows[0].cluster_bytes)).toBeGreaterThan(0);
      expect(measured.rows[0].observed_at).toBeTruthy();
    } finally {
      client.release();
    }
    await ingest.query(`select raw.upsert_player_game_stat(5, '1', 1, 2, 0.5, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 2, 1, 11, 22, 33, '{"k":1}'::jsonb, '{"k":2}'::jsonb, '{"k":3}'::jsonb)`);
    await ingest.query(`select raw.upsert_player_game_stat(5, '2', 1, 2, 0.5, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 4, 1, 11, 22, 44, '{"k":4}'::jsonb, '{"k":2}'::jsonb, '{"k":3}'::jsonb)`);

    const games = await ingest.query(`select status from display.scoreboard_games where game_id = 'g1'`);
    const lines = await ingest.query(`select player_id from display.scoreboard_player_lines where game_id = 'g1' order by player_id`);
    const ledger = await ingest.query(`select archive_status from raw.acquisition_requests where request_id = 'req-1'`);
    const logs = await ingest.query(`select points from analytics.player_game_logs where game_id = 'g1'`);
    const stats = await ingest.query(`select game_id from raw.player_game_stats_row where id = 5`);
    const documents = await ingest.query(`select count(*)::int as n from raw.player_game_stat_document`);
    const rolled = await ingest.query(`select count(*)::int as n from display.scoreboard_games where game_id = 'g-rollback'`);
    expect(games.rows[0].status).toBe('final');
    expect(lines.rows.map((row) => row.player_id)).toEqual(['p2']);
    expect(ledger.rows[0].archive_status).toBe('archived');
    expect(Number(logs.rows[0].points)).toBe(10);
    expect(stats.rows[0].game_id).toBe(44);
    expect(documents.rows[0].n).toBe(2);
    expect(rolled.rows[0].n).toBe(0);
  });

  it('keeps the final-status trigger and denies destructive or ungranted operations', async () => {
    psql(database, ['-c', `insert into analytics.games values ('final-game', 'Final')`]);
    await expect(ingest.query(`update analytics.games set status = 'Live' where game_id = 'final-game'`)).rejects.toThrow(/final status is preserved/);
    const triggers = psql(database, ['-c', `select tgname from pg_trigger where tgname like 'acquisition_requests%' and not tgisinternal order by tgname`]);
    expect(triggers).toContain('acquisition_requests_guard_trg');
    expect(triggers).toContain('acquisition_requests_block_truncate_trg');

    await expect(ingest.query('drop table display.scoreboard_games')).rejects.toThrow(/must be owner/);
    await expect(ingest.query('alter table analytics.games add column extra text')).rejects.toThrow(/must be owner/);
    await expect(ingest.query('truncate raw.acquisition_requests')).rejects.toThrow(/permission denied/);
    await expect(ingest.query(`delete from raw.acquisition_requests where request_id = 'req-1'`)).rejects.toThrow(/permission denied/);
    await expect(ingest.query('delete from raw.player_game_stats_row where id = 5')).rejects.toThrow(/permission denied/);
    await expect(ingest.query('create table raw.not_allowed (id integer)')).rejects.toThrow(/permission denied for schema raw/);
    await expect(ingest.query('set role postgres')).rejects.toThrow(/permission denied/);
    await expect(ingest.query('create role should_not_exist')).rejects.toThrow(/permission denied to create role/);
    await expect(ingest.query('select id from analytics.not_granted')).rejects.toThrow(/permission denied/);
  });

  it('does not rewrite an existing role that has unexpected attributes or membership', async () => {
    await ingest.end();
    psql(database, ['-c', 'drop owned by court_context_ingest']);
    psql(database, ['-c', 'drop role court_context_ingest']);
    psql(database, ['-c', 'create role court_context_ingest login createdb nosuperuser nocreaterole nobypassrls noinherit noreplication']);
    psqlFails(database, ['-f', sqlPath], /unexpected role attributes/);
    const stillCreatedb = psql('postgres', ['-c', `select rolcreatedb from pg_roles where rolname = 'court_context_ingest'`]);
    expect(stillCreatedb).toContain('t');

    psql(database, ['-c', 'drop role court_context_ingest']);
    psql(database, ['-c', `create role court_context_ingest login nosuperuser nocreatedb nocreaterole nobypassrls noinherit noreplication`]);
    psql(database, ['-c', `alter role court_context_ingest set search_path to "$user", public, extensions`]);
    psql(database, ['-c', 'create role ingest_extra_group nologin']);
    psql(database, ['-c', 'grant ingest_extra_group to court_context_ingest']);
    psqlFails(database, ['-f', sqlPath], /unexpected membership: ingest_extra_group/);
    const members = psql('postgres', ['-c', `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = 'court_context_ingest'`]);
    expect(members).toContain('ingest_extra_group');
  });
});
