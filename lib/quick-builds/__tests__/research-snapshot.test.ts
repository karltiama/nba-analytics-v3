import { describe, expect, it, vi } from 'vitest';
import { QUICK_BUILD_PRESETS, QUICK_BUILD_PRICE_NOTICE, QuickBuildInputError } from '../types';
import { presetRange } from '../index';
import {
  QUICK_BUILD_ATTEMPTS_SQL,
  QUICK_BUILD_CLOCK_SQL,
  QUICK_BUILD_GAMES_SQL,
  QUICK_BUILD_OBSERVATION_COUNT_SQL,
  QUICK_BUILD_OBSERVATION_ROWS_SQL,
  QUICK_BUILD_READ_SQL,
  QUICK_BUILD_SLATE_SQL,
  buildResearchQuickBuildRequest,
  isResearchSlateGame,
  loadResearchQuickBuilds,
  loadResearchSlate,
  parseSelectedGameIds,
  type QuickBuildReader,
} from '../research-snapshot';
import { normalizeGameStatus } from '@/lib/betting/normalize-game-status';
import { QUICK_BUILD_PLAYERS_SQL } from '../display';

const NOW = new Date('2026-11-09T18:00:00.000Z');
const TIP = '2026-11-10T00:00:00.000Z';
const OBS = '2026-11-09T17:00:00.000Z';

type Game = {
  gameId: string;
  startTime: string;
  status: string | null;
  awayAbbreviation?: string | null;
  homeAbbreviation?: string | null;
};
type NamedPlayer = { playerId: string; fullName: string; nbaPlayerId?: string | null };
type Run = {
  pullRunId: string;
  gameId: string;
  status: 'started' | 'success' | 'error';
  rowsStored: number;
  completedAt: string | null;
  startedAt?: string | null;
};
type Snap = {
  pullRunId: string;
  gameId: string;
  playerId: string;
  propType: string;
  marketType: string;
  side: string;
  line: string | null;
  sportsbook: string;
  odds: number | null;
  observedAt: string | null;
  clock: 'RESPONSE_RECEIVED' | null;
};

type Mem = { games: Game[]; runs: Run[]; snaps: Snap[]; players?: NamedPlayer[] };

function success(pullRunId: string, gameId: string, completedAt: string, rowsStored = 4): Run {
  return { pullRunId, gameId, status: 'success', rowsStored, completedAt };
}

function bothSides(input: {
  pullRunId: string;
  gameId: string;
  playerId: string;
  line?: string;
  over?: number;
  under?: number;
  sportsbook?: string;
  propType?: string;
  observedAt?: string | null;
  clock?: 'RESPONSE_RECEIVED' | null;
}): Snap[] {
  const base = {
    pullRunId: input.pullRunId,
    gameId: input.gameId,
    playerId: input.playerId,
    propType: input.propType ?? 'points',
    marketType: 'over_under',
    line: input.line ?? '20.5',
    sportsbook: input.sportsbook ?? 'draftkings',
    observedAt: input.observedAt === undefined ? OBS : input.observedAt,
    clock: input.clock === undefined ? ('RESPONSE_RECEIVED' as const) : input.clock,
  };
  return [
    { ...base, side: 'over', odds: input.over ?? -200 },
    { ...base, side: 'under', odds: input.under ?? -200 },
  ];
}

function slate(): Mem {
  return {
    games: [
      { gameId: '101', startTime: TIP, status: 'Scheduled' },
      { gameId: '102', startTime: '2026-11-10T01:00:00.000Z', status: 'Scheduled' },
    ],
    runs: [success('2', '101', OBS), success('8', '102', '2026-11-09T17:05:00.000Z')],
    snaps: [
      ...bothSides({ pullRunId: '2', gameId: '101', playerId: '11' }),
      ...bothSides({ pullRunId: '8', gameId: '102', playerId: '22', line: '8.5' }),
    ],
  };
}

