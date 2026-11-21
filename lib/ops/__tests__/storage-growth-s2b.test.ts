import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryStorageReservationStore, admitPersistentWrite } from '@/lib/ops/storage-admission';
import {
  GAME_STATUS_MAX_GAMES,
  GAME_STATUS_MAX_LEDGER_ROWS,
  GAME_STATUS_MAX_SEASON,
  GAME_STATUS_MAX_STATUS,
  GAME_STATUS_MAX_VENUE,
  GAME_STATUS_MEASURED_RELATION_COUNT,
  GAME_STATUS_MEASURED_WORST_BYTES,
  GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES,
  LEDGER_MAX_ERROR,
  LEDGER_MAX_ID,
  LEDGER_MAX_KEY,
  LEDGER_MAX_PATH,
  LEDGER_MAX_SCOPE_ID,
  SCOREBOARD_MAX_CLOCK,
  SCOREBOARD_MAX_GAMES_PER_SEASON_TYPE,
  SCOREBOARD_MAX_LEDGER_ROWS,
  SCOREBOARD_MAX_NAME,
  SCOREBOARD_MAX_ODDS_ROWS,
  SCOREBOARD_MAX_PLAYERS_PER_GAME,
  SCOREBOARD_MAX_SEASON_TYPES,
  SCOREBOARD_MAX_STATUS,
  SCOREBOARD_MEASURED_RELATION_COUNT,
  SCOREBOARD_MEASURED_WORST_BYTES,
  SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
  conservativePhysicalBound,
  observedGrowthVerdict,
} from '@/lib/ops/storage-growth-bounds';

const BIN = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const PORT = 54347;
const ROOT = path.join(os.tmpdir(), 'cc-s2b-growth');
const SCHEMAS = path.resolve(__dirname, '../../../db/schemas');

type Sizes = {
  database: number;
  cluster: number;
  wal: number | null;
  relations: Record<string, number>;
};

type Step = {
  name: string;
  clusterDelta: number;
  databaseDelta: number;
  walDelta: number | null;
  relations: Record<string, number>;
};

const report: {
  steps: Step[];
  scoreboardWorst: number;
  gameStatusWorst: number;
  scoreboardRelations: number;
  gameStatusRelations: number;
  relationNames: { scoreboard: string[]; gameStatus: string[] };
  samples: Record<string, Sizes>;
} = {
  steps: [],
  scoreboardWorst: 0,
  gameStatusWorst: 0,
  scoreboardRelations: 0,
  gameStatusRelations: 0,
  relationNames: { scoreboard: [], gameStatus: [] },
  samples: {},
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
    application_name: 's2b-growth',
  });
}

