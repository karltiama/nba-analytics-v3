import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StoredOddsQuote, StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { createPgScoreboardStore } from '@/lib/scoreboard/store';

const root = path.resolve(__dirname, '../../..');

function findPgBin(): string | null {
  const fromEnv = process.env.PG_BIN;
  const names = process.platform === 'win32' ? 'initdb.exe' : 'initdb';
  if (fromEnv && fs.existsSync(path.join(fromEnv, names))) return fromEnv;
  for (const candidate of ['C:\\Program Files\\PostgreSQL\\17\\bin', 'C:\\Program Files\\PostgreSQL\\16\\bin']) {
    if (fs.existsSync(path.join(candidate, names))) return candidate;
  }
  return null;
}

const pgBin = findPgBin();
const describeDb = pgBin ? describe : describe.skip;

function exe(name: string): string {
  return path.join(pgBin!, process.platform === 'win32' ? `${name}.exe` : name);
}

const dataDir = path.join(root, 'tmp', 'scoreboard-odds-pg');
const logFile = path.join(root, 'tmp', 'scoreboard-odds-pg.log');
const port = 55442;
const T0 = '2026-10-09T21:00:00.000Z';
const T15 = '2026-10-09T21:15:00.000Z';
const T30 = '2026-10-09T21:30:00.000Z';

function game(): StoredScoreboardGame {
  return {
    gameId: '21826163',
    season: 2026,
    seasonType: 'preseason',
    seasonTypeSource: 'request_season_type',
    etDate: '2026-10-09',
    scheduledTip: '2026-10-10T02:00:00.000Z',
    homeTeamId: '24',
    homeAbbr: 'PHX',
    homeName: null,
    homeScore: null,
    visitorTeamId: '27',
    visitorAbbr: 'SAS',
    visitorName: null,
    visitorScore: null,
    providerStatus: null,
    providerStatusState: null,
    period: 0,
    clock: null,
    overtimePeriods: 0,
    lifecycle: 'scheduled',
    gamesRequestId: 'r1',
    firstObservedAt: T0,
    lastObservedAt: T0,
    lastChangedAt: T0,
    terminalConfirmations: 0,
    finalObservedAt: null,
    pollingState: 'pending',
    boxCompleteness: 'none',
    boxRequestId: null,
    boxObservedAt: null,
    finalBoxAttempts: 0,
  };
}

/** Audited DraftKings prices for 21826163. */
function quote(observedAt: string, requestId: string, over: Partial<StoredOddsQuote> = {}): StoredOddsQuote {
  return {
    gameId: '21826163',
    vendor: 'draftkings',
    quoteKind: 'current',
    moneylineHome: 200,
    moneylineAway: -245,
    spreadHome: 7.5,
    spreadHomeOdds: -115,
    spreadAway: -7.5,
    spreadAwayOdds: -105,
    total: 223.5,
    totalOverOdds: -115,
    totalUnderOdds: -105,
    providerUpdatedAt: observedAt,
    vendorSyncedAt: observedAt,
    openedAt: null,
    firstObservedAt: observedAt,
    observedAt,
    requestId,
    withdrawnAt: null,
    withdrawnRequestId: null,
    ...over,
  };
}

