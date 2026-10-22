import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PregameMatchupView } from '@/components/scoreboard/PregameMatchupView';
import { buildPregameMatchup } from '@/lib/pregame-matchup/compose';
import { loadRosterContinuity } from '@/lib/pregame-matchup/roster-load';
import { presentBdlRoster, teamContinuity } from '@/lib/pregame-matchup/roster';
import { historicalWindow } from '@/lib/pregame-matchup/window';
import { explainRosterEligibility, rosterObservationEtDate } from '@/lib/roster/bdl-roster-read';

const STORED = '2026-10-12T12:15:55.474Z';
const BATCH_ID = '65912e16-9343-51b0-8e29-9cbb99ada16b';

function batch(over: Record<string, unknown> = {}) {
  return {
    batch_id: BATCH_ID,
    provider: 'balldontlie',
    season_label: '2026-27',
    collected_at: STORED,
    status: 'complete',
    gate_ok: true,
    team_count: 30,
    player_count: 624,
    ...over,
  };
}

function member(abbr: string, playerId: string, over: Record<string, unknown> = {}) {
  return {
    provider_player_id: playerId,
    provider_team_id: abbr === 'BOS' ? '2' : abbr === 'MIL' ? '17' : '9',
    team_abbreviation: abbr,
    historical_player_id: playerId,
    player_name: `Player ${playerId}`,
    player_rows: 1,
    has_prior_season_production: true,
    ...over,
  };
}

const MAP = [
  { provider_team_id: '2', abbreviation: 'BOS', analytics_team_id: '2' },
  { provider_team_id: '9', abbreviation: 'DET', analytics_team_id: '9' },
  { provider_team_id: '17', abbreviation: 'MIL', analytics_team_id: '17' },
];

function production(teamId: string, playerId: string, minutes: number, fga: number, fta: number) {
  return {
    team_id: teamId,
    player_id: playerId,
    minutes,
    fga,
    fta,
    usage_mass: 0,
    usage_possessions: 0,
  };
}

function fakeSql(input: {
  stored?: Record<string, unknown> | null;
  latest?: Record<string, unknown> | null;
  members?: Record<string, unknown>[];
  production?: Record<string, unknown>[];
  map?: Record<string, unknown>[];
}) {
  const calls: string[] = [];
  const run = async (text: string, params?: unknown[]) => {
    calls.push(text);
    expect(text).not.toContain('nba_roster_snapshots');
    if (text.includes('collected_at <')) {
      const tipoff = Date.parse(String(params?.[2]));
      const row = input.stored;
      if (!row) return [];
      return Date.parse(String(row.collected_at)) < tipoff ? [row] : [];
    }
    if (text.includes('roster_observation_batches')) return input.latest ? [input.latest] : [];
    if (text.includes('FROM raw.teams')) return input.map ?? MAP;
    if (text.includes('roster_observation_members')) {
      const abbr = String(params?.[1]);
      return (input.members ?? []).filter((row) => row.team_abbreviation === abbr);
    }
    if (text.includes('NOT (l.team_id')) return [];
    if (text.includes('player_game_logs')) return input.production ?? [];
    throw new Error(text);
  };
  return { run, calls };
}

