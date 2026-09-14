import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import {
  blendTrackA,
  classifyAppearance,
  comboComponentProjection,
  isPlayedGame,
  isPostseasonGame,
  minutesErrorBucket,
  parseMinutes,
  pearson,
  rateBasedProjection,
  reconstructAsOfUsage,
  teamChangeContext,
  windowCountingMean,
  windowMeanGameRate,
  windowMinutesMean,
  windowPerMinuteRate,
  type MinutesEvalLog,
} from '@/lib/betting/minutes-projection-eval';
import { computeProjection } from '@/lib/betting/player-prop-model';

function log(
  partial: Partial<MinutesEvalLog> & Pick<MinutesEvalLog, 'game_id' | 'start_time' | 'season'>
): MinutesEvalLog {
  return {
    player_id: 'p1',
    team_id: 'LAL',
    minutes: 30,
    points: 20,
    rebounds: 5,
    assists: 4,
    three_pointers_made: 2,
    ...partial,
  };
}

describe('parseMinutes / played filter', () => {
  it('parses integer strings and treats 00 as DNP', () => {
    expect(parseMinutes('00')).toBe(0);
    expect(parseMinutes('32')).toBe(32);
    expect(parseMinutes(null)).toBeNull();
    expect(isPlayedGame(log({ game_id: 'a', start_time: '2026-01-01T00:00:00.000Z', season: '2025', minutes: '00' }))).toBe(
      false
    );
  });
});

describe('windowMinutesMean', () => {
  it('uses last N played games and ignores DNP zeros', () => {
    const prior = [
      log({ game_id: 'dnp', start_time: '2026-04-08T00:00:00.000Z', season: '2025', minutes: '00', points: 0 }),
      log({ game_id: 'p1', start_time: '2026-04-06T00:00:00.000Z', season: '2025', minutes: 36 }),
      log({ game_id: 'p2', start_time: '2026-04-04T00:00:00.000Z', season: '2025', minutes: 24 }),
    ];
    expect(windowMinutesMean(prior, 10)).toBe(30);
    expect(windowMinutesMean(prior, 1)).toBe(36);
  });

  it('returns null rather than 0 when the window is empty', () => {
    expect(windowMinutesMean([], 10)).toBeNull();
  });
});

describe('windowPerMinuteRate', () => {
  it('is minutes-weighted and skips DNP', () => {
    const prior = [
      log({
        game_id: 'dnp',
        start_time: '2026-04-08T00:00:00.000Z',
        season: '2025',
        minutes: '00',
        points: 0,
      }),
      log({
        game_id: 'high',
        start_time: '2026-04-06T00:00:00.000Z',
        season: '2025',
        minutes: 40,
        points: 40,
      }),
      log({
        game_id: 'low',
        start_time: '2026-04-04T00:00:00.000Z',
        season: '2025',
        minutes: 10,
        points: 0,
      }),
    ];
    // (40+0) / (40+10) = 0.8, not mean of 1.0 and 0.0
    expect(windowPerMinuteRate(prior, 'points', 10)).toBeCloseTo(0.8, 10);
  });
});

describe('as-of reconstruction has no lookahead', () => {
  it('excludes the target, later games, and other seasons under active_season', () => {
    const games: MinutesEvalLog[] = [
      log({ game_id: 'later', start_time: '2026-04-12T00:00:00.000Z', season: '2025', minutes: 48, points: 50 }),
      log({ game_id: 'target', start_time: '2026-04-10T00:00:00.000Z', season: '2025', minutes: 34, points: 28 }),
      log({ game_id: 'prior-a', start_time: '2026-04-08T00:00:00.000Z', season: '2025', minutes: 30, points: 10 }),
      log({ game_id: 'prior-b', start_time: '2026-04-06T00:00:00.000Z', season: '2025', minutes: 20, points: 20 }),
      log({ game_id: 'prior-season', start_time: '2025-12-01T00:00:00.000Z', season: '2024', minutes: 40, points: 40 }),
    ];
    const features = reconstructAsOfUsage(games, games[1], 'active_season');
    expect(features).not.toBeNull();
    expect(features?.priorPlayedCount).toBe(2);
    expect(features?.minutes.season).toBe(25);
    expect(features?.minutes.l10).toBe(25);
    expect(features?.minutes.track_a).toBe(computeProjection(25, 25));
    expect(features?.rates.points.season).toBeCloseTo(30 / 50, 10);
    expect(features?.counting.points.season).toBe(15);
  });
});

describe('Track-A blend and rate product', () => {
  it('reuses production 0.7 / 0.3 and stays null if either side is missing', () => {
    expect(blendTrackA(10, 20)).toBe(computeProjection(10, 20));
    expect(blendTrackA(null, 20)).toBeNull();
    expect(rateBasedProjection(null, 0.8)).toBeNull();
    expect(rateBasedProjection(0, 0.8)).toBeNull();
    expect(rateBasedProjection(30, 0.8)).toBeCloseTo(24, 10);
  });
});

