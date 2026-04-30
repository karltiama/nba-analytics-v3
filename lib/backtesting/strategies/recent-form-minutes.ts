/**
 * RECENT_FORM_MINUTES strategy (pure function).
 *
 * For each player-game inside [evaluationStartDate, evaluationEndDate], decide
 * whether the situation matches "recent form is hot AND minutes are stable",
 * then evaluate whether the actual stat beat (a) the player's season-to-date
 * average and (b) a weighted projection. No DB / S3 / HTTP dependencies.
 *
 * Lookahead-bias guarantee: every baseline (season avg, last-5, last-10,
 * last-5 minutes) is computed from games strictly before the target game in
 * the same player's chronologically-sorted timeline. The target game itself
 * is never in any baseline.
 *
 * Game order: ascending by `(game_date, game_id)`. The `game_id` tiebreaker
 * keeps results deterministic when two games share a calendar date (rare but
 * possible mid-season). Lexicographic comparison on `YYYY-MM-DD` is correct
 * for ISO calendar dates.
 */

import type {
  BacktestResult,
  PlayerGameLog,
  RecentFormMinutesConfig,
  ResolvedRecentFormMinutesConfig,
  Signal,
  Stat,
  Summary,
} from '../types';

const DEFAULTS = {
  minPriorGames: 8,
  minMinutesL5: 28,
  recentFormThreshold: 1.15,
  projectionWeightL10: 0.7,
  projectionWeightSeason: 0.3,
} as const;

function resolveConfig(config: RecentFormMinutesConfig): ResolvedRecentFormMinutesConfig {
  return {
    stat: config.stat,
    evaluationStartDate: config.evaluationStartDate,
    evaluationEndDate: config.evaluationEndDate,
    minPriorGames: config.minPriorGames ?? DEFAULTS.minPriorGames,
    minMinutesL5: config.minMinutesL5 ?? DEFAULTS.minMinutesL5,
    recentFormThreshold: config.recentFormThreshold ?? DEFAULTS.recentFormThreshold,
    projectionWeightL10: config.projectionWeightL10 ?? DEFAULTS.projectionWeightL10,
    projectionWeightSeason: config.projectionWeightSeason ?? DEFAULTS.projectionWeightSeason,
  };
}

