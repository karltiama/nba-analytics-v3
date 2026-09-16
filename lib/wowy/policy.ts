import type { WowySupportTier } from './types';

/** Documented minimum-support policy for game-level WOWY v1. Not a confidence score. */
export const WOWY_SUPPORT_POLICY_ID = 'game-level-wowy-support-v1';

/** Either side below this → comparison is not shown as a numeric split. */
export const WOWY_INSUFFICIENT_MIN_GAMES = 2;

/** Either side below this (and at/above insufficient) → low-support label. */
export const WOWY_LOW_SUPPORT_MIN_GAMES = 8;

/**
 * Percentage differences require a comparison denominator at least this large
 * in absolute value. Smaller baselines make % change uninterpretable.
 */
export const WOWY_PERCENT_DIFF_MIN_ABS = {
  minutesPerGame: 1,
  countingPerGame: 0.5,
  perMinuteRate: 0.01,
} as const;

export const WOWY_SUPPORT_COPY: Record<WowySupportTier, string> = {
  insufficient:
    'Insufficient sample — need at least 2 with games and 2 verified without games before showing a split.',
  low_support:
    'Low support — sample is below 8 games on at least one side. Treat the split as descriptive only.',
  adequate:
    'Sample meets the documented floor of 8 games on each side. This is still not a causal effect.',
};

export function wowySupportTier(withGames: number, withoutGames: number): WowySupportTier {
  if (withGames < WOWY_INSUFFICIENT_MIN_GAMES || withoutGames < WOWY_INSUFFICIENT_MIN_GAMES) {
    return 'insufficient';
  }
  if (withGames < WOWY_LOW_SUPPORT_MIN_GAMES || withoutGames < WOWY_LOW_SUPPORT_MIN_GAMES) {
    return 'low_support';
  }
  return 'adequate';
}

export function wowySupportLabel(tier: WowySupportTier): string {
  return WOWY_SUPPORT_COPY[tier];
}

/** Numeric WITH/WITHOUT comparison cards and bars. Insufficient sample is not comparable. */
export function wowyShowsComparisonHero(tier: WowySupportTier): boolean {
  return tier !== 'insufficient';
}
