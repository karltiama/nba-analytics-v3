import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ScoreboardPlayerLine, StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { createPgScoreboardStore } from '@/lib/scoreboard/store';

const root = path.resolve(__dirname, '../../..');

function findPgBin(): string | null {
  const fromEnv = process.env.PG_BIN;
  const names = process.platform === 'win32' ? 'initdb.exe' : 'initdb';
  if (fromEnv && fs.existsSync(path.join(fromEnv, names))) return fromEnv;
  for (const candidate of [
    'C:\\Program Files\\PostgreSQL\\17\\bin',
    'C:\\Program Files\\PostgreSQL\\16\\bin',
  ]) {
    if (fs.existsSync(path.join(candidate, names))) return candidate;
  }
  return null;
}

const pgBin = findPgBin();
const describeDb = pgBin ? describe : describe.skip;

function exe(name: string): string {
  return path.join(pgBin!, process.platform === 'win32' ? `${name}.exe` : name);
}

const dataDir = path.join(root, 'tmp', 'scoreboard-ordering-pg');
const logFile = path.join(root, 'tmp', 'scoreboard-ordering-pg.log');
const port = 55441;

function game(at: string, over: Partial<StoredScoreboardGame> = {}): StoredScoreboardGame {
  return {
    gameId: '21826156',
    season: 2026,
    seasonType: 'preseason',
    seasonTypeSource: 'request_season_type',
    etDate: '2026-10-09',
    scheduledTip: '2026-10-10T00:00:00.000Z',
    homeTeamId: 'chi',
    homeAbbr: 'CHI',
    homeName: null,
    homeScore: 0,
    visitorTeamId: 'mem',
    visitorAbbr: 'MEM',
    visitorName: null,
    visitorScore: 0,
    providerStatus: null,
    providerStatusState: null,
    period: 1,
    clock: 'Q1 9:00',
    overtimePeriods: 0,
    lifecycle: 'live',
    gamesRequestId: 'req-order',
    firstObservedAt: at,
    lastObservedAt: at,
    lastChangedAt: at,
    terminalConfirmations: 0,
    finalObservedAt: null,
    pollingState: 'active',
    boxCompleteness: 'none',
    boxRequestId: null,
    boxObservedAt: null,
    finalBoxAttempts: 0,
    ...over,
  };
}

function line(pts: number): ScoreboardPlayerLine {
  return {
    gameId: '21826156',
    playerId: 'p1',
    teamId: 'mem',
    name: 'Player',
    min: '4',
    pts,
    reb: 1,
    ast: 0,
    fgm: 1,
    fga: 2,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 1,
  };
}

