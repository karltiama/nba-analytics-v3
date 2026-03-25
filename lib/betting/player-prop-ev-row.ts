import type { EvTrack } from '@/lib/betting/ev-selection-policy';
import { getStatsForPropType, type PlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { computePlayerPropProbability, computeUpgradedPlayerPropProbability } from '@/lib/betting/player-prop-model';
import { calibrateProbability } from '@/lib/betting/ev-calibration';

/** Minimal row shape needed to compute EV / model probabilities (over/under lines). */
export interface PropEvRowInput {
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
}

export interface PropEvFields {
  modelProbability: number | null;
  ev: number | null;
  projection: number | null;
  modelProbabilityTrackA: number | null;
  evTrackA: number | null;
  projectionTrackA: number | null;
  modelProbabilityTrackB: number | null;
  evTrackB: number | null;
  projectionTrackB: number | null;
}

const MAX_MODEL_MARKET_PROB_GAP = 0.2;

function decimalOddsFromRow(row: PropEvRowInput): number | null {
  const oddsDec =
    row.odds_decimal != null && Number.isFinite(Number(row.odds_decimal))
      ? Number(row.odds_decimal)
      : null;
  const oddsAm = row.odds_american != null ? Number(row.odds_american) : null;
  if (oddsDec != null) return oddsDec;
  if (oddsAm != null && Number.isFinite(oddsAm)) {
    return oddsAm < 0 ? 1 + 100 / Math.abs(oddsAm) : 1 + oddsAm / 100;
  }
  return null;
}

function isOverUnderRow(row: PropEvRowInput): boolean {
  return (
    (row.market_type ?? '').toLowerCase() === 'over_under' &&
    ((row.side ?? '').toLowerCase() === 'over' || (row.side ?? '').toLowerCase() === 'under')
  );
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function anchorToMarket(modelProb: number, marketProb: number): number {
  const lo = Math.max(0, marketProb - MAX_MODEL_MARKET_PROB_GAP);
  const hi = Math.min(1, marketProb + MAX_MODEL_MARKET_PROB_GAP);
  return Math.max(lo, Math.min(hi, modelProb));
}

/**
 * Computes baseline, Track A, and Track B probabilities/EV for one prop row.
 * Primary `modelProbability` / `ev` / `projection` follow `selectedTrack`.
 */
export function computePropEvFields(
  row: PropEvRowInput,
  modelInputs: PlayerPropModelInputs | null,
  selectedTrack: EvTrack
): PropEvFields {
  const empty: PropEvFields = {
    modelProbability: null,
    ev: null,
    projection: null,
    modelProbabilityTrackA: null,
    evTrackA: null,
    projectionTrackA: null,
    modelProbabilityTrackB: null,
    evTrackB: null,
    projectionTrackB: null,
  };

  if (!modelInputs || !isOverUnderRow(row)) return empty;

  const lineNum = row.line_value != null ? Number(row.line_value) : NaN;
  if (!Number.isFinite(lineNum)) return empty;

  const stats = getStatsForPropType(modelInputs, row.prop_type ?? '');
  const decimalOdds = decimalOddsFromRow(row);
  if (!stats || decimalOdds == null) return empty;
  const marketProb = clamp01(1 / decimalOdds);

  const baselineResult = computePlayerPropProbability({
    last10Avg: stats.last10Avg,
    seasonAvg: stats.seasonAvg,
    line: lineNum,
    propType: row.prop_type ?? 'points',
  });
  const projection =
    Number.isFinite(baselineResult.projection) ? baselineResult.projection : null;
  const pOverBase = baselineResult.probability;
  const pBaseRaw = (row.side ?? '').toLowerCase() === 'under' ? 1 - pOverBase : pOverBase;
  const pBase = anchorToMarket(clamp01(pBaseRaw), marketProb);
  if (!Number.isFinite(pBase)) return empty;

  let modelProbability: number | null = pBase;
  let ev: number | null = pBase * decimalOdds - 1;

  const pTrackA = anchorToMarket(
    calibrateProbability(pBase, row.prop_type ?? 'points', 'trackA'),
    marketProb
  );
  const modelProbabilityTrackA = pTrackA;
  const evTrackA = pTrackA * decimalOdds - 1;
  const projectionTrackA = projection;

  const upgradedResult = computeUpgradedPlayerPropProbability({
    last10Avg: stats.last10Avg,
    seasonAvg: stats.seasonAvg,
    line: lineNum,
    propType: row.prop_type ?? 'points',
    last5Avg: stats.last5Avg,
    observedStdDev: stats.observedStdDev,
  });
  const projectionTrackB = Number.isFinite(upgradedResult.projection)
    ? upgradedResult.projection
    : null;
  const pOverB = upgradedResult.probability;
  const pRawB = (row.side ?? '').toLowerCase() === 'under' ? 1 - pOverB : pOverB;
  const pTrackB = anchorToMarket(
    calibrateProbability(clamp01(pRawB), row.prop_type ?? 'points', 'trackB'),
    marketProb
  );
  const modelProbabilityTrackB = pTrackB;
  const evTrackB = pTrackB * decimalOdds - 1;

  let projectionOut = projection;
  if (selectedTrack === 'trackA_calibrated') {
    modelProbability = modelProbabilityTrackA;
    ev = evTrackA;
    projectionOut = projectionTrackA;
  } else if (selectedTrack === 'trackB_calibrated') {
    modelProbability = modelProbabilityTrackB;
    ev = evTrackB;
    projectionOut = projectionTrackB;
  }

  return {
    modelProbability,
    ev: ev != null && Number.isFinite(ev) ? ev : null,
    projection: projectionOut,
    modelProbabilityTrackA: Number.isFinite(pTrackA) ? pTrackA : null,
    evTrackA: Number.isFinite(evTrackA) ? evTrackA : null,
    projectionTrackA,
    modelProbabilityTrackB: Number.isFinite(pTrackB) ? pTrackB : null,
    evTrackB: Number.isFinite(evTrackB) ? evTrackB : null,
    projectionTrackB,
  };
}
