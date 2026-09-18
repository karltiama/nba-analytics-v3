/**
 * Comparison helpers — RECENT_MINUS_SEASON only.
 */

import {
  equalAtDisplayPrecision1,
  equalAtPercentagePointPrecision,
  roundToDecimals,
} from './format';

export type ComparisonKind = 'counting' | 'minutes' | 'percentage_fraction';

export type ComparisonResult =
  | { status: 'ok'; delta: number; displayRecent: number; displaySeason: number }
  | { status: 'suppressed' }
  | { status: 'missing' };

export function compareRecentMinusSeason(
  recent: number | null | undefined,
  season: number | null | undefined,
  kind: ComparisonKind
): ComparisonResult {
  if (
    recent == null ||
    season == null ||
    !Number.isFinite(recent) ||
    !Number.isFinite(season)
  ) {
    return { status: 'missing' };
  }

  if (kind === 'percentage_fraction') {
    if (equalAtPercentagePointPrecision(recent, season)) {
      return { status: 'suppressed' };
    }
    return {
      status: 'ok',
      delta: recent - season,
      displayRecent: roundToDecimals(recent * 100, 1),
      displaySeason: roundToDecimals(season * 100, 1),
    };
  }

  if (equalAtDisplayPrecision1(recent, season)) {
    return { status: 'suppressed' };
  }

  return {
    status: 'ok',
    delta: recent - season,
    displayRecent: roundToDecimals(recent, 1),
    displaySeason: roundToDecimals(season, 1),
  };
}
