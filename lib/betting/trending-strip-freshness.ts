/**
 * Freshness guard for the dashboard Recent form strip.
 *
 * L5 averages are only "recent" when the games behind them are. A player whose last
 * game is older than the cutoff is left out, and when the season's newest stored
 * game is older than the cutoff the whole strip is stale (e.g. box score ingestion
 * stopped, or the analytics season still points at last season).
 */

import { etYmd, shiftEtYmd } from '@/lib/games/status-sync-query';

/** Calendar days (ET) a last game may be behind today and still count as recent. */
export const TRENDING_STRIP_MAX_AGE_DAYS = 10;

export type TrendingStripFreshness = {
  /** Newest stored game date (YYYY-MM-DD) for the analytics season, or null when none. */
  through: string | null;
  /** Oldest last-game date (YYYY-MM-DD) a player may have and still be shown. */
  cutoff: string;
  stale: boolean;
};

export function trendingStripCutoff(now: Date): string {
  return shiftEtYmd(etYmd(now), -TRENDING_STRIP_MAX_AGE_DAYS);
}

export function trendingStripFreshness(through: string | null, now: Date): TrendingStripFreshness {
  const cutoff = trendingStripCutoff(now);
  return { through, cutoff, stale: through == null || through < cutoff };
}
