import { describe, expect, it } from 'vitest';
import { classifyWowyGames } from '../eligibility';
import { summarizeWowyPair } from '../aggregate';
import { buildWowyInsights, wowyDiffPolarity } from '../insights';
import { wowyShowsComparisonHero } from '../policy';
import type { WowyLoadedGame, WowyPairQuery } from '../types';

const query: WowyPairQuery = {
  subjectPlayerId: 'A',
  teammatePlayerId: 'B',
  season: '2024',
  teamId: '8',
  seasonType: 'all',
};

function game(
  gameId: string,
  startTime: string,
  extra: Partial<WowyLoadedGame> = {}
): WowyLoadedGame {
  return {
    gameId,
    startTime,
    gameDate: startTime.slice(0, 10),
    season: '2024',
    status: 'Final',
    homeScore: 100,
    awayScore: 90,
    subjectTeamId: '8',
    opponentTeamId: '14',
    opponentAbbr: 'LAL',
    subjectMinutes: '30',
    subjectPts: 20,
    subjectReb: 10,
    subjectAst: 5,
    subjectTpm: 2,
    subjectFga: 16,
    subjectTpa: 6,
    subjectFta: 4,
    teammateRowPresent: true,
    teammateTeamId: '8',
    teammateMinutes: '28',
    teammatePts: 12,
    teammateReb: 3,
    teammateAst: 4,
    teammateTpm: 1,
    teammateFga: 10,
    teammateFta: 2,
    homeTeamId: '8',
    teamPts: null,
    teamReb: null,
    teamAst: null,
    teamTpm: null,
    teamFga: null,
    teamTpa: null,
    teamFta: null,
    teamOppPts: null,
    ...extra,
  };
}

