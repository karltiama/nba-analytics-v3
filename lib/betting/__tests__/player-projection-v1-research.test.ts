import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { isPlayedGame } from '@/lib/betting/minutes-projection-eval';
import { selectPriorGames } from '@/lib/betting/player-projection-eval';
import {
  BOOTSTRAP_SEED,
  CLIP_GRIDS,
  PLAYED_ONLY_TRACK_A_DEFINITION,
  REJECTED_AS_PROJECTION_INPUTS,
  chronoSplitForSeason,
  clipRatio,
  consecutiveStarts,
  countAsOfLeakage,
  conditionalMinutesAdjustedProjection,
  ewmPlayedMinutes,
  isStrictlyBefore,
  minutesChangeBucket,
  observedRoleTransition,
  pairedDelta,
  playedOnlyTrackA,
  reconstructPregameMinutesRole,
  roleAwareMinutes,
  roleShiftToL5,
  scaleByMinutesRatio,
  scoreMinutesRoleCandidates,
  starterRate,
  trendAdjustedMinutes,
  withBaselineFallback,
  type ProjectionV1Log,
} from '@/lib/betting/player-projection-v1-research';

function log(
  partial: Partial<ProjectionV1Log> & Pick<ProjectionV1Log, 'game_id' | 'start_time'>
): ProjectionV1Log {
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
    ...partial,
  };
}

describe('Played-only Track A freeze', () => {
  it('keeps the published 0.7 / 0.3 played-game formula', () => {
    expect(PLAYED_ONLY_TRACK_A_DEFINITION.weights).toEqual({ l10: 0.7, season: 0.3 });
    expect(PLAYED_ONLY_TRACK_A_DEFINITION.formula).toContain('PLAYED');
  });

  it('uses played games only and ignores DNP 00 zeros', () => {
    const prior = [
      log({ game_id: 'dnp', start_time: '2026-04-08T00:00:00.000Z', minutes: '00', points: 0 }),
      log({ game_id: 'p1', start_time: '2026-04-06T00:00:00.000Z', minutes: 30, points: 10 }),
      log({ game_id: 'p2', start_time: '2026-04-04T00:00:00.000Z', minutes: 30, points: 20 }),
    ];
    expect(isPlayedGame(prior[0])).toBe(false);
    expect(playedOnlyTrackA(prior, 'points')).toBe(15);
  });

  it('keeps a 0-minute played appearance in counting history', () => {
    expect(
      isPlayedGame(log({ game_id: 'z', start_time: '2026-04-01T00:00:00.000Z', minutes: '0', points: 0 }))
    ).toBe(true);
    expect(
      isPlayedGame(log({ game_id: 'dnp', start_time: '2026-04-01T00:00:00.000Z', minutes: '00', points: 0 }))
    ).toBe(false);
  });
});

describe('as-of leakage guard', () => {
  it('rejects equal timestamps and future games', () => {
    const tip = '2026-04-10T00:00:00.000Z';
    expect(isStrictlyBefore('2026-04-09T23:59:59.000Z', tip)).toBe(true);
    expect(isStrictlyBefore(tip, tip)).toBe(false);
    expect(isStrictlyBefore('2026-04-10T00:00:01.000Z', tip)).toBe(false);
  });

  it('selectPriorGames plus countAsOfLeakage is empty on valid history', () => {
    const games = [
      log({ game_id: 'target', start_time: '2026-04-10T00:00:00.000Z' }),
      log({ game_id: 'prior', start_time: '2026-04-08T00:00:00.000Z' }),
      log({ game_id: 'future', start_time: '2026-04-12T00:00:00.000Z' }),
    ];
    const prior = selectPriorGames(games, games[0].start_time, '2025', 'active_season');
    expect(prior.map((g) => g.game_id)).toEqual(['prior']);
    expect(countAsOfLeakage(prior, games[0].start_time)).toBe(0);
  });

  it('lists market and target-game fields as rejected inputs', () => {
    expect(REJECTED_AS_PROJECTION_INPUTS).toEqual(
      expect.arrayContaining([
        'target-game box score',
        'target-game minutes',
        'closing-market prices as basketball features',
        'historical public-betting percentages (capture timing unknown)',
      ])
    );
  });
});

