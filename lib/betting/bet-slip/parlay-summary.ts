/**
 * Independent-leg parlay math (simplifying assumption).
 * Combined model P ≈ ∏ P(leg); parlay EV from total decimal odds when available.
 */

export type LegForParlay = {
  index: number;
  modelProbability: number | null;
  ev: number | null;
  marketImpliedProbability: number | null;
};

function americanToDecimal(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  if (american < 0) return 1 + 100 / Math.abs(american);
  return 1 + american / 100;
}

export function impliedProbFromAmerican(american: number | null): number | null {
  if (american == null || Number.isNaN(american) || american === 0) return null;
  if (american < 0) return (-american) / ((-american) + 100);
  return 100 / (american + 100);
}

export function computeParlaySummary(input: {
  legs: LegForParlay[];
  totalOddsAmerican: number | null;
  totalOddsDecimal: number | null;
}): {
  combinedModelProbability: number | null;
  impliedProbabilityFromTotal: number | null;
  estimatedParlayEv: number | null;
  strongestLegIndex: number | null;
  weakestLegIndex: number | null;
  independenceNote: string;
} {
  const independenceNote =
    'Parlay model probability treats legs as independent (no same-game correlation). Use as a rough guide.';

  const probs = input.legs
    .map((l) => l.modelProbability)
    .filter((p): p is number => p != null && Number.isFinite(p) && p > 0 && p < 1);

  let combinedModelProbability: number | null = null;
  if (probs.length === input.legs.length && probs.length > 0) {
    combinedModelProbability = probs.reduce((a, b) => a * b, 1);
  }

  const dec =
    input.totalOddsDecimal != null && Number.isFinite(input.totalOddsDecimal) && input.totalOddsDecimal > 1
      ? input.totalOddsDecimal
      : input.totalOddsAmerican != null
        ? americanToDecimal(input.totalOddsAmerican)
        : null;

  const impliedProbabilityFromTotal =
    dec != null && dec > 1 ? Math.min(1, Math.max(0, 1 / dec)) : null;

  let estimatedParlayEv: number | null = null;
  if (combinedModelProbability != null && dec != null && dec > 1) {
    estimatedParlayEv = combinedModelProbability * dec - 1;
  }

  const withEv = input.legs.filter((l) => l.ev != null && Number.isFinite(l.ev));
  let strongestLegIndex: number | null = null;
  let weakestLegIndex: number | null = null;
  if (withEv.length) {
    const sorted = [...withEv].sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
    strongestLegIndex = sorted[0]?.index ?? null;
    weakestLegIndex = sorted[sorted.length - 1]?.index ?? null;
  }

  return {
    combinedModelProbability,
    impliedProbabilityFromTotal,
    estimatedParlayEv,
    strongestLegIndex,
    weakestLegIndex,
    independenceNote,
  };
}
