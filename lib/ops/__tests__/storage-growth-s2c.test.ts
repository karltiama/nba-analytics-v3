import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  INJURY_MAX_DESCRIPTION,
  INJURY_MAX_PAYLOAD_BYTES,
  INJURY_MAX_PLAYER_ID,
  INJURY_MAX_RETURN,
  INJURY_MAX_ROWS,
  INJURY_MAX_STATUS,
  INJURY_MEASURED_RELATION_COUNT,
  INJURY_MEASURED_WORST_BYTES,
  INJURY_PHYSICAL_GROWTH_BOUND_BYTES,
  NIGHTLY_MAX_FINAL_GAMES,
  NIGHTLY_MAX_GAME_JSON_BYTES,
  NIGHTLY_MAX_NAME,
  NIGHTLY_MAX_PLAYERS_PER_GAME,
  NIGHTLY_MAX_PLAYER_JSON_BYTES,
  NIGHTLY_MAX_SCHEDULE_GAMES,
  NIGHTLY_MAX_STAT_LINES,
  NIGHTLY_MAX_STATUS,
  NIGHTLY_MAX_TEAM_JSON_BYTES,
  NIGHTLY_MAX_VENUE,
  NIGHTLY_MEASURED_RELATION_COUNT,
  NIGHTLY_MEASURED_WORST_BYTES,
  NIGHTLY_PHYSICAL_GROWTH_BOUND_BYTES,
  conservativePhysicalBound,
} from '@/lib/ops/storage-growth-bounds';

const BIN = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const PORT = 54348;
const ROOT = path.join(os.tmpdir(), 'cc-s2c-growth');
const SCHEMAS = path.resolve(__dirname, '../../../db/schemas');

type Sizes = { database: number; cluster: number; wal: number | null; relations: Record<string, number> };
type Step = { name: string; clusterDelta: number; databaseDelta: number; walDelta: number | null; relations: Record<string, number> };

const report: { steps: Step[]; nightlyWorst: number; injuryWorst: number; nightlyRelations: number; injuryRelations: number } = {
  steps: [],
  nightlyWorst: 0,
  injuryWorst: 0,
  nightlyRelations: 0,
  injuryRelations: 0,
};

let started = false;
let maintenance: Client | undefined;
const clients = new Map<string, Client>();

function assertTarget(database: string, maintenanceConnection = false): void {
  const port: number = PORT;
  if (port < 1024 || port === 5432) throw new Error('refusing a non-disposable PostgreSQL port');
  if (maintenanceConnection) {
    if (database !== 'postgres') throw new Error('maintenance connection must use the postgres database');
    return;
  }
  if (!database.startsWith('lifecycle_')) throw new Error(`refusing database ${database}`);
}

