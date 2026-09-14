import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import {
  PRODUCTION_CALIBRATION_RELATIVE_PATH,
  SHADOW_CALIBRATION_RELATIVE_PATH,
  applyLinearCalibration,
  bootstrapMaeDifference,
  buildPlayedOnlyAsOfModelInputs,
  chronologicalCutIso,
  classifyMaeDelta,
  countShadowLeakage,
  filterPlayedGames,
  fitLinearCalibration,
  isProductionCalibrationPath,
  priorGamesForTarget,
  rawOverProbability,
  resolveResearchCalibrationWritePath,
  shadowMeansFromInputs,
  shrinkToward,
  writeResearchCalibration,
} from '@/lib/betting/shadow-projection-eval';
import { buildAsOfModelInputs, type EvalGameLog } from '@/lib/betting/player-projection-eval';
import { getStatsForPropType } from '@/lib/betting/player-prop-inputs';
import { isPlayedGame } from '@/lib/betting/minutes-projection-eval';

function g(
  partial: Partial<EvalGameLog> & Pick<EvalGameLog, 'game_id' | 'start_time'>
): EvalGameLog {
  return {
    player_id: 'p1',
    season: '2025',
    minutes: 30,
    points: 20,
    rebounds: 5,
    assists: 4,
    three_pointers_made: 2,
    ...partial,
  };
}

