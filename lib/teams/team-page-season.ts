/**
 * Team-page season context (Phase 2.T.3A.1+).
 *
 * One page → one analytics season.
 * Default: active pin via getAnalyticsSeason().
 * Override: ?season=2026 (or selectedSeason) without changing Production pin.
 */

import {
  formatNbaSeasonLabel,
  getAnalyticsSeason,
  getRosterSeason,
  parseSeasonStartYear,
} from '@/lib/season';

export type TeamPageSeasonContext = {
  /** Analytics start-year used in queries (e.g. "2025"). */
  season: string;
  /** User-facing label (e.g. "2025–26"). */
  seasonLabel: string;
};

export type TeamPageSeasonChoice = {
  season: string;
  seasonLabel: string;
};

/**
 * Seasons offered in the team-page switcher.
 * Active pin + next season (e.g. 2025 and 2026) so 2026–27 is reachable
 * without flipping Production CURRENT_ANALYTICS_SEASON.
 */
export function listTeamPageSeasonChoices(
  env: NodeJS.ProcessEnv = process.env
): TeamPageSeasonChoice[] {
  const active = Number(getAnalyticsSeason(env));
  const years = [active, active + 1];
  return years.map((y) => {
    const season = String(y);
    return { season, seasonLabel: formatNbaSeasonLabel(season) };
  });
}

/**
 * Resolve the single season for a team page.
 * `selectedSeason` comes from ?season= (YYYY or YYYY-YY).
 */
export function resolveTeamPageSeason(args?: {
  selectedSeason?: string | null;
  env?: NodeJS.ProcessEnv;
}): TeamPageSeasonContext {
  const fromSelected = parseSeasonStartYear(args?.selectedSeason ?? null);
  const season = fromSelected ?? getAnalyticsSeason(args?.env);
  return {
    season,
    seasonLabel: formatNbaSeasonLabel(season),
  };
}

export type RosterSeasonContext = {
  /** Analytics start-year for membership rows (e.g. "2026"). */
  season: string;
  seasonLabel: string;
};

/**
 * Roster membership season for a team page.
 * An explicit ?season= keeps that year, including historic pages.
 * The default stats page has no ?season= and still uses the 2025 pin for
 * averages; its roster uses getRosterSeason() (2026 in October 2026).
 */
export function resolveRosterSeason(args?: {
  selectedSeason?: string | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): RosterSeasonContext {
  const env = args?.env;
  const now = args?.now ?? new Date();
  const explicit = parseSeasonStartYear(args?.selectedSeason ?? null);
  const season = explicit ?? getRosterSeason(env, now);
  return { season, seasonLabel: formatNbaSeasonLabel(season) };
}

/**
 * Shown on the roster card when membership and the page's stat season differ.
 * Returns null when both seasons are the same.
 */
export function rosterStatsDistinction(
  rosterSeason: string,
  statsSeason: string
): string | null {
  if (rosterSeason === statsSeason) return null;
  return `Season stats on this page are ${formatNbaSeasonLabel(statsSeason)}.`;
}

/** Labels the 2026–27 card as a stored observation, including later gaps. */
export function rosterObservationNote(season: string): string | null {
  if (season !== '2026') return null;
  return 'Observed 2026–27 membership. Later moves may still be missing.';
}

/** Build team page href with season query (omits param when matching default pin). */
export function teamPageSeasonHref(args: {
  teamId: string;
  season: string;
  defaultSeason: string;
}): string {
  const base = `/teams/${args.teamId}`;
  if (args.season === args.defaultSeason) return base;
  return `${base}?season=${encodeURIComponent(args.season)}`;
}
