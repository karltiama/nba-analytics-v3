/**
 * Tests for `evaluateRecentFormMinutes`.
 *
 * Each test fixes a small player timeline so we can hand-verify expected
 * baselines and margins. The shared `buildPriorRamp` helper produces the
 * canonical "cold-then-hot" pattern that lets a signal fire under default
 * thresholds.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRecentFormMinutes } from '../strategies/recent-form-minutes';
import type { PlayerGameLog, RecentFormMinutesConfig, Stat } from '../types';

const PLAYER_ID = 'p1';
const PLAYER_NAME = 'Test Player';
const TEAM = 'NYK';
const OPPONENT = 'BOS';

function mkLog(overrides: Partial<PlayerGameLog>): PlayerGameLog {
  return {
    player_id: PLAYER_ID,
    player_name: PLAYER_NAME,
    game_id: 'g',
    game_date: '2025-11-01',
    team_abbr: TEAM,
    opponent_abbr: OPPONENT,
    minutes: 32,
    points: 0,
    rebounds: 0,
    assists: 0,
    threes: 0,
    ...overrides,
  };
}

/**
 * Build a 15-game prior ramp dated `2025-10-26 + i` and a target game on
 * `evaluationStartDate`. By default the ramp scores 10 pts/game for the first
 * 5 games and 30 pts/game for the next 10. With default config:
 *   - priorGames = 15  (>= minPriorGames=8)
 *   - seasonAvg(points) = 350/15 ≈ 23.33
 *   - last10(points)    = 300/10 = 30
 *   - 30 >= 23.33 * 1.15 (= 26.83) ✓
 *   - last5 minutes     = 32  (>= 28) ✓
 */
function buildPriorRamp(opts: {
  /** Override per-game stat values; index 0 = oldest, 14 = most recent. */
  pointsByIndex?: number[];
  reboundsByIndex?: number[];
  assistsByIndex?: number[];
  threesByIndex?: number[];
  /** Override per-game minutes; same indexing. */
  minutesByIndex?: Array<number | null>;
} = {}): PlayerGameLog[] {
  const defaultPoints = [
    10, 10, 10, 10, 10,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ];
  const points = opts.pointsByIndex ?? defaultPoints;
  const rebounds = opts.reboundsByIndex ?? Array(15).fill(0);
  const assists = opts.assistsByIndex ?? Array(15).fill(0);
  const threes = opts.threesByIndex ?? Array(15).fill(0);
  const minutes = opts.minutesByIndex ?? Array(15).fill(32);

  return Array.from({ length: 15 }, (_, i) => {
    const day = String(26 + i).padStart(2, '0');
    const month = i < 6 ? '10' : '11';
    const dayInMonth = i < 6 ? 26 + i : i - 5;
    return mkLog({
      game_id: `prior-${i}`,
      game_date: `2025-${month}-${String(dayInMonth).padStart(2, '0')}`,
      points: points[i],
      rebounds: rebounds[i],
      assists: assists[i],
      threes: threes[i],
      minutes: minutes[i],
    });
    void day;
  });
}

const BASE_CONFIG: RecentFormMinutesConfig = {
  stat: 'points',
  evaluationStartDate: '2025-12-01',
  evaluationEndDate: '2026-04-30',
};

