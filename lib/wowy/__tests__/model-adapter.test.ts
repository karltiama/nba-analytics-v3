import { describe, expect, it } from 'vitest';
import { classifyWowyGames } from '../eligibility';
import { summarizeWowyPair } from '../aggregate';
import { summarizeWowyBeforeCutoff, WOWY_SCENARIO_UNKNOWN } from '../model-adapter';
import type { WowyLoadedGame, WowyPairQuery } from '../types';

const cutoff = '2025-01-10T17:00:00.000Z';

const query: WowyPairQuery = {
  subjectPlayerId: 'A',
  teammatePlayerId: 'B',
  season: '2024',
  teamId: '8',
  seasonType: 'all',
  cutoffStartTime: cutoff,
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
    subjectReb: 8,
    subjectAst: 6,
    subjectTpm: 1,
    subjectFga: 14,
    subjectTpa: 4,
    subjectFta: 3,
    teammateRowPresent: true,
    teammateTeamId: '8',
    teammateMinutes: '28',
    teammatePts: 10,
    teammateReb: 4,
    teammateAst: 5,
    teammateTpm: 1,
    teammateFga: 9,
    teammateFta: 2,
    ...extra,
  };
}

describe('summarizeWowyBeforeCutoff', () => {
  it('excludes the target game and future games from history', () => {
    const games = [
      game('prior-with', '2025-01-06T00:00:00.000Z', { subjectPts: 18 }),
      game('prior-dnp', '2025-01-08T00:00:00.000Z', { teammateMinutes: '00', subjectPts: 22 }),
      game('target', cutoff, { subjectPts: 99, teammateMinutes: '00' }),
      game('future', '2025-01-12T00:00:00.000Z', { subjectPts: 50 }),
    ];
    const result = summarizeWowyBeforeCutoff({
      games,
      query,
      subjectName: 'A',
      teammateName: 'B',
    });
    expect(result.history.with.gameIds).toEqual(['prior-with']);
    expect(result.history.without.gameIds).toEqual(['prior-dnp']);
    expect(result.history.with.perGame.pts).toBe(18);
    expect(result.history.without.perGame.pts).toBe(22);
    expect(result.scenario).toEqual(WOWY_SCENARIO_UNKNOWN);
    expect(result.reliability.leakSafe).toBe(true);
  });

  it('does not change pregame summaries when target-game outcomes are mutated', () => {
    const base = [
      game('prior-with', '2025-01-06T00:00:00.000Z', { subjectPts: 18 }),
      game('prior-dnp', '2025-01-08T00:00:00.000Z', { teammateMinutes: '00', subjectPts: 22 }),
      game('target', cutoff, { subjectPts: 10, teammateMinutes: '30' }),
    ];
    const first = summarizeWowyBeforeCutoff({
      games: base,
      query,
      subjectName: 'A',
      teammateName: 'B',
    });
    const mutated = [
      base[0],
      base[1],
      game('target', cutoff, { subjectPts: 80, teammateMinutes: '00', teammateRowPresent: true }),
    ];
    const second = summarizeWowyBeforeCutoff({
      games: mutated,
      query,
      subjectName: 'A',
      teammateName: 'B',
    });
    expect(second.history.with.perGame.pts).toEqual(first.history.with.perGame.pts);
    expect(second.history.without.perGame.pts).toEqual(first.history.without.perGame.pts);
    expect(second.history.with.gameIds).toEqual(first.history.with.gameIds);
    expect(second.history.without.gameIds).toEqual(first.history.without.gameIds);
  });

  it('agrees with the page summarizer on identical eligible history', () => {
    const games = [
      game('prior-with', '2025-01-06T00:00:00.000Z'),
      game('prior-dnp', '2025-01-08T00:00:00.000Z', { teammateMinutes: '00' }),
      game('target', cutoff, { subjectPts: 99 }),
    ];
    const adapter = summarizeWowyBeforeCutoff({
      games,
      query,
      subjectName: 'A',
      teammateName: 'B',
    });
    const page = summarizeWowyPair({
      query,
      classified: classifyWowyGames(games, query),
      subjectName: 'A',
      teammateName: 'B',
    });
    expect(adapter.history.with.gameIds).toEqual(page.with.gameIds);
    expect(adapter.history.without.gameIds).toEqual(page.without.gameIds);
    expect(adapter.history.with.perGame).toEqual(page.with.perGame);
    expect(adapter.history.without.perGame).toEqual(page.without.perGame);
    expect(adapter.history.diff.absolutePerGame).toEqual(page.diff.absolutePerGame);
  });

  it('does not auto-select a with/without scenario from teammate participation', () => {
    const result = summarizeWowyBeforeCutoff({
      games: [game('prior-dnp', '2025-01-08T00:00:00.000Z', { teammateMinutes: '00' })],
      query,
      subjectName: 'A',
      teammateName: 'B',
    });
    expect(result.scenario.status).toBe('unknown');
    expect(result.reliability.notes.some((n) => /do not auto-apply/i.test(n))).toBe(true);
  });
});