describe('played-game shadow inputs', () => {
  it('excludes minutes token "00" DNP from season/L10/L5', () => {
    const prior = [
      g({ game_id: 'dnp', start_time: '2026-04-10T00:00:00.000Z', minutes: '00', points: 0 }),
      g({ game_id: 'p1', start_time: '2026-04-08T00:00:00.000Z', minutes: 32, points: 20 }),
      g({ game_id: 'p2', start_time: '2026-04-06T00:00:00.000Z', minutes: 28, points: 10 }),
    ];
    const played = filterPlayedGames(prior);
    expect(played.map((x) => x.game_id)).toEqual(['p1', 'p2']);
    expect(played.every(isPlayedGame)).toBe(true);

    const inputs = buildPlayedOnlyAsOfModelInputs(prior, '2025');
    expect(inputs).not.toBeNull();
    expect(inputs!.season.pts).toBe(15);
    expect(inputs!.last10.pts).toBe(15);
    expect(inputs!.ext.last5.pts).toBe(15);
    expect(inputs!.seasonGamesPlayed).toBe(2);
  });

  it('retains minutes token "0" as a played appearance', () => {
    const prior = [
      g({ game_id: 'sub', start_time: '2026-04-10T00:00:00.000Z', minutes: '0', points: 0 }),
      g({ game_id: 'full', start_time: '2026-04-08T00:00:00.000Z', minutes: 30, points: 10 }),
    ];
    const inputs = buildPlayedOnlyAsOfModelInputs(prior, '2025');
    expect(inputs!.seasonGamesPlayed).toBe(2);
    expect(inputs!.season.pts).toBe(5);
  });

  it('retains a real 0-point played game', () => {
    const prior = [
      g({
        game_id: 'zero',
        start_time: '2026-04-10T00:00:00.000Z',
        minutes: 18,
        points: 0,
        rebounds: 2,
        assists: 1,
        three_pointers_made: 0,
      }),
      g({ game_id: 'full', start_time: '2026-04-08T00:00:00.000Z', minutes: 30, points: 20 }),
    ];
    const inputs = buildPlayedOnlyAsOfModelInputs(prior, '2025');
    expect(inputs!.season.pts).toBe(10);
    expect(inputs!.last10.pts).toBe(10);
  });

  it('played-only L10 selects the last 10 actual appearances, skipping DNP', () => {
    const prior: EvalGameLog[] = [];
    for (let i = 0; i < 12; i++) {
      prior.push(
        g({
          game_id: `play-${i}`,
          start_time: `2026-03-${String(20 - i).padStart(2, '0')}T00:00:00.000Z`,
          minutes: 30,
          points: i < 10 ? 10 : 99,
        })
      );
      prior.push(
        g({
          game_id: `dnp-${i}`,
          start_time: `2026-03-${String(20 - i).padStart(2, '0')}T12:00:00.000Z`,
          minutes: '00',
          points: 0,
        })
      );
    }
    prior.sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
    const inputs = buildPlayedOnlyAsOfModelInputs(prior, '2025');
    expect(inputs!.sampleGamesUsed).toBe(10);
    expect(inputs!.seasonGamesPlayed).toBe(12);
    expect(inputs!.last10.pts).toBe(10);
    expect(inputs!.last10.pts).not.toBe(0);
  });

  it('Track B receives played-only L5/L10/season (DNP would otherwise zero the window)', () => {
    const prior = [
      g({ game_id: 'dnp', start_time: '2026-04-10T00:00:00.000Z', minutes: '00', points: 0 }),
      g({ game_id: 'a', start_time: '2026-04-08T00:00:00.000Z', minutes: 30, points: 20 }),
      g({ game_id: 'b', start_time: '2026-04-06T00:00:00.000Z', minutes: 30, points: 10 }),
      g({ game_id: 'c', start_time: '2026-04-04T00:00:00.000Z', minutes: 30, points: 10 }),
      g({ game_id: 'd', start_time: '2026-04-02T00:00:00.000Z', minutes: 30, points: 10 }),
      g({ game_id: 'e', start_time: '2026-03-31T00:00:00.000Z', minutes: 30, points: 10 }),
    ];
    const contaminated = buildAsOfModelInputs(prior, '2025');
    const played = buildPlayedOnlyAsOfModelInputs(prior, '2025');
    const dirty = getStatsForPropType(contaminated!, 'points')!;
    const clean = getStatsForPropType(played!, 'points')!;
    expect(dirty.last5Avg).toBe(10);
    expect(clean.last5Avg).toBe(12);
    expect(clean.last10Avg).toBe(12);
    expect(clean.seasonAvg).toBe(12);
    const means = shadowMeansFromInputs(contaminated, played, 'points');
    expect(means.productionTrackA).toBeCloseTo(0.7 * 10 + 0.3 * 10, 8);
    expect(means.playedTrackA).toBeCloseTo(0.7 * 12 + 0.3 * 12, 8);
    expect(means.playedTrackB).not.toBeNull();
  });

  it('excludes the target game and later games from as-of history', () => {
    const games = [
      g({ game_id: 'later', start_time: '2026-04-12T00:00:00.000Z', points: 50 }),
      g({ game_id: 'target', start_time: '2026-04-10T00:00:00.000Z', points: 28 }),
      g({ game_id: 'prior', start_time: '2026-04-08T00:00:00.000Z', points: 10 }),
    ];
    const target = games[1];
    const prior = priorGamesForTarget(games, target);
    expect(prior.map((x) => x.game_id)).toEqual(['prior']);
    const leak = countShadowLeakage({
      target,
      priorAll: prior,
      playedInputsPrior: filterPlayedGames(prior),
      marketMinutesBeforeTip: 90,
    });
    expect(leak.targetIncluded).toBe(false);
    expect(leak.laterIncluded).toBe(false);
  });
});