function reader(mem: Mem, calls: { sql: string; params: unknown[] }[] = []): QuickBuildReader {
  return async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql === QUICK_BUILD_GAMES_SQL) {
      return mem.games.map((game) => ({
        game_id: game.gameId,
        start_time: game.startTime,
        status: game.status,
        away_abbr: game.awayAbbreviation ?? null,
        home_abbr: game.homeAbbreviation ?? null,
      }));
    }
    if (sql === QUICK_BUILD_ATTEMPTS_SQL) {
      const ids = new Set((params[0] as string[]) ?? []);
      return mem.runs
        .filter((run) => ids.has(run.gameId))
        .map((run) => ({
          pull_run_id: run.pullRunId,
          game_id: run.gameId,
          status: run.status,
          rows_stored: run.rowsStored,
          completed_at: run.completedAt,
          started_at: run.startedAt ?? null,
        }));
    }
    if (sql === QUICK_BUILD_CLOCK_SQL) {
      const pullIds = params[0] as number[];
      const gameIds = params[1] as number[];
      const rows = [];
      for (let i = 0; i < pullIds.length; i += 1) {
        const pullRunId = String(pullIds[i]);
        const gameId = String(gameIds[i]);
        const snaps = mem.snaps.filter((snap) => snap.pullRunId === pullRunId && snap.gameId === gameId);
        rows.push({
          pull_run_id: pullRunId,
          game_id: gameId,
          snapshot_rows: snaps.length,
          response_rows: snaps.filter((snap) => snap.clock === 'RESPONSE_RECEIVED' && snap.observedAt != null).length,
        });
      }
      return rows;
    }
    if (sql === QUICK_BUILD_OBSERVATION_COUNT_SQL || sql === QUICK_BUILD_OBSERVATION_ROWS_SQL) {
      const pullIds = new Set((params[0] as number[]).map(String));
      const gameIds = new Set((params[1] as number[]).map(String));
      const book = String(params[2]);
      const markets = new Set(params[3] as string[]);
      const snaps = mem.snaps.filter(
        (snap) =>
          pullIds.has(snap.pullRunId) &&
          gameIds.has(snap.gameId) &&
          snap.sportsbook.trim().toLowerCase() === book &&
          snap.marketType.toLowerCase() === 'over_under' &&
          ['over', 'under'].includes(snap.side.toLowerCase()) &&
          markets.has(snap.propType.toLowerCase())
      );
      if (sql === QUICK_BUILD_OBSERVATION_COUNT_SQL) {
        return [{ observation_count: snaps.length }];
      }
      return snaps.map((snap) => ({
        player_id: snap.playerId,
        game_id: snap.gameId,
        prop_type: snap.propType,
        side: snap.side,
        line_value: snap.line,
        sportsbook: snap.sportsbook,
        odds_american: snap.odds,
        pull_run_id: snap.pullRunId,
        observed_at: snap.observedAt,
        observation_clock: snap.clock,
      }));
    }
    if (sql === QUICK_BUILD_PLAYERS_SQL) {
      const ids = (params[0] as string[]) ?? [];
      const named = mem.players?.filter((player) => ids.includes(player.playerId));
      const rows = named && named.length > 0 ? named : ids.map((playerId) => ({ playerId, fullName: `Player ${playerId}`, nbaPlayerId: null }));
      return rows.map((player) => ({
        player_id: player.playerId,
        full_name: player.fullName,
        nba_player_id: player.nbaPlayerId ?? null,
      }));
    }
    throw new Error(`unexpected sql: ${sql}`);
  };
}

function observationPulls(calls: { sql: string; params: unknown[] }[]): string[] {
  const call = calls.find((row) => row.sql === QUICK_BUILD_OBSERVATION_COUNT_SQL);
  return ((call?.params[0] as number[]) ?? []).map(String);
}

