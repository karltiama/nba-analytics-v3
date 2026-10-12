import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PregameMatchupView } from '@/components/scoreboard/PregameMatchupView';
import { buildPregameMatchup, SAMPLE_LABEL } from '@/lib/pregame-matchup/compose';
import { historicalWindow } from '@/lib/pregame-matchup/window';
import {
  rosterMembershipQuery,
  rosterOtherTeamQuery,
  rosterSnapshotDaysQuery,
  rosterTeamProductionQuery,
} from '@/lib/pregame-matchup/queries';
import {
  CONCENTRATION_FGA_SHARE,
  calendarDaysBetween,
  classifyRosterIdentity,
  dayIsComplete,
  presentRoster,
  rosterFreshness,
  selectQualifyingDay,
  teamContinuity,
  type ProductionRow,
  type RosterDaySummary,
  type RosterMember,
} from '@/lib/pregame-matchup/roster';
import { selectMatchupInsights } from '@/lib/pregame-matchup/signals';
import type { TeamProfile } from '@/lib/pregame-matchup/aggregate';

const GAME = '2026-10-11';

function day(over: Partial<RosterDaySummary> = {}): RosterDaySummary {
  return {
    snapshotDate: '2026-10-10',
    observations: 540,
    teams: 30,
    players: 540,
    minTeamSize: 15,
    crossTeamDuplicates: 0,
    missingAnalyticsTeam: 0,
    collectedAt: '2026-10-10T16:00:00.000Z',
    ...over,
  };
}

function member(over: Partial<RosterMember> = {}): RosterMember {
  return { teamId: '22', nbaPlayerId: 'nba-1', analyticsPlayerId: '101', name: 'Returning Guard', ...over };
}

function prod(over: Partial<ProductionRow> = {}): ProductionRow {
  return {
    teamId: '22',
    playerId: '101',
    minutes: 1000,
    fga: 400,
    fta: 100,
    usageMass: 80,
    usagePossessions: 400,
    ...over,
  };
}

function profile(teamId: string): TeamProfile {
  return {
    teamId,
    games: 82,
    offensiveRating: 112,
    defensiveRating: 112,
    netRating: 0,
    estimatedPossessionsPerGame: 100,
    pointsPerGame: 112,
    pointsAllowedPerGame: 112,
    effectiveFieldGoalPct: 0.54,
    threePointAttemptRate: 0.4,
    offensiveReboundRate: 0.25,
    opponentOffensiveReboundRate: 0.25,
    turnoverRate: 0.12,
  };
}

describe('roster snapshot selection', () => {
  it('keeps the 2026-27 season and the observation date, and drops a duplicate or incomplete day', () => {
    const query = rosterSnapshotDaysQuery(GAME);
    expect(query.params).toEqual(['2026', '2026-27', GAME]);
    expect(query.text).not.toMatch(/insert|update|delete|merge|analytics\.games/i);
    expect(dayIsComplete(day())).toBe(true);
    expect(dayIsComplete(day({ teams: 29, minTeamSize: 0 }))).toBe(false);
    expect(dayIsComplete(day({ crossTeamDuplicates: 1 }))).toBe(false);
    expect(dayIsComplete(day({ missingAnalyticsTeam: 2 }))).toBe(false);
    expect(dayIsComplete(day({ collectedAt: null }))).toBe(false);
    const chosen = selectQualifyingDay(
      [day({ snapshotDate: '2026-10-09', teams: 12, minTeamSize: 0 }), day({ snapshotDate: '2026-10-08' })],
      GAME
    );
    expect(chosen?.snapshotDate).toBe('2026-10-08');
  });

  it('treats a five-week-old list as stale and a recent list as fresh', () => {
    expect(calendarDaysBetween('2026-09-05', GAME)).toBe(36);
    expect(rosterFreshness(36)).toBe('stale');
    expect(rosterFreshness(1)).toBe('fresh');
    expect(rosterFreshness(16)).toBe('informative');
    const stale = presentRoster({ gameDate: GAME, day: day({ snapshotDate: '2026-09-05', collectedAt: '2026-09-05T00:14:09Z' }), teams: [] });
    expect(stale.status).toBe('hidden');
    expect(stale.observationDate).toBe('2026-09-05');
    expect(stale.note).toMatch(/too old/);
    expect(stale.note).not.toMatch(/traded|waived|signed|injured|departed|starter/i);
  });

  it('keeps a snapshot dated after the game off that game, including a UTC date that has already rolled', () => {
    expect(queryText()).toContain('snapshot_date <= $3::date');
    const later = day({ snapshotDate: '2026-10-12' });
    const sameDay = day({ snapshotDate: '2026-10-11' });
    const earlier = day({ snapshotDate: '2026-09-05', collectedAt: '2026-09-05T00:14:09Z' });
    expect(selectQualifyingDay([later, sameDay], GAME)?.snapshotDate).toBe('2026-10-11');
    expect(selectQualifyingDay([later, earlier], GAME)?.snapshotDate).toBe('2026-09-05');
    expect(selectQualifyingDay([later], GAME)).toBeNull();
    const onDate = presentRoster({ gameDate: GAME, day: sameDay, teams: [] });
    expect(onDate.freshness === 'fresh' || onDate.freshness === 'unresolved').toBe(true);
    const after = presentRoster({ gameDate: GAME, day: later, teams: [] });
    expect(after.freshness).toBe('incomplete');
    expect(after.status).toBe('hidden');
  });
});