describe('minutes estimators', () => {
  it('EWM weights newer played minutes more', () => {
    const prior = [
      log({ game_id: 'new', start_time: '2026-04-08T00:00:00.000Z', minutes: 40 }),
      log({ game_id: 'old', start_time: '2026-04-04T00:00:00.000Z', minutes: 20 }),
    ];
    const ewm = ewmPlayedMinutes(prior, 0.4);
    expect(ewm).toBeGreaterThan(30);
    expect(ewm).toBeLessThan(40);
  });

  it('clips trend L3/L10 to the published 0.8–1.2 band', () => {
    expect(trendAdjustedMinutes(40, 20)).toBeCloseTo(20 * 1.2);
    expect(trendAdjustedMinutes(5, 20)).toBeCloseTo(20 * 0.8);
  });

  it('role-aware minutes uses prior starter rate, not tonight', () => {
    const prior: ProjectionV1Log[] = [];
    for (let i = 0; i < 5; i += 1) {
      prior.push(
        log({
          game_id: `s${i}`,
          start_time: `2026-04-0${8 - i}T00:00:00.000Z`,
          minutes: 34,
          started: 'starter',
        })
      );
    }
    expect(starterRate(prior, 5)).toBe(1);
    expect(consecutiveStarts(prior)).toBe(5);
    expect(roleAwareMinutes(prior, 24)).toBe(34);
  });
});

describe('Concept A scaling', () => {
  it('reports clip grids instead of a hidden threshold', () => {
    expect(CLIP_GRIDS.map((c) => c.id)).toEqual(['clip_080_120', 'clip_085_115', 'clip_090_110']);
    expect(clipRatio(2, 0.8, 1.2)).toBe(1.2);
    expect(clipRatio(0.5, 0.8, 1.2)).toBe(0.8);
  });

  it('does not scale when the L10 minutes reference is below the floor', () => {
    expect(scaleByMinutesRatio(20, 30, 4, CLIP_GRIDS[0])).toBeNull();
    expect(scaleByMinutesRatio(20, 36, 30, CLIP_GRIDS[0])).toBeCloseTo(20 * 1.2);
  });

  it('falls back to baseline when a candidate is missing', () => {
    expect(withBaselineFallback(null, 12.5)).toBe(12.5);
    expect(withBaselineFallback(11, 12.5)).toBe(11);
  });
});

describe('role-shift rule and segments', () => {
  it('switches to L5 counting only when minutes moved by tau', () => {
    expect(roleShiftToL5(15, 22, 34, 24, 0.2)).toBe(22);
    expect(roleShiftToL5(15, 22, 25, 24, 0.2)).toBe(15);
  });

  it('labels minutes-change buckets from pregame L5 vs L10', () => {
    expect(minutesChangeBucket(30, 30)).toBe('stable');
    expect(minutesChangeBucket(24, 20)).toBe('moderate');
    expect(minutesChangeBucket(30, 20)).toBe('large');
  });

  it('treats target starter as an observed split, not mixed into prior majority', () => {
    expect(observedRoleTransition('bench', 'starter')).toBe('bench_to_starter');
    expect(observedRoleTransition('starter', 'unknown')).toBe('unknown');
  });
});

describe('chronological split and bootstrap', () => {
  it('maps complete seasons onto train / validation / test', () => {
    expect(chronoSplitForSeason('2023')).toBe('train');
    expect(chronoSplitForSeason('2024')).toBe('validation');
    expect(chronoSplitForSeason('2025')).toBe('test');
    expect(chronoSplitForSeason('2026')).toBe('excluded');
  });

  it('paired MAE delta is deterministic for a fixed seed', () => {
    const a = [1, -2, 3, -4, 0.5];
    const b = [0.5, -1.5, 2.5, -3.5, 0.2];
    const x = pairedDelta(a, b, 40, BOOTSTRAP_SEED);
    const y = pairedDelta(a, b, 40, BOOTSTRAP_SEED);
    expect(x.delta).toBe(y.delta);
    expect(x.ciLow).toBe(y.ciLow);
    expect(x.n).toBe(5);
    expect(x.delta).toBeLessThan(0);
  });
});