describeDb('display odds on Postgres: guarded writes, no public access, rollback', () => {
  let pool: Pool;
  const psqlBase = ['-h', '127.0.0.1', '-p', String(port), '-U', 'scoreboard', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const quiet = { stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };

  beforeAll(async () => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    execFileSync(exe('initdb'), ['-D', dataDir, '-U', 'scoreboard', '-A', 'trust', '--no-sync'], { stdio: 'pipe' });
    execFileSync(exe('pg_ctl'), ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'], { stdio: 'ignore' });
    const setup = path.join(root, 'tmp', 'scoreboard-odds-setup.sql');
    fs.writeFileSync(
      setup,
      `create role anon nologin;
       create role authenticated nologin;
       create schema raw;
       create table raw.acquisition_requests (request_id text primary key);
       insert into raw.acquisition_requests (request_id) values ('r1'), ('r2'), ('r3'), ('w');`
    );
    execFileSync(exe('psql'), [...psqlBase, '-f', setup], quiet);
    execFileSync(exe('psql'), [...psqlBase, '-f', path.join(root, 'db/schemas/MIGRATION_display_scoreboard.sql')], quiet);
    execFileSync(exe('psql'), [...psqlBase, '-f', path.join(root, 'db/schemas/MIGRATION_display_scoreboard_odds.sql')], quiet);
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
    await pool.query('delete from display.scoreboard_odds_state');
    await pool.query('delete from display.scoreboard_game_odds');
    await pool.query('delete from display.scoreboard_games');
    await createPgScoreboardStore(pool).upsertGames([game()]);
  });

  it('no public, anon or authenticated access to either odds table', async () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      for (const table of ['display.scoreboard_game_odds', 'display.scoreboard_odds_state']) {
        const r = await pool.query(
          `select has_table_privilege($1, $2, 'select') or has_table_privilege($1, $2, 'insert') as any`,
          [role === 'public' ? 'anon' : role, table]
        );
        expect(r.rows[0].any, `${role} ${table}`).toBe(false);
      }
    }
    const grants = await pool.query(
      `select count(*)::int as n from information_schema.role_table_grants
       where table_schema = 'display' and table_name like 'scoreboard_%odds%' and grantee in ('PUBLIC', 'anon', 'authenticated')`
    );
    expect(grants.rows[0].n).toBe(0);
  });

  it('round-trips the audited quote with exact numeric types', async () => {
    const store = createPgScoreboardStore(pool);
    expect(await store.applyOddsAcquisition({ quotes: [quote(T0, 'r1')], observedAt: T0, requestId: 'r1', withdrawGameIds: ['21826163'] })).toEqual({
      written: 1,
      withdrawn: 0,
    });
    expect(await store.loadCurrentOdds(['21826163'])).toEqual([quote(T0, 'r1')]);
  });

  it('an older acquisition cannot overwrite a newer one; a duplicate is idempotent; first_observed_at is kept', async () => {
    const store = createPgScoreboardStore(pool);
    await store.applyOddsAcquisition({ quotes: [quote(T0, 'r1')], observedAt: T0, requestId: 'r1', withdrawGameIds: [] });
    await store.applyOddsAcquisition({ quotes: [quote(T15, 'r2', { moneylineAway: -260 })], observedAt: T15, requestId: 'r2', withdrawGameIds: [] });
    const late = await store.applyOddsAcquisition({ quotes: [quote(T0, 'r1', { moneylineAway: -200 })], observedAt: T0, requestId: 'r1', withdrawGameIds: [] });
    expect(late.written).toBe(0);
    const dup = await store.applyOddsAcquisition({ quotes: [quote(T15, 'r2', { moneylineAway: -260 })], observedAt: T15, requestId: 'r2', withdrawGameIds: [] });
    expect(dup.written).toBe(1);
    const [row] = await store.loadCurrentOdds(['21826163']);
    expect(row).toMatchObject({ moneylineAway: -260, requestId: 'r2', observedAt: T15, firstObservedAt: T0 });
    const count = await pool.query('select count(*)::int as n from display.scoreboard_game_odds');
    expect(count.rows[0].n).toBe(1);
  });

  it('withdraws a vendor missing from a complete later acquisition; an older one cannot revive it; a newer one can', async () => {
    const store = createPgScoreboardStore(pool);
    await store.applyOddsAcquisition({
      quotes: [quote(T0, 'r1'), quote(T0, 'r1', { vendor: 'fanduel' })],
      observedAt: T0,
      requestId: 'r1',
      withdrawGameIds: ['21826163'],
    });
    const w = await store.applyOddsAcquisition({ quotes: [quote(T15, 'w', { vendor: 'fanduel' })], observedAt: T15, requestId: 'w', withdrawGameIds: ['21826163'] });
    expect(w).toEqual({ written: 1, withdrawn: 1 });
    expect((await store.loadCurrentOdds(['21826163'])).map((q) => q.vendor)).toEqual(['fanduel']);
    expect((await store.applyOddsAcquisition({ quotes: [quote(T0, 'r1')], observedAt: T0, requestId: 'r1', withdrawGameIds: [] })).written).toBe(0);
    expect((await store.loadCurrentOdds(['21826163'])).map((q) => q.vendor)).toEqual(['fanduel']);
    await store.applyOddsAcquisition({ quotes: [quote(T30, 'r3')], observedAt: T30, requestId: 'r3', withdrawGameIds: [] });
    expect((await store.loadCurrentOdds(['21826163'])).map((q) => q.vendor)).toEqual(['draftkings', 'fanduel']);
  });

  it('a current write never touches the opening row, and opening rows are never served as current', async () => {
    await pool.query(
      `insert into display.scoreboard_game_odds (game_id, vendor, quote_kind, moneyline_home, moneyline_away, opened_at, first_observed_at, observed_at, request_id)
       values ('21826163', 'draftkings', 'opening', 130, -155, '2026-10-09T18:16:03Z', $1, $1, 'r1')`,
      [T0]
    );
    const store = createPgScoreboardStore(pool);
    await store.applyOddsAcquisition({ quotes: [quote(T15, 'r2')], observedAt: T15, requestId: 'r2', withdrawGameIds: ['21826163'] });
    const opening = await pool.query(`select moneyline_home, withdrawn_at from display.scoreboard_game_odds where quote_kind = 'opening'`);
    expect(opening.rows).toEqual([{ moneyline_home: 130, withdrawn_at: null }]);
    expect((await store.loadCurrentOdds(['21826163'])).map((q) => q.quoteKind)).toEqual(['current']);
  });

  it('numeric integrity: a bad price or half-point violation rolls back the whole acquisition', async () => {
    const store = createPgScoreboardStore(pool);
    for (const bad of [{ moneylineHome: 50 }, { total: 223.25 }, { spreadHome: 70 }, { vendor: 'Draft Kings' }]) {
      await expect(
        store.applyOddsAcquisition({
          quotes: [quote(T0, 'r1', { vendor: 'fanduel' }), quote(T0, 'r1', bad)],
          observedAt: T0,
          requestId: 'r1',
          withdrawGameIds: [],
        }),
        JSON.stringify(bad)
      ).rejects.toThrow();
      expect(await store.loadCurrentOdds(['21826163'])).toEqual([]);
    }
  });

  it('exact ids: an unknown game or request id is refused; deleting the game removes its quotes', async () => {
    const store = createPgScoreboardStore(pool);
    await expect(
      store.applyOddsAcquisition({ quotes: [quote(T0, 'r1', { gameId: '99999999' })], observedAt: T0, requestId: 'r1', withdrawGameIds: [] })
    ).rejects.toThrow();
    await expect(
      store.applyOddsAcquisition({ quotes: [quote(T0, 'nope')], observedAt: T0, requestId: 'nope', withdrawGameIds: [] })
    ).rejects.toThrow();
    await store.applyOddsAcquisition({ quotes: [quote(T0, 'r1')], observedAt: T0, requestId: 'r1', withdrawGameIds: [] });
    await pool.query(`delete from display.scoreboard_games where game_id = '21826163'`);
    const n = await pool.query('select count(*)::int as n from display.scoreboard_game_odds');
    expect(n.rows[0].n).toBe(0);
  });

  it('the odds attempt claim is atomic and follows the 15-minute / 5-minute cadence', async () => {
    const store = createPgScoreboardStore(pool);
    const claims = await Promise.all([store.claimOddsAttempt(T0), store.claimOddsAttempt(T0), store.claimOddsAttempt(T0)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.claimOddsAttempt('2026-10-09T21:14:59.000Z')).toBe(false);
    await store.recordOddsOutcome(T0, { status: 'failed', error: 'HTTP 429' });
    expect(await store.claimOddsAttempt('2026-10-09T21:04:59.000Z')).toBe(false);
    expect(await store.claimOddsAttempt('2026-10-09T21:05:00.000Z')).toBe(true);
    await store.recordOddsOutcome(T0, { status: 'success', requestId: 'r1' });
    await store.recordOddsOutcome('2026-10-09T21:05:00.000Z', { status: 'success', requestId: 'r2' });
    const s = await pool.query('select last_outcome, last_success_request_id, last_error from display.scoreboard_odds_state');
    expect(s.rows).toEqual([{ last_outcome: 'success', last_success_request_id: 'r2', last_error: null }]);
    expect(await store.claimOddsAttempt('2026-10-09T21:19:59.000Z')).toBe(false);
    expect(await store.claimOddsAttempt('2026-10-09T21:20:00.000Z')).toBe(true);
  });

  it('the documented rollback removes only the odds tables', async () => {
    const sql = fs.readFileSync(path.join(root, 'db/schemas/MIGRATION_display_scoreboard_odds.sql'), 'utf8');
    const rollback = sql
      .slice(sql.indexOf('-- Rollback'))
      .split('\n')
      .slice(1)
      .filter((l) => l.startsWith('-- '))
      .map((l) => l.slice(3))
      .join('\n');
    expect(rollback).toMatch(/drop table if exists display\.scoreboard_game_odds/);
    const file = path.join(root, 'tmp', 'scoreboard-odds-rollback.sql');
    fs.writeFileSync(file, rollback);
    execFileSync(exe('psql'), [...psqlBase, '-f', file], quiet);
    const left = await pool.query(
      `select table_name from information_schema.tables where table_schema = 'display' order by table_name`
    );
    expect(left.rows.map((r) => r.table_name)).toEqual(['scoreboard_collector_state', 'scoreboard_games', 'scoreboard_player_lines']);
    execFileSync(exe('psql'), [...psqlBase, '-f', path.join(root, 'db/schemas/MIGRATION_display_scoreboard_odds.sql')], quiet);
  });
});