function queryText(): string {
  return rosterSnapshotDaysQuery(GAME).text;
}

describe('roster continuity math', () => {
  const window = historicalWindow();

  it('uses the regular-season fence and ignores zero-minute rows, other-team shots, and unresolved players in the numerator', () => {
    const production = rosterTeamProductionQuery(window, ['22', '6']);
    expect(production.params).toEqual(['2025', ['22', '6'], '2025-10-21', '2026-04-14', '2025-12-16']);
    expect(production.text).toContain('free_throws_attempted');
    expect(production.text).not.toMatch(/insert|update|delete|analytics\.games/i);
    const other = rosterOtherTeamQuery(window, ['22', '6'], ['101']);
    expect(other.params[0]).toBe('2025');
    expect(other.text).not.toMatch(/analytics\.games/);

    const team = teamContinuity({
      teamId: '22',
      abbr: 'ORL',
      observationDate: '2026-10-10',
      members: [
        member(),
        member({ nbaPlayerId: 'nba-2', analyticsPlayerId: '202', name: 'Arrived Elsewhere' }),
        member({ nbaPlayerId: 'nba-3', analyticsPlayerId: '303', name: 'No Games' }),
        member({ nbaPlayerId: 'nba-4', analyticsPlayerId: null, name: 'Unresolved' }),
        member({ nbaPlayerId: 'nba-1', analyticsPlayerId: '101', name: 'Returning Guard' }),
      ],
      production: [
        prod(),
        prod({ playerId: '101', teamId: '6', minutes: 50, fga: 20, fta: 5 }),
        prod({ playerId: '202', teamId: '6', minutes: 800, fga: 300, fta: 40 }),
        prod({ playerId: '404', teamId: '22', minutes: 500, fga: 200, fta: 20 }),
        prod({ playerId: '505', teamId: '22', minutes: 0, fga: 99, fta: 99 }),
      ],
    });
    expect(team.returning).toBe(1);
    expect(team.otherTeam).toBe(1);
    expect(team.noPriorHistory).toBe(1);
    expect(team.unresolved).toBe(1);
    expect(team.minutesNumerator).toBe(1000);
    expect(team.minutesDenominator).toBe(1500);
    expect(team.minutesShare).toBeCloseTo(1000 / 1500);
    expect(team.fgaNumerator).toBe(400);
    expect(team.fgaDenominator).toBe(600);
    expect(team.fgaShare).toBeCloseTo(400 / 600);
    expect(team.ftaNumerator).toBe(100);
    expect(team.ftaDenominator).toBe(120);
    expect(team.ftaShare).toBeCloseTo(100 / 120);
  });

  it('suppresses the percentage when unresolved identities could move it, and shows a dated share when they cannot', () => {
    const members = Array.from({ length: 10 }, (_, index) =>
      member({
        nbaPlayerId: `nba-${index}`,
        analyticsPlayerId: index < 2 ? null : String(100 + index),
        name: `Player ${index}`,
      })
    );
    const distorted = teamContinuity({
      teamId: '22',
      abbr: 'ORL',
      observationDate: '2026-10-10',
      members,
      production: [prod({ playerId: '102', minutes: 100, fga: 40, fta: 10 })],
    });
    const hidden = presentRoster({ gameDate: GAME, day: day(), teams: [distorted, distorted] });
    expect(hidden.status).toBe('hidden');
    expect(hidden.freshness).toBe('unresolved');
    expect(JSON.stringify(hidden)).not.toMatch(/\d+(\.\d+)?%/);

    const clean = teamContinuity({
      teamId: '22',
      abbr: 'ORL',
      observationDate: '2026-10-10',
      members: [
        member({ nbaPlayerId: 'a', analyticsPlayerId: '1', name: 'Star Guard' }),
        member({ nbaPlayerId: 'b', analyticsPlayerId: '2', name: 'Star Forward' }),
        member({ nbaPlayerId: 'c', analyticsPlayerId: null, name: 'One Unknown' }),
        ...Array.from({ length: 9 }, (_, index) =>
          member({ nbaPlayerId: `extra-${index}`, analyticsPlayerId: `9${index}`, name: `Bench ${index}` })
        ),
      ],
      production: [
        prod({ playerId: '1', minutes: 2000, fga: 900, fta: 200, usageMass: 120, usagePossessions: 400 }),
        prod({ playerId: '2', minutes: 1500, fga: 700, fta: 100, usageMass: 80, usagePossessions: 400 }),
        prod({ playerId: '9', minutes: 500, fga: 100, fta: 20 }),
      ],
    });
    expect(clean.unresolved).toBe(1);
    expect(clean.minutesShare).toBeCloseTo(3500 / 4000);
    expect((clean.fgaNumerator) / clean.fgaDenominator).toBeGreaterThanOrEqual(CONCENTRATION_FGA_SHARE);
    const shown = presentRoster({ gameDate: GAME, day: day(), teams: [clean, { ...clean, teamId: '6', abbr: 'CLE' }] });
    expect(shown.status).toBe('shown');
    expect(shown.observationDate).toBe('2026-10-10');
    expect(shown.note).toMatch(/not confirmation that a player is available/);
    expect(shown.teams?.[0]?.concentration).toMatch(/Star Guard and Star Forward/);
    expect(shown.teams?.[0]?.concentration).toMatch(/30\.0% and 20\.0%/);
    expect(shown.teams?.[0]?.concentration).not.toMatch(/inherit|departed|traded|injured|starting/i);
  });

  it('treats a unique entity with no log id as resolved and keeps a missing bridge unresolved', () => {
    const membership = rosterMembershipQuery('2026-09-05', ['22', '6']);
    expect(membership.text).toContain('nba.player_entity_id');
    expect(membership.text).toContain('analytics.players');
    expect(membership.text).not.toMatch(/similarity|ilike|player_name\s*=/i);

    expect(classifyRosterIdentity({ entityId: null, analyticsPlayerId: null })).toEqual({
      identityStatus: 'unresolved_no_bridge',
      analyticsPlayerId: null,
    });
    expect(classifyRosterIdentity({ entityId: 'entity-1', analyticsPlayerId: null })).toEqual({
      identityStatus: 'resolved',
      analyticsPlayerId: null,
    });
    expect(
      classifyRosterIdentity({ entityId: 'entity-1', analyticsPlayerId: '10', alternatePlayerId: '11' })
    ).toEqual({ identityStatus: 'unresolved_ambiguous', analyticsPlayerId: null });
    expect(classifyRosterIdentity({ entityId: 'entity-1', analyticsPlayerId: '10', alternatePlayerId: '10' })).toEqual({
      identityStatus: 'resolved',
      analyticsPlayerId: '10',
    });

    const team = teamContinuity({
      teamId: '22',
      abbr: 'ORL',
      observationDate: '2026-10-10',
      members: [
        member(),
        member({
          nbaPlayerId: 'nba-rookie-shaped',
          analyticsPlayerId: null,
          identityStatus: 'resolved',
          name: 'No Observed Production',
        }),
        member({
          nbaPlayerId: 'nba-ambiguous',
          analyticsPlayerId: '999',
          identityStatus: 'unresolved_ambiguous',
          name: 'Conflicting Map',
        }),
        member({ nbaPlayerId: 'nba-bridge', analyticsPlayerId: null, identityStatus: 'unresolved_no_bridge', name: 'No Bridge' }),
      ],
      production: [prod(), prod({ playerId: '999', minutes: 400, fga: 100, fta: 20 })],
    });
    expect(team.unresolved).toBe(2);
    expect(team.noPriorHistory).toBe(1);
    expect(team.returning).toBe(1);
    expect(team.minutesNumerator).toBe(1000);
    expect(team.minutesDenominator).toBe(1400);
    expect(team.fgaNumerator).toBe(400);
    expect(team.fgaDenominator).toBe(500);
    expect(team.ftaNumerator).toBe(100);
    expect(team.ftaDenominator).toBe(120);
    expect(team.minutesShare).toBeGreaterThanOrEqual(0);
    expect(team.minutesShare).toBeLessThanOrEqual(1);
    expect(team.fgaShare).toBeGreaterThanOrEqual(0);
    expect(team.fgaShare).toBeLessThanOrEqual(1);
  });

  it('leaves the existing matchup signals alone and still renders history when no roster exists', () => {
    const league = [profile('22'), profile('6')];
    const insights = selectMatchupInsights({
      away: { abbr: 'ORL', profile: league[0]! },
      home: { abbr: 'CLE', profile: league[1]! },
      league,
    });
    expect(insights.every((item) => !String(item.id).includes('roster'))).toBe(true);
    const absent = presentRoster({ gameDate: GAME, day: null, teams: [] });
    expect(absent.note).toBe('Current roster continuity is unavailable.');
    const html = renderToStaticMarkup(
      createElement(PregameMatchupView, {
        model: {
          gameId: '21826166',
          awayAbbr: 'ORL',
          awayName: 'Orlando Magic',
          homeAbbr: 'CLE',
          homeName: 'Cleveland Cavaliers',
          tipLabel: '6:30 PM EDT',
          seasonLabel: 'Preseason',
          statusLabel: 'Scheduled',
          updatedLabel: 'Scoreboard Updated 5:49 PM EDT',
          returnHref: '/dashboard?date=2026-10-11',
          history: { label: SAMPLE_LABEL, possessionNote: 'Estimated possessions are a box-score estimate, not official NBA pace, and are not adjusted for overtime.', rows: [] },
          historyNote: null,
          insights: [],
          contributors: null,
          roster: absent,
          quote: null,
          quoteNote: 'No verified pregame price is available.',
        },
      })
    );
    expect(html).toContain('2025–26 Team Identity');
    expect(html).toContain('Roster Continuity');
    expect(html).toContain('Current roster continuity is unavailable.');
    expect(html).not.toMatch(/traded|waived|injured|departed usage|starter/i);
  });

  it('does not attach a continuity percentage when the scoreboard team is unconfirmed', () => {
    const shown = presentRoster({
      gameDate: GAME,
      day: day(),
      teams: [
        teamContinuity({
          teamId: '22',
          abbr: 'ORL',
          observationDate: '2026-10-10',
          members: [member()],
          production: [prod()],
        }),
      ],
    });
    const model = buildPregameMatchup({
      gameId: '1',
      awayTeamId: '22',
      homeTeamId: '6',
      awayAbbr: 'ORL',
      awayName: 'Orlando Magic',
      homeAbbr: 'CLE',
      homeName: 'Cleveland Cavaliers',
      tipLabel: '6:30 PM EDT',
      seasonLabel: 'Preseason',
      statusLabel: 'Scheduled',
      updatedLabel: 'Updated',
      returnHref: '/dashboard',
      identityConfirmed: false,
      teamRows: [],
      playerRows: [],
      roster: shown,
      quote: { quote: null, note: 'No verified pregame price is available.' },
    });
    expect(model.roster.status).toBe('hidden');
    expect(model.roster.teams).toBeNull();
    expect(model.insights).toEqual([]);
  });
});
