import { describe, expect, it } from 'vitest';
import {
  assertValidRegularSeasonSnapshot,
  InvalidRegularSeasonSnapshotError,
  INVALID_REGULAR_SEASON_SNAPSHOT,
  MAX_REGULAR_SEASON_GAMES,
  REGULAR_SEASON_SCOPE,
  REGULAR_SEASON_TEAM_SNAPSHOT_SQL,
} from '../regular-season-integrity';
import {
  applyHumanRosterReviewFlags,
  classifyRosterStatuses,
} from '../roster-status';
import { NBA_CUP_CHAMPIONSHIP_ET } from '@/lib/wowy/calendar';

function debug(partial: {
  gamesPlayed: number;
  wins: number | null;
  losses: number | null;
}) {
  return {
    teamId: '27',
    season: '2025',
    postseasonStartEt: '2026-04-14',
    cupChampionshipExcludedEt: NBA_CUP_CHAMPIONSHIP_ET['2025'] ?? [],
    metricsScope: REGULAR_SEASON_SCOPE,
    ...partial,
  };
}

describe('V1.2.1 regular-season snapshot integrity', () => {
  it('1. wins + losses != games_played → validation failure', () => {
    expect(() =>
      assertValidRegularSeasonSnapshot({
        gamesPlayed: 82,
        wins: 60,
        losses: 21,
        metricsScope: REGULAR_SEASON_SCOPE,
        debug: debug({ gamesPlayed: 82, wins: 60, losses: 21 }),
      })
    ).toThrow(InvalidRegularSeasonSnapshotError);

    try {
      assertValidRegularSeasonSnapshot({
        gamesPlayed: 82,
        wins: 60,
        losses: 21,
        metricsScope: REGULAR_SEASON_SCOPE,
        debug: debug({ gamesPlayed: 82, wins: 60, losses: 21 }),
      });
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidRegularSeasonSnapshotError);
      expect((e as InvalidRegularSeasonSnapshotError).code).toBe(
        INVALID_REGULAR_SEASON_SNAPSHOT
      );
    }
  });

  it('2. games_played > 82 → validation failure', () => {
    expect(() =>
      assertValidRegularSeasonSnapshot({
        gamesPlayed: 83,
        wins: 62,
        losses: 21,
        metricsScope: REGULAR_SEASON_SCOPE,
        debug: debug({ gamesPlayed: 83, wins: 62, losses: 21 }),
      })
    ).toThrow(/exceeds public NBA regular-season max/);
  });

  it('3. valid 82-game RS record passes', () => {
    expect(() =>
      assertValidRegularSeasonSnapshot({
        gamesPlayed: 82,
        wins: 62,
        losses: 20,
        metricsScope: REGULAR_SEASON_SCOPE,
        debug: debug({ gamesPlayed: 82, wins: 62, losses: 20 }),
      })
    ).not.toThrow();
    expect(MAX_REGULAR_SEASON_GAMES).toBe(82);
  });

  it('4. public SQL excludes cup championship dates and uses postseason floor', () => {
    expect(REGULAR_SEASON_TEAM_SNAPSHOT_SQL).toContain(
      "(timezone('America/New_York', g.start_time))::date < $3::date"
    );
    expect(REGULAR_SEASON_TEAM_SNAPSHOT_SQL).toContain('<> ALL ($4::text[])');
    expect(NBA_CUP_CHAMPIONSHIP_ET['2025']).toContain('2025-12-16');
  });

  it('5. SAS regression: 83 RS games is invalid (cannot pass integrity gate)', () => {
    expect(() =>
      assertValidRegularSeasonSnapshot({
        gamesPlayed: 83,
        wins: 62,
        losses: 21,
        metricsScope: REGULAR_SEASON_SCOPE,
        debug: debug({ gamesPlayed: 83, wins: 62, losses: 21 }),
      })
    ).toThrow(InvalidRegularSeasonSnapshotError);
  });

  it('public record scope must be REGULAR_SEASON', () => {
    expect(() =>
      assertValidRegularSeasonSnapshot({
        gamesPlayed: 82,
        wins: 41,
        losses: 41,
        metricsScope: 'all_games',
        debug: debug({ gamesPlayed: 82, wins: 41, losses: 41 }),
      })
    ).toThrow(/REGULAR_SEASON/);
  });
});

describe('V1.2.1 high-impact roster review flags', () => {
  const teamId = '2';
  const teamAbbr = 'BOS';
  const season = '2026';
  const previousSeason = '2025';
  const jaylen = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  it('6. high-impact confirmed departure can receive human-review flag', () => {
    const elsewhere = new Map([
      [jaylen, { playerEntityId: jaylen, teamAbbr: 'PHI', teamId: '23' }],
    ]);
    const classified = classifyRosterStatuses({
      season,
      previousSeason,
      teamId,
      teamAbbr,
      previous: [
        {
          playerEntityId: jaylen,
          displayName: 'Jaylen Brown',
          playerId: '70',
          position: 'G',
        },
      ],
      current: [],
      elsewhereCurrentByEntity: elsewhere,
      elsewherePreviousByEntity: new Map(),
    });

    const flagged = applyHumanRosterReviewFlags({
      rows: classified,
      previousRosterStats: [
        {
          playerEntityId: jaylen,
          mpg: 35.2,
          ppg: 24.1,
          usageAvg: 0.28,
        },
      ],
      currentRosterStats: [],
    });

    expect(flagged[0].status).toBe('DEPARTED');
    expect(flagged[0].requiresHumanRosterReview).toBe(true);
    expect(flagged[0].reviewReasons).toContain(
      'HIGH_MINUTES_CONFIRMED_DEPARTURE'
    );
  });

  it('7. review flag does not change DEPARTED classification', () => {
    const elsewhere = new Map([
      [jaylen, { playerEntityId: jaylen, teamAbbr: 'PHI', teamId: '23' }],
    ]);
    const classified = classifyRosterStatuses({
      season,
      previousSeason,
      teamId,
      teamAbbr,
      previous: [
        {
          playerEntityId: jaylen,
          displayName: 'Jaylen Brown',
          playerId: '70',
          position: 'G',
        },
      ],
      current: [],
      elsewhereCurrentByEntity: elsewhere,
      elsewherePreviousByEntity: new Map(),
    });
    expect(classified[0].status).toBe('DEPARTED');
    expect(classified[0].requiresHumanRosterReview).toBe(false);

    const flagged = applyHumanRosterReviewFlags({
      rows: classified,
      previousRosterStats: [
        {
          playerEntityId: jaylen,
          mpg: 35.2,
          ppg: 24.1,
          usageAvg: 0.28,
        },
      ],
      currentRosterStats: [],
    });

    expect(flagged[0].status).toBe('DEPARTED');
    expect(flagged[0].status).toBe(classified[0].status);
    expect(flagged[0].requiresHumanRosterReview).toBe(true);
  });
});
