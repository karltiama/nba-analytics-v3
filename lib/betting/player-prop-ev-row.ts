import type { EvTrack } from '@/lib/betting/ev-selection-policy';
import { getStatsForPropType, type PlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import {
  computePlayerPropProbability,
  computeTrackB1PlayerPropProbability,
} from '@/lib/betting/player-prop-model';
import { calibrateProbability, getCalibrationVersion } from '@/lib/betting/ev-calibration';
import {
  computeConfidenceTier,
  isComboPropType,
  type ConfidenceTier,
} from '@/lib/betting/track-b1-policy';

/** Minimal row shape needed to compute EV / model probabilities (over/under lines). */
export interface PropEvRowInput {
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
}

const ANCHOR_EPS = 1e-5;

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
  /** Track B.1 projection (pre-calibration; same numeric value as `projectionTrackB`). */
  projectionTrackBRaw: number | null;
  modelProbabilityTrackBRaw: number | null;
  modelProbabilityTrackBCalibrated: number | null;
  modelProbabilityTrackBAnchored: number | null;
  evTrackBRaw: number | null;
  evTrackBCalibrated: number | null;
  evTrackBAnchored: number | null;
  modelProbabilityTrackARaw: number | null;
  modelProbabilityTrackACalibrated: number | null;
  modelProbabilityTrackAAnchored: number | null;
  evTrackARaw: number | null;
  evTrackACalibrated: number | null;
  evTrackAAnchored: number | null;
  marketImpliedProbability: number | null;
  anchorAppliedTrackB: boolean;
  anchorDeltaAbsTrackB: number | null;
  calibrationDeltaAbsTrackB: number | null;
  modelTrackVersion: string;
  calibrationVersion: string;
  confidenceTier: ConfidenceTier | null;
  isComboProp: boolean;
  sampleGamesUsed: number | null;
  minutesStabilityScore: number | null;
  sigmaSummary: string | null;
}

const EMPTY: PropEvFields = {
  modelProbability: null,
  ev: null,
  projection: null,
  modelProbabilityTrackA: null,
  evTrackA: null,
  projectionTrackA: null,
  modelProbabilityTrackB: null,
  evTrackB: null,
  projectionTrackB: null,
  projectionTrackBRaw: null,
  modelProbabilityTrackBRaw: null,
  modelProbabilityTrackBCalibrated: null,
  modelProbabilityTrackBAnchored: null,
  evTrackBRaw: null,
  evTrackBCalibrated: null,
  evTrackBAnchored: null,
  modelProbabilityTrackARaw: null,
  modelProbabilityTrackACalibrated: null,
  modelProbabilityTrackAAnchored: null,
  evTrackARaw: null,
  evTrackACalibrated: null,
  evTrackAAnchored: null,
  marketImpliedProbability: null,
  anchorAppliedTrackB: false,
  anchorDeltaAbsTrackB: null,
  calibrationDeltaAbsTrackB: null,
  modelTrackVersion: 'trackB.1',
  calibrationVersion: '',
  confidenceTier: null,
  isComboProp: false,
  sampleGamesUsed: null,
  minutesStabilityScore: null,
  sigmaSummary: null,
};

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

const MAX_MODEL_MARKET_PROB_GAP = 0.2;

function anchorToMarket(modelProb: number, marketProb: number): number {
  const lo = Math.max(0, marketProb - MAX_MODEL_MARKET_PROB_GAP);
  const hi = Math.min(1, marketProb + MAX_MODEL_MARKET_PROB_GAP);
  return Math.max(lo, Math.min(hi, modelProb));
}

function evFromProb(p: number, decimalOdds: number): number {
  return p * decimalOdds - 1;
}

/**
 * Computes baseline, Track A, and Track B probabilities/EV for one prop row.
 * Primary `modelProbability` / `ev` / `projection` follow `selectedTrack`.
 * Track B uses Track B.1 model; ladder exposes raw → calibrated → anchored.
 */