describe('scoreMinutesRoleCandidates', () => {
  it('scales Track A up when recent minutes exceed L10', () => {
    const prior = [
      log({ game_id: 'n1', start_time: '2026-04-08T00:00:00.000Z', minutes: 40, points: 24 }),
      log({ game_id: 'n2', start_time: '2026-04-06T00:00:00.000Z', minutes: 40, points: 24 }),
      log({ game_id: 'n3', start_time: '2026-04-04T00:00:00.000Z', minutes: 40, points: 24 }),
      log({ game_id: 'o1', start_time: '2026-03-20T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o2', start_time: '2026-03-18T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o3', start_time: '2026-03-16T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o4', start_time: '2026-03-14T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o5', start_time: '2026-03-12T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o6', start_time: '2026-03-10T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o7', start_time: '2026-03-08T00:00:00.000Z', minutes: 20, points: 10 }),
    ];
    const target = log({ game_id: 't', start_time: '2026-04-10T00:00:00.000Z' });
    const features = reconstructPregameMinutesRole([...prior, target], target);
    expect(features).not.toBeNull();
    const baseline = playedOnlyTrackA(prior, 'points');
    expect(baseline).not.toBeNull();
    const scored = scoreMinutesRoleCandidates({
      prior,
      features: features!,
      propType: 'points',
      baseline: baseline!,
    });
    expect(scored.played_track_a).toBe(baseline);
    expect(scored.a_min_l5__clip_085_115).toBeGreaterThan(baseline!);
    expect(scored.r_shift_l5__tau_020).toBeGreaterThan(baseline!);
  });
});

describe('reconstructPregameMinutesRole', () => {
  it('does not read the target game box or starter', () => {
    const games = [
      log({
        game_id: 'target',
        start_time: '2026-04-10T00:00:00.000Z',
        minutes: 40,
        points: 50,
        started: 'starter',
      }),
      log({
        game_id: 'prior',
        start_time: '2026-04-08T00:00:00.000Z',
        minutes: 20,
        points: 8,
        started: 'bench',
      }),
    ];
    const features = reconstructPregameMinutesRole(games, games[0]);
    expect(features).not.toBeNull();
    expect(features!.seasonMin).toBe(20);
    expect(features!.l5Min).toBe(20);
    expect(features!.starterRateL5).toBe(0);
    expect(features!.leakageViolations).toBe(0);
    expect(features!.location).toBe('home');
  });
});

describe('frozen Benchmark B (conditional EWM minutes)', () => {
  it('does not adjust 3PM or stable-minute games, and scales only large minutes-change', () => {
    const prior = [
      log({ game_id: 'n1', start_time: '2026-04-08T00:00:00.000Z', minutes: 40, points: 24 }),
      log({ game_id: 'n2', start_time: '2026-04-06T00:00:00.000Z', minutes: 40, points: 24 }),
      log({ game_id: 'n3', start_time: '2026-04-04T00:00:00.000Z', minutes: 40, points: 24 }),
      log({ game_id: 'n4', start_time: '2026-04-02T00:00:00.000Z', minutes: 40, points: 24 }),
      log({ game_id: 'n5', start_time: '2026-03-31T00:00:00.000Z', minutes: 40, points: 24 }),
      log({ game_id: 'o1', start_time: '2026-03-20T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o2', start_time: '2026-03-18T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o3', start_time: '2026-03-16T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o4', start_time: '2026-03-14T00:00:00.000Z', minutes: 20, points: 10 }),
      log({ game_id: 'o5', start_time: '2026-03-12T00:00:00.000Z', minutes: 20, points: 10 }),
    ];
    const target = log({ game_id: 't', start_time: '2026-04-10T00:00:00.000Z' });
    const features = reconstructPregameMinutesRole([...prior, target], target)!;
    expect(features.l5Min).toBeGreaterThan((features.l10Min ?? 0) * 1.25 - 0.01);
    const trackA = 20;
    expect(conditionalMinutesAdjustedProjection({ trackA, features, propType: 'threes' })).toBe(20);
    expect(conditionalMinutesAdjustedProjection({ trackA, features, propType: 'points' })).toBeGreaterThan(20);

    const stablePrior = prior.map((g, i) => log({ ...g, game_id: `s${i}`, minutes: 24, points: 12 }));
    const stable = reconstructPregameMinutesRole(
      [...stablePrior, target],
      target
    )!;
    expect(conditionalMinutesAdjustedProjection({ trackA, features: stable, propType: 'points' })).toBe(20);
  });
});
