import { describe, expect, it } from 'vitest';
import {
  HISTORICAL_RAW_STAT_RECOVERY_AUTHORIZATION,
  RawStatSeasonBoundaryError,
  assertCurrentSeasonRawStat,
  assertCurrentSeasonStatBatch,
  planHistoricalRawStatRecovery,
} from '../raw-stat-season-boundary';

describe('raw stat season boundary', () => {
  it('accepts the live season start year, including its string form', () => {
    expect(() =>
      assertCurrentSeasonRawStat({ liveSeasonStartYear: 2026, gameSeason: '2026', gameId: 21718057 })
    ).not.toThrow();
  });

  it('refuses a season-2025 game inside ordinary current-season recovery', () => {
    expect(() =>
      assertCurrentSeasonRawStat({ liveSeasonStartYear: 2026, gameSeason: 2025, gameId: 18447000 })
    ).toThrow(RawStatSeasonBoundaryError);
    try {
      assertCurrentSeasonRawStat({ liveSeasonStartYear: 2026, gameSeason: 2025, gameId: 18447000 });
    } catch (error) {
      expect(error).toMatchObject({ reason: 'season_not_current' });
    }
  });

  it('does not treat a calendar date as a season', () => {
    expect(() =>
      assertCurrentSeasonRawStat({ liveSeasonStartYear: 2026, gameSeason: '2026-11-13', gameId: 1 })
    ).toThrow(RawStatSeasonBoundaryError);
  });

  it('refuses a stat whose game is outside the serving set', () => {
    expect(() =>
      assertCurrentSeasonStatBatch({
        liveSeasonStartYear: 2026,
        games: [{ id: 21718057, season: 2026 }],
        stats: [{ game: { id: 18447000, season: 2025 } }],
      })
    ).toThrow(RawStatSeasonBoundaryError);
  });

  it('keeps an explicitly authorized historical season off the current-season writer', () => {
    const plan = planHistoricalRawStatRecovery({
      liveSeasonStartYear: 2026,
      targetSeasonStartYear: 2025,
      gameSeason: '2025',
      gameId: 18447000,
      authorization: HISTORICAL_RAW_STAT_RECOVERY_AUTHORIZATION,
    });
    expect(plan).toEqual({ seasonStartYear: 2025, gameId: 18447000, writesCurrentSeasonRaw: false });
  });

  it('refuses historical recovery without the authorization, and refuses the live season', () => {
    expect(() =>
      planHistoricalRawStatRecovery({
        liveSeasonStartYear: 2026,
        targetSeasonStartYear: 2025,
        gameSeason: 2025,
        gameId: 1,
        authorization: null,
      })
    ).toThrow(RawStatSeasonBoundaryError);
    expect(() =>
      planHistoricalRawStatRecovery({
        liveSeasonStartYear: 2026,
        targetSeasonStartYear: 2026,
        gameSeason: 2026,
        gameId: 1,
        authorization: HISTORICAL_RAW_STAT_RECOVERY_AUTHORIZATION,
      })
    ).toThrow(RawStatSeasonBoundaryError);
  });
});