function statValue(log: PlayerGameLog, stat: Stat): number {
  switch (stat) {
    case 'points':
      return log.points;
    case 'rebounds':
      return log.rebounds;
    case 'assists':
      return log.assists;
    case 'threes':
      return log.threes;
    case 'pra':
      return log.points + log.rebounds + log.assists;
  }
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Drop duplicate `(player_id, game_id)` rows. First occurrence wins; the
 * sort downstream guarantees the surviving row's position is deterministic.
 */
function dedupe(logs: readonly PlayerGameLog[]): PlayerGameLog[] {
  const seen = new Set<string>();
  const out: PlayerGameLog[] = [];
  for (const log of logs) {
    const key = `${log.player_id}::${log.game_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(log);
  }
  return out;
}

function groupByPlayer(logs: readonly PlayerGameLog[]): Map<string, PlayerGameLog[]> {
  const m = new Map<string, PlayerGameLog[]>();
  for (const log of logs) {
    const arr = m.get(log.player_id);
    if (arr) arr.push(log);
    else m.set(log.player_id, [log]);
  }
  return m;
}

function compareLogs(a: PlayerGameLog, b: PlayerGameLog): number {
  if (a.game_date !== b.game_date) return a.game_date < b.game_date ? -1 : 1;
  if (a.game_id !== b.game_id) return a.game_id < b.game_id ? -1 : 1;
  return 0;
}

function makeEmptySummary(): Summary {
  return {
    totalSignals: 0,
    hitRateVsSeasonAvg: 0,
    hitRateVsProjection: 0,
    averageMarginVsSeasonAvg: 0,
    averageMarginVsProjection: 0,
    medianMarginVsSeasonAvg: 0,
    medianMarginVsProjection: 0,
  };
}

function summarize(signals: readonly Signal[]): Summary {
  if (signals.length === 0) return makeEmptySummary();
  const marginsSeason = signals.map((s) => s.marginVsSeasonAvg);
  const marginsProjection = signals.map((s) => s.marginVsProjection);
  const hitsSeason = signals.reduce((n, s) => n + (s.hitVsSeasonAvg ? 1 : 0), 0);
  const hitsProjection = signals.reduce((n, s) => n + (s.hitVsProjection ? 1 : 0), 0);
  return {
    totalSignals: signals.length,
    hitRateVsSeasonAvg: hitsSeason / signals.length,
    hitRateVsProjection: hitsProjection / signals.length,
    averageMarginVsSeasonAvg: mean(marginsSeason),
    averageMarginVsProjection: mean(marginsProjection),
    medianMarginVsSeasonAvg: median(marginsSeason),
    medianMarginVsProjection: median(marginsProjection),
  };
}

/**
 * Public entry point. See module-level doc for invariants.
 */
export function evaluateRecentFormMinutes(
  logs: readonly PlayerGameLog[],
  config: RecentFormMinutesConfig
): BacktestResult {
  const resolved = resolveConfig(config);
  const signals: Signal[] = [];

  const deduped = dedupe(logs);
  const byPlayer = groupByPlayer(deduped);

  for (const [playerId, plogs] of byPlayer) {
    const sorted = [...plogs].sort(compareLogs);

    for (let i = 0; i < sorted.length; i++) {
      const target = sorted[i];

      if (target.game_date < resolved.evaluationStartDate) continue;
      if (target.game_date > resolved.evaluationEndDate) continue;

      const prior = sorted.slice(0, i);
      if (prior.length < resolved.minPriorGames) continue;

      const seasonAvg = mean(prior.map((p) => statValue(p, resolved.stat)));
      if (seasonAvg <= 0) continue;

      const last10 = prior.slice(-10);
      const last5 = prior.slice(-5);

      const last10Stats = last10.map((p) => statValue(p, resolved.stat));
      const last5Stats = last5.map((p) => statValue(p, resolved.stat));
      const last10Avg = mean(last10Stats);
      const last5Avg = mean(last5Stats);

      // Missing-minutes policy: ignore null minutes from the L5 average. If
      // every game in the L5 window has missing minutes, fail safely (no
      // signal) rather than emit one we can't gate on.
      const last5MinutesValid: number[] = [];
      for (const p of last5) {
        if (typeof p.minutes === 'number' && Number.isFinite(p.minutes)) {
          last5MinutesValid.push(p.minutes);
        }
      }
      if (last5MinutesValid.length === 0) continue;
      const last5MinutesAvg = mean(last5MinutesValid);
      if (last5MinutesAvg < resolved.minMinutesL5) continue;

      if (last10Avg < seasonAvg * resolved.recentFormThreshold) continue;

      const actual = statValue(target, resolved.stat);
      const projection =
        resolved.projectionWeightL10 * last10Avg + resolved.projectionWeightSeason * seasonAvg;

      signals.push({
        playerId,
        playerName: target.player_name ?? null,
        gameId: target.game_id,
        gameDate: target.game_date,
        team: target.team_abbr ?? null,
        opponent: target.opponent_abbr ?? null,
        stat: resolved.stat,
        actual,
        seasonAvgBeforeGame: seasonAvg,
        last5AvgBeforeGame: last5Avg,
        last10AvgBeforeGame: last10Avg,
        last5MinutesAvgBeforeGame: last5MinutesAvg,
        weightedProjection: projection,
        hitVsSeasonAvg: actual > seasonAvg,
        hitVsProjection: actual > projection,
        marginVsSeasonAvg: actual - seasonAvg,
        marginVsProjection: actual - projection,
        priorGames: prior.length,
      });
    }
  }

  // Stable, deterministic output ordering across players.
  signals.sort((a, b) => {
    if (a.gameDate !== b.gameDate) return a.gameDate < b.gameDate ? -1 : 1;
    if (a.playerId !== b.playerId) return a.playerId < b.playerId ? -1 : 1;
    return 0;
  });

  return {
    strategy: 'RECENT_FORM_MINUTES',
    config: resolved,
    summary: summarize(signals),
    signals,
  };
}