describe('research calibration isolation', () => {
  it('never resolves to the production artifact path', () => {
    expect(SHADOW_CALIBRATION_RELATIVE_PATH).not.toBe(PRODUCTION_CALIBRATION_RELATIVE_PATH);
    expect(isProductionCalibrationPath(SHADOW_CALIBRATION_RELATIVE_PATH)).toBe(false);
    expect(isProductionCalibrationPath(PRODUCTION_CALIBRATION_RELATIVE_PATH)).toBe(true);
    expect(() =>
      resolveResearchCalibrationWritePath(process.cwd(), PRODUCTION_CALIBRATION_RELATIVE_PATH)
    ).toThrow(/production path/);
  });

  it('writes research artifacts to a non-production path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shadow-cal-'));
    const dest = writeResearchCalibration(dir, { version: 'test' }, 'shadow-calibration.json');
    expect(dest).toBe(join(dir, 'shadow-calibration.json'));
    expect(JSON.parse(readFileSync(dest, 'utf-8')).version).toBe('test');
    expect(existsSync(join(process.cwd(), PRODUCTION_CALIBRATION_RELATIVE_PATH))).toBe(true);
  });

  it('reproduces identity-shrink toward slope=1 intercept=0', () => {
    const samples = Array.from({ length: 120 }, (_, i) => ({
      p: i < 60 ? 0.2 : 0.8,
      y: (i < 60 ? 0 : 1) as 0 | 1,
    }));
    const fit = fitLinearCalibration(samples);
    expect(fit.identityFallback).toBe(false);
    expect(fit.shrinkLambda).toBe(0.35);
    expect(Number.isFinite(fit.rawSlope)).toBe(true);
    expect(fit.meanP).not.toBeNull();
    expect(fit.slope).toBeCloseTo(0.35 * 1 + 0.65 * fit.rawSlope, 8);
    expect(applyLinearCalibration(0.5, { slope: 0.5, intercept: 0.25 })).toBeCloseTo(0.5, 8);
  });

  it('fits when labels are 0/1 y, not a win alias', () => {
    const samples = [
      ...Array.from({ length: 80 }, () => ({ p: 0.2, y: 0 as 0 | 1 })),
      ...Array.from({ length: 80 }, () => ({ p: 0.8, y: 1 as 0 | 1 })),
    ];
    const fit = fitLinearCalibration(samples);
    expect(fit.identityFallback).toBe(false);
    expect(fit.meanY).toBeCloseTo(0.5, 8);
    expect(fit.rawSlope).toBeGreaterThan(0.5);
  });
});

describe('3PM shrinkage is market-independent', () => {
  it('uses only n/(n+k) toward a numeric center — no line or odds arguments', () => {
    expect(shrinkToward.length).toBe(4);
    expect(shrinkToward(2, 1, 10, 10)).toBeCloseTo(1.5, 8);
    expect(shrinkToward(3, 1, 5, 5)).toBeCloseTo(2, 8);
  });
});

describe('Track B complexity helpers', () => {
  it('classifies MAE deltas descriptively', () => {
    expect(classifyMaeDelta(-0.04)).toBe('materially better');
    expect(classifyMaeDelta(-0.02)).toBe('marginal');
    expect(classifyMaeDelta(-0.005)).toBe('tied');
    expect(classifyMaeDelta(0.02)).toBe('worse');
  });

  it('bootstrap MAE difference is paired and deterministic', () => {
    const a = [1, -1, 2, -2, 0.5];
    const b = [1.1, -0.9, 2.1, -1.9, 0.4];
    const x = bootstrapMaeDifference(a, b, 50, 1);
    const y = bootstrapMaeDifference(a, b, 50, 1);
    expect(x.delta).toBe(y.delta);
    expect(x.ciLow).toBe(y.ciLow);
    expect(x.n).toBe(5);
  });
});

describe('raw probability uses the line only as threshold', () => {
  it('changes P when the line changes but the mean does not', () => {
    const prior = [
      g({ game_id: 'a', start_time: '2026-04-08T00:00:00.000Z', points: 20 }),
      g({ game_id: 'b', start_time: '2026-04-06T00:00:00.000Z', points: 20 }),
    ];
    const inputs = buildPlayedOnlyAsOfModelInputs(prior, '2025');
    const pLow = rawOverProbability(inputs, 'points', 10, 'A');
    const pHigh = rawOverProbability(inputs, 'points', 30, 'A');
    expect(pLow).not.toBeNull();
    expect(pHigh).not.toBeNull();
    expect(pLow!).toBeGreaterThan(pHigh!);
  });
});

describe('chronological split', () => {
  it('cuts by sorted unique start times, never shuffled', () => {
    const cut = chronologicalCutIso(
      ['2026-04-20T00:00:00.000Z', '2026-04-01T00:00:00.000Z', '2026-04-10T00:00:00.000Z'],
      0.7
    );
    expect(cut.uniqueStarts).toBe(3);
    expect(cut.cutIso).toBe('2026-04-20T00:00:00.000Z');
    const single = chronologicalCutIso(['2026-04-01T00:00:00.000Z'], 0.7);
    expect(single.fitStarts).toBe(0);
    expect(single.holdStarts).toBe(1);
  });
});