describe('buildWowyInsights', () => {
  it('describes per-game splits without causal or injury language', () => {
    const classified = classifyWowyGames(
      [
        game('w1', '2025-01-02T00:00:00.000Z', { subjectPts: 10 }),
        game('w2', '2025-01-03T00:00:00.000Z', { subjectPts: 10 }),
        game('wo1', '2025-01-06T00:00:00.000Z', { teammateMinutes: '00', subjectPts: 30 }),
        game('wo2', '2025-01-07T00:00:00.000Z', { teammateMinutes: '00', subjectPts: 30 }),
      ],
      query
    );
    const summary = summarizeWowyPair({
      query,
      classified,
      subjectName: 'Player A',
      teammateName: 'Player B',
    });
    const text = buildWowyInsights(summary)
      .map((row) => `${row.title} ${row.body}`)
      .join('\n');
    expect(text).toMatch(/In these games, Player A averaged/);
    expect(text).toMatch(/verified DNP/);
    expect(text).not.toMatch(/causes/i);
    expect(text).not.toMatch(/injured/i);
    expect(text).toMatch(/Not a causal effect/);
  });

  it('stops at sample caution when either side is below two games', () => {
    const classified = classifyWowyGames(
      [game('w1', '2025-01-02T00:00:00.000Z'), game('wo1', '2025-01-06T00:00:00.000Z', { teammateMinutes: '00' })],
      query
    );
    const summary = summarizeWowyPair({
      query,
      classified,
      subjectName: 'Player A',
      teammateName: 'Player B',
    });
    const insights = buildWowyInsights(summary);
    expect(insights.some((row) => row.id === 'hold')).toBe(true);
    expect(insights.some((row) => row.id.startsWith('stat-'))).toBe(false);
    expect(wowyShowsComparisonHero(summary.support.tier)).toBe(false);
  });

  it('describes team splits when the query is the player themselves', () => {
    const selfQuery = { ...query, teammatePlayerId: null };
    const classified = classifyWowyGames(
      [
        game('w1', '2025-01-02T00:00:00.000Z', { teamPts: 110, teamOppPts: 100 }),
        game('w2', '2025-01-03T00:00:00.000Z', { teamPts: 110, teamOppPts: 100 }),
        game('wo1', '2025-01-06T00:00:00.000Z', { subjectMinutes: '00', teamPts: 90, teamOppPts: 120 }),
        game('wo2', '2025-01-07T00:00:00.000Z', { subjectMinutes: '00', teamPts: 90, teamOppPts: 120 }),
      ],
      selfQuery
    );
    const summary = summarizeWowyPair({
      query: selfQuery,
      classified,
      subjectName: 'Player A',
      teammateName: null,
      teamAbbreviation: 'DEN',
      teamFullName: 'Denver Nuggets',
    });
    expect(summary.mode).toBe('subject');
    const text = buildWowyInsights(summary)
      .map((row) => `${row.title} ${row.body}`)
      .join('\n');
    expect(text).toMatch(/When Player A appeared/);
    expect(text).toMatch(/Denver Nuggets averaged/);
    expect(text).not.toMatch(/in the box/i);
    expect(text).not.toMatch(/Player A averaged/);
    expect(text).not.toMatch(/injured/i);
  });

  it('treats higher opponent points as unfavorable, not a positive split', () => {
    const selfQuery = { ...query, teammatePlayerId: null };
    const classified = classifyWowyGames(
      [
        game('w1', '2025-01-02T00:00:00.000Z', { teamPts: 110, teamOppPts: 112 }),
        game('w2', '2025-01-03T00:00:00.000Z', { teamPts: 110, teamOppPts: 112 }),
        game('wo1', '2025-01-06T00:00:00.000Z', { subjectMinutes: '00', teamPts: 90, teamOppPts: 100 }),
        game('wo2', '2025-01-07T00:00:00.000Z', { subjectMinutes: '00', teamPts: 90, teamOppPts: 100 }),
      ],
      selfQuery
    );
    const summary = summarizeWowyPair({
      query: selfQuery,
      classified,
      subjectName: 'Player A',
      teammateName: null,
      teamAbbreviation: 'DEN',
      teamFullName: 'Denver Nuggets',
    });
    expect(summary.diff.absolutePerGame.oppPts).toBe(12);
    expect(wowyDiffPolarity('oppPts', summary.diff.absolutePerGame.oppPts)).toBe('unfavorable');
    const opp = buildWowyInsights(summary).find((row) => row.id === 'stat-oppPts');
    expect(opp?.tone).toBe('down');
    expect(opp?.body).toMatch(/unfavorable/i);
    expect(opp?.title).toMatch(/higher/i);
  });

  it('treats lower opponent points as favorable', () => {
    const selfQuery = { ...query, teammatePlayerId: null };
    const classified = classifyWowyGames(
      [
        game('w1', '2025-01-02T00:00:00.000Z', { teamPts: 110, teamOppPts: 100 }),
        game('w2', '2025-01-03T00:00:00.000Z', { teamPts: 110, teamOppPts: 100 }),
        game('wo1', '2025-01-06T00:00:00.000Z', { subjectMinutes: '00', teamPts: 90, teamOppPts: 120 }),
        game('wo2', '2025-01-07T00:00:00.000Z', { subjectMinutes: '00', teamPts: 90, teamOppPts: 120 }),
      ],
      selfQuery
    );
    const summary = summarizeWowyPair({
      query: selfQuery,
      classified,
      subjectName: 'Player A',
      teammateName: null,
      teamFullName: 'Denver Nuggets',
    });
    expect(summary.diff.absolutePerGame.oppPts).toBe(-20);
    expect(wowyDiffPolarity('oppPts', summary.diff.absolutePerGame.oppPts)).toBe('favorable');
    const opp = buildWowyInsights(summary).find((row) => row.id === 'stat-oppPts');
    expect(opp?.tone).toBe('up');
    expect(opp?.body).toMatch(/unfavorable/i);
    expect(opp?.title).toMatch(/lower/i);
  });

  it('keeps low-support splits visible with support disclosure', () => {
    const classified = classifyWowyGames(
      [
        game('w1', '2025-01-02T00:00:00.000Z', { subjectPts: 10 }),
        game('w2', '2025-01-03T00:00:00.000Z', { subjectPts: 10 }),
        game('wo1', '2025-01-06T00:00:00.000Z', { teammateMinutes: '00', subjectPts: 30 }),
        game('wo2', '2025-01-07T00:00:00.000Z', { teammateMinutes: '00', subjectPts: 30 }),
      ],
      query
    );
    const summary = summarizeWowyPair({
      query,
      classified,
      subjectName: 'Player A',
      teammateName: 'Player B',
    });
    expect(summary.support.tier).toBe('low_support');
    expect(wowyShowsComparisonHero(summary.support.tier)).toBe(true);
    const insights = buildWowyInsights(summary);
    expect(insights.some((row) => row.id.startsWith('stat-'))).toBe(true);
    expect(summary.support.label).toMatch(/Low support/i);
  });
});
