/**
 * Disposable Postgres 17 on 127.0.0.1 only. Trust auth, synthetic rows, no production URL.
 * The tables cover the columns and primary keys the recovery writer uses.
 * This is not a clone of every production column. raw.player_game_stats has
 * a primary key on id and no (game_id, player_id) unique constraint, matching
 * the constraint catalog reviewed in V2.0C.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StatLine } from '../box-completeness';
import { RECOVERY_GAME_LOCK_SQL, executeRecovery, type RecoveryUpserts } from '../recovery-execute';
import type { ProviderGame } from '../recovery-select';

const root = path.resolve(__dirname, '../../..');
const pgBin = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const dataDir = path.join(root, 'tmp', 'recovery-canary-pg');
const logFile = path.join(root, 'tmp', 'recovery-canary-pg.log');
const port = 55443;
const localUrl = `postgresql://recovery_canary@127.0.0.1:${port}/postgres`;

function exe(name: string): string {
  return path.join(pgBin, `${name}.exe`);
}

function assertLocal(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== String(port)) {
    throw new Error('Refusing a database that is not the disposable loopback instance');
  }
  if (parsed.hostname.includes('supabase') || url.includes('pooler')) {
    throw new Error('Refusing a production database host');
  }
}

const SCHEMA = `
create schema raw;
create schema analytics;
create table raw.teams (id integer primary key, abbreviation text);
create table raw.games (
  id bigint primary key, date text, season integer, status text, period integer, time text,
  period_detail text, datetime timestamptz, postseason boolean,
  home_team_score integer, visitor_team_score integer, home_team jsonb, visitor_team jsonb
);
create table raw.players (
  id bigint primary key, first_name text, last_name text, position text, height text, weight text,
  jersey_number text, college text, country text, draft_year integer, draft_round integer,
  draft_number integer, team_id integer
);
create table raw.player_game_stats (
  id bigint primary key, min text, fgm integer, fga integer, fg_pct numeric,
  fg3m integer, fg3a integer, fg3_pct numeric, ftm integer, fta integer, ft_pct numeric,
  oreb integer, dreb integer, reb integer, ast integer, stl integer, blk integer,
  turnover integer, pf integer, pts integer, plus_minus integer,
  player_id bigint, team_id integer, game_id bigint, player jsonb, team jsonb, game jsonb
);
create table analytics.players (
  player_id text primary key, full_name text, first_name text, last_name text,
  position text, height text, weight text, updated_at timestamptz default now()
);
create table analytics.games (
  game_id text primary key, season text, start_time timestamptz, status text,
  home_team_id text, away_team_id text, home_score integer, away_score integer,
  venue text, updated_at timestamptz default now()
);
create table analytics.player_game_logs (
  game_id text not null, player_id text not null, team_id text, minutes text,
  points integer, rebounds integer, offensive_rebounds integer, defensive_rebounds integer,
  assists integer, steals integer, blocks integer, turnovers integer, personal_fouls integer,
  field_goals_made integer, field_goals_attempted integer,
  three_pointers_made integer, three_pointers_attempted integer,
  free_throws_made integer, free_throws_attempted integer, plus_minus integer,
  opponent_team_id text, is_home boolean, game_date date, season text, pra integer,
  updated_at timestamptz default now(),
  primary key (game_id, player_id)
);
create table analytics.team_game_stats (
  team_id text not null, game_id text not null, season text, game_date date,
  opponent_team_id text, is_home boolean,
  team_points numeric, team_rebounds numeric, team_assists numeric, team_steals numeric,
  team_blocks numeric, team_turnovers numeric, team_fgm numeric, team_fga numeric,
  team_3pm numeric, team_3pa numeric, team_ftm numeric, team_fta numeric,
  offensive_rebounds numeric, defensive_rebounds numeric,
  opponent_fgm numeric, opponent_fga numeric, opponent_3pm numeric, opponent_3pa numeric,
  opponent_ftm numeric, opponent_fta numeric, opponent_turnovers numeric,
  opponent_offensive_rebounds numeric, opponent_defensive_rebounds numeric,
  points_allowed numeric, result text, estimated_possessions numeric,
  offensive_rating numeric, defensive_rating numeric, pace numeric,
  efg_pct numeric, tov_pct numeric, orb_pct numeric,
  updated_at timestamptz default now(),
  primary key (team_id, game_id)
);
create table analytics.team_season_averages (
  team_id text not null, season text not null, games_played integer,
  avg_points numeric, avg_rebounds numeric, avg_assists numeric, avg_steals numeric,
  avg_blocks numeric, avg_turnovers numeric, avg_fgm numeric, avg_fga numeric,
  avg_3pm numeric, avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_points_allowed numeric, wins integer, losses integer, home_wins integer,
  home_losses integer, away_wins integer, away_losses integer, win_pct numeric,
  avg_offensive_rating numeric, avg_defensive_rating numeric, avg_pace numeric,
  avg_efg_pct numeric, avg_tov_pct numeric, avg_orb_pct numeric,
  updated_at timestamptz default now(),
  primary key (team_id, season)
);
create table analytics.player_season_averages (
  player_id text not null, season text not null, games_played integer,
  pts_avg numeric, reb_avg numeric, ast_avg numeric, stl_avg numeric, blk_avg numeric,
  turnover_avg numeric, pra_avg numeric, fg_pct numeric, fg3_pct numeric, ft_pct numeric,
  updated_at timestamptz default now(),
  primary key (player_id, season)
);
create table analytics.recovery_test_fail (enabled boolean not null);
insert into analytics.recovery_test_fail values (false);
create function analytics.reject_when_armed() returns trigger language plpgsql as $$
begin
  if (select enabled from analytics.recovery_test_fail) then
    raise exception 'injected write failure';
  end if;
  return new;
end;
$$;
create trigger recovery_test_fail_logs
before insert on analytics.player_game_logs
for each row execute function analytics.reject_when_armed();
`;

function line(id: number, playerId: number, teamId: number, gameId: number): StatLine {
  const home = teamId === 10;
  const bump = home && playerId % 10 === 1;
  const fgm = bump ? 6 : 4;
  const fga = bump ? 10 : 8;
  const fg3m = bump ? 2 : 1;
  const fg3a = bump ? 4 : 3;
  const ftm = bump ? 2 : 1;
  return {
    id,
    player: { id: playerId, first_name: home ? 'Home' : 'Away', last_name: String(playerId) },
    team: { id: teamId },
    game: { id: gameId },
    min: '18',
    fgm,
    fga,
    fg3m,
    fg3a,
    ftm,
    fta: 2,
    oreb: 1,
    dreb: 2,
    reb: 3,
    turnover: 1,
    pts: 2 * (fgm - fg3m) + 3 * fg3m + ftm,
    ast: 1,
    stl: 0,
    blk: 0,
    pf: 1,
    plus_minus: home ? 6 : -6,
  };
}

function box(gameId: number): StatLine[] {
  const lines: StatLine[] = [];
  for (let player = 1; player <= 8; player += 1) {
    lines.push(line(gameId * 100 + player, gameId * 100 + player, 10, gameId));
    lines.push(line(gameId * 100 + 50 + player, gameId * 100 + 50 + player, 20, gameId));
  }
  return lines;
}

function providerGame(id: number): ProviderGame {
  return {
    id,
    season: 2026,
    date: '2026-10-21',
    datetime: '2026-10-22T03:00:00.000Z',
    status: 'Final',
    home_team_score: 86,
    visitor_team_score: 80,
    home_team: { id: 10, abbreviation: 'ORL' },
    visitor_team: { id: 20, abbreviation: 'ATL' },
  };
}

describe('recovery on disposable Postgres', () => {
  let pool: Pool;
  let upserts: RecoveryUpserts;
  let version = '';

  beforeAll(async () => {
    assertLocal(localUrl);
    process.env.SUPABASE_DB_URL = localUrl;
    process.env.DATA_MODE = 'replay';
    process.env.OFFSEASON_MODE = '1';
    process.env.CRON_DRY_RUN = '1';
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    execFileSync(exe('initdb'), ['-D', dataDir, '-U', 'recovery_canary', '-A', 'trust', '--no-sync'], { stdio: 'pipe' });
    execFileSync(exe('pg_ctl'), ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'], {
      stdio: 'ignore',
    });
    const setup = path.join(root, 'tmp', 'recovery-canary-setup.sql');
    fs.writeFileSync(setup, SCHEMA);
    execFileSync(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'recovery_canary', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', setup], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pool = new Pool({ host: '127.0.0.1', port, user: 'recovery_canary', database: 'postgres', max: 4 });
    const info = await pool.query<{ version: string; addr: string | null }>('select version() as version, inet_server_addr()::text as addr');
    version = info.rows[0].version;
    expect(String(info.rows[0].addr)).toMatch(/^127\.0\.0\.1/);
    expect(version).toMatch(/PostgreSQL 17/);
    await pool.query(`insert into raw.teams (id, abbreviation) values (10, 'ORL'), (20, 'ATL')`);
    const loaded = await import('../index');
    expect(process.env.SUPABASE_DB_URL).toBe(localUrl);
    upserts = loaded.nightlyRecoveryUpserts;
    console.log(`disposable postgres ${version}`);
  }, 60_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    if (fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
      execFileSync(exe('pg_ctl'), ['-D', dataDir, 'stop'], { stdio: 'pipe' });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query(`
      update analytics.recovery_test_fail set enabled = false;
      truncate analytics.player_game_logs, analytics.team_game_stats, analytics.games, analytics.players,
        analytics.team_season_averages, analytics.player_season_averages,
        raw.player_game_stats, raw.games, raw.players;
    `);
  });

  async function runRecovery(gameId = 21717922) {
    return executeRecovery({
      event: { recovery: { seasonStartYear: 2026, startDate: '2026-10-21', endDate: '2026-10-21', gameIds: [gameId] } },
      env: { INGESTION_SEASON_START_YEAR: '2026' },
      maxRetries: 3,
      requestDelayMs: 0,
      baseUrl: 'https://example.test/v1',
      sleep: async () => {},
      connect: () => pool.connect() as Promise<PoolClient>,
      upserts,
      fetchPage: async (url, _retries, onAttempt, _onHttp, beforeHttp) => {
        onAttempt();
        beforeHttp();
        const stats = url.includes('/stats');
        const data = stats ? box(gameId) : [providerGame(gameId)];
        return new Response(JSON.stringify({ data, meta: { next_cursor: null } }), { status: 200 });
      },
    });
  }

  it('uses primary keys the recovery conflict targets, and no raw player-game unique key', async () => {
    const keys = await pool.query<{ table_name: string; definition: string }>(`
      select rel.relname as table_name, pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where con.contype in ('p', 'u')
        and nsp.nspname in ('raw', 'analytics')
        and rel.relname in ('games', 'player_game_stats', 'player_game_logs', 'team_game_stats', 'team_season_averages', 'player_season_averages', 'players')
      order by nsp.nspname, rel.relname, con.contype
    `);
    const defs = keys.rows.map((row) => `${row.table_name} ${row.definition}`);
    expect(defs).toContain('player_game_stats PRIMARY KEY (id)');
    expect(defs).toContain('player_game_logs PRIMARY KEY (game_id, player_id)');
    expect(defs).toContain('team_game_stats PRIMARY KEY (team_id, game_id)');
    expect(defs).toContain('team_season_averages PRIMARY KEY (team_id, season)');
    expect(defs).toContain('player_season_averages PRIMARY KEY (player_id, season)');
    expect(defs.some((row) => row.includes('player_game_stats') && row.includes('UNIQUE'))).toBe(false);
    await pool.query(`insert into raw.player_game_stats (id, player_id, game_id) values (1, 10, 21717922), (2, 10, 21717922)`);
    const count = await pool.query<{ n: number }>('select count(*)::int as n from raw.player_game_stats');
    expect(count.rows[0].n).toBe(2);
  });

  it('rolls back a failed write and leaves the connection usable', async () => {
    await pool.query('update analytics.recovery_test_fail set enabled = true');
    await expect(runRecovery()).rejects.toThrow(/injected write failure/);
    const games = await pool.query<{ n: number }>('select count(*)::int as n from raw.games');
    const logs = await pool.query<{ n: number }>('select count(*)::int as n from analytics.player_game_logs');
    expect(games.rows[0].n).toBe(0);
    expect(logs.rows[0].n).toBe(0);
    const ping = await pool.query<{ ok: number }>('select 1 as ok');
    expect(ping.rows[0].ok).toBe(1);
  });

  it('holds the game advisory lock without blocking a different game', async () => {
    const holder = await pool.connect();
    const other = await pool.connect();
    const blocked = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query(RECOVERY_GAME_LOCK_SQL, [21717922]);
      await other.query('begin');
      const started = Date.now();
      await other.query(RECOVERY_GAME_LOCK_SQL, [21717923]);
      expect(Date.now() - started).toBeLessThan(1000);
      await other.query('rollback');
      await blocked.query('begin');
      await blocked.query("set local statement_timeout = '300ms'");
      await expect(blocked.query(RECOVERY_GAME_LOCK_SQL, [21717922])).rejects.toThrow(/statement timeout|canceling statement/i);
    } finally {
      await holder.query('rollback').catch(() => {});
      await other.query('rollback').catch(() => {});
      await blocked.query('rollback').catch(() => {});
      holder.release();
      other.release();
      blocked.release();
    }
  });

  it('waits for the same-game lock, then commits one idempotent box without touching 2025', async () => {
    await pool.query(`
      insert into analytics.team_game_stats (team_id, game_id, season, game_date, team_points, result, is_home)
      values ('10', '2025-final', '2025', '2025-12-15', 100, 'W', true)
    `);
    await pool.query(`
      insert into analytics.player_game_logs (game_id, player_id, season, game_date, points)
      values ('2025-final', 'historical-player', '2025', '2025-12-15', 20)
    `);
    await pool.query(`insert into analytics.team_season_averages (team_id, season, games_played) values ('10', '2025', 82)`);
    await pool.query(`insert into analytics.player_season_averages (player_id, season, games_played) values ('historical-player', '2025', 70)`);
    await pool.query(`insert into raw.players (id, first_name, last_name, team_id) values ($1, 'Keep', 'Name', 99)`, [21717922 * 100 + 1]);

    const holder = await pool.connect();
    await holder.query('begin');
    await holder.query(RECOVERY_GAME_LOCK_SQL, [21717922]);
    let finished = false;
    const pending = runRecovery().then((result) => {
      finished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(finished).toBe(false);
    await holder.query('rollback');
    holder.release();
    const first = await pending;
    expect(first.writesCommitted).toBe(true);
    const second = await runRecovery();
    expect(second.writesCommitted).toBe(true);

    const counts = await pool.query<{ table_name: string; n: number }>(`
      select 'raw.games' as table_name, count(*)::int as n from raw.games
      union all select 'raw.player_game_stats', count(*)::int from raw.player_game_stats
      union all select 'logs', count(*)::int from analytics.player_game_logs where season = '2026'
      union all select 'team_rows', count(*)::int from analytics.team_game_stats where season = '2026'
      union all select 'team_played', max(games_played)::int from analytics.team_season_averages where season = '2026'
      union all select 'player_played', max(games_played)::int from analytics.player_season_averages where season = '2026'
    `);
    const byTable = Object.fromEntries(counts.rows.map((row) => [row.table_name, row.n]));
    expect(byTable['raw.games']).toBe(1);
    expect(byTable['raw.player_game_stats']).toBe(16);
    expect(byTable.logs).toBe(16);
    expect(byTable.team_rows).toBe(2);
    expect(byTable.team_played).toBe(1);
    expect(byTable.player_played).toBe(1);

    const historical = await pool.query<{ games_played: number; points: number }>(`
      select s.games_played, t.team_points::int as points
      from analytics.team_season_averages s
      join analytics.team_game_stats t on t.team_id = s.team_id and t.season = s.season
      where s.season = '2025'
    `);
    expect(historical.rows).toEqual([{ games_played: 82, points: 100 }]);
    const oldLog = await pool.query<{ points: number; games_played: number }>(`
      select l.points::int as points, a.games_played
      from analytics.player_game_logs l
      join analytics.player_season_averages a on a.player_id = l.player_id and a.season = l.season
      where l.season = '2025'
    `);
    expect(oldLog.rows).toEqual([{ points: 20, games_played: 70 }]);
    const kept = await pool.query<{ first_name: string; team_id: number }>('select first_name, team_id from raw.players where id = $1', [
      21717922 * 100 + 1,
    ]);
    expect(kept.rows).toEqual([{ first_name: 'Keep', team_id: 99 }]);
  });

  it('rejects a conflicting raw stat id and does not leave a partial analytics write', async () => {
    await pool.query('insert into raw.player_game_stats (id, player_id, game_id) values (999, $1, 21717922)', [21717922 * 100 + 1]);
    await expect(runRecovery()).rejects.toThrow(/does not match this payload/);
    const analytics = await pool.query<{ n: number }>('select count(*)::int as n from analytics.games');
    const rawGames = await pool.query<{ n: number }>('select count(*)::int as n from raw.games');
    const rawStats = await pool.query<{ n: number }>('select count(*)::int as n from raw.player_game_stats');
    expect(analytics.rows[0].n).toBe(0);
    expect(rawGames.rows[0].n).toBe(0);
    expect(rawStats.rows[0].n).toBe(1);
  });
});
