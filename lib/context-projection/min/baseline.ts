/**
 * B0_PLAYER_HISTORY MIN — expanding same-season/same-team prior PLAYED mean.
 */

import { B0_MIN_VERSION } from '@/lib/context-projection/min/protocol';

export interface B0MinPriorGame {
  teamId: string;
  season: string;
  startTime: string;
  played: boolean;
  minutes: number;
}

/**
 * Mean of prior same-season same-team PLAYED minutes with start < tip.
 * Returns null when n === 0 (cold start — exclude / baseline unavailable).
 */
export function computeB0Min(
  priors: B0MinPriorGame[],
  tipIso: string,
  season: string,
  teamId: string
): { b0Min: number | null; historyN: number; version: typeof B0_MIN_VERSION } {
  const vals: number[] = [];
  for (const g of priors) {
    if (!g.played) continue;
    if (g.season !== season) continue;
    if (g.teamId !== teamId) continue;
    if (!(g.startTime < tipIso)) continue;
    vals.push(g.minutes);
  }
  if (vals.length === 0) {
    return { b0Min: null, historyN: 0, version: B0_MIN_VERSION };
  }
  const b0Min = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { b0Min, historyN: vals.length, version: B0_MIN_VERSION };
}
