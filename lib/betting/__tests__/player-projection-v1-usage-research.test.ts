import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import {
  FTA_SHOT_VOLUME_WEIGHT,
  isLargeUsageChange,
  maybeScale,
  minutesUsageQuad,
  reconstructPregameUsage,
  scoreUsageRateCandidates,
  shotVolume,
  type UsageEvalLog,
} from '@/lib/betting/player-projection-v1-usage-research';
import type { PregameMinutesRoleFeatures } from '@/lib/betting/player-projection-v1-research';

function log(partial: Partial<UsageEvalLog> & Pick<UsageEvalLog, 'game_id' | 'start_time'>): UsageEvalLog {
  return {
    player_id: 'p1',
    team_id: 'LAL',
    home_team_id: 'LAL',
    away_team_id: 'BOS',
    season: '2025',
    minutes: 30,
    points: 20,
    rebounds: 5,
    assists: 4,
    three_pointers_made: 2,
    started: 'unknown',
    field_goals_attempted: 15,
    free_throws_attempted: 4,
    three_pointers_attempted: 5,
    usage_percentage: 0.22,
    ...partial,
  };
}

describe('shot volume', () => {
  it('uses the documented 0.44 FTA weight', () => {
    expect(FTA_SHOT_VOLUME_WEIGHT).toBe(0.44);
    expect(shotVolume(10, 10)).toBeCloseTo(10 + 4.4);
  });
});

describe('pregame usage features', () => {
  it('uses only prior games and detects a usage increase', () => {
    const prior = [
      log({ game_id: 'n1', start_time: '2026-04-08T00:00:00.000Z', usage_percentage: 0.32, field_goals_attempted: 22 }),
      log({ game_id: 'n2', start_time: '2026-04-06T00:00:00.000Z', usage_percentage: 0.31, field_goals_attempted: 21 }),
      log({ game_id: 'n3', start_time: '2026-04-04T00:00:00.000Z', usage_percentage: 0.3, field_goals_attempted: 20 }),
      log({ game_id: 'n4', start_time: '2026-04-02T00:00:00.000Z', usage_percentage: 0.3, field_goals_attempted: 20 }),
      log({ game_id: 'n5', start_time: '2026-03-31T00:00:00.000Z', usage_percentage: 0.29, field_goals_attempted: 19 }),
      log({ game_id: 'o1', start_time: '2026-03-20T00:00:00.000Z', usage_percentage: 0.18, field_goals_attempted: 10 }),
      log({ game_id: 'o2', start_time: '2026-03-18T00:00:00.000Z', usage_percentage: 0.18, field_goals_attempted: 10 }),
      log({ game_id: 'o3', start_time: '2026-03-16T00:00:00.000Z', usage_percentage: 0.17, field_goals_attempted: 9 }),
      log({ game_id: 'o4', start_time: '2026-03-14T00:00:00.000Z', usage_percentage: 0.17, field_goals_attempted: 9 }),
      log({ game_id: 'o5', start_time: '2026-03-12T00:00:00.000Z', usage_percentage: 0.16, field_goals_attempted: 8 }),
    ];
    const features = reconstructPregameUsage(prior);
    expect(features.usage.l5).toBeGreaterThan(features.usage.l10!);
    expect(isLargeUsageChange(features, 0.25)).toBe(true);
    expect(isLargeUsageChange(features, 0.15)).toBe(true);
  });

  it('does not scale when the usage-change flag is off', () => {
    expect(maybeScale(10, 0.3, 0.2, { lo: 0.85, hi: 1.15 }, 0.08, false)).toBe(10);
    expect(maybeScale(10, 0.3, 0.2, { lo: 0.85, hi: 1.15 }, 0.08, true)).toBeCloseTo(11.5);
  });
});

describe('minutes x usage quad', () => {
  it('labels stable minutes + changing usage separately', () => {
    const minutes = {
      l5Min: 30,
      l10Min: 30,
    } as PregameMinutesRoleFeatures;
    const usage = reconstructPregameUsage([
      log({ game_id: 'a', start_time: '2026-04-08T00:00:00.000Z', usage_percentage: 0.35 }),
      log({ game_id: 'b', start_time: '2026-04-06T00:00:00.000Z', usage_percentage: 0.34 }),
      log({ game_id: 'c', start_time: '2026-04-04T00:00:00.000Z', usage_percentage: 0.33 }),
      log({ game_id: 'd', start_time: '2026-04-02T00:00:00.000Z', usage_percentage: 0.32 }),
      log({ game_id: 'e', start_time: '2026-03-31T00:00:00.000Z', usage_percentage: 0.31 }),
      log({ game_id: 'f', start_time: '2026-03-20T00:00:00.000Z', usage_percentage: 0.18 }),
      log({ game_id: 'g', start_time: '2026-03-18T00:00:00.000Z', usage_percentage: 0.18 }),
      log({ game_id: 'h', start_time: '2026-03-16T00:00:00.000Z', usage_percentage: 0.17 }),
      log({ game_id: 'i', start_time: '2026-03-14T00:00:00.000Z', usage_percentage: 0.17 }),
      log({ game_id: 'j', start_time: '2026-03-12T00:00:00.000Z', usage_percentage: 0.16 }),
    ]);
    expect(minutesUsageQuad(minutes, usage, 0.25)).toBe('stable_min_changing_usg');
  });
});

describe('scoreUsageRateCandidates', () => {
  it('falls back to Benchmark B when usage history is missing', () => {
    const prior = [log({ game_id: 'a', start_time: '2026-04-08T00:00:00.000Z', usage_percentage: null })];
    const usage = reconstructPregameUsage(prior);
    const scored = scoreUsageRateCandidates({
      prior,
      usage,
      benchmarkA: 12,
      benchmarkB: 13,
      propType: 'points',
    });
    expect(scored.track_a_conditional_ewm_minutes).toBe(13);
    expect(scored.usg_l5_l10_always__clip_085_115).toBe(13);
  });
});