describe('minutes error buckets', () => {
  it('labels actual vs predicted minutes', () => {
    expect(minutesErrorBucket(28, 34)).toBe('actual_over_5+');
    expect(minutesErrorBucket(34, 28)).toBe('actual_under_5+');
    expect(minutesErrorBucket(30, 31)).toBe('within_pm2');
    expect(minutesErrorBucket(null, 30)).toBe('other');
  });
});

describe('postseason calendar', () => {
  it('treats 2025-26 play-in start as postseason', () => {
    expect(isPostseasonGame('2025', '2026-04-14T16:00:00.000Z')).toBe(true);
    expect(isPostseasonGame('2025', '2026-04-13T16:00:00.000Z')).toBe(false);
  });
});

describe('team-change context', () => {
  it('counts first games on a new team from as-of logs', () => {
    const prior: MinutesEvalLog[] = [
      log({ game_id: 'n1', start_time: '2026-02-02T00:00:00.000Z', season: '2025', team_id: 'LAL' }),
      log({ game_id: 'old', start_time: '2026-01-15T00:00:00.000Z', season: '2025', team_id: 'BOS' }),
    ];
    const ctx = teamChangeContext(prior, 'LAL');
    expect(ctx.teamChanged).toBe(true);
    expect(ctx.gamesOnCurrentTeamIncludingTonight).toBe(2);
  });
});

describe('pearson', () => {
  it('returns 1 for a perfect line', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 8);
  });
});

describe('played-game semantics', () => {
  const t = '2026-01-01T00:00:00.000Z';
  it('excludes minutes=00 DNP from played history even with 0 stats', () => {
    const dnp = log({ game_id: 'dnp', start_time: t, season: '2025', minutes: '00', points: 0 });
    expect(classifyAppearance(dnp).class).toBe('dnp');
    expect(isPlayedGame(dnp)).toBe(false);
  });

  it('keeps a legitimate 0-point game with minutes played', () => {
    const zeroPts = log({
      game_id: 'zero',
      start_time: t,
      season: '2025',
      minutes: 18,
      points: 0,
      rebounds: 0,
      assists: 0,
      three_pointers_made: 0,
    });
    expect(isPlayedGame(zeroPts)).toBe(true);
    expect(windowCountingMean([zeroPts], 'points', 'all', true)).toBe(0);
  });

  it('treats minutes token 0 as a sub-minute appearance, not DNP', () => {
    expect(
      isPlayedGame(log({ game_id: 'sub', start_time: t, season: '2025', minutes: '0', points: 0 }))
    ).toBe(true);
  });

  it('treats malformed minutes as not played', () => {
    const bad = log({ game_id: 'bad', start_time: t, season: '2025', minutes: 'DNP-CD', points: 0 });
    expect(classifyAppearance(bad).class).toBe('malformed');
    expect(isPlayedGame(bad)).toBe(false);
    expect(windowCountingMean([bad], 'points', 'all', true)).toBeNull();
  });

  it('L10 played skips DNP rows and uses the last 10 played games', () => {
    const newestFirst: MinutesEvalLog[] = [];
    for (let i = 0; i < 10; i += 1) {
      newestFirst.push(
        log({
          game_id: `dnp-${i}`,
          start_time: `2026-02-20T${String(20 - i).padStart(2, '0')}:00:00.000Z`,
          season: '2025',
          minutes: '00',
          points: 0,
        })
      );
    }
    for (let i = 0; i < 12; i += 1) {
      newestFirst.push(
        log({
          game_id: `played-${i}`,
          start_time: `2026-02-01T${String(20 - i).padStart(2, '0')}:00:00.000Z`,
          season: '2025',
          minutes: 24,
          points: i === 0 ? 100 : 10,
        })
      );
    }
    expect(windowCountingMean(newestFirst, 'points', 10, false)).toBe(0);
    expect(windowCountingMean(newestFirst, 'points', 10, true)).toBe(19);
  });
});

describe('rate definitions', () => {
  it('aggregate rate uses total/total, not mean of game rates', () => {
    const t = '2026-01-01T00:00:00.000Z';
    const prior = [
      log({ game_id: 'a', start_time: t, season: '2025', minutes: 40, points: 40 }),
      log({ game_id: 'b', start_time: '2025-12-31T00:00:00.000Z', season: '2025', minutes: 10, points: 0 }),
    ];
    expect(windowPerMinuteRate(prior, 'points', 10)).toBeCloseTo(0.8, 10);
    expect(windowMeanGameRate(prior, 'points', 10)).toBeCloseTo(0.5, 10);
  });
});

describe('combo component projection', () => {
  it('sums available component projections and stays null if any required piece is missing', () => {
    expect(comboComponentProjection(20, 8, 6, 'pra')).toBe(34);
    expect(comboComponentProjection(20, 8, 6, 'pa')).toBe(26);
    expect(comboComponentProjection(20, 8, 6, 'pr')).toBe(28);
    expect(comboComponentProjection(20, 8, 6, 'ra')).toBe(14);
    expect(comboComponentProjection(20, null, 6, 'pra')).toBeNull();
  });
});
