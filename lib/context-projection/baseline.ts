/**
 * Production Track B.1 PTS baseline adapter — exact Props Explorer mean path.
 */

import {
  computeProjection,
  computeTrackB1PlayerPropProbability,
} from '@/lib/betting/player-prop-model';
import {
  buildStabilitySignals,
  computeL5BlendWeight,
  neutralStabilitySignals,
  type StabilitySignals,
} from '@/lib/betting/track-b1-policy';
import type { GameLog } from '@/lib/players/types';
import {
  PRODUCTION_BASELINE_ID,
  PRODUCTION_BASELINE_VERSION,
} from '@/lib/context-projection/protocol';

export interface ProductionPtsBaselineInput {
  last10Avg: number;
  seasonAvg: number;
  last5Avg?: number | null;
  observedStdDev?: number | null;
  /** Final logs (DNP-inclusive) for stability; optional. */
  recentFinalLogs?: GameLog[] | null;
}

export interface ProductionPtsBaselineResult {
  productionBaselineId: typeof PRODUCTION_BASELINE_ID;
  productionBaselineVersion: typeof PRODUCTION_BASELINE_VERSION;
  trackAPts: number;
  productionBaselinePts: number;
  wL5: number;
}

/**
 * Canonical production PTS serving mean (Track B.1 on points).
 * Dummy line is unused for mean comparison; only `projection` is consumed.
 */
export function computeProductionPtsBaseline(
  input: ProductionPtsBaselineInput,
  signalsOverride?: StabilitySignals
): ProductionPtsBaselineResult {
  const trackAPts = computeProjection(input.last10Avg, input.seasonAvg);
  const signals: StabilitySignals =
    signalsOverride ??
    (input.recentFinalLogs?.length
      ? buildStabilitySignals(input.recentFinalLogs, 'pts')
      : neutralStabilitySignals());
  const wL5 = computeL5BlendWeight(signals, false);
  const out = computeTrackB1PlayerPropProbability(
    {
      last10Avg: input.last10Avg,
      seasonAvg: input.seasonAvg,
      last5Avg: input.last5Avg ?? undefined,
      observedStdDev: input.observedStdDev ?? undefined,
      line: 0,
      propType: 'points',
    },
    { signals, isCombo: false }
  );
  return {
    productionBaselineId: PRODUCTION_BASELINE_ID,
    productionBaselineVersion: PRODUCTION_BASELINE_VERSION,
    trackAPts,
    productionBaselinePts: out.projection,
    wL5,
  };
}
