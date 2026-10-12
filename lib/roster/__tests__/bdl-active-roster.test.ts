import { describe, expect, it } from 'vitest';

import {
  BDL_ACTIVE_ROSTER_URL,
  BDL_ROSTER_DEFAULT_MAX_REQUESTS,
  CURRENT_NBA_ABBREVIATIONS,
  activeRosterUrl,
  collectBdlActiveRoster,
  parseActivePlayersPage,
  parseBdlRosterCollectArgs,
  validateLeagueObservation,
  type ActiveRosterPlayer,
  type RosterTransportResponse,
} from '@/lib/roster/bdl-active-roster';

function league(perTeam = 15): ActiveRosterPlayer[] {
  const players: ActiveRosterPlayer[] = [];
  let id = 1;
  CURRENT_NBA_ABBREVIATIONS.forEach((abbreviation, index) => {
    for (let slot = 0; slot < perTeam; slot += 1) {
      players.push({
        providerPlayerId: String(id),
        providerTeamId: String(100 + index),
        teamAbbreviation: abbreviation,
      });
      id += 1;
    }
  });
  return players;
}

function bodyFor(players: ActiveRosterPlayer[], start: number) {
  const slice = players.slice(start, start + 100);
  const next = start + 100 < players.length ? start + 100 : null;
  return {
    data: slice.map((player) => ({
      id: Number(player.providerPlayerId),
      team: { id: Number(player.providerTeamId), abbreviation: player.teamAbbreviation },
    })),
    meta: { next_cursor: next, per_page: 100 },
  };
}

function pagingTransport(players: ActiveRosterPlayer[], calls: string[]) {
  return async (url: string): Promise<RosterTransportResponse> => {
    calls.push(url);
    const cursor = new URL(url).searchParams.get('cursor');
    const start = cursor ? Number(cursor) : 0;
    return { status: 200, body: bodyFor(players, start) };
  };
}

const observedAt = '2026-10-12T00:27:56.640Z';

