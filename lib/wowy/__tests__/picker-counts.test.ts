import { describe, expect, it } from 'vitest';
import { classifyWowyGames } from '../eligibility';
import { teammatePickerCountsFromGames } from '../picker-counts';
import type { WowyLoadedGame, WowyPairQuery } from '../types';

const baseQuery: WowyPairQuery = {
  subjectPlayerId: 'A',
  teammatePlayerId: 'B',
  season: '2024',
  teamId: '8',
  seasonType: 'regular',
};

function game(gameId: string, startTime: string, extra: Partial<WowyLoadedGame> = {}): WowyLoadedGame {
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

const corpus: WowyLoadedGame[] = [
  game('rs-with', '2025-01-06T00:00:00.000Z'),
  game('rs-with-zero-min-subject', '2025-01-08T00:00:00.000Z', { subjectMinutes: '0' }),
  game('rs-without', '2025-01-10T00:00:00.000Z', { teammateMinutes: '00' }),
  game('rs-subject-dnp', '2025-01-12T00:00:00.000Z', { subjectMinutes: '00', teammateMinutes: '00' }),
  game('po-with', '2025-04-20T00:00:00.000Z'),
  game('po-without', '2025-04-22T00:00:00.000Z', { teammateMinutes: '00' }),
];

describe('teammate picker counts vs pair eligibility', () => {
  it('respects regular vs playoffs', () => {
    const regular = teammatePickerCountsFromGames(corpus, { ...baseQuery, seasonType: 'regular' });
    const playoffs = teammatePickerCountsFromGames(corpus, { ...baseQuery, seasonType: 'playoffs' });
    expect(regular).toEqual({ withGames: 2, withoutGames: 1 });
    expect(playoffs).toEqual({ withGames: 1, withoutGames: 1 });
  });

  it('counts only games where the subject played', () => {
    const counts = teammatePickerCountsFromGames(corpus, { ...baseQuery, seasonType: 'regular' });
    const classified = classifyWowyGames(corpus, { ...baseQuery, seasonType: 'regular' });
    expect(classified.some((g) => g.gameId === 'rs-subject-dnp' && g.excludeReason === 'subject_did_not_play')).toBe(
      true
    );
    expect(counts.withoutGames).toBe(1);
    expect(counts.withGames + counts.withoutGames).toBe(3);
  });

  it('matches pair WITH/WITHOUT buckets on the same fixture', () => {
    const query = { ...baseQuery, seasonType: 'all' };
    const counts = teammatePickerCountsFromGames(corpus, query);
    const classified = classifyWowyGames(corpus, query);
    expect(counts.withGames).toBe(classified.filter((g) => g.bucket === 'with').length);
    expect(counts.withoutGames).toBe(classified.filter((g) => g.bucket === 'without').length);
    expect(counts).toEqual({ withGames: 3, withoutGames: 2 });
  });
});
