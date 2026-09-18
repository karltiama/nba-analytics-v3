/**
 * Opponent Context V1 metric formulas (locked by opponent-context-design).
 *
 * Pace: mean(estimated_possessions) — unit possessions/game, NOT /48.
 * Rates: pooled numerator / pooled denominator.
 */

import type { OpponentTeamBox } from './team-box';
import { POSSESSION_FTA_WEIGHT } from './team-box';

export type OpponentMetricId =
  | 'pace'
  | 'defensive_rating'
  | 'defensive_rebound_pct'
  | 'offensive_rebound_pct'
  | 'turnover_rate'
  | 'three_point_attempt_rate_allowed';

export type OpponentMetrics = {
  pace: number | null;
  defensiveRating: number | null;
  defensiveReboundPct: number | null;
  offensiveReboundPct: number | null;
  turnoverRate: number | null;
  threePointAttemptRateAllowed: number | null;
};

export function gameDefensiveRating(box: OpponentTeamBox): number | null {
  const p = box.estimatedPossessions;
  if (!(p > 0) || !Number.isFinite(p) || !Number.isFinite(box.pointsAllowed)) return null;
  return (100 * box.pointsAllowed) / p;
}

export function gameDefensiveReboundPct(box: OpponentTeamBox): number | null {
  const den = box.drb + box.opponentOrb;
  if (!(den > 0) || !Number.isFinite(den)) return null;
  return box.drb / den;
}

export function gameOffensiveReboundPct(box: OpponentTeamBox): number | null {
  const den = box.orb + box.opponentDrb;
  if (!(den > 0) || !Number.isFinite(den)) return null;
  return box.orb / den;
}

export function gameTurnoverRate(box: OpponentTeamBox): number | null {
  // Opponent offensive turnover rate (profile team's own TOV)
  const den = box.fga + POSSESSION_FTA_WEIGHT * box.fta + box.tov;
  if (!(den > 0) || !Number.isFinite(den)) return null;
  return box.tov / den;
}

export function gameThreePointAttemptRateAllowed(box: OpponentTeamBox): number | null {
  // Volume allowed: shots by opponents facing this team
  if (!(box.opponentFga > 0) || !Number.isFinite(box.opponentFga)) return null;
  return box.opponentTpa / box.opponentFga;
}

/** Arithmetic mean of game-level estimated possessions. */
export function aggregatePace(history: readonly OpponentTeamBox[]): number | null {
  const vals = history
    .map((b) => b.estimatedPossessions)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Pooled 100 * Σ points_allowed / Σ estimated_possessions. */
export function aggregateDefensiveRating(history: readonly OpponentTeamBox[]): number | null {
  let allowed = 0;
  let poss = 0;
  for (const b of history) {
    if (!(b.estimatedPossessions > 0) || !Number.isFinite(b.estimatedPossessions)) continue;
    if (!Number.isFinite(b.pointsAllowed)) continue;
    allowed += b.pointsAllowed;
    poss += b.estimatedPossessions;
  }
  if (!(poss > 0)) return null;
  const v = (100 * allowed) / poss;
  return Number.isFinite(v) ? v : null;
}

export function aggregateDefensiveReboundPct(history: readonly OpponentTeamBox[]): number | null {
  let num = 0;
  let den = 0;
  for (const b of history) {
    const d = b.drb + b.opponentOrb;
    if (!(d > 0) || !Number.isFinite(d)) continue;
    num += b.drb;
    den += d;
  }
  if (!(den > 0)) return null;
  const v = num / den;
  return Number.isFinite(v) ? v : null;
}

export function aggregateOffensiveReboundPct(history: readonly OpponentTeamBox[]): number | null {
  let num = 0;
  let den = 0;
  for (const b of history) {
    const d = b.orb + b.opponentDrb;
    if (!(d > 0) || !Number.isFinite(d)) continue;
    num += b.orb;
    den += d;
  }
  if (!(den > 0)) return null;
  const v = num / den;
  return Number.isFinite(v) ? v : null;
}

export function aggregateTurnoverRate(history: readonly OpponentTeamBox[]): number | null {
  let num = 0;
  let den = 0;
  for (const b of history) {
    const d = b.fga + POSSESSION_FTA_WEIGHT * b.fta + b.tov;
    if (!(d > 0) || !Number.isFinite(d)) continue;
    num += b.tov;
    den += d;
  }
  if (!(den > 0)) return null;
  const v = num / den;
  return Number.isFinite(v) ? v : null;
}

export function aggregateThreePointAttemptRateAllowed(
  history: readonly OpponentTeamBox[]
): number | null {
  let tpa = 0;
  let fga = 0;
  for (const b of history) {
    if (!(b.opponentFga > 0) || !Number.isFinite(b.opponentFga)) continue;
    tpa += b.opponentTpa;
    fga += b.opponentFga;
  }
  if (!(fga > 0)) return null;
  const v = tpa / fga;
  return Number.isFinite(v) ? v : null;
}

export function aggregateOpponentMetrics(history: readonly OpponentTeamBox[]): OpponentMetrics {
  if (history.length === 0) {
    return {
      pace: null,
      defensiveRating: null,
      defensiveReboundPct: null,
      offensiveReboundPct: null,
      turnoverRate: null,
      threePointAttemptRateAllowed: null,
    };
  }
  return {
    pace: aggregatePace(history),
    defensiveRating: aggregateDefensiveRating(history),
    defensiveReboundPct: aggregateDefensiveReboundPct(history),
    offensiveReboundPct: aggregateOffensiveReboundPct(history),
    turnoverRate: aggregateTurnoverRate(history),
    threePointAttemptRateAllowed: aggregateThreePointAttemptRateAllowed(history),
  };
}

export function assertOpponentMetricDomains(m: OpponentMetrics): void {
  const check = (name: string, v: number | null, pred: (x: number) => boolean) => {
    if (v == null) return;
    if (!Number.isFinite(v) || !pred(v)) {
      throw new Error(`invalid domain ${name}=${v}`);
    }
  };
  check('pace', m.pace, (x) => x > 0);
  check('defensiveRating', m.defensiveRating, (x) => x > 0);
  check('defensiveReboundPct', m.defensiveReboundPct, (x) => x >= 0 && x <= 1);
  check('offensiveReboundPct', m.offensiveReboundPct, (x) => x >= 0 && x <= 1);
  check('turnoverRate', m.turnoverRate, (x) => x >= 0);
  check(
    'threePointAttemptRateAllowed',
    m.threePointAttemptRateAllowed,
    (x) => x >= 0 && x <= 1
  );
}