describe('BallDontLie active roster collection', () => {
  it('parses one page and stops when the cursor is absent', async () => {
    const players = league();
    const calls: string[] = [];
    const result = await collectBdlActiveRoster({
      observedAt,
      transport: pagingTransport(players, calls),
    });
    expect(result.validation.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.paginationComplete).toBe(true);
    expect(result.players).toHaveLength(450);
    expect(result.successfulPages).toBe(5);
    expect(result.requestCount).toBe(5);
    expect(Object.keys(result.teamCounts)).toHaveLength(30);
    expect(calls[0]).toBe(`${BDL_ACTIVE_ROSTER_URL}?per_page=100`);
    expect(activeRosterUrl(null)).toContain('/nba/v1/players/active');
  });

  it('follows cursors across pages', async () => {
    const calls: string[] = [];
    const result = await collectBdlActiveRoster({
      observedAt,
      transport: pagingTransport(league(), calls),
    });
    expect(calls.map((url) => new URL(url).searchParams.get('cursor'))).toEqual([null, '100', '200', '300', '400']);
    expect(result.players[100]?.providerPlayerId).toBe('101');
  });

  it('stops on a repeated cursor without another request', async () => {
    const calls: string[] = [];
    const result = await collectBdlActiveRoster({
      observedAt,
      transport: async (url) => {
        calls.push(url);
        const cursor = new URL(url).searchParams.get('cursor');
        return {
          status: 200,
          body: {
            data: [{ id: 1, team: { id: 22, abbreviation: 'ORL' } }],
            meta: { next_cursor: cursor ?? 10, per_page: 100 },
          },
        };
      },
    });
    expect(result.error).toBe('repeated_cursor');
    expect(result.paginationComplete).toBe(false);
    expect(result.validation.failures).toContain('repeated_cursor');
    expect(calls).toHaveLength(2);
  });

  it('rejects a malformed page', async () => {
    const result = await collectBdlActiveRoster({
      observedAt,
      transport: async () => ({ status: 200, body: { data: 'no' } }),
    });
    expect(result.error).toBe('malformed');
    expect(parseActivePlayersPage(null).ok).toBe(false);
  });

  it('rejects a missing player id', async () => {
    const result = await collectBdlActiveRoster({
      observedAt,
      transport: async () => ({ status: 200, body: { data: [{ team: { id: 22, abbreviation: 'ORL' } }], meta: { next_cursor: null, per_page: 100 } } }),
    });
    expect(result.error).toBe('missing_player_id');
    expect(result.missingPlayerIds).toBe(1);
  });

  it('rejects a missing team', async () => {
    const result = await collectBdlActiveRoster({
      observedAt,
      transport: async () => ({ status: 200, body: { data: [{ id: 9 }], meta: { next_cursor: null, per_page: 100 } } }),
    });
    expect(result.error).toBe('missing_team');
    expect(result.missingTeams).toBeGreaterThan(0);
  });

  it('reports a duplicate player id', () => {
    const players = league();
    players.push({ ...players[0]! });
    const result = validateLeagueObservation({
      provider: 'balldontlie',
      endpoint: '/nba/v1/players/active',
      seasonLabel: '2026-27',
      observedAt,
      paginationComplete: true,
      repeatedCursor: false,
      players,
      perPageMismatch: false,
    });
    expect(result.failures).toContain('duplicate_player');
    expect(result.ok).toBe(false);
  });

  it('reports an unexpected team abbreviation', () => {
    const players = league();
    players[0] = { ...players[0]!, teamAbbreviation: 'XXX' };
    const result = validateLeagueObservation({
      provider: 'balldontlie',
      endpoint: '/nba/v1/players/active',
      seasonLabel: '2026-27',
      observedAt,
      paginationComplete: true,
      repeatedCursor: false,
      players,
      perPageMismatch: false,
    });
    expect(result.failures).toContain('unexpected_team');
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
  ] as const)('stops on HTTP %s without a retry', async (status, error) => {
    let calls = 0;
    const result = await collectBdlActiveRoster({
      observedAt,
      transport: async () => {
        calls += 1;
        return { status, body: null, retryAfter: status === 429 ? '13' : null };
      },
    });
    expect(result.error).toBe(error);
    expect(calls).toBe(1);
    expect(result.validation.ok).toBe(false);
  });

  it('stops on a timeout', async () => {
    const result = await collectBdlActiveRoster({
      observedAt,
      transport: async () => {
        throw Object.assign(new Error('request timeout'), { name: 'TimeoutError' });
      },
    });
    expect(result.error).toBe('timeout');
  });

  it('stops when the request budget is exhausted and does not invent the remaining teams', async () => {
    const result = await collectBdlActiveRoster({
      observedAt,
      maxRequests: 1,
      transport: pagingTransport(league(), []),
    });
    expect(result.error).toBe('budget');
    expect(result.requestCount).toBe(1);
    expect(result.players).toHaveLength(100);
    expect(result.validation.failures).toContain('pagination');
    expect(result.validation.ok).toBe(false);
  });

  it('rejects a missing team, an empty team, a cross-team conflict, a count shift, a bad season, and a missing timestamp', () => {
    const players = league();
    const missing = validateLeagueObservation({
      provider: 'balldontlie',
      endpoint: '/nba/v1/players/active',
      seasonLabel: '2026-27',
      observedAt,
      paginationComplete: true,
      repeatedCursor: false,
      players: players.filter((player) => player.teamAbbreviation !== 'MIL'),
      perPageMismatch: false,
    });
    expect(missing.failures).toContain('missing_team');

    const sizes = Object.fromEntries(CURRENT_NBA_ABBREVIATIONS.map((abbreviation) => [abbreviation, abbreviation === 'MIL' ? 0 : 15]));
    const empty = validateLeagueObservation({
      provider: 'balldontlie',
      endpoint: '/nba/v1/players/active',
      seasonLabel: '2026-27',
      observedAt,
      paginationComplete: true,
      repeatedCursor: false,
      players,
      perPageMismatch: false,
      teamSizes: sizes,
    });
    expect(empty.failures).toContain('empty_team');

    const conflicted = league();
    conflicted[0] = { ...conflicted[0]!, providerTeamId: '999', teamAbbreviation: 'MIL' };
    const conflict = validateLeagueObservation({
      provider: 'balldontlie',
      endpoint: '/nba/v1/players/active',
      seasonLabel: '2026-27',
      observedAt,
      paginationComplete: true,
      repeatedCursor: false,
      players: [...league().slice(0, 1), conflicted[0]!],
      perPageMismatch: false,
    });
    expect(conflict.failures).toContain('team_conflict');

    const shifted = validateLeagueObservation({
      provider: 'balldontlie',
      endpoint: '/nba/v1/players/active',
      seasonLabel: '2026-27',
      observedAt,
      paginationComplete: true,
      repeatedCursor: false,
      players,
      perPageMismatch: false,
      priorLeagueCount: 600,
    });
    expect(shifted.failures).toContain('coverage_shift');

    const season = validateLeagueObservation({
      provider: 'balldontlie',
      endpoint: '/nba/v1/players/active',
      seasonLabel: '2025-26',
      observedAt,
      paginationComplete: true,
      repeatedCursor: false,
      players,
      perPageMismatch: false,
    });
    expect(season.failures).toContain('season');

    const timestamp = validateLeagueObservation({
      provider: 'balldontlie',
      endpoint: '/nba/v1/players/active',
      seasonLabel: '2026-27',
      observedAt: null,
      paginationComplete: true,
      repeatedCursor: false,
      players,
      perPageMismatch: false,
    });
    expect(timestamp.failures).toContain('timestamp');
  });

  it('rejects an unfinished pagination even when rows are present', () => {
    const result = validateLeagueObservation({
      provider: 'balldontlie',
      endpoint: '/nba/v1/players/active',
      seasonLabel: '2026-27',
      observedAt,
      paginationComplete: false,
      repeatedCursor: false,
      players: league(),
      perPageMismatch: false,
    });
    expect(result.failures).toContain('pagination');
  });

  it('requires an explicit dry-run or apply and keeps dry-run ahead of apply', () => {
    expect(parseBdlRosterCollectArgs(['--season=2026-27']).ok).toBe(false);
    expect(parseBdlRosterCollectArgs(['--season=2026-27', '--dry-run'])).toMatchObject({ apply: false });
    expect(parseBdlRosterCollectArgs(['--season=2026-27', '--apply'])).toMatchObject({ apply: true });
    expect(parseBdlRosterCollectArgs(['--season=2026-27', '--apply', '--dry-run'])).toMatchObject({ apply: false });
    expect(parseBdlRosterCollectArgs(['--season=2026-27', '--dry-run', '--max-requests=13']).ok).toBe(false);
    expect(BDL_ROSTER_DEFAULT_MAX_REQUESTS).toBe(12);
  });
});
