/**
 * Ledger means come from the production serving functions.
 * This module does not restate the 70/30 or Track B.1 formulas.
 */

import { getCalibrationVersion } from '@/lib/betting/ev-calibration';
import { computePropEvFields, type PropEvRowInput } from '@/lib/betting/player-prop-ev-row';
import { getStatsForPropType, type PlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import {
  computeProjection,
  computeTrackB1PlayerPropProbability,
  getStdDev,
} from '@/lib/betting/player-prop-model';
import type { EvTrack } from '@/lib/betting/ev-selection-policy';
import { LEDGER_MODEL_ID, LEDGER_MODEL_VERSION, isLedgerMarket } from '@/lib/betting/projection-ledger/protocol';
import { computeL5BlendWeight, isComboPropType } from '@/lib/betting/track-b1-policy';

export interface LedgerMean {
  market: string;
  projectionValue: number;
  baseProjectionValue: number;
  sigmaEffective: number;
  servingTrack: EvTrack;
  projectionModelId: string;
  projectionModelVersion: string;
  calibrationVersion: string;
  inputSnapshot: Record<string, unknown>;
  l5Avg: number;
  l10Avg: number;
  seasonAvg: number;
  sampleGamesUsed: number;
  seasonGamesPlayed: number;
  l10GameIds: string[];
  latestInputGameStartTime: string | null;
  inputSeasonKey: string;
}

export interface LedgerServedSide {
  servedProbabilityRaw: number | null;
  servedProbabilityCalibrated: number | null;
  servedProbabilityAnchored: number | null;
  servedEv: number | null;
  /** Serving mean for this same input. Must match LedgerMean.projectionValue. */
  projectionValue: number | null;
}

export function buildLedgerMean(
  inputs: PlayerPropModelInputs,
  market: string,
  servingTrack: EvTrack
): LedgerMean | null {
  if (!isLedgerMarket(market)) return null;
  const stats = getStatsForPropType(inputs, market);
  if (!stats) return null;
  const base = computeProjection(stats.last10Avg, stats.seasonAvg);
  const blended = computeTrackB1PlayerPropProbability(
    {
      last10Avg: stats.last10Avg,
      seasonAvg: stats.seasonAvg,
      line: 0,
      propType: market,
      last5Avg: stats.last5Avg,
      observedStdDev: stats.observedStdDev,
    },
    { signals: stats.stability, isCombo: isComboPropType(market) }
  );
  if (!Number.isFinite(base) || !Number.isFinite(blended.projection) || blended.sigmaEffective == null) {
    return null;
  }
  const projectionValue = servingTrack === 'trackB_calibrated' ? blended.projection : base;
  const combo = isComboPropType(market);
  return {
    market,
    projectionValue,
    baseProjectionValue: base,
    sigmaEffective: blended.sigmaEffective,
    servingTrack,
    projectionModelId: LEDGER_MODEL_ID,
    projectionModelVersion: LEDGER_MODEL_VERSION,
    calibrationVersion: getCalibrationVersion(),
    l5Avg: stats.last5Avg,
    l10Avg: stats.last10Avg,
    seasonAvg: stats.seasonAvg,
    sampleGamesUsed: inputs.sampleGamesUsed,
    seasonGamesPlayed: inputs.seasonGamesPlayed,
    l10GameIds: inputs.l10GameIds,
    latestInputGameStartTime: inputs.latestInputGameStartTime,
    inputSeasonKey: inputs.seasonKey,
    inputSnapshot: {
      l10_game_ids: inputs.l10GameIds,
      std10: stats.observedStdDev,
      w_l5: computeL5BlendWeight(stats.stability, combo),
      minutes_cv: stats.stability.minutesCv,
      minutes_stability_score: stats.stability.minutesStabilityScore,
      stat_coeff_var: stats.stability.statCoeffVar,
      sigma_fallback: getStdDev(market),
      combo_sigma_multiplier: blended.comboSigmaMultiplierApplied ?? null,
      dnp_inclusive_inputs: true,
      reliability_shrink_summary: blended.reliabilityShrinkSummary ?? null,
      sample_games_used: stats.stability.sampleGamesUsed,
    },
  };
}

export function servedSideForLine(
  inputs: PlayerPropModelInputs,
  market: string,
  servingTrack: EvTrack,
  row: PropEvRowInput
): LedgerServedSide | null {
  const fields = computePropEvFields(row, inputs, servingTrack);
  if (fields.projection == null) return null;
  const raw =
    servingTrack === 'trackB_calibrated' ? fields.modelProbabilityTrackBRaw : fields.modelProbabilityTrackARaw;
  const calibrated =
    servingTrack === 'trackB_calibrated'
      ? fields.modelProbabilityTrackBCalibrated
      : fields.modelProbabilityTrackACalibrated;
  const anchored =
    servingTrack === 'trackB_calibrated'
      ? fields.modelProbabilityTrackBAnchored
      : fields.modelProbabilityTrackAAnchored;
  const ev = servingTrack === 'trackB_calibrated' ? fields.evTrackB : fields.evTrackA;
  return {
    projectionValue: fields.projection,
    servedProbabilityRaw: raw,
    servedProbabilityCalibrated: calibrated,
    servedProbabilityAnchored: anchored,
    servedEv: servingTrack === 'baseline' ? fields.ev : ev,
  };
}

export function partitionSportsbookObservations<T extends { side: string; observedAt: string }>(
  rows: readonly T[],
  generatedAt: string
): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const row of rows) {
    const side = row.side.trim().toLowerCase();
    if (side !== 'over' && side !== 'under') {
      rejected.push(row);
      continue;
    }
    if (!marketObservedBeforeProjection(row.observedAt, generatedAt)) {
      rejected.push(row);
      continue;
    }
    accepted.push({ ...row, side });
  }
  return { accepted, rejected };
}

export function marketObservedBeforeProjection(observedAt: string, generatedAt: string): boolean {
  const observed = Date.parse(observedAt);
  const generated = Date.parse(generatedAt);
  return Number.isFinite(observed) && Number.isFinite(generated) && observed <= generated;
}