describe('BallDontLie matchup continuity', () => {
  it('uses the stored batch before an October 20 tipoff and keeps the existing share arithmetic', async () => {
    const sql = fakeSql({
      stored: batch(),
      members: [
        member('BOS', '10'),
        member('BOS', '11', { historical_player_id: null, player_rows: 0, has_prior_season_production: false, player_name: null }),
        member('DET', '20'),
      ],
      production: [
        production('2', '10', 100, 40, 10),
        production('2', '99', 300, 60, 30),
        production('9', '20', 200, 80, 20),
      ],
    });
    const roster = await loadRosterContinuity(sql.run, {
      gameDate: '2026-10-20',
      tipoffAt: '2026-10-20T23:00:00.000Z',
      teamIds: ['2', '9'],
      awayAbbr: 'BOS',
      homeAbbr: 'DET',
      window: historicalWindow(),
    });
    expect(roster.status).toBe('shown');
    expect(roster.freshness).toBe('informative');
    expect(roster.source).toBe('balldontlie');
    expect(roster.collectedAt).toBe(STORED);
    expect(roster.observationDate).toBe('2026-10-12');
    expect(roster.note).toContain('Roster observation: Oct 12, 2026');
    expect(roster.note).toContain('older than a week');
    expect(roster.note).not.toMatch(/confirmed active|official game-day|starting lineup|injury-cleared|confirmed departure/i);
    const bos = roster.teams?.find((team) => team.abbr === 'BOS');
    expect(bos?.minutesShare).toBeCloseTo(0.25, 6);
    expect(bos?.fgaShare).toBeCloseTo(0.4, 6);
    expect(bos?.ftaShare).toBeCloseTo(0.25, 6);
    expect(bos?.returning).toBe(1);
    expect(bos?.noPriorHistory).toBe(1);
    expect(bos?.unresolved).toBe(0);
    expect(bos?.minutesNumerator).toBe(100);
    expect(bos?.minutesDenominator).toBe(400);
    expect(sql.calls.some((text) => text.includes('nba_roster_snapshots'))).toBe(false);
    expect(sql.calls).toHaveLength(6);
    const boston = roster.listedPlayers?.filter((player) => player.teamId === '2');
    expect(boston?.map((player) => player.name)).toEqual(['Player 10', null]);
    expect(boston?.every((player) => player.identityStatus === 'resolved')).toBe(true);
  });

  it('rejects the October 12 observation for an October 11 tipoff', async () => {
    const sql = fakeSql({ stored: batch(), latest: batch() });
    const roster = await loadRosterContinuity(sql.run, {
      gameDate: '2026-10-11',
      tipoffAt: '2026-10-11T23:00:00.000Z',
      teamIds: ['22', '6'],
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
      window: historicalWindow(),
    });
    expect(roster.status).toBe('hidden');
    expect(roster.teams).toBeNull();
    expect(roster.note).toMatch(/after this game tipped off/);
  });

  it('rejects an observation collected at the exact tipoff instant', () => {
    const exact = explainRosterEligibility({
      batches: [{
        batchId: BATCH_ID,
        provider: 'balldontlie',
        seasonLabel: '2026-27',
        collectedAt: STORED,
        status: 'complete',
        teamCount: 30,
        playerCount: 624,
      }],
      tipoffAt: STORED,
      gameEtDate: '2026-10-12',
    });
    expect(exact.reason).toBe('after_tipoff');
    expect(exact.batch).toBeNull();
    expect(exact.sharesAllowed).toBe(false);
  });

  it('hides percentages when no batch exists and when the only batch is incomplete', async () => {
    const missing = await loadRosterContinuity(fakeSql({}).run, {
      gameDate: '2026-10-20',
      tipoffAt: '2026-10-20T23:00:00.000Z',
      teamIds: ['2', '9'],
      awayAbbr: 'BOS',
      homeAbbr: 'DET',
      window: historicalWindow(),
    });
    expect(missing.freshness).toBe('missing');
    expect(missing.teams).toBeNull();

    const incomplete = await loadRosterContinuity(
      fakeSql({ latest: batch({ status: 'incomplete', gate_ok: false }) }).run,
      {
        gameDate: '2026-10-20',
        tipoffAt: '2026-10-20T23:00:00.000Z',
        teamIds: ['2', '9'],
        awayAbbr: 'BOS',
        homeAbbr: 'DET',
        window: historicalWindow(),
      }
    );
    expect(incomplete.freshness).toBe('incomplete');
    expect(incomplete.teams).toBeNull();
  });

  it('labels a same-day observation fresh and a 22-day observation stale', async () => {
    const fresh = await loadRosterContinuity(
      fakeSql({
        stored: batch({ collected_at: '2026-10-20T16:00:00.000Z' }),
        members: [member('BOS', '10'), member('DET', '20')],
        production: [production('2', '10', 100, 40, 10), production('9', '20', 100, 40, 10)],
      }).run,
      {
        gameDate: '2026-10-20',
        tipoffAt: '2026-10-20T23:00:00.000Z',
        teamIds: ['2', '9'],
        awayAbbr: 'BOS',
        homeAbbr: 'DET',
        window: historicalWindow(),
      }
    );
    expect(fresh.freshness).toBe('fresh');
    expect(fresh.note).not.toContain('older than a week');

    const stale = await loadRosterContinuity(
      fakeSql({ stored: batch({ collected_at: '2026-09-01T16:00:00.000Z' }) }).run,
      {
        gameDate: '2026-10-20',
        tipoffAt: '2026-10-20T23:00:00.000Z',
        teamIds: ['2', '9'],
        awayAbbr: 'BOS',
        homeAbbr: 'DET',
        window: historicalWindow(),
      }
    );
    expect(stale.freshness).toBe('stale');
    expect(stale.teams).toBeNull();
    expect(stale.note).toMatch(/too old/);
  });

  it('uses the Eastern calendar date across midnight and the November daylight-saving change', () => {
    expect(rosterObservationEtDate('2026-10-20T03:30:00.000Z')).toBe('2026-10-19');
    expect(rosterObservationEtDate('2026-10-20T04:00:00.000Z')).toBe('2026-10-20');
    expect(rosterObservationEtDate('2026-11-01T05:30:00.000Z')).toBe('2026-11-01');
    expect(rosterObservationEtDate('2026-11-01T06:30:00.000Z')).toBe('2026-11-01');
    const beforeTip = explainRosterEligibility({
      batches: [{
        batchId: BATCH_ID,
        provider: 'balldontlie',
        seasonLabel: '2026-27',
        collectedAt: '2026-11-01T05:30:00.000Z',
        status: 'complete',
        teamCount: 30,
        playerCount: 624,
      }],
      tipoffAt: '2026-11-01T04:00:00.000Z',
      gameEtDate: '2026-10-31',
    });
    expect(beforeTip.reason).toBe('after_tipoff');
    const shown = presentBdlRoster({
      observationEtDate: '2026-10-19',
      collectedAt: '2026-10-20T03:30:00.000Z',
      reason: 'eligible',
      freshness: 'fresh',
      teams: [
        teamContinuity({
          teamId: '2',
          abbr: 'BOS',
          observationDate: '2026-10-19',
          members: [{ teamId: '2', nbaPlayerId: '10', analyticsPlayerId: '10', identityStatus: 'resolved', name: 'A' }],
          production: [{ teamId: '2', playerId: '10', minutes: 10, fga: 4, fta: 1, usageMass: 0, usagePossessions: 0 }],
        }),
      ],
    });
    expect(shown.freshness).toBe('fresh');
    expect(shown.observationDate).toBe('2026-10-19');
  });

  it('fails closed on an unmapped provider team and withholds shares at the unresolved gate', async () => {
    const unmapped = await loadRosterContinuity(
      fakeSql({
        stored: batch(),
        members: [member('DET', '42', { provider_team_id: '42', team_abbreviation: 'DET' }), member('BOS', '10')],
        production: [production('2', '10', 100, 40, 10), production('9', '20', 100, 40, 10)],
      }).run,
      {
        gameDate: '2026-10-20',
        tipoffAt: '2026-10-20T23:00:00.000Z',
        teamIds: ['2', '9'],
        awayAbbr: 'BOS',
        homeAbbr: 'DET',
        window: historicalWindow(),
      }
    );
    expect(unmapped.status).toBe('hidden');
    expect(unmapped.freshness).toBe('unresolved');

    const ambiguous = await loadRosterContinuity(
      fakeSql({
        stored: batch(),
        members: [
          member('BOS', '1', { player_rows: 2 }),
          member('BOS', '2', { player_rows: 2 }),
          member('DET', '20'),
        ],
        production: [production('2', '10', 100, 40, 10), production('9', '20', 100, 40, 10)],
      }).run,
      {
        gameDate: '2026-10-20',
        tipoffAt: '2026-10-20T23:00:00.000Z',
        teamIds: ['2', '9'],
        awayAbbr: 'BOS',
        homeAbbr: 'DET',
        window: historicalWindow(),
      }
    );
    expect(ambiguous.teams).toBeNull();
    expect(ambiguous.note).toMatch(/unresolved player identities/);
  });

  it('resolves Milwaukee through the abbreviation map rather than a substituted id', async () => {
    const sql = fakeSql({
      stored: batch(),
      map: [{ provider_team_id: '17', abbreviation: 'MIL', analytics_team_id: '17' }, ...MAP],
      members: [
        member('MIL', '77'),
        member('BOS', '10'),
      ],
      production: [production('17', '77', 50, 20, 5), production('2', '10', 50, 20, 5)],
    });
    const roster = await loadRosterContinuity(sql.run, {
      gameDate: '2026-10-20',
      tipoffAt: '2026-10-20T23:00:00.000Z',
      teamIds: ['17', '2'],
      awayAbbr: 'MIL',
      homeAbbr: 'BOS',
      window: historicalWindow(),
    });
    expect(roster.teams?.find((team) => team.abbr === 'MIL')?.minutesShare).toBe(1);
  });

  it('renders the provenance note without a confirmed-lineup claim', () => {
    const roster = presentBdlRoster({
      observationEtDate: '2026-10-12',
      collectedAt: STORED,
      reason: 'eligible',
      freshness: 'informative',
      teams: [
        teamContinuity({
          teamId: '2',
          abbr: 'BOS',
          observationDate: '2026-10-12',
          members: [{ teamId: '2', nbaPlayerId: '10', analyticsPlayerId: '10', identityStatus: 'resolved', name: 'A' }],
          production: [{ teamId: '2', playerId: '10', minutes: 10, fga: 4, fta: 1, usageMass: 0, usagePossessions: 0 }],
        }),
      ],
    });
    const html = renderToStaticMarkup(createElement(PregameMatchupView, {
      model: buildPregameMatchup({
        gameId: '21717855',
        awayTeamId: '2',
        homeTeamId: '9',
        awayAbbr: 'BOS',
        awayName: 'Boston Celtics',
        homeAbbr: 'DET',
        homeName: 'Detroit Pistons',
        tipLabel: '3:00 PM EDT',
        seasonLabel: 'Regular season',
        statusLabel: 'Scheduled',
        updatedLabel: 'Scoreboard',
        returnHref: '/dashboard?date=2026-10-20',
        identityConfirmed: true,
        teamRows: [],
        playerRows: [],
        roster,
        quote: { quote: null, note: 'No verified pregame price is available.' },
      }),
    }));
    expect(html).toContain('Roster observation: Oct 12, 2026');
    expect(html).toContain('Players listed by BALLDONTLIE');
    expect(html).toContain('Returning minutes share based on 2025–26 regular-season production');
    expect(html).not.toMatch(/confirmed active|official game-day|starting lineup|injury-cleared/i);
    const page = readFileSync(join(process.cwd(), 'app/scoreboard/games/[gameId]/page.tsx'), 'utf8');
    expect(page).toContain('loadPregameMatchup');
    expect(page).not.toContain('fetch(');
  });
});