describe('research snapshot adapter', () => {
  it('reads only the declared statements and never the current props table', () => {
    const text = QUICK_BUILD_READ_SQL.join('\n');
    expect(text).not.toMatch(/player_props_current/i);
    expect(text).not.toMatch(/\b(insert|update|delete|limit)\b/i);
    expect(text).toContain('raw.player_prop_game_runs');
    expect(text).toContain('raw.player_prop_snapshots_v2');
    expect(text).toContain('analytics.games');
    expect(text).toContain('analytics.players');
    expect(QUICK_BUILD_GAMES_SQL).toContain('analytics.teams');
    expect(QUICK_BUILD_OBSERVATION_ROWS_SQL).not.toContain('analytics.teams');
    expect(QUICK_BUILD_OBSERVATION_COUNT_SQL).not.toContain('analytics.teams');
    expect(QUICK_BUILD_OBSERVATION_ROWS_SQL).toContain("IN ('over', 'under')");
  });

  it('keeps an unstarted scheduled game on today\'s ET slate and rejects the rest', () => {
    expect(isResearchSlateGame({ startTime: TIP, status: 'Scheduled' }, NOW)).toBe(true);
    expect(isResearchSlateGame({ startTime: TIP, status: '7:00 pm' }, NOW)).toBe(true);
    expect(isResearchSlateGame({ startTime: NOW.toISOString(), status: 'Scheduled' }, NOW)).toBe(false);
    expect(isResearchSlateGame({ startTime: '2026-11-09T17:59:00.000Z', status: 'Scheduled' }, NOW)).toBe(false);
    expect(isResearchSlateGame({ startTime: '2026-11-10T23:00:00.000Z', status: 'Scheduled' }, NOW)).toBe(false);
    for (const status of ['Final', 'In Progress', 'live', 'Postponed', 'Canceled', 'Cancelled', '', 'delayed']) {
      expect(isResearchSlateGame({ startTime: TIP, status }, NOW)).toBe(false);
    }
  });

  it('rejects a bare clock, a past tip, and non-pregame statuses', () => {
    const pastIso = '2026-11-09T17:00:00.000Z';
    expect(normalizeGameStatus('5:43')).toBe('Scheduled');
    expect(isResearchSlateGame({ startTime: TIP, status: '5:43' }, NOW)).toBe(false);
    expect(isResearchSlateGame({ startTime: TIP, status: '19:00' }, NOW)).toBe(false);
    expect(isResearchSlateGame({ startTime: TIP, status: '7:00' }, NOW)).toBe(false);

    expect(isResearchSlateGame({ startTime: TIP, status: TIP }, NOW)).toBe(true);
    expect(isResearchSlateGame({ startTime: TIP, status: '7:30 PM ET' }, NOW)).toBe(true);
    expect(isResearchSlateGame({ startTime: pastIso, status: pastIso }, NOW)).toBe(false);
    expect(isResearchSlateGame({ startTime: pastIso, status: '7:00 pm' }, NOW)).toBe(false);

    for (const status of ['Postponed', 'Delayed', 'live', 'Halftime', 'OT', 'Final', 'Final/OT']) {
      expect(isResearchSlateGame({ startTime: TIP, status }, NOW)).toBe(false);
    }
    expect(isResearchSlateGame({ startTime: TIP, status: 'not a status' }, NOW)).toBe(false);
    expect(isResearchSlateGame({ startTime: TIP, status: '' }, NOW)).toBe(false);
    expect(isResearchSlateGame({ startTime: TIP, status: null }, NOW)).toBe(false);
    expect(isResearchSlateGame({ startTime: TIP }, NOW)).toBe(false);
  });

  it('builds from the latest complete pull on each game', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const request = await buildResearchQuickBuildRequest({
      sportsbook: 'FanDuel',
      preset: 'higher_payout',
      now: NOW,
      query: reader(
        {
          ...slate(),
          snaps: [
            ...bothSides({ pullRunId: '2', gameId: '101', playerId: '11', sportsbook: 'fanduel' }),
            ...bothSides({ pullRunId: '2', gameId: '101', playerId: '11', sportsbook: 'draftkings', line: '99.5' }),
            ...bothSides({ pullRunId: '8', gameId: '102', playerId: '22', sportsbook: 'fanduel', line: '8.5' }),
          ],
        },
        calls
      ),
    });
    expect(request.sportsbook).toBe('fanduel');
    expect(request.range).toEqual(presetRange('higher_payout'));
    expect(request.range).toEqual(QUICK_BUILD_PRESETS.higher_payout);
    expect(request.policy).toEqual({ mode: 'research_snapshot', asOf: NOW.toISOString() });
    expect(request.games.map((game) => game.gameId)).toEqual(['101', '102']);
    expect(observationPulls(calls).sort()).toEqual(['2', '8']);
    expect(request.observations.every((row) => row.sportsbook === 'fanduel')).toBe(true);
    expect(request.observations.some((row) => row.line === '99.5')).toBe(false);

    const result = await loadResearchQuickBuilds({
      sportsbook: 'fanduel',
      preset: 'higher_payout',
      now: NOW,
      query: reader({
        ...slate(),
        snaps: [
          ...bothSides({ pullRunId: '2', gameId: '101', playerId: '11', sportsbook: 'fanduel' }),
          ...bothSides({ pullRunId: '8', gameId: '102', playerId: '22', sportsbook: 'fanduel', line: '8.5' }),
        ],
      }),
    });
    expect(result.status).toBe('ok');
    expect(result.snapshotClass).toBe('research_snapshot');
    expect(result.generatedAt).toBe(NOW.toISOString());
    expect(result.builds.length).toBeGreaterThan(0);
    expect(result.builds.length).toBeLessThanOrEqual(5);
    expect(result.builds.every((build) => build.combinedAmerican === 125)).toBe(true);
    expect(result.builds[0]?.legs.every((leg) => leg.observedAt === OBS)).toBe(true);
    expect(result.builds[0]?.legs.every((leg) => leg.display.displayReady)).toBe(true);
    expect(result.builds[0]?.legs.map((leg) => leg.display.playerName).sort()).toEqual(['Player 11', 'Player 22']);
    expect(result.builds[0]?.legs.every((leg) => leg.display.teamAbbreviation == null)).toBe(true);
    expect(result.builds[0]?.legs.every((leg) => leg.display.opponentAbbreviation == null)).toBe(true);
    expect(result.builds[0]?.legs.every((leg) => leg.display.scheduledAwayAbbreviation == null)).toBe(true);
    expect(result.builds[0]?.legs.every((leg) => leg.display.nbaPlayerId == null)).toBe(true);
    expect(result.builds[0]?.legs.every((leg) => leg.display.gameStartTime != null)).toBe(true);
    expect(result.priceNotice).toBe(QUICK_BUILD_PRICE_NOTICE);
    expect(result.limitations[1]).toBe(QUICK_BUILD_PRICE_NOTICE);
    expect(JSON.stringify(result)).not.toMatch(/jointFair|expectedValue|safeBet|positiveEv/i);
    const again = await loadResearchQuickBuilds({
      sportsbook: 'fanduel',
      preset: 'higher_payout',
      now: NOW,
      query: reader({
        ...slate(),
        snaps: [
          ...bothSides({ pullRunId: '2', gameId: '101', playerId: '11', sportsbook: 'fanduel' }),
          ...bothSides({ pullRunId: '8', gameId: '102', playerId: '22', sportsbook: 'fanduel', line: '8.5' }),
        ],
      }),
    });
    expect(again.builds.map((build) => build.id)).toEqual(result.builds.map((build) => build.id));
  });

  it('attaches the scheduled matchup and NBA provider id without a player team', async () => {
    const base = slate();
    const result = await loadResearchQuickBuilds({
      sportsbook: 'fanduel',
      preset: 'higher_payout',
      now: NOW,
      query: reader({
        ...base,
        games: [
          { ...base.games[0]!, awayAbbreviation: 'por', homeAbbreviation: 'bos' },
          { ...base.games[1]!, awayAbbreviation: 'lal', homeAbbreviation: '' },
        ],
        players: [
          { playerId: '11', fullName: 'Donovan Clingan', nbaPlayerId: '1631210' },
          { playerId: '22', fullName: 'Player 22', nbaPlayerId: 'not-an-id' },
        ],
        snaps: [
          ...bothSides({ pullRunId: '2', gameId: '101', playerId: '11', sportsbook: 'fanduel' }),
          ...bothSides({ pullRunId: '8', gameId: '102', playerId: '22', sportsbook: 'fanduel', line: '8.5' }),
        ],
      }),
    });
    const clingan = result.builds[0]?.legs.find((leg) => leg.playerId === '11');
    const other = result.builds[0]?.legs.find((leg) => leg.playerId === '22');
    expect(clingan?.display).toMatchObject({
      playerName: 'Donovan Clingan',
      scheduledAwayAbbreviation: 'POR',
      scheduledHomeAbbreviation: 'BOS',
      nbaPlayerId: '1631210',
      teamAbbreviation: null,
      opponentAbbreviation: null,
      homeAway: null,
    });
    expect(other?.display.scheduledAwayAbbreviation).toBeNull();
    expect(other?.display.scheduledHomeAbbreviation).toBeNull();
    expect(other?.display.nbaPlayerId).toBeNull();
    expect(clingan?.oddsAmerican).toBe(-200);
  });

  it('does not resurrect a line that is absent from the latest complete pull', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mem = slate();
    mem.runs.push(success('1', '101', '2026-11-09T13:00:00.000Z'));
    mem.snaps.push(
      ...bothSides({
        pullRunId: '1',
        gameId: '101',
        playerId: '11',
        line: '19.5',
        observedAt: '2026-11-09T13:00:00.000Z',
      })
    );
    const request = await buildResearchQuickBuildRequest({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem, calls),
    });
    expect(observationPulls(calls)).not.toContain('1');
    expect(request.observations.every((row) => row.pullRunId === '2' || row.pullRunId === '8')).toBe(true);
    expect(request.observations.some((row) => row.line === '19.5')).toBe(false);
    expect(request.observations.some((row) => row.line === '20.5')).toBe(true);
  });

  it('keeps a later failed attempt visible and still uses the last complete pull', async () => {
    const mem = slate();
    mem.runs.push({
      pullRunId: '3',
      gameId: '101',
      status: 'error',
      rowsStored: 0,
      completedAt: '2026-11-09T17:30:00.000Z',
    });
    mem.snaps.push(...bothSides({ pullRunId: '3', gameId: '101', playerId: '11', line: '1.5' }));
    const calls: { sql: string; params: unknown[] }[] = [];
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem, calls),
    });
    expect(observationPulls(calls)).not.toContain('3');
    expect(result.games.find((game) => game.gameId === '101')).toMatchObject({
      eligiblePullRunId: '2',
      newerUnsuccessfulAttempt: { pullRunId: '3', kind: 'failed' },
    });
    expect(result.builds.every((build) => build.legs.every((leg) => leg.line !== 1.5))).toBe(true);
  });

  it('keeps an in-progress attempt visible after the last complete pull', async () => {
    const mem = slate();
    mem.runs.push({
      pullRunId: '5',
      gameId: '101',
      status: 'started',
      rowsStored: 0,
      completedAt: null,
      startedAt: '2026-11-09T17:50:00.000Z',
    });
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem),
    });
    expect(result.games.find((game) => game.gameId === '101')).toMatchObject({
      eligiblePullRunId: '2',
      newerUnsuccessfulAttempt: { pullRunId: '5', kind: 'in_progress' },
    });
  });

  it('reports a later zero-row success instead of treating it as the board', async () => {
    const mem = slate();
    mem.runs.push({
      pullRunId: '4',
      gameId: '102',
      status: 'success',
      rowsStored: 0,
      completedAt: '2026-11-09T17:40:00.000Z',
    });
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem),
    });
    expect(result.games.find((game) => game.gameId === '102')).toMatchObject({
      eligiblePullRunId: '8',
      newerUnsuccessfulAttempt: { pullRunId: '4', kind: 'zero_row' },
    });
  });

  it('does not treat a pull with a bad observation clock as complete', async () => {
    const mem = slate();
    mem.snaps = mem.snaps.map((snap) => (snap.gameId === '101' ? { ...snap, clock: null, observedAt: null } : snap));
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem),
    });
    expect(result.emptyReason).toBe('NO_CROSS_GAME');
    expect(result.games.find((game) => game.gameId === '101')).toMatchObject({
      eligiblePullRunId: null,
      rejection: 'NO_COMPLETE_PULL',
      newerUnsuccessfulAttempt: { pullRunId: '2', kind: 'invalid_clock' },
    });
  });

  it('rejects a complete-looking pull when any snapshot row lacks the observation clock', async () => {
    const mem = slate();
    mem.snaps.push({
      pullRunId: '2',
      gameId: '101',
      playerId: '99',
      propType: 'points',
      marketType: 'over_under',
      side: 'over',
      line: '3.5',
      sportsbook: 'betmgm',
      odds: -110,
      observedAt: null,
      clock: null,
    });
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem),
    });
    expect(result.games.find((game) => game.gameId === '101')?.eligiblePullRunId).toBeNull();
  });

  it('orders attempts by completion time when a later id finishes first', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mem = slate();
    mem.runs.push(success('11', '101', '2026-11-09T16:00:00.000Z'));
    mem.snaps.push(...bothSides({ pullRunId: '11', gameId: '101', playerId: '11', line: '15.5' }));
    await buildResearchQuickBuildRequest({
      sportsbook: 'draftkings',
      preset: 'balanced',
      now: NOW,
      query: reader(mem, calls),
    });
    expect(observationPulls(calls)).toContain('2');
    expect(observationPulls(calls)).not.toContain('11');
  });

  it('drops a game that has already tipped and does not read its pulls', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mem = slate();
    mem.games[0] = { gameId: '101', startTime: NOW.toISOString(), status: 'Scheduled' };
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem, calls),
    });
    const attemptCall = calls.find((call) => call.sql === QUICK_BUILD_ATTEMPTS_SQL);
    expect(attemptCall?.params[0]).toEqual(['102']);
    expect(result.emptyReason).toBe('NO_CROSS_GAME');
  });

  it('throws when an eligible snapshot row has a bad observation timestamp', async () => {
    const mem = slate();
    mem.snaps = mem.snaps.map((snap) => (snap.gameId === '101' ? { ...snap, observedAt: 'not-a-time' } : snap));
    await expect(
      buildResearchQuickBuildRequest({
        sportsbook: 'draftkings',
        preset: 'higher_payout',
        now: NOW,
        query: reader(mem),
      })
    ).rejects.toMatchObject({ code: 'MALFORMED_INPUT' });
  });

  it('throws when an eligible snapshot row has no line', async () => {
    const mem = slate();
    mem.snaps.push({
      pullRunId: '2',
      gameId: '101',
      playerId: '11',
      propType: 'points',
      marketType: 'over_under',
      side: 'over',
      line: null,
      sportsbook: 'draftkings',
      odds: -200,
      observedAt: OBS,
      clock: 'RESPONSE_RECEIVED',
    });
    await expect(
      buildResearchQuickBuildRequest({
        sportsbook: 'draftkings',
        preset: 'higher_payout',
        now: NOW,
        query: reader(mem),
      })
    ).rejects.toMatchObject({ code: 'MALFORMED_INPUT' });
  });

  it('passes duplicate prices through and leaves an unsupported market behind', async () => {
    const mem = slate();
    mem.snaps.push(
      ...bothSides({ pullRunId: '2', gameId: '101', playerId: '11' }),
      ...bothSides({ pullRunId: '2', gameId: '101', playerId: '11', propType: 'steals', line: '1.5' })
    );
    const request = await buildResearchQuickBuildRequest({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem),
    });
    const points = request.observations.filter((row) => row.playerId === '11' && row.market === 'points' && row.side === 'over');
    expect(points).toHaveLength(2);
    expect(request.observations.some((row) => row.market === 'steals')).toBe(false);
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem),
    });
    expect(result.status).toBe('ok');
  });

  it('does not invent the missing opposite side', async () => {
    const mem = slate();
    mem.snaps = mem.snaps.filter((snap) => !(snap.playerId === '11' && snap.side === 'under'));
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem),
    });
    expect(result.status).toBe('empty');
    expect(result.emptyReason).toBe('NO_CROSS_GAME');
    expect(result.builds).toEqual([]);
  });

  it('does not fall back to an older pull when the latest pull has no rows for the selected book', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mem = slate();
    mem.runs.push(success('1', '101', '2026-11-09T13:00:00.000Z'), success('7', '102', '2026-11-09T13:00:00.000Z'));
    mem.snaps.push(
      ...bothSides({ pullRunId: '1', gameId: '101', playerId: '11', sportsbook: 'caesars', line: '19.5' }),
      ...bothSides({ pullRunId: '7', gameId: '102', playerId: '22', sportsbook: 'caesars', line: '7.5' })
    );
    const result = await loadResearchQuickBuilds({
      sportsbook: 'caesars',
      preset: 'higher_payout',
      now: NOW,
      query: reader(mem, calls),
    });
    expect(observationPulls(calls).sort()).toEqual(['2', '8']);
    expect(result.emptyReason).toBe('NO_SUCCESSFUL_PULL');
    expect(result.games.every((game) => game.rejection === 'STALE_OBSERVATION')).toBe(true);
    expect(result.games.map((game) => game.stalePullRunId).sort()).toEqual(['2', '8']);
  });

  it('refuses an unsupported sportsbook before querying', async () => {
    const query = vi.fn();
    await expect(
      buildResearchQuickBuildRequest({
        sportsbook: 'bet365',
        preset: 'balanced',
        now: NOW,
        query,
      })
    ).rejects.toBeInstanceOf(QuickBuildInputError);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a bounded-data error at 4001 observations and still allows 4000', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const base = reader(slate(), calls);
    const overCount: QuickBuildReader = async (sql, params) => {
      if (sql === QUICK_BUILD_OBSERVATION_COUNT_SQL) return [{ observation_count: 4001 }];
      return base(sql, params);
    };
    await expect(
      buildResearchQuickBuildRequest({
        sportsbook: 'draftkings',
        preset: 'higher_payout',
        now: NOW,
        query: overCount,
      })
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(calls.some((call) => call.sql === QUICK_BUILD_OBSERVATION_ROWS_SQL)).toBe(false);

    const atCap = await buildResearchQuickBuildRequest({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: async (sql, params) => {
        if (sql === QUICK_BUILD_OBSERVATION_COUNT_SQL) return [{ observation_count: 4000 }];
        return base(sql, params);
      },
    });
    expect(atCap.observations.length).toBeGreaterThan(0);

    await expect(
      buildResearchQuickBuildRequest({
        sportsbook: 'draftkings',
        preset: 'higher_payout',
        now: NOW,
        query: async (sql, params) => {
          if (sql === QUICK_BUILD_OBSERVATION_ROWS_SQL) {
            const rows = await base(sql, params);
            return Array.from({ length: 4001 }, () => rows[0]);
          }
          if (sql === QUICK_BUILD_OBSERVATION_COUNT_SQL) return [{ observation_count: 4 }];
          return base(sql, params);
        },
      })
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('returns a bounded-data error when the slate or its attempts exceed the engine cap', async () => {
    const games = Array.from({ length: 33 }, (_, index) => ({
      gameId: String(200 + index),
      startTime: TIP,
      status: 'Scheduled',
    }));
    await expect(
      buildResearchQuickBuildRequest({
        sportsbook: 'draftkings',
        preset: 'balanced',
        now: NOW,
        query: reader({ games, runs: [], snaps: [] }),
      })
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    const runs = Array.from({ length: 257 }, (_, index) => success(String(index + 1), '101', OBS));
    await expect(
      buildResearchQuickBuildRequest({
        sportsbook: 'draftkings',
        preset: 'balanced',
        now: NOW,
        query: reader({ games: [{ gameId: '101', startTime: TIP, status: 'Scheduled' }], runs, snaps: [] }),
      })
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('propagates a database failure instead of an empty market result', async () => {
    await expect(
      loadResearchQuickBuilds({
        sportsbook: 'draftkings',
        preset: 'balanced',
        now: NOW,
        query: async () => {
          throw new Error('connection reset');
        },
      })
    ).rejects.toThrow('connection reset');
  });

  it('keeps the build when the player name is missing and does not call the props current table', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const base = reader(slate(), calls);
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql === QUICK_BUILD_PLAYERS_SQL) return [];
        return base(sql, params);
      },
    });
    expect(result.status).toBe('ok');
    expect(result.builds.length).toBeGreaterThan(0);
    expect(result.builds[0]?.combinedAmerican).toBe(125);
    expect(result.builds[0]?.legs[0]?.oddsAmerican).toBe(-200);
    expect(result.builds[0]?.legs[0]?.observedAt).toBe(OBS);
    expect(result.builds[0]?.legs.every((leg) => leg.display.displayReady === false)).toBe(true);
    expect(result.builds[0]?.legs.every((leg) => leg.display.unavailableReason === 'MISSING_PLAYER')).toBe(true);
    expect(result.builds[0]?.legs.every((leg) => leg.display.playerName == null)).toBe(true);
    expect(calls.some((call) => call.sql.includes('player_props_current'))).toBe(false);
    const playerCall = calls.find((call) => call.sql === QUICK_BUILD_PLAYERS_SQL);
    expect(playerCall?.params[0]).toEqual(expect.arrayContaining(['11', '22']));
  });

  it('reports a player-catalog failure instead of an empty shortlist', async () => {
    const base = reader(slate());
    await expect(
      loadResearchQuickBuilds({
        sportsbook: 'draftkings',
        preset: 'higher_payout',
        now: NOW,
        query: async (sql, params) => {
          if (sql === QUICK_BUILD_PLAYERS_SQL) throw new Error('players unavailable');
          return base(sql, params);
        },
      })
    ).rejects.toThrow('players unavailable');
  });

  it('keeps All Games on the full slate and limits attempts to a selected subset', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mem = slate();
    mem.games.push({ gameId: '103', startTime: '2026-11-10T02:00:00.000Z', status: 'Scheduled' });
    mem.runs.push(success('9', '103', '2026-11-09T17:10:00.000Z'));
    mem.snaps.push(...bothSides({ pullRunId: '9', gameId: '103', playerId: '33', line: '4.5' }));
    const query = reader(mem, calls);
    const all = await loadResearchQuickBuilds({ sportsbook: 'draftkings', preset: 'higher_payout', now: NOW, query });
    const attemptIds = calls.find((call) => call.sql === QUICK_BUILD_ATTEMPTS_SQL)?.params[0];
    expect(attemptIds).toEqual(['101', '102', '103']);
    expect(all.status).toBe('ok');

    calls.length = 0;
    const selected = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'higher_payout',
      now: NOW,
      query,
      gameIds: ['101', '103'],
    });
    expect(calls.find((call) => call.sql === QUICK_BUILD_ATTEMPTS_SQL)?.params[0]).toEqual(['101', '103']);
    const observedGames = calls.find((call) => call.sql === QUICK_BUILD_OBSERVATION_ROWS_SQL)?.params[1];
    expect((observedGames as number[]).map(String).sort()).toEqual(['101', '103']);
    expect(JSON.stringify(calls)).not.toContain('102');
    expect(selected.builds.every((build) => build.legs.every((leg) => leg.gameId === '101' || leg.gameId === '103'))).toBe(true);
    expect(selected.builds.some((build) => build.legs.some((leg) => leg.gameId === '102'))).toBe(false);
  });

  it('does not read attempts when a selected game is unknown, finished, or already started', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mem = slate();
    mem.games.push(
      { gameId: '201', startTime: '2026-11-09T17:00:00.000Z', status: 'Scheduled' },
      { gameId: '202', startTime: TIP, status: 'Final' },
      { gameId: '203', startTime: TIP, status: 'In Progress' },
      { gameId: '204', startTime: '2026-11-11T00:00:00.000Z', status: 'Scheduled' },
    );
    const query = reader(mem, calls);
    await expect(
      buildResearchQuickBuildRequest({ sportsbook: 'draftkings', preset: 'balanced', now: NOW, query, gameIds: ['101', '999'] }),
    ).rejects.toMatchObject({ code: 'INELIGIBLE_GAME' });
    await expect(
      buildResearchQuickBuildRequest({ sportsbook: 'draftkings', preset: 'balanced', now: NOW, query, gameIds: ['101', '201'] }),
    ).rejects.toMatchObject({ code: 'INELIGIBLE_GAME' });
    await expect(
      buildResearchQuickBuildRequest({ sportsbook: 'draftkings', preset: 'balanced', now: NOW, query, gameIds: ['101', '202'] }),
    ).rejects.toMatchObject({ code: 'INELIGIBLE_GAME' });
    await expect(
      buildResearchQuickBuildRequest({ sportsbook: 'draftkings', preset: 'balanced', now: NOW, query, gameIds: ['101', '204'] }),
    ).rejects.toMatchObject({ code: 'INELIGIBLE_GAME' });
    expect(calls.some((call) => call.sql === QUICK_BUILD_ATTEMPTS_SQL)).toBe(false);
    expect(calls.some((call) => call.sql === QUICK_BUILD_OBSERVATION_ROWS_SQL)).toBe(false);
  });

  it('returns an empty snapshot when the selected games have no usable observations', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mem = slate();
    mem.snaps = [];
    const result = await loadResearchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'balanced',
      now: NOW,
      query: reader(mem, calls),
      gameIds: ['101', '102'],
    });
    expect(result.status).toBe('empty');
    expect(result.builds).toEqual([]);
    expect(calls.find((call) => call.sql === QUICK_BUILD_ATTEMPTS_SQL)?.params[0]).toEqual(['101', '102']);
  });
});