function run(bin: string, args: string[]): void {
  const result = spawnSync(path.join(BIN, bin), args, { stdio: 'ignore', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${bin} exited ${result.status}`);
}

function client(database: string, maintenanceConnection = false): Client {
  assertTarget(database, maintenanceConnection);
  return new Client({
    host: '127.0.0.1',
    port: PORT,
    user: 'lifecycle',
    database,
    application_name: 's2c-growth',
  });
}

async function apply(db: Client, files: string[]): Promise<void> {
  await db.query("DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
  await db.query("DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
  await db.query('CREATE SCHEMA IF NOT EXISTS raw');
  for (const file of files) await db.query(fs.readFileSync(path.join(SCHEMAS, file), 'utf8'));
}

async function readSizes(db: Client): Promise<Sizes> {
  const size = await db.query<{ db: string; cluster: string }>(
    `SELECT pg_database_size(current_database())::bigint AS db,
            (SELECT coalesce(sum(pg_database_size(datname)), 0) FROM pg_database)::bigint AS cluster`
  );
  let wal: number | null = null;
  try {
    const found = await db.query<{ bytes: string }>('SELECT coalesce(sum(size), 0)::bigint AS bytes FROM pg_ls_waldir()');
    wal = Number(found.rows[0]?.bytes ?? 0);
  } catch {
    wal = null;
  }
  const rel = await db.query<{ rel: string; bytes: string }>(
    `SELECT n.nspname || '.' || c.relname AS rel, pg_total_relation_size(c.oid)::bigint AS bytes
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('raw', 'analytics') AND c.relkind = 'r'`
  );
  return {
    database: Number(size.rows[0]?.db ?? 0),
    cluster: Number(size.rows[0]?.cluster ?? 0),
    wal,
    relations: Object.fromEntries(rel.rows.map((row) => [row.rel, Number(row.bytes)])),
  };
}

async function capture(db: Client, name: string, before: Sizes): Promise<number> {
  const after = await readSizes(db);
  const relations: Record<string, number> = {};
  for (const rel of new Set([...Object.keys(before.relations), ...Object.keys(after.relations)])) {
    const delta = (after.relations[rel] ?? 0) - (before.relations[rel] ?? 0);
    if (delta !== 0) relations[rel] = delta;
  }
  const step = {
    name,
    clusterDelta: after.cluster - before.cluster,
    databaseDelta: after.database - before.database,
    walDelta: before.wal == null || after.wal == null ? null : after.wal - before.wal,
    relations,
  };
  report.steps.push(step);
  return Math.max(step.clusterDelta, step.databaseDelta, 0);
}

async function relationCount(db: Client, tables: string[]): Promise<number> {
  const found = await db.query<{ n: string }>(
    `SELECT count(*)::int AS n
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'i')
       AND (
         n.nspname || '.' || c.relname = ANY($1::text[])
         OR c.oid IN (
           SELECT i.indexrelid
           FROM pg_index i
           JOIN pg_class t ON t.oid = i.indrelid
           JOIN pg_namespace tn ON tn.oid = t.relnamespace
           WHERE tn.nspname || '.' || t.relname = ANY($1::text[])
         )
       )`,
    [tables]
  );
  return Number(found.rows[0]?.n ?? 0);
}

function padLength(cap: number, sample: Record<string, unknown>): number {
  const room = cap - Buffer.byteLength(JSON.stringify({ ...sample, pad: '' }));
  if (room < 0) throw new Error(`cap ${cap} is smaller than the document skeleton`);
  const text = JSON.stringify({ ...sample, pad: 'x'.repeat(room) });
  if (Buffer.byteLength(text) !== cap) throw new Error(`document sized ${Buffer.byteLength(text)} for cap ${cap}`);
  return room;
}

const TEAM_PAD = padLength(NIGHTLY_MAX_TEAM_JSON_BYTES, { id: 9_999_999, full_name: 'n'.repeat(NIGHTLY_MAX_NAME) });
const PLAYER_PAD = padLength(NIGHTLY_MAX_PLAYER_JSON_BYTES, {
  id: 9_999_999,
  first_name: 'a'.repeat(NIGHTLY_MAX_NAME),
  last_name: 'b'.repeat(NIGHTLY_MAX_NAME),
});
const GAME_PAD = padLength(NIGHTLY_MAX_GAME_JSON_BYTES, { id: 9_999_999, status: 'F'.repeat(NIGHTLY_MAX_STATUS) });

async function writeNightly(db: Client, games: number, finals: number, players: number, fresh: boolean): Promise<void> {
  const idBase = fresh ? 1 : 1_000_000;
  await db.query(
    `INSERT INTO raw.games (id, date, season, status, period, time, period_detail, datetime, postseason, home_team_score, visitor_team_score, home_team, visitor_team)
     SELECT $1::int + g, DATE '2026-10-20' + ((g - 1) / $2), 2026, repeat('F', $3::int), 4, repeat('t', 8), repeat('d', $3::int), now(), false, 100, 99,
            jsonb_build_object('id', $1::int + g, 'full_name', repeat('n', $4::int), 'pad', repeat('x', $6::int)),
            jsonb_build_object('id', $1::int + g + $5::int, 'full_name', repeat('m', $4::int), 'pad', repeat('x', $6::int))
     FROM generate_series(1, $5::int) g
     ON CONFLICT (id) DO UPDATE SET home_team_score = excluded.home_team_score + 1, status = excluded.status`,
    [idBase, NIGHTLY_MAX_FINAL_GAMES, NIGHTLY_MAX_STATUS, NIGHTLY_MAX_NAME, games, TEAM_PAD]
  );
  await db.query(
    `INSERT INTO analytics.games (game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score, venue)
     SELECT ($1::int + g)::text, '2026', now(), repeat('F', $2::int), 'home', 'away', 100, 99, repeat('v', $3::int)
     FROM generate_series(1, $4::int) g
     ON CONFLICT (game_id) DO UPDATE SET home_score = excluded.home_score + 1, status = excluded.status`,
    [idBase, NIGHTLY_MAX_STATUS, NIGHTLY_MAX_VENUE, games]
  );
  if (finals === 0 || players === 0) return;
  const lines = finals * players;
  await db.query(
    `INSERT INTO raw.players (id, first_name, last_name, position, team_id)
     SELECT p, repeat('a', $1::int), repeat('b', $1::int), 'G', 1
     FROM generate_series(1, $2::int) p
     ON CONFLICT (id) DO UPDATE SET first_name = excluded.first_name`,
    [NIGHTLY_MAX_NAME, players]
  );
  await db.query(
    `INSERT INTO analytics.players (player_id, full_name, first_name, last_name, position)
     SELECT p::text, repeat('a', $1::int), repeat('a', $1::int), repeat('b', $1::int), 'G'
     FROM generate_series(1, $2::int) p
     ON CONFLICT (player_id) DO UPDATE SET full_name = excluded.full_name`,
    [NIGHTLY_MAX_NAME, players]
  );
  await db.query(
    `SELECT raw.upsert_player_game_stat(
       (($1::int + ((g - 1) / $2::int) + 1) * 1000) + ((g - 1) % $2::int),
       '48:00', 1, 2, 0.5, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1,
       ((g - 1) % $2::int) + 1, 1, $1::int + ((g - 1) / $2::int) + 1,
       jsonb_build_object('id', ((g - 1) % $2::int) + 1, 'first_name', repeat('a', $3::int), 'last_name', repeat('b', $3::int), 'pad', repeat('x', $6::int)),
       jsonb_build_object('id', ((g - 1) % $2::int) + 1, 'full_name', repeat('n', $3::int), 'pad', repeat('x', $7::int)),
       jsonb_build_object('id', $1::int + ((g - 1) / $2::int) + 1, 'status', repeat('F', $4::int), 'pad', repeat('x', $8::int))
     )
     FROM generate_series(1, $5::int) g`,
    [idBase, players, NIGHTLY_MAX_NAME, NIGHTLY_MAX_STATUS, lines, PLAYER_PAD, TEAM_PAD, GAME_PAD]
  );
  await db.query(
    `INSERT INTO analytics.player_game_logs (
       game_id, player_id, team_id, minutes, points, rebounds, offensive_rebounds, defensive_rebounds,
       assists, steals, blocks, turnovers, personal_fouls, field_goals_made, field_goals_attempted,
       three_pointers_made, three_pointers_attempted, free_throws_made, free_throws_attempted, plus_minus,
       opponent_team_id, is_home, game_date, season, pra
     )
     SELECT ($1::int + ((g - 1) / $2::int) + 1)::text, (((g - 1) % $2::int) + 1)::text, 'home', '48:00',
            2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 1, 0, 0, 1, 'away', true, DATE '2026-10-20', '2026', 2
     FROM generate_series(1, $3::int) g
     ON CONFLICT (game_id, player_id) DO UPDATE SET points = excluded.points + 1`,
    [idBase, players, lines]
  );
  await db.query(
    `INSERT INTO analytics.team_game_stats (
       team_id, game_id, season, game_date, opponent_team_id, is_home, team_points, result
     )
     SELECT CASE WHEN side = 1 THEN 'home' ELSE 'away' END, ($1::int + g)::text, '2026', DATE '2026-10-20',
            CASE WHEN side = 1 THEN 'away' ELSE 'home' END, side = 1, 100, 'W'
     FROM generate_series(1, $2::int) g
     CROSS JOIN (VALUES (1), (2)) s(side)
     ON CONFLICT (team_id, game_id) DO UPDATE SET team_points = excluded.team_points + 1`,
    [idBase, finals]
  );
  await db.query(
    `INSERT INTO analytics.team_season_averages (team_id, season, games_played, avg_points)
     VALUES ('home', '2026', $1, 100), ('away', '2026', $1, 99)
     ON CONFLICT (team_id, season) DO UPDATE SET games_played = excluded.games_played + 1`,
    [finals]
  );
  await db.query(
    `INSERT INTO analytics.player_season_averages (player_id, season, games_played, pts_avg)
     SELECT p::text, '2026', 1, 2 FROM generate_series(1, $1::int) p
     ON CONFLICT (player_id, season) DO UPDATE SET pts_avg = excluded.pts_avg + 1`,
    [players]
  );
  await db.query(
    `INSERT INTO raw.game_period_scores (game_id, season, home_periods, visitor_periods, period_count, overtime_count, reconciled, source)
     SELECT $1::int + g, 2026, ARRAY[25, 25, 25, 25], ARRAY[24, 25, 25, 25], 4, 0, true, 'bdl_games'
     FROM generate_series(1, $2::int) g
     ON CONFLICT (game_id) DO UPDATE SET reconciled = excluded.reconciled`,
    [idBase, finals]
  );
  await db.query(
    `INSERT INTO analytics.player_period_scoring (game_id, season, player_id, team_id, period, points, fgm, fg3m, ftm, game_reconciled, source)
     SELECT ($1::int + g)::text, '2026', p::text, 'home', period, 2, 1, 0, 0, true, 'bdl_plays_nightly'
     FROM generate_series(1, $2::int) g
     CROSS JOIN generate_series(1, $3::int) p
     CROSS JOIN generate_series(1, 10) period
     ON CONFLICT (game_id, player_id, period) DO UPDATE SET points = excluded.points + 1`,
    [idBase, finals, players]
  );
}

async function writeInjury(db: Client, rows: number, changed: boolean): Promise<void> {
  const status = changed ? 'Out' : 'S'.repeat(Math.min(INJURY_MAX_STATUS, 80));
  const pull = await db.query<{ id: string }>(
    `INSERT INTO raw.injury_pull_runs (pulled_at, provider, status, rows_returned, rows_stored, metadata, completed_at)
     VALUES (now(), 'balldontlie', 'success', $1, $1, jsonb_build_object('pad', repeat('m', 500)), now())
     RETURNING pull_run_id::text AS id`,
    [rows]
  );
  const pullId = pull.rows[0]?.id;
  await db.query(
    `INSERT INTO raw.player_injuries (pull_run_id, provider_player_id, provider_team_id, status, description, return_date_raw, raw_payload)
     SELECT $1::bigint, g, 1, $2::text, repeat('d', $3::int), repeat('r', $4::int),
            jsonb_build_object('player', jsonb_build_object('id', g), 'status', $2::text, 'description', repeat('d', $3::int), 'pad', repeat('p', $5::int))
     FROM generate_series(1, $6::int) g`,
    [pullId, status, INJURY_MAX_DESCRIPTION, INJURY_MAX_RETURN, 200, rows]
  );
  await db.query(
    `INSERT INTO analytics.player_injury_status_history (player_id, team_id, status, description, return_date_raw, snapshot_at, pull_run_id)
     SELECT repeat('p', $2::int - length(g::text)) || g::text, 'home', $3, repeat('d', $4::int), repeat('r', $5::int), now(), $1::bigint
     FROM generate_series(1, $6::int) g`,
    [pullId, INJURY_MAX_PLAYER_ID, status, INJURY_MAX_DESCRIPTION, INJURY_MAX_RETURN, rows]
  );
  await db.query(
    `INSERT INTO analytics.player_injury_status_current (player_id, team_id, status, description, return_date_raw, snapshot_at, pull_run_id)
     SELECT repeat('p', $2::int - length(g::text)) || g::text, 'home', $3, repeat('d', $4::int), repeat('r', $5::int), now(), $1::bigint
     FROM generate_series(1, $6::int) g
     ON CONFLICT (player_id) DO UPDATE SET status = excluded.status, description = excluded.description, pull_run_id = excluded.pull_run_id`,
    [pullId, INJURY_MAX_PLAYER_ID, status, INJURY_MAX_DESCRIPTION, INJURY_MAX_RETURN, rows]
  );
  await db.query(
    `INSERT INTO raw.injury_pull_membership (pull_run_id, provider_player_id, analytics_player_id, in_report, observed_at)
     SELECT $1::bigint, g::text, repeat('p', $2::int - length(g::text)) || g::text, true, now()
     FROM generate_series(1, $3::int) g`,
    [pullId, INJURY_MAX_PLAYER_ID, rows]
  );
}

async function replayNovember19(db: Client): Promise<void> {
  const capture = 'D:/court-context-backups/rollbacks/nightly-bdl-updater/f72-capture';
  const stats = JSON.parse(fs.readFileSync(`${capture}/stats.json`, 'utf8')) as Array<Record<string, any>>;
  const finals = (JSON.parse(fs.readFileSync(`${capture}/box-games.json`, 'utf8')) as Array<Record<string, any>>)
    .filter((game) => game.status === 'Final');
  await db.query('drop table if exists raw.player_game_stats cascade');
  await db.query('create view raw.player_game_stats as select * from raw.player_game_stats_resolved');
  const teams = new Map<number, Record<string, any>>();
  for (const stat of stats) if (stat.team?.id != null) teams.set(stat.team.id, stat.team);
  for (const game of finals) {
    if (game.home_team?.id != null) teams.set(game.home_team.id, game.home_team);
    if (game.visitor_team?.id != null) teams.set(game.visitor_team.id, game.visitor_team);
  }
  for (const team of teams.values()) {
    await db.query(
      `insert into analytics.teams (team_id, abbreviation, full_name, name)
       values ($1, $2, $3, $4) on conflict (team_id) do nothing`,
      [String(team.id), team.abbreviation, team.full_name ?? team.abbreviation, team.name ?? team.abbreviation]
    );
    await db.query(
      `insert into raw.teams (id, abbreviation, full_name, name) values ($1, $2, $3, $4) on conflict (id) do nothing`,
      [team.id, team.abbreviation, team.full_name ?? null, team.name ?? null]
    );
  }
  for (const game of finals) {
    await db.query(
      `insert into raw.games (id, date, season, status, datetime, postseason, home_team_score, visitor_team_score, home_team, visitor_team)
       values ($1, $2, $3, $4, $5, false, $6, $7, $8::jsonb, $9::jsonb)`,
      [game.id, game.date, game.season, game.status, game.datetime, game.home_team_score, game.visitor_team_score, JSON.stringify(game.home_team), JSON.stringify(game.visitor_team)]
    );
    await db.query(
      `insert into analytics.games (game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [String(game.id), String(game.season), game.datetime, game.status, String(game.home_team.id), String(game.visitor_team.id), game.home_team_score, game.visitor_team_score]
    );
  }
  for (const stat of stats) {
    await db.query(
      `select raw.upsert_player_game_stat($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26::jsonb,$27::jsonb)`,
      [stat.id, stat.min, stat.fgm, stat.fga, stat.fg_pct, stat.fg3m, stat.fg3a, stat.fg3_pct, stat.ftm, stat.fta, stat.ft_pct, stat.oreb, stat.dreb, stat.reb, stat.ast, stat.stl, stat.blk, stat.turnover, stat.pf, stat.pts, stat.plus_minus, stat.player.id, stat.team.id, stat.game.id, JSON.stringify(stat.player), JSON.stringify(stat.team), JSON.stringify(stat.game)]
    );
    const fullName = `${stat.player.first_name ?? ''} ${stat.player.last_name ?? ''}`.trim();
    await db.query(
      `insert into analytics.players (player_id, full_name, first_name, last_name, position)
       values ($1, $2, $3, $4, $5) on conflict (player_id) do nothing`,
      [String(stat.player.id), fullName || String(stat.player.id), stat.player.first_name ?? null, stat.player.last_name ?? null, stat.player.position ?? null]
    );
    const homeId = String(stat.game.home_team_id ?? stat.game.home_team?.id);
    const awayId = String(stat.game.visitor_team_id ?? stat.game.visitor_team?.id);
    const teamId = String(stat.team.id);
    await db.query(
      `insert into analytics.player_game_logs (
         game_id, player_id, team_id, minutes, points, rebounds, offensive_rebounds, defensive_rebounds,
         assists, steals, blocks, turnovers, personal_fouls, field_goals_made, field_goals_attempted,
         three_pointers_made, three_pointers_attempted, free_throws_made, free_throws_attempted, plus_minus,
         opponent_team_id, is_home, game_date, season, pra
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
       )`,
      [String(stat.game.id), String(stat.player.id), teamId, stat.min, stat.pts, stat.reb, stat.oreb, stat.dreb, stat.ast, stat.stl, stat.blk, stat.turnover, stat.pf, stat.fgm, stat.fga, stat.fg3m, stat.fg3a, stat.ftm, stat.fta, stat.plus_minus, teamId === homeId ? awayId : homeId, teamId === homeId, stat.game.date, String(stat.game.season), (stat.pts ?? 0) + (stat.reb ?? 0) + (stat.ast ?? 0)]
    );
  }
  await db.query(
    `insert into analytics.team_game_stats (team_id, game_id, season, game_date, opponent_team_id, is_home, team_points, result)
     select pgl.team_id, pgl.game_id, pgl.season, pgl.game_date, pgl.opponent_team_id, pgl.is_home, coalesce(sum(pgl.points), 0)::int,
            case when pgl.is_home and home.home_score > home.away_score then 'W'
                 when not pgl.is_home and home.away_score > home.home_score then 'W'
                 else 'L' end
     from analytics.player_game_logs pgl
     join analytics.games home on home.game_id = pgl.game_id
     group by pgl.team_id, pgl.game_id, pgl.season, pgl.game_date, pgl.opponent_team_id, pgl.is_home, home.home_score, home.away_score`
  );
  const logs = await db.query<{ n: number }>('select count(*)::int as n from analytics.player_game_logs');
  const rows = await db.query<{ n: number }>('select count(*)::int as n from raw.player_game_stats');
  const teamsWritten = await db.query<{ n: number }>('select count(*)::int as n from analytics.team_game_stats');
  if (logs.rows[0]?.n !== 140 || rows.rows[0]?.n !== 140 || teamsWritten.rows[0]?.n !== 8) {
    throw new Error(`replay counts logs=${logs.rows[0]?.n} raw=${rows.rows[0]?.n} team=${teamsWritten.rows[0]?.n}`);
  }
}

