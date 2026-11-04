/**
 * Display-only market probability helpers.
 * Does not persist odds or overwrite stored implied probabilities.
 */

import { americanToImpliedProb } from '@/lib/betting/odds-utils';

/** Raw American-to-implied (includes vig). Rejects missing / zero moneylines. */
export function rawImpliedProbFromMoneyline(ml: number | null | undefined): number | null {
  if (ml == null || !Number.isFinite(ml) || ml === 0) return null;
  const p = americanToImpliedProb(ml);
  if (p == null || !Number.isFinite(p) || p <= 0) return null;
  return p;
}

export type TwoWayMarketDisplay = {
  /** Integer percents; awayPct + homePct === 100. */
  awayPct: number;
  homePct: number;
  /** Sportsbook favorite from raw (with-vig) implied probability. */
  favorite: 'home' | 'away' | null;
  /** |no-vig home − no-vig away| × 100 < 10. */
  isClose: boolean;
};

const CLOSE_PP = 10;

/**
 * Two-way no-vig display percents from moneylines.
 * awayDisplay = round(awayShare × 100); homeDisplay = 100 − awayDisplay.
 */
export function twoWayMarketDisplay(
  awayMoneyline: number | null | undefined,
  homeMoneyline: number | null | undefined
): TwoWayMarketDisplay | null {
  const rawAway = rawImpliedProbFromMoneyline(awayMoneyline ?? null);
  const rawHome = rawImpliedProbFromMoneyline(homeMoneyline ?? null);
  if (rawAway == null || rawHome == null) return null;
  const total = rawAway + rawHome;
  if (!Number.isFinite(total) || total <= 0) return null;

  const awayNoVig = rawAway / total;
  const homeNoVig = rawHome / total;
  const awayPct = Math.round(awayNoVig * 100);
  const homePct = 100 - awayPct;

  let favorite: 'home' | 'away' | null = null;
  if (rawHome > rawAway) favorite = 'home';
  else if (rawAway > rawHome) favorite = 'away';

  return {
    awayPct,
    homePct,
    favorite,
    isClose: Math.abs(homeNoVig - awayNoVig) * 100 < CLOSE_PP,
  };
}

/**
 * Two-way no-vig probability for one side: own / (own + opposite).
 * Both inputs are raw (with-vig) implied probabilities from the same book and line.
 * Returns null when either side is missing or out of (0, 1).
 */
export function noVigProbability(
  ownImplied: number | null | undefined,
  oppositeImplied: number | null | undefined
): number | null {
  if (ownImplied == null || oppositeImplied == null) return null;
  if (!Number.isFinite(ownImplied) || !Number.isFinite(oppositeImplied)) return null;
  if (ownImplied <= 0 || ownImplied >= 1 || oppositeImplied <= 0 || oppositeImplied >= 1) return null;
  return ownImplied / (ownImplied + oppositeImplied);
}

export function projectionGap(
  projection: number | null | undefined,
  marketLine: number | null | undefined
): number | null {
  if (projection == null || marketLine == null) return null;
  if (!Number.isFinite(projection) || !Number.isFinite(marketLine)) return null;
  return projection - marketLine;
}

export function formatProjectionGap(gap: number): string {
  if (!Number.isFinite(gap)) return '—';
  if (Object.is(gap, -0) || Math.abs(gap) < 5e-12) return '0.0';
  const rounded = Number(gap.toFixed(1));
  if (rounded === 0) return '0.0';
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

export const PROJECTION_METHODOLOGY =
  'Based on recent and season performance. Matchup adjustments are not yet included in this projection.';