describe('eligible game discovery', () => {
  function slateReader(rows: Record<string, unknown>[]): QuickBuildReader {
    return async (sql, params = []) => {
      expect(sql).toBe(QUICK_BUILD_SLATE_SQL);
      expect(params).toEqual(['2026-11-09', NOW.toISOString()]);
      expect(sql).not.toContain('101');
      return rows;
    };
  }

  it('returns today\'s future scheduled games in start order with verified abbreviations', async () => {
    const slate = await loadResearchSlate({
      now: NOW,
      query: slateReader([
        { game_id: '102', start_time: '2026-11-10T01:00:00.000Z', status: '7:00 pm', away_abbr: 'nyk', home_abbr: 'bos' },
        { game_id: '101', start_time: TIP, status: '2026-11-10T00:00:00.000Z', away_abbr: 'LAL', home_abbr: 'DEN' },
        { game_id: '301', start_time: TIP, status: 'Final', away_abbr: 'MIA', home_abbr: 'PHI' },
        { game_id: '302', start_time: TIP, status: 'In Progress', away_abbr: 'CHI', home_abbr: 'MIL' },
        { game_id: '303', start_time: '2026-11-09T17:00:00.000Z', status: 'Scheduled', away_abbr: 'DAL', home_abbr: 'HOU' },
        { game_id: '104', start_time: '2026-11-10T02:00:00.000Z', status: 'Scheduled', away_abbr: 'not-a-team', home_abbr: 'GSW' },
      ]),
    });
    expect(slate.games.map((game) => game.gameId)).toEqual(['101', '102', '104']);
    expect(slate.games[0]).toMatchObject({ label: 'LAL @ DEN', awayAbbreviation: 'LAL', homeAbbreviation: 'DEN' });
    expect(slate.games[1]?.label).toBe('NYK @ BOS');
    expect(slate.games[2]).toMatchObject({ label: null, awayAbbreviation: null, homeAbbreviation: 'GSW' });
    expect(JSON.stringify(slate)).not.toContain('MIA');
    expect(JSON.stringify(slate)).not.toContain('not-a-team');
  });

  it('keeps a future tip timestamp eligible and rejects live, final, and already-started games', async () => {
    const pastIso = '2026-11-09T17:00:00.000Z';
    expect(normalizeGameStatus(pastIso)).toBe('Scheduled');
    expect(normalizeGameStatus('1st Qtr')).toBe('In Progress');
    expect(normalizeGameStatus('Final/OT')).toBe('Unknown');
    const slate = await loadResearchSlate({
      now: NOW,
      query: slateReader([
        { game_id: '101', start_time: TIP, status: TIP, away_abbr: 'LAL', home_abbr: 'DEN' },
        { game_id: '401', start_time: pastIso, status: pastIso, away_abbr: 'DAL', home_abbr: 'MIN' },
        { game_id: '402', start_time: TIP, status: 'Halftime', away_abbr: 'TOR', home_abbr: 'PHI' },
        { game_id: '403', start_time: TIP, status: '1st Qtr', away_abbr: 'BOS', home_abbr: 'NYK' },
        { game_id: '404', start_time: TIP, status: 'End of 3rd Qtr', away_abbr: 'CHI', home_abbr: 'MIL' },
        { game_id: '405', start_time: TIP, status: 'OT', away_abbr: 'MIA', home_abbr: 'ORL' },
        { game_id: '406', start_time: TIP, status: '2OT', away_abbr: 'GSW', home_abbr: 'LAC' },
        { game_id: '407', start_time: TIP, status: 'Final/OT', away_abbr: 'DEN', home_abbr: 'UTA' },
        { game_id: '408', start_time: TIP, status: 'Postponed', away_abbr: 'SAS', home_abbr: 'HOU' },
        { game_id: '409', start_time: TIP, status: 'Delayed', away_abbr: 'ATL', home_abbr: 'WAS' },
        { game_id: '410', start_time: TIP, status: '5:43', away_abbr: 'DAL', home_abbr: 'MIN' },
      ]),
    });
    expect(slate.games.map((game) => game.gameId)).toEqual(['101']);
  });

  it('returns no games when the slate has none and rejects a slate over the cap', async () => {
    const empty = await loadResearchSlate({ now: NOW, query: slateReader([]) });
    expect(empty.games).toEqual([]);
    const rows = Array.from({ length: 33 }, (_, index) => ({
      game_id: String(400 + index),
      start_time: TIP,
      status: 'Scheduled',
      away_abbr: 'BOS',
      home_abbr: 'NYK',
    }));
    await expect(loadResearchSlate({ now: NOW, query: slateReader(rows) })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('rejects duplicate and malformed selections instead of searching every game', () => {
    expect(parseSelectedGameIds('101,102')).toEqual({ ok: true, ids: ['101', '102'] });
    expect(parseSelectedGameIds('101,101').ok).toBe(false);
    expect(parseSelectedGameIds('101,abc').ok).toBe(false);
    const one = parseSelectedGameIds('101');
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.code).toBe('NEED_TWO_GAMES');
  });
});