beforeAll(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  run('initdb', ['-D', path.join(ROOT, 'data'), '-U', 'lifecycle', '--auth=trust', '--no-sync', '--encoding=UTF8', '--locale=C']);
  fs.writeFileSync(
    path.join(ROOT, 'data', 'postgresql.conf'),
    `listen_addresses = '127.0.0.1'\nport = ${PORT}\nmax_connections = 20\nautovacuum = off\nshared_buffers = 32MB\n`,
  );
  run('pg_ctl', ['-D', path.join(ROOT, 'data'), '-l', path.join(ROOT, 'log'), 'start']);
  started = true;
  maintenance = client('postgres', true);
  await maintenance.connect();
  await maintenance.query('CREATE DATABASE lifecycle_s2c_nightly');
  await maintenance.query('CREATE DATABASE lifecycle_s2c_injury');
  await maintenance.query('CREATE DATABASE lifecycle_s2c_replay');
  const nightly = client('lifecycle_s2c_nightly');
  const injury = client('lifecycle_s2c_injury');
  const replay = client('lifecycle_s2c_replay');
  clients.set('nightly', nightly);
  clients.set('injury', injury);
  clients.set('replay', replay);
  await nightly.connect();
  await injury.connect();
  await replay.connect();
  await apply(nightly, [
    'analytics_schema.sql',
    'MIGRATION_analytics_games_season_phase.sql',
    'analytics_schema_migration.sql',
    'analytics_team_stats.sql',
    'analytics_team_stats_advanced.sql',
    'raw_schema.sql',
    'MIGRATION_player_game_stats_documents.sql',
    'MIGRATION_raw_game_period_scores.sql',
    'MIGRATION_player_period_scoring.sql',
  ]);
  await nightly.query(`INSERT INTO analytics.teams (team_id, abbreviation, full_name, name) VALUES ('home', 'HOM', 'Home', 'Home'), ('away', 'AWY', 'Away', 'Away')`);
  await apply(injury, [
    'analytics_schema.sql',
    'raw_injury_schema.sql',
    'analytics_injury_schema.sql',
    'MIGRATION_injury_collection_baselines.sql',
    'MIGRATION_context_collection_snapshots.sql',
  ]);
  await injury.query(`
    CREATE TABLE IF NOT EXISTS analytics.player_identity_unresolved (
      unresolved_id uuid primary key default gen_random_uuid(),
      provider text not null,
      provider_player_id text not null,
      source_context text not null,
      status text not null default 'UNRESOLVED',
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      occurrence_count integer not null default 1,
      sample_game_id text,
      sample_team_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (provider, provider_player_id, source_context)
    )`);
  await injury.query(`INSERT INTO analytics.teams (team_id, abbreviation, full_name, name) VALUES ('home', 'HOM', 'Home', 'Home')`);
  await injury.query(
    `INSERT INTO analytics.players (player_id, full_name)
     SELECT repeat('p', $1::int - length(g::text)) || g::text, 'Player ' || g
     FROM generate_series(1, $2::int) g`,
    [INJURY_MAX_PLAYER_ID, INJURY_MAX_ROWS]
  );
  const nightlyTables = [
    'raw.games', 'raw.game_period_scores', 'raw.player_game_stat_document', 'raw.player_game_stats_row', 'raw.players',
    'analytics.players', 'analytics.games', 'analytics.player_game_logs', 'analytics.team_game_stats',
    'analytics.team_season_averages', 'analytics.player_season_averages', 'analytics.player_period_scoring',
  ];
  const injuryTables = [
    'raw.injury_pull_runs', 'raw.player_injuries', 'raw.injury_pull_membership', 'raw.injury_collection_baselines',
    'analytics.player_injury_status_current', 'analytics.player_injury_status_history', 'analytics.player_identity_unresolved',
  ];
  report.nightlyRelations = await relationCount(nightly, nightlyTables);
  report.injuryRelations = await relationCount(injury, injuryTables);

  let before = await readSizes(nightly);
  await writeNightly(nightly, 1, 1, 2, true);
  report.nightlyWorst = Math.max(report.nightlyWorst, await capture(nightly, 'nightly-small', before));
  before = await readSizes(nightly);
  await writeNightly(nightly, 15, 8, 10, false);
  report.nightlyWorst = Math.max(report.nightlyWorst, await capture(nightly, 'nightly-normal', before));
  before = await readSizes(nightly);
  const legalPlayers = Math.floor(NIGHTLY_MAX_STAT_LINES / NIGHTLY_MAX_FINAL_GAMES);
  await writeNightly(nightly, NIGHTLY_MAX_SCHEDULE_GAMES, NIGHTLY_MAX_FINAL_GAMES, legalPlayers, true);
  report.nightlyWorst = Math.max(report.nightlyWorst, await capture(nightly, 'nightly-max-new', before));
  before = await readSizes(nightly);
  await writeNightly(nightly, NIGHTLY_MAX_SCHEDULE_GAMES, NIGHTLY_MAX_FINAL_GAMES, legalPlayers, true);
  report.nightlyWorst = Math.max(report.nightlyWorst, await capture(nightly, 'nightly-max-update', before));
  before = await readSizes(nightly);
  await nightly.query('BEGIN');
  await nightly.query(`INSERT INTO raw.games (id, date, season, status) VALUES (2147000001, DATE '2026-10-20', 2026, 'Final')`);
  await nightly.query('ROLLBACK');
  report.nightlyWorst = Math.max(report.nightlyWorst, await capture(nightly, 'nightly-rollback', before));

  before = await readSizes(injury);
  await writeInjury(injury, 2, false);
  report.injuryWorst = Math.max(report.injuryWorst, await capture(injury, 'injury-small', before));
  before = await readSizes(injury);
  await writeInjury(injury, 50, false);
  report.injuryWorst = Math.max(report.injuryWorst, await capture(injury, 'injury-normal', before));
  before = await readSizes(injury);
  await writeInjury(injury, INJURY_MAX_ROWS, false);
  report.injuryWorst = Math.max(report.injuryWorst, await capture(injury, 'injury-max-new', before));
  before = await readSizes(injury);
  await writeInjury(injury, INJURY_MAX_ROWS, true);
  report.injuryWorst = Math.max(report.injuryWorst, await capture(injury, 'injury-max-update', before));
  before = await readSizes(injury);
  await injury.query('BEGIN');
  await injury.query(`INSERT INTO raw.injury_pull_runs (provider, status) VALUES ('balldontlie', 'started')`);
  await injury.query('ROLLBACK');
  report.injuryWorst = Math.max(report.injuryWorst, await capture(injury, 'injury-rollback', before));
  const payload = await injury.query<{ bytes: string }>(
    `SELECT octet_length(raw_payload::text) AS bytes FROM raw.player_injuries ORDER BY snapshot_id DESC LIMIT 1`
  );
  if (Number(payload.rows[0]?.bytes ?? 0) > INJURY_MAX_PAYLOAD_BYTES) {
    throw new Error('injury fixture payload exceeds the enforced cap');
  }
  await apply(replay, [
    'analytics_schema.sql',
    'MIGRATION_analytics_games_season_phase.sql',
    'analytics_schema_migration.sql',
    'analytics_team_stats.sql',
    'analytics_team_stats_advanced.sql',
    'raw_schema.sql',
    'MIGRATION_player_game_stats_documents.sql',
    'MIGRATION_raw_game_period_scores.sql',
    'MIGRATION_player_period_scoring.sql',
  ]);
  await replayNovember19(replay);
  console.log(JSON.stringify({ ...report, nightlyBound: conservativePhysicalBound(report.nightlyWorst, report.nightlyRelations), injuryBound: conservativePhysicalBound(report.injuryWorst, report.injuryRelations) }));
}, 180_000);