describeDb('scoreboard writes keep the newest collection on Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    execFileSync(exe('initdb'), ['-D', dataDir, '-U', 'scoreboard', '-A', 'trust', '--no-sync'], { stdio: 'pipe' });
    const quiet = { stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
    // pg_ctl's postmaster inherits stdio. A piped stdout never closes, so spawnSync would wait forever.
    execFileSync(exe('pg_ctl'), ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'], { stdio: 'ignore' });
    const psql = exe('psql');
    const base = ['-h', '127.0.0.1', '-p', String(port), '-U', 'scoreboard', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    const setup = path.join(root, 'tmp', 'scoreboard-ordering-setup.sql');
    fs.writeFileSync(
      setup,
      `create role anon nologin;
       create role authenticated nologin;
       create schema raw;
       create table raw.acquisition_requests (request_id text primary key);
       insert into raw.acquisition_requests (request_id) values ('req-order');`
    );
    execFileSync(psql, [...base, '-f', setup], quiet);
    execFileSync(psql, [...base, '-f', path.join(root, 'db/schemas/MIGRATION_display_scoreboard.sql')], quiet);
    pool = new Pool({ host: '127.0.0.1', port, user: 'scoreboard', database: 'postgres', max: 4 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (pgBin && fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
      execFileSync(exe('pg_ctl'), ['-D', dataDir, 'stop'], { stdio: 'pipe' });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query('delete from display.scoreboard_player_lines');
    await pool.query('delete from display.scoreboard_games');
    await pool.query('delete from display.scoreboard_collector_state');
  });

  async function snapshot() {
    const games = await pool.query(
      `select home_score, visitor_score, lifecycle, terminal_confirmations, box_completeness, last_observed_at
       from display.scoreboard_games where game_id = '21826156'`
    );
    const lines = await pool.query(
      `select player_id, pts from display.scoreboard_player_lines where game_id = '21826156' order by player_id`
    );
    return { games: games.rows, lines: lines.rows };
  }

  it('applies sequential score updates and keeps one row', async () => {
    const store = createPgScoreboardStore(pool);
    expect(await store.applyObservation(game('2026-10-10T00:17:00.000Z', { homeScore: 2 }), null)).toBe(true);
    expect(await store.applyObservation(game('2026-10-10T00:22:00.000Z', { homeScore: 8 }), null)).toBe(true);
    const snap = await snapshot();
    expect(snap.games).toHaveLength(1);
    expect(snap.games[0]).toMatchObject({ home_score: 8, lifecycle: 'live' });
  });

  it('rejects an older observation that finishes after a newer one', async () => {
    const store = createPgScoreboardStore(pool);
    await store.applyObservation(game('2026-10-10T00:22:00.000Z', { homeScore: 15, visitorScore: 6 }), null);
    expect(await store.applyObservation(game('2026-10-10T00:17:00.000Z', { homeScore: 10, visitorScore: 2 }), null)).toBe(false);
    expect((await snapshot()).games[0]).toMatchObject({ home_score: 15, visitor_score: 6 });
  });

  it('treats a repeated acquisition as the same row', async () => {
    const store = createPgScoreboardStore(pool);
    const row = game('2026-10-10T00:17:00.000Z', { homeScore: 10, visitorScore: 2 });
    expect(await store.applyObservation(row, [line(10)])).toBe(true);
    expect(await store.applyObservation(row, [line(10)])).toBe(true);
    const snap = await snapshot();
    expect(snap.games).toHaveLength(1);
    expect(snap.lines).toEqual([{ player_id: 'p1', pts: 10 }]);
  });

  it('does not let an older live snapshot regress a final game or its player lines', async () => {
    const store = createPgScoreboardStore(pool);
    const finalAt = '2026-10-10T00:40:00.000Z';
    await store.applyObservation(
      game(finalAt, { homeScore: 117, visitorScore: 135, lifecycle: 'final', terminalConfirmations: 2, pollingState: 'complete', finalObservedAt: finalAt }),
      [line(22)]
    );
    const older = await store.applyObservation(
      game('2026-10-10T00:27:00.000Z', { homeScore: 22, visitorScore: 11, lifecycle: 'live' }),
      [line(4)]
    );
    expect(older).toBe(false);
    const snap = await snapshot();
    expect(snap.games[0]).toMatchObject({ home_score: 117, lifecycle: 'final', terminal_confirmations: 2 });
    expect(snap.lines).toEqual([{ player_id: 'p1', pts: 22 }]);
  });

  it('completes player lines for the accepted observation and ignores a stale replacement', async () => {
    const store = createPgScoreboardStore(pool);
    const at = '2026-10-10T00:22:00.000Z';
    expect(await store.applyObservation(game(at, { homeScore: 15, boxCompleteness: 'none' }), null)).toBe(true);
    expect(
      await store.applyObservation(game(at, { homeScore: 15, boxCompleteness: 'live_partial', boxObservedAt: at, boxRequestId: 'req-order' }), [line(15)])
    ).toBe(true);
    expect(await store.applyObservation(game('2026-10-10T00:17:00.000Z', { homeScore: 10 }), [line(2)])).toBe(false);
    const snap = await snapshot();
    expect(snap.games[0]).toMatchObject({ home_score: 15, box_completeness: 'live_partial' });
    expect(snap.lines).toEqual([{ player_id: 'p1', pts: 15 }]);
  });

  it('rolls back the game write when player lines fail the check', async () => {
    const store = createPgScoreboardStore(pool);
    await store.applyObservation(game('2026-10-10T00:17:00.000Z', { homeScore: 10 }), [line(10)]);
    await expect(
      store.applyObservation(game('2026-10-10T00:22:00.000Z', { homeScore: 99 }), [line(-1)])
    ).rejects.toThrow();
    const snap = await snapshot();
    expect(snap.games[0]).toMatchObject({ home_score: 10 });
    expect(snap.lines).toEqual([{ player_id: 'p1', pts: 10 }]);
  });

  it('keeps the newest accepted observation when an older complete response arrives later', async () => {
    const store = createPgScoreboardStore(pool);
    await store.applyObservation(game('2026-10-10T00:27:00.000Z', { homeScore: 22, visitorScore: 11 }), [line(22)]);
    const olderAt = '2026-10-10T00:22:00.000Z';
    expect(
      await store.applyObservation(
        game(olderAt, { homeScore: 15, boxCompleteness: 'live_partial', boxRequestId: 'req-order', boxObservedAt: olderAt }),
        [line(15)]
      )
    ).toBe(false);
    const snap = await snapshot();
    expect(snap.games[0]).toMatchObject({ home_score: 22, visitor_score: 11 });
    expect(snap.lines).toEqual([{ player_id: 'p1', pts: 22 }]);
  });
});