async function applySchema(db: Client): Promise<void> {
  await db.query("DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
  await db.query("DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
  await db.query('CREATE SCHEMA IF NOT EXISTS raw');
  for (const file of [
    'analytics_schema.sql',
    'MIGRATION_analytics_games_season_phase.sql',
    'MIGRATION_acquisition_requests.sql',
    'MIGRATION_display_scoreboard.sql',
    'MIGRATION_display_scoreboard_odds.sql',
  ]) {
    await db.query(fs.readFileSync(path.join(SCHEMAS, file), 'utf8'));
  }
  await db.query(`
    INSERT INTO analytics.teams (team_id, abbreviation, full_name, name)
    VALUES (repeat('h', 32), 'HOM', repeat('n', 80), 'Home'), (repeat('a', 32), 'AWY', repeat('n', 80), 'Away')
  `);
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
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('raw', 'display', 'analytics') AND c.relkind = 'r'
     ORDER BY 1`
  );
  return {
    database: Number(size.rows[0]?.db ?? 0),
    cluster: Number(size.rows[0]?.cluster ?? 0),
    wal,
    relations: Object.fromEntries(rel.rows.map((row) => [row.rel, Number(row.bytes)])),
  };
}

async function capture(db: Client, name: string, before: Sizes): Promise<Sizes> {
  const after = await readSizes(db);
  const relations: Record<string, number> = {};
  for (const rel of new Set([...Object.keys(before.relations), ...Object.keys(after.relations)])) {
    const delta = (after.relations[rel] ?? 0) - (before.relations[rel] ?? 0);
    if (delta !== 0) relations[rel] = delta;
  }
  report.steps.push({
    name,
    clusterDelta: after.cluster - before.cluster,
    databaseDelta: after.database - before.database,
    walDelta: before.wal == null || after.wal == null ? null : after.wal - before.wal,
    relations,
  });
  report.samples[name] = after;
  return after;
}

function grew(step: Step): number {
  return Math.max(step.clusterDelta, step.databaseDelta, 0);
}

async function relationNames(db: Client): Promise<{ scoreboard: string[]; gameStatus: string[] }> {
  const found = await db.query<{ schema: string; name: string }>(
    `SELECT n.nspname AS schema, c.relname AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'i') AND n.nspname IN ('raw', 'display', 'analytics')
     ORDER BY 1, 2`
  );
  const scoreboard: string[] = [];
  const gameStatus: string[] = [];
  for (const row of found.rows) {
    const id = `${row.schema}.${row.name}`;
    if (row.schema === 'raw' && row.name.startsWith('acquisition_requests')) {
      scoreboard.push(id);
      gameStatus.push(id);
    } else if (row.schema === 'display' && (row.name.startsWith('scoreboard') || row.name.startsWith('display_scoreboard'))) {
      scoreboard.push(id);
    } else if (row.schema === 'analytics' && row.name.includes('games') && !row.name.includes('player')) {
      gameStatus.push(id);
    }
  }
  return { scoreboard, gameStatus };
}

function idPrefix(mark: string): string {
  return `${mark}${'r'.repeat(LEDGER_MAX_ID - mark.length - 8)}`;
}

async function insertLedger(db: Client, prefix: string, rows: number): Promise<void> {
  await db.query(
    `INSERT INTO raw.acquisition_requests (
       request_id, pull_run_id, provider, league, endpoint_family, endpoint_path,
       scope_kind, scope_id, season, season_type_requested, page_index, attempt,
       request_started_at, response_received_at, body_completed_at,
       http_status, body_sha256, body_bytes, archive_status, collector_name, collector_version
     )
     SELECT $1 || lpad(g::text, 8, '0'), $2, 'balldontlie', 'nba', 'scoreboard_games', repeat('p', $3::int),
            'date', repeat('s', $4::int), 2026, 'preseason', (g - 1) % 10000, ((g - 1) % 4) + 1,
            now(), now(), now(), 200, repeat('a', 64), 1000, 'pending', 'scoreboard', 'v1'
     FROM generate_series(1, $5::int) g`,
    [prefix, 'u'.repeat(LEDGER_MAX_ID), LEDGER_MAX_PATH, LEDGER_MAX_SCOPE_ID, rows]
  );
  await db.query(
    `UPDATE raw.acquisition_requests
     SET archive_status = 'archived',
         s3_key = rpad('raw/entity=acq_games/' || request_id, $2::int, 'k'),
         envelope_sha256 = repeat('b', 64),
         archived_at = now(),
         archive_error = repeat('e', $3::int)
     WHERE request_id LIKE $1 || '%'`,
    [prefix, LEDGER_MAX_KEY, LEDGER_MAX_ERROR]
  );
  await db.query(
    `UPDATE raw.acquisition_requests
     SET parse_ok = false, parse_error = repeat('z', $2::int)
     WHERE request_id LIKE $1 || '%'`,
    [prefix, LEDGER_MAX_ERROR]
  );
}

async function writeScoreboard(
  db: Client,
  spec: { prefix: string; games: number; players: number; ledgerRows: number; odds: boolean }
): Promise<void> {
  if (spec.ledgerRows > 0) await insertLedger(db, idPrefix(spec.prefix), spec.ledgerRows);
  if (spec.games > 0) {
    await db.query(
      `INSERT INTO display.scoreboard_games (
         game_id, season, season_type, season_type_source, et_date, scheduled_tip,
         home_team_id, home_abbr, home_name, home_score,
         visitor_team_id, visitor_abbr, visitor_name, visitor_score,
         provider_status, provider_status_state, period, clock, overtime_periods,
         lifecycle, games_request_id, first_observed_at, last_observed_at, last_changed_at,
         polling_state, box_completeness
       )
       SELECT $1 || lpad(g::text, 8, '0'), 2026,
              CASE WHEN g <= $2::int THEN 'preseason' ELSE 'regular' END,
              'request_season_type', DATE '2026-10-10', now(),
              repeat('h', 32), repeat('a', 16), repeat('n', $3::int), 10,
              repeat('w', 32), repeat('b', 16), repeat('m', $3::int), 9,
              repeat('t', $4::int), repeat('u', $4::int), 1, repeat('c', $5::int), 0,
              'live',
              (SELECT request_id FROM raw.acquisition_requests WHERE request_id LIKE $6 || '%' ORDER BY request_id LIMIT 1),
              now(), now(), now(), 'active', 'none'
       FROM generate_series(1, $7::int) g`,
      [
        spec.prefix,
        Math.ceil(spec.games / 2),
        SCOREBOARD_MAX_NAME,
        SCOREBOARD_MAX_STATUS,
        SCOREBOARD_MAX_CLOCK,
        idPrefix(spec.prefix),
        spec.games,
      ]
    );
  }
  if (spec.players > 0) {
    await db.query(
      `INSERT INTO display.scoreboard_player_lines (
         game_id, player_id, team_id, name, min, pts, reb, ast, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb
       )
       SELECT game_id, 'p' || lpad(s::text, 2, '0'), repeat('h', 32), repeat('n', $2::int), repeat('m', $3::int),
              1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
       FROM display.scoreboard_games
       CROSS JOIN generate_series(1, $4::int) s
       WHERE game_id LIKE $1 || '%'`,
      [spec.prefix, SCOREBOARD_MAX_NAME, SCOREBOARD_MAX_CLOCK, spec.players]
    );
  }
  await db.query(
    `INSERT INTO display.scoreboard_collector_state (season_type, last_games_request_at, last_games_request_id)
     VALUES ('preseason', now(), (SELECT request_id FROM raw.acquisition_requests WHERE request_id LIKE $1 || '%' ORDER BY request_id LIMIT 1))
     ON CONFLICT (season_type) DO UPDATE SET last_games_request_at = excluded.last_games_request_at, updated_at = now()`,
    [idPrefix(spec.prefix)]
  );
  if (spec.odds) {
    await db.query(
      `INSERT INTO display.scoreboard_game_odds (
         game_id, vendor, quote_kind, moneyline_home, moneyline_away, first_observed_at, observed_at, request_id
       )
       SELECT g.game_id, repeat('v', 39) || d::text, 'current', -110, -110, now(), now(),
              (SELECT request_id FROM raw.acquisition_requests WHERE request_id LIKE $2 || '%' ORDER BY request_id LIMIT 1)
       FROM (
         SELECT game_id FROM display.scoreboard_games WHERE game_id LIKE $1 || '%' ORDER BY game_id LIMIT 30
       ) g
       CROSS JOIN generate_series(0, 9) d`,
      [spec.prefix, idPrefix(spec.prefix)]
    );
    await db.query(
      `INSERT INTO display.scoreboard_odds_state (scope, last_attempt_at, last_outcome, last_error)
       VALUES ('current', now(), 'failed', repeat('e', $1::int))
       ON CONFLICT (scope) DO UPDATE SET last_error = excluded.last_error, updated_at = now()`,
      [LEDGER_MAX_ERROR]
    );
  }
}

async function writeGameStatus(db: Client, spec: { prefix: string; games: number; ledgerRows: number }): Promise<void> {
  if (spec.ledgerRows > 0) await insertLedger(db, idPrefix(spec.prefix), spec.ledgerRows);
  await db.query(
    `INSERT INTO analytics.games (
       game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score, venue
     )
     SELECT $1 || lpad(g::text, 8, '0'), repeat('s', $2::int), now(), repeat('t', $3::int),
            repeat('h', 32), repeat('a', 32), 100, 99, repeat('v', $4::int)
     FROM generate_series(1, $5::int) g`,
    [spec.prefix, GAME_STATUS_MAX_SEASON, GAME_STATUS_MAX_STATUS, GAME_STATUS_MAX_VENUE, spec.games]
  );
  await db.query(
    `UPDATE analytics.games
     SET season_phase = 'REGULAR', season_phase_source = 'request_season_type'
     WHERE game_id LIKE $1 || '%' AND season_phase = 'UNCLASSIFIED'`,
    [spec.prefix]
  );
}

async function openDatabase(name: string): Promise<Client> {
  assertTarget(name);
  await maintenance!.query(`CREATE DATABASE ${name}`);
  const db = client(name);
  await db.connect();
  clients.set(name, db);
  await applySchema(db);
  return db;
}

describe('disposable PostgreSQL 17 physical growth', () => {
  beforeAll(async () => {
    if (!fs.existsSync(path.join(BIN, 'initdb.exe'))) throw new Error('BLOCKED: PostgreSQL 17 initdb is not installed');
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    const data = path.join(ROOT, 'data');
    run('initdb.exe', ['-D', data, '-U', 'lifecycle', '-A', 'trust', '--no-sync', '--encoding=UTF8', '--locale=C']);
    fs.appendFileSync(
      path.join(data, 'postgresql.conf'),
      `\nlisten_addresses = '127.0.0.1'\nport = ${PORT}\nautovacuum = off\n`
    );
    run('pg_ctl.exe', ['start', '-D', data, '-l', path.join(ROOT, 'server.log'), '-w']);
    started = true;
    maintenance = client('postgres', true);
    await maintenance.connect();

    const small = await openDatabase('lifecycle_s2b_small');
    let mark = await readSizes(small);
    await writeScoreboard(small, { prefix: 's', games: 1, players: 2, ledgerRows: 1, odds: false });
    mark = await capture(small, 'scoreboard-small', mark);
    await writeGameStatus(small, { prefix: 't', games: 1, ledgerRows: 1 });
    await capture(small, 'game-status-small', mark);

    const normal = await openDatabase('lifecycle_s2b_normal');
    mark = await readSizes(normal);
    await writeScoreboard(normal, { prefix: 'n', games: 15, players: 10, ledgerRows: 4, odds: true });
    mark = await capture(normal, 'scoreboard-normal', mark);
    await writeGameStatus(normal, { prefix: 'm', games: 15, ledgerRows: 4 });
    await capture(normal, 'game-status-normal', mark);

    const max = await openDatabase('lifecycle_s2b_max');
    report.relationNames = await relationNames(max);
    report.scoreboardRelations = report.relationNames.scoreboard.length;
    report.gameStatusRelations = report.relationNames.gameStatus.length;
    mark = await readSizes(max);
    const games = SCOREBOARD_MAX_SEASON_TYPES * SCOREBOARD_MAX_GAMES_PER_SEASON_TYPE;
    await writeScoreboard(max, {
      prefix: 'a',
      games,
      players: SCOREBOARD_MAX_PLAYERS_PER_GAME,
      ledgerRows: SCOREBOARD_MAX_LEDGER_ROWS,
      odds: true,
    });
    mark = await capture(max, 'scoreboard-max-new', mark);
    await max.query(`UPDATE display.scoreboard_player_lines SET name = repeat('q', $1::int) WHERE game_id LIKE 'a%'`, [
      SCOREBOARD_MAX_NAME,
    ]);
    await max.query(
      `UPDATE display.scoreboard_games
       SET home_name = repeat('q', $1::int), visitor_name = repeat('q', $1::int), provider_status = repeat('u', $2::int)
       WHERE game_id LIKE 'a%'`,
      [SCOREBOARD_MAX_NAME, SCOREBOARD_MAX_STATUS]
    );
    mark = await capture(max, 'scoreboard-max-update', mark);
    await writeScoreboard(max, {
      prefix: 'b',
      games,
      players: SCOREBOARD_MAX_PLAYERS_PER_GAME,
      ledgerRows: SCOREBOARD_MAX_LEDGER_ROWS,
      odds: true,
    });
    mark = await capture(max, 'scoreboard-max-second', mark);
    await max.query('BEGIN');
    await max.query(
      `INSERT INTO display.scoreboard_games (
         game_id, season, season_type, season_type_source, et_date,
         home_team_id, visitor_team_id, lifecycle, games_request_id,
         first_observed_at, last_observed_at, last_changed_at, polling_state
       ) VALUES (
         'rollback-game', 2026, 'preseason', 'request_season_type', DATE '2026-10-10',
         repeat('h', 32), repeat('a', 32), 'scheduled',
         (SELECT request_id FROM raw.acquisition_requests LIMIT 1),
         now(), now(), now(), 'pending'
       )`
    );
    await max.query('ROLLBACK');
    mark = await capture(max, 'scoreboard-rollback', mark);

    await writeGameStatus(max, { prefix: 'c', games: GAME_STATUS_MAX_GAMES, ledgerRows: GAME_STATUS_MAX_LEDGER_ROWS });
    mark = await capture(max, 'game-status-max-new', mark);
    await max.query(
      `UPDATE analytics.games
       SET status = repeat('u', $1::int), venue = repeat('w', $2::int), updated_at = now()
       WHERE game_id LIKE 'c%'`,
      [GAME_STATUS_MAX_STATUS, GAME_STATUS_MAX_VENUE]
    );
    mark = await capture(max, 'game-status-max-update', mark);
    await writeGameStatus(max, { prefix: 'd', games: GAME_STATUS_MAX_GAMES, ledgerRows: GAME_STATUS_MAX_LEDGER_ROWS });
    mark = await capture(max, 'game-status-max-second', mark);
    await max.query('BEGIN');
    await max.query(
      `INSERT INTO analytics.games (game_id, season, status, home_team_id, away_team_id, venue)
       VALUES ('rollback-status', '2026', 'Scheduled', repeat('h', 32), repeat('a', 32), 'venue')`
    );
    await max.query('ROLLBACK');
    await capture(max, 'game-status-rollback', mark);

    const scoreboardNames = ['scoreboard-small', 'scoreboard-normal', 'scoreboard-max-new', 'scoreboard-max-update', 'scoreboard-max-second', 'scoreboard-rollback'];
    const statusNames = ['game-status-small', 'game-status-normal', 'game-status-max-new', 'game-status-max-update', 'game-status-max-second', 'game-status-rollback'];
    report.scoreboardWorst = Math.max(...report.steps.filter((step) => scoreboardNames.includes(step.name)).map(grew));
    report.gameStatusWorst = Math.max(...report.steps.filter((step) => statusNames.includes(step.name)).map(grew));
    fs.writeFileSync(path.join(ROOT, 'growth.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      scoreboardWorst: report.scoreboardWorst,
      scoreboardRelations: report.scoreboardRelations,
      scoreboardBound: conservativePhysicalBound(report.scoreboardWorst, report.scoreboardRelations),
      gameStatusWorst: report.gameStatusWorst,
      gameStatusRelations: report.gameStatusRelations,
      gameStatusBound: conservativePhysicalBound(report.gameStatusWorst, report.gameStatusRelations),
      steps: report.steps,
    }));
  }, 300_000);

  afterAll(async () => {
    for (const db of clients.values()) await db.end().catch(() => undefined);
    await maintenance?.end().catch(() => undefined);
    if (started) {
      spawnSync(path.join(BIN, 'pg_ctl.exe'), ['stop', '-D', path.join(ROOT, 'data'), '-m', 'fast', '-w'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
  }, 60_000);

  it('locks the scoreboard reservation to the measured worst cluster growth', () => {
    expect(report.scoreboardRelations).toBeGreaterThan(1);
    expect(report.scoreboardWorst).toBe(SCOREBOARD_MEASURED_WORST_BYTES);
    expect(report.scoreboardRelations).toBe(SCOREBOARD_MEASURED_RELATION_COUNT);
    expect(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES).toBe(
      conservativePhysicalBound(report.scoreboardWorst, report.scoreboardRelations)
    );
    expect(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES).toBeGreaterThanOrEqual(report.scoreboardWorst * 2);
  });

  it('locks the game-status reservation to the measured worst cluster growth', () => {
    expect(report.gameStatusRelations).toBeGreaterThan(1);
    expect(report.gameStatusWorst).toBe(GAME_STATUS_MEASURED_WORST_BYTES);
    expect(report.gameStatusRelations).toBe(GAME_STATUS_MEASURED_RELATION_COUNT);
    expect(GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES).toBe(
      conservativePhysicalBound(report.gameStatusWorst, report.gameStatusRelations)
    );
    expect(GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES).toBeGreaterThanOrEqual(report.gameStatusWorst * 2);
  });

  it('does not treat a rolled-back write as committed growth beyond the measured worst', () => {
    const rolled = report.steps.filter((step) => step.name.endsWith('rollback'));
    expect(rolled).toHaveLength(2);
    for (const step of rolled) expect(grew(step)).toBeLessThanOrEqual(Math.max(report.scoreboardWorst, report.gameStatusWorst));
  });

  it('refuses recovery that is not proven, and a proven recovery does not write', async () => {
    const db = clients.get('lifecycle_s2b_small');
    if (!db) throw new Error('small database was not opened');
    const count = async () => {
      const result = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM display.scoreboard_games');
      return result.rows[0]?.n ?? -1;
    };
    const before = await count();
    const store = new MemoryStorageReservationStore();
    const admitted = await admitPersistentWrite({
      writerId: 'scoreboard-collector',
      kind: 'scoreboard',
      invocationId: 'crash-before',
      now: '2026-11-19T16:00:00.000Z',
      measurement: {
        clusterBytes: 1_000_000,
        measuredAt: '2026-11-19T15:30:00.000Z',
        source: 'local-test',
        valid: true,
        complete: true,
      },
      physicalGrowthBoundBytes: 1_000,
      tables: ['display.scoreboard_games'],
      reservations: store,
    });
    expect(admitted.allowed).toBe(true);
    await store.noteWriteIntent({
      invocationId: 'crash-before',
      writerId: 'scoreboard-collector',
      boundBytes: 1_000,
      intentAt: '2026-11-19T16:00:00.000Z',
      inWrite: true,
    });
    const active = await store.releaseStranded({
      now: '2026-11-19T16:10:00.000Z',
      invocationId: 'crash-before',
      writerId: 'scoreboard-collector',
      boundBytes: 1_000,
      expectedVersion: store.ledgerVersion(),
      inactiveAt: '2026-11-19T16:05:00.000Z',
      confirmSessionEnded: false,
      processTimedOut: true,
      measurement: {
        clusterBytes: 1_000_000,
        measuredAt: '2026-11-19T16:07:00.000Z',
        source: 'local-test',
        valid: true,
        complete: true,
      },
      databaseSnapshotAt: '2026-11-19T16:06:00.000Z',
    });
    expect(active.ok).toBe(false);
    expect(await count()).toBe(before);

    await db.query(
      `INSERT INTO display.scoreboard_games (
         game_id, season, season_type, season_type_source, et_date,
         home_team_id, visitor_team_id, lifecycle, games_request_id,
         first_observed_at, last_observed_at, last_changed_at, polling_state
       )
       SELECT 'partial-' || g, 2026, 'preseason', 'request_season_type', DATE '2026-10-10',
              repeat('h', 32), repeat('a', 32), 'scheduled',
              (SELECT request_id FROM raw.acquisition_requests LIMIT 1),
              now(), now(), now(), 'pending'
       FROM generate_series(1, 3) g`
    );
    const partial = await count();
    expect(partial).toBe(before + 3);
    const released = await store.releaseStranded({
      now: '2026-11-19T16:10:00.000Z',
      invocationId: 'crash-before',
      writerId: 'scoreboard-collector',
      boundBytes: 1_000,
      expectedVersion: store.ledgerVersion(),
      inactiveAt: '2026-11-19T16:05:00.000Z',
      confirmSessionEnded: true,
      measurement: {
        clusterBytes: report.samples['scoreboard-small']?.cluster ?? 1_000_000,
        measuredAt: '2026-11-19T16:07:00.000Z',
        source: 'disposable-postgresql-17',
        valid: true,
        complete: true,
      },
      databaseSnapshotAt: '2026-11-19T16:06:00.000Z',
    });
    expect(released.ok).toBe(true);
    expect(await count()).toBe(partial);
    const verdict = observedGrowthVerdict(
      0,
      report.scoreboardWorst + SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES + 1,
      SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(await count()).toBe(partial);
    }
  });

  it('keeps the odds row cap used by the measurement', () => {
    expect(SCOREBOARD_MAX_ODDS_ROWS).toBe(300);
  });
});