afterAll(async () => {
  for (const db of clients.values()) await db.end().catch(() => undefined);
  await maintenance?.end().catch(() => undefined);
  if (started) run('pg_ctl', ['-D', path.join(ROOT, 'data'), 'stop', '-m', 'fast']);
});

describe('disposable PostgreSQL 17 nightly and injury growth', () => {
  it('locks the nightly reservation to the measured worst cluster growth', () => {
    expect(report.nightlyWorst).toBeGreaterThan(0);
    expect(Math.floor(NIGHTLY_MAX_STAT_LINES / NIGHTLY_MAX_FINAL_GAMES)).toBeLessThanOrEqual(NIGHTLY_MAX_PLAYERS_PER_GAME);
    expect(NIGHTLY_MEASURED_WORST_BYTES).toBe(report.nightlyWorst);
    expect(NIGHTLY_MEASURED_RELATION_COUNT).toBe(report.nightlyRelations);
    expect(NIGHTLY_PHYSICAL_GROWTH_BOUND_BYTES).toBe(conservativePhysicalBound(report.nightlyWorst, report.nightlyRelations));
    expect(NIGHTLY_PHYSICAL_GROWTH_BOUND_BYTES).toBe(4_718_592);
    expect(report.steps.find((step) => step.name === 'nightly-rollback')?.clusterDelta).toBe(0);
  });

  it('locks the injury reservation to the measured worst cluster growth', () => {
    expect(report.injuryWorst).toBeGreaterThan(0);
    expect(INJURY_MEASURED_WORST_BYTES).toBe(report.injuryWorst);
    expect(INJURY_MEASURED_RELATION_COUNT).toBe(report.injuryRelations);
    expect(INJURY_PHYSICAL_GROWTH_BOUND_BYTES).toBe(conservativePhysicalBound(report.injuryWorst, report.injuryRelations));
    expect(report.steps.find((step) => step.name === 'injury-rollback')?.clusterDelta).toBe(0);
  });
});