export function computePropEvFields(
  row: PropEvRowInput,
  modelInputs: PlayerPropModelInputs | null,
  selectedTrack: EvTrack
): PropEvFields {
  if (!modelInputs || !isOverUnderRow(row)) {
    return { ...EMPTY, calibrationVersion: getCalibrationVersion() };
  }

  const lineNum = row.line_value != null ? Number(row.line_value) : NaN;
  if (!Number.isFinite(lineNum)) {
    return { ...EMPTY, calibrationVersion: getCalibrationVersion() };
  }

  const stats = getStatsForPropType(modelInputs, row.prop_type ?? '');
  const decimalOdds = decimalOddsFromRow(row);
  if (!stats || decimalOdds == null) {
    return { ...EMPTY, calibrationVersion: getCalibrationVersion() };
  }

  const marketProb = clamp01(1 / decimalOdds);
  const propTypeStr = row.prop_type ?? 'points';
  const isUnder = (row.side ?? '').toLowerCase() === 'under';
  const isCombo = isComboPropType(propTypeStr);
  const calVer = getCalibrationVersion();

  const baselineResult = computePlayerPropProbability({
    last10Avg: stats.last10Avg,
    seasonAvg: stats.seasonAvg,
    line: lineNum,
    propType: propTypeStr,
  });
  const projection =
    Number.isFinite(baselineResult.projection) ? baselineResult.projection : null;
  const pOverBase = baselineResult.probability;
  const pSideRawBaseline = isUnder ? 1 - pOverBase : pOverBase;
  const pBase = anchorToMarket(clamp01(pSideRawBaseline), marketProb);
  if (!Number.isFinite(pBase)) {
    return { ...EMPTY, calibrationVersion: calVer };
  }

  let modelProbability: number | null = pBase;
  let ev: number | null = evFromProb(pBase, decimalOdds);

  const pSideRawA = clamp01(pSideRawBaseline);
  const pCalA = clamp01(calibrateProbability(pSideRawA, propTypeStr, 'trackA'));
  const pAnchA = anchorToMarket(pCalA, marketProb);
  const modelProbabilityTrackA = pAnchA;
  const evTrackA = evFromProb(pAnchA, decimalOdds);
  const projectionTrackA = projection;
  const evTrackARaw = evFromProb(pSideRawA, decimalOdds);
  const evTrackACalibrated = evFromProb(pCalA, decimalOdds);
  const evTrackAAnchored = evTrackA;

  const upgradedResult = computeTrackB1PlayerPropProbability(
    {
      last10Avg: stats.last10Avg,
      seasonAvg: stats.seasonAvg,
      line: lineNum,
      propType: propTypeStr,
      last5Avg: stats.last5Avg,
      observedStdDev: stats.observedStdDev,
    },
    { signals: stats.stability, isCombo }
  );
  const projectionTrackB = Number.isFinite(upgradedResult.projection)
    ? upgradedResult.projection
    : null;
  const pOverB = upgradedResult.probability;
  const pSideRawB = clamp01(isUnder ? 1 - pOverB : pOverB);
  const pCalB = clamp01(calibrateProbability(pSideRawB, propTypeStr, 'trackB'));
  const pAnchB = anchorToMarket(pCalB, marketProb);
  const modelProbabilityTrackB = pAnchB;
  const evTrackB = evFromProb(pAnchB, decimalOdds);
  const evTrackBRaw = evFromProb(pSideRawB, decimalOdds);
  const evTrackBCalibrated = evFromProb(pCalB, decimalOdds);
  const evTrackBAnchored = evTrackB;

  const anchorDeltaAbsTrackB = Math.abs(pAnchB - pCalB);
  const calibrationDeltaAbsTrackB = Math.abs(pCalB - pSideRawB);
  const anchorAppliedTrackB = anchorDeltaAbsTrackB > ANCHOR_EPS;

  const sigmaParts = [
    upgradedResult.sigmaEffective != null ? `σ=${upgradedResult.sigmaEffective.toFixed(3)}` : null,
    upgradedResult.reliabilityShrinkSummary ?? null,
  ].filter(Boolean);
  const sigmaSummary = sigmaParts.length ? sigmaParts.join('|') : null;

  const confidenceTier = computeConfidenceTier(isCombo, stats.stability);

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
    modelProbabilityTrackA: Number.isFinite(pAnchA) ? pAnchA : null,
    evTrackA: Number.isFinite(evTrackA) ? evTrackA : null,
    projectionTrackA,
    modelProbabilityTrackB: Number.isFinite(pAnchB) ? pAnchB : null,
    evTrackB: Number.isFinite(evTrackB) ? evTrackB : null,
    projectionTrackB,
    projectionTrackBRaw: projectionTrackB,
    modelProbabilityTrackBRaw: Number.isFinite(pSideRawB) ? pSideRawB : null,
    modelProbabilityTrackBCalibrated: Number.isFinite(pCalB) ? pCalB : null,
    modelProbabilityTrackBAnchored: Number.isFinite(pAnchB) ? pAnchB : null,
    evTrackBRaw: Number.isFinite(evTrackBRaw) ? evTrackBRaw : null,
    evTrackBCalibrated: Number.isFinite(evTrackBCalibrated) ? evTrackBCalibrated : null,
    evTrackBAnchored: Number.isFinite(evTrackBAnchored) ? evTrackBAnchored : null,
    modelProbabilityTrackARaw: Number.isFinite(pSideRawA) ? pSideRawA : null,
    modelProbabilityTrackACalibrated: Number.isFinite(pCalA) ? pCalA : null,
    modelProbabilityTrackAAnchored: Number.isFinite(pAnchA) ? pAnchA : null,
    evTrackARaw: Number.isFinite(evTrackARaw) ? evTrackARaw : null,
    evTrackACalibrated: Number.isFinite(evTrackACalibrated) ? evTrackACalibrated : null,
    evTrackAAnchored: Number.isFinite(evTrackAAnchored) ? evTrackAAnchored : null,
    marketImpliedProbability: marketProb,
    anchorAppliedTrackB,
    anchorDeltaAbsTrackB: Number.isFinite(anchorDeltaAbsTrackB) ? anchorDeltaAbsTrackB : null,
    calibrationDeltaAbsTrackB: Number.isFinite(calibrationDeltaAbsTrackB)
      ? calibrationDeltaAbsTrackB
      : null,
    modelTrackVersion: 'trackB.1',
    calibrationVersion: calVer,
    confidenceTier,
    isComboProp: isCombo,
    sampleGamesUsed: stats.stability.sampleGamesUsed,
    minutesStabilityScore: stats.stability.minutesStabilityScore,
    sigmaSummary,
  };
}