describe('evaluateRecentFormMinutes', () => {
  it('1. happy path: emits one signal with correct baselines and margins', () => {
    const target = mkLog({
      game_id: 'target-1',
      game_date: '2025-12-05',
      points: 32,
      minutes: 34,
    });
    const result = evaluateRecentFormMinutes([...buildPriorRamp(), target], BASE_CONFIG);

    expect(result.strategy).toBe('RECENT_FORM_MINUTES');
    expect(result.signals).toHaveLength(1);

    const s = result.signals[0];
    expect(s.playerId).toBe(PLAYER_ID);
    expect(s.playerName).toBe(PLAYER_NAME);
    expect(s.gameId).toBe('target-1');
    expect(s.gameDate).toBe('2025-12-05');
    expect(s.team).toBe(TEAM);
    expect(s.opponent).toBe(OPPONENT);
    expect(s.stat).toBe('points');
    expect(s.actual).toBe(32);
    expect(s.priorGames).toBe(15);
    expect(s.seasonAvgBeforeGame).toBeCloseTo(350 / 15, 6);
    expect(s.last10AvgBeforeGame).toBe(30);
    expect(s.last5AvgBeforeGame).toBe(30);
    expect(s.last5MinutesAvgBeforeGame).toBe(32);
    expect(s.weightedProjection).toBeCloseTo(0.7 * 30 + 0.3 * (350 / 15), 6);
    expect(s.hitVsSeasonAvg).toBe(true);
    expect(s.hitVsProjection).toBe(true);
    expect(s.marginVsSeasonAvg).toBeCloseTo(32 - 350 / 15, 6);
    expect(s.marginVsProjection).toBeCloseTo(32 - (0.7 * 30 + 0.3 * (350 / 15)), 6);

    expect(result.summary.totalSignals).toBe(1);
    expect(result.summary.hitRateVsSeasonAvg).toBe(1);
    expect(result.summary.hitRateVsProjection).toBe(1);
    expect(result.summary.medianMarginVsSeasonAvg).toBeCloseTo(32 - 350 / 15, 6);
    expect(result.summary.medianMarginVsProjection).toBeCloseTo(
      32 - (0.7 * 30 + 0.3 * (350 / 15)),
      6
    );
  });

  it('2. no lookahead bias: target game is excluded from its own baselines', () => {
    // Target has an extreme stat. If it leaked into seasonAvg the value would
    // jump from 23.33 to (350 + 100) / 16 = 28.125 — easy to detect.
    const target = mkLog({
      game_id: 'target-2',
      game_date: '2025-12-10',
      points: 100,
      minutes: 40,
    });
    const result = evaluateRecentFormMinutes([...buildPriorRamp(), target], BASE_CONFIG);

    expect(result.signals).toHaveLength(1);
    const s = result.signals[0];
    expect(s.actual).toBe(100);
    expect(s.seasonAvgBeforeGame).toBeCloseTo(350 / 15, 6);
    expect(s.last10AvgBeforeGame).toBe(30);
    expect(s.last5AvgBeforeGame).toBe(30);
    expect(s.last5MinutesAvgBeforeGame).toBe(32);
    expect(s.priorGames).toBe(15);
  });

  it('3. lookback uses pre-window games but signals only emit inside the window', () => {
    // Prior ramp ends on 2025-11-10. evaluationStartDate = 2025-12-01.
    // One target inside window, one game after window — only the inside one
    // should produce a signal.
    const insideTarget = mkLog({
      game_id: 'inside',
      game_date: '2025-12-15',
      points: 31,
      minutes: 33,
    });
    const afterWindow = mkLog({
      game_id: 'after',
      game_date: '2026-05-15',
      points: 50,
      minutes: 38,
    });
    const result = evaluateRecentFormMinutes(
      [...buildPriorRamp(), insideTarget, afterWindow],
      BASE_CONFIG
    );

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].gameId).toBe('inside');
    expect(result.signals[0].priorGames).toBe(15);
  });

  it('4. fewer than minPriorGames produces no signal', () => {
    const target = mkLog({
      game_id: 'target-4',
      game_date: '2025-12-05',
      points: 40,
      minutes: 34,
    });
    // Only 5 prior games — below minPriorGames default of 8.
    const fewPrior: PlayerGameLog[] = Array.from({ length: 5 }, (_, i) =>
      mkLog({
        game_id: `prior-${i}`,
        game_date: `2025-11-${String(20 + i).padStart(2, '0')}`,
        points: 30,
        minutes: 32,
      })
    );

    const result = evaluateRecentFormMinutes([...fewPrior, target], BASE_CONFIG);
    expect(result.signals).toHaveLength(0);
    expect(result.summary.totalSignals).toBe(0);
  });

  it('5. seasonAvg = 0 produces no signal and no divide-by-zero', () => {
    const flatZeros = buildPriorRamp({
      pointsByIndex: Array(15).fill(0),
    });
    const target = mkLog({
      game_id: 'target-5',
      game_date: '2025-12-05',
      points: 5,
      minutes: 32,
    });

    const result = evaluateRecentFormMinutes([...flatZeros, target], BASE_CONFIG);
    expect(result.signals).toHaveLength(0);
    expect(result.summary.totalSignals).toBe(0);
    // Make sure the all-zero margins didn't sneak through as NaN.
    expect(Number.isFinite(result.summary.averageMarginVsSeasonAvg)).toBe(true);
    expect(Number.isFinite(result.summary.medianMarginVsProjection)).toBe(true);
  });

  describe('6. missing minutes', () => {
    it('6a. partial nulls in last 5 minutes are filtered; signal still fires', () => {
      // Pattern: ramp's last 5 minutes (most recent 5 prior games) are
      // [null, null, null, null, 30]. Valid avg = 30 >= minMinutesL5.
      const minutesByIndex: Array<number | null> = Array(15).fill(32);
      minutesByIndex[10] = null;
      minutesByIndex[11] = null;
      minutesByIndex[12] = null;
      minutesByIndex[13] = null;
      minutesByIndex[14] = 30;

      const ramp = buildPriorRamp({ minutesByIndex });
      const target = mkLog({
        game_id: 'target-6a',
        game_date: '2025-12-05',
        points: 32,
        minutes: 32,
      });
      const result = evaluateRecentFormMinutes([...ramp, target], BASE_CONFIG);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].last5MinutesAvgBeforeGame).toBe(30);
    });

    it('6b. all nulls in last 5 minutes fails safe (no signal)', () => {
      const minutesByIndex: Array<number | null> = Array(15).fill(32);
      for (let i = 10; i < 15; i++) minutesByIndex[i] = null;

      const ramp = buildPriorRamp({ minutesByIndex });
      const target = mkLog({
        game_id: 'target-6b',
        game_date: '2025-12-05',
        points: 32,
        minutes: 32,
      });
      const result = evaluateRecentFormMinutes([...ramp, target], BASE_CONFIG);
      expect(result.signals).toHaveLength(0);
    });
  });

  it('7. duplicate (player_id, game_id) rows are deduped', () => {
    const ramp = buildPriorRamp();
    const target = mkLog({
      game_id: 'target-7',
      game_date: '2025-12-05',
      points: 32,
      minutes: 32,
    });
    const dupes = [...ramp, ...ramp, target, target];
    const result = evaluateRecentFormMinutes(dupes, BASE_CONFIG);
    const baseline = evaluateRecentFormMinutes([...ramp, target], BASE_CONFIG);

    expect(result.signals).toHaveLength(1);
    expect(result.signals).toEqual(baseline.signals);
    expect(result.summary).toEqual(baseline.summary);
  });

  it('8. unsorted input produces the same result as sorted input', () => {
    const ramp = buildPriorRamp();
    const target = mkLog({
      game_id: 'target-8',
      game_date: '2025-12-05',
      points: 32,
      minutes: 32,
    });
    const sorted = [...ramp, target];
    const shuffled = [...sorted];

    // Deterministic shuffle so a flake in the test runner can't hide a real bug.
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (i * 7 + 3) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const sortedResult = evaluateRecentFormMinutes(sorted, BASE_CONFIG);
    const shuffledResult = evaluateRecentFormMinutes(shuffled, BASE_CONFIG);
    expect(shuffledResult).toEqual(sortedResult);
  });

  describe('9. stat selection', () => {
    /**
     * Build a ramp that puts the cold→hot pattern on `stat` only; other stats
     * stay flat at low values that wouldn't pass the gate. The target game's
     * value of `stat` should appear as `actual` in the emitted signal.
     */
    function rampForStat(stat: Stat): {
      logs: PlayerGameLog[];
      target: PlayerGameLog;
      expectedActual: number;
    } {
      // Cold-vs-hot scalar values per stat field; designed so the chosen stat's
      // last10 / seasonAvg ratio comfortably exceeds 1.15.
      const COLD = { points: 10, rebounds: 1, assists: 1, threes: 0 };
      const HOT = { points: 30, rebounds: 12, assists: 10, threes: 5 };
      // For PRA, ramp all three components so PRA itself has the pattern.
      const COLD_PRA = { points: 4, rebounds: 1, assists: 1 };
      const HOT_PRA = { points: 14, rebounds: 12, assists: 10 };

      const ramp = buildPriorRamp({
        pointsByIndex: Array.from({ length: 15 }, (_, i) =>
          stat === 'points'
            ? i < 5
              ? COLD.points
              : HOT.points
            : stat === 'pra'
            ? i < 5
              ? COLD_PRA.points
              : HOT_PRA.points
            : 0
        ),
        reboundsByIndex: Array.from({ length: 15 }, (_, i) =>
          stat === 'rebounds'
            ? i < 5
              ? COLD.rebounds
              : HOT.rebounds
            : stat === 'pra'
            ? i < 5
              ? COLD_PRA.rebounds
              : HOT_PRA.rebounds
            : 0
        ),
        assistsByIndex: Array.from({ length: 15 }, (_, i) =>
          stat === 'assists'
            ? i < 5
              ? COLD.assists
              : HOT.assists
            : stat === 'pra'
            ? i < 5
              ? COLD_PRA.assists
              : HOT_PRA.assists
            : 0
        ),
        threesByIndex: Array.from({ length: 15 }, (_, i) =>
          stat === 'threes' ? (i < 5 ? COLD.threes : HOT.threes) : 0
        ),
      });

      const targetByStat: Record<Stat, Partial<PlayerGameLog>> = {
        points: { points: 35 },
        rebounds: { rebounds: 15 },
        assists: { assists: 12 },
        threes: { threes: 7 },
        pra: { points: 16, rebounds: 14, assists: 12 },
      };

      const target = mkLog({
        game_id: `target-${stat}`,
        game_date: '2025-12-05',
        minutes: 32,
        ...targetByStat[stat],
      });

      const expectedActual =
        stat === 'pra'
          ? (target.points ?? 0) + (target.rebounds ?? 0) + (target.assists ?? 0)
          : (target[stat as keyof PlayerGameLog] as number);

      return { logs: [...ramp, target], target, expectedActual };
    }

    const STATS: Stat[] = ['points', 'rebounds', 'assists', 'threes', 'pra'];

    it.each(STATS)('emits signal for stat=%s', (stat) => {
      const { logs, expectedActual } = rampForStat(stat);
      const result = evaluateRecentFormMinutes(logs, { ...BASE_CONFIG, stat });
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].stat).toBe(stat);
      expect(result.signals[0].actual).toBe(expectedActual);
    });
  });

  it('10. empty input returns a zero summary and empty signals', () => {
    const result = evaluateRecentFormMinutes([], BASE_CONFIG);
    expect(result.signals).toEqual([]);
    expect(result.summary).toEqual({
      totalSignals: 0,
      hitRateVsSeasonAvg: 0,
      hitRateVsProjection: 0,
      averageMarginVsSeasonAvg: 0,
      averageMarginVsProjection: 0,
      medianMarginVsSeasonAvg: 0,
      medianMarginVsProjection: 0,
    });
    expect(result.config.minPriorGames).toBe(8);
    expect(result.config.minMinutesL5).toBe(28);
    expect(result.config.recentFormThreshold).toBe(1.15);
    expect(result.config.projectionWeightL10).toBe(0.7);
    expect(result.config.projectionWeightSeason).toBe(0.3);
  });
});
