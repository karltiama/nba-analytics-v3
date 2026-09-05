/**
 * Single season clock for the app and ops scripts.
 *
 * - Env override: CURRENT_ANALYTICS_SEASON=2025 (or 2025-26).
 * - Fallback is PINNED_ANALYTICS_SEASON ('2025'), not the July calendar.
 *   Calendar would already return 2026 in Sep 2026 and empty the dashboards
 *   until 2026-27 rows exist.
 * - calendarSeasonStartYear() is the ingestion July cutoff (Jan–Jun → prior year).
 *   Flip the pin (or set env to 2026) after 2026-27 schedule + averages are seeded.
 */

export const ANALYTICS_SEASON_ENV = 'CURRENT_ANALYTICS_SEASON';
export const PINNED_ANALYTICS_SEASON = '2025';

export function calendarSeasonStartYear(now: Date = new Date()): number {
  const year = now.getFullYear();
  const month = now.getMonth();
  return month < 6 ? year - 1 : year;
}

/** Accepts '2025' or '2025-26'. Returns start-year string or null. */
export function parseSeasonStartYear(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hyphen = trimmed.match(/^(\d{4})-\d{2}$/);
  if (hyphen) return hyphen[1];
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  return null;
}

export function toNbaStatsSeason(startYear: string): string {
  const year = Number(startYear);
  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    throw new Error(`Invalid season start year: ${startYear}`);
  }
  return `${year}-${String(year + 1).slice(-2)}`;
}

/**
 * User-facing NBA season label with an en dash.
 * Storage/query season stays the start year (e.g. "2026").
 * Display: 2025 → "2025–26", 2026 → "2026–27".
 */
export function formatNbaSeasonLabel(startYear: string): string {
  const ascii = toNbaStatsSeason(startYear);
  return ascii.replace('-', '–');
}

export function getAnalyticsSeason(
  env: NodeJS.ProcessEnv = process.env,
  _now: Date = new Date()
): string {
  const fromEnv = parseSeasonStartYear(env[ANALYTICS_SEASON_ENV] ?? env.NBA_STATS_SEASON);
  if (fromEnv) return fromEnv;
  return PINNED_ANALYTICS_SEASON;
}

/** Numeric start year for BDL `seasons[]` and ingestion (same source as getAnalyticsSeason). */
export function getAnalyticsSeasonStartYearNumber(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): number {
  return Number(getAnalyticsSeason(env, now));
}

/**
 * Resolve BDL/ingestion season start year.
 * Explicit `season` wins (CLI seed). Otherwise uses the app pin / CURRENT_ANALYTICS_SEASON —
 * never the silent calendar July cutoff, so ingest and product stay aligned during cutover.
 */
export function resolveIngestionSeasonStartYear(
  season: number | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): number {
  if (season != null && Number.isFinite(season)) return Math.trunc(season);
  return getAnalyticsSeasonStartYearNumber(env, now);
}

export function getNbaStatsSeason(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): string {
  return toNbaStatsSeason(getAnalyticsSeason(env, now));
}

/**
 * Real-world NBA season for live availability (injuries), independent of the
 * Production analytics pin. Sep 2026 → "2026".
 *
 * Override: LIVE_AVAILABILITY_SEASON=2026 (or 2026-27) for tests/ops.
 * Do NOT use getAnalyticsSeason()/pin here — that would show today's injuries
 * on historical 2025 pages while Production remains pinned to 2025.
 */
export const LIVE_AVAILABILITY_SEASON_ENV = 'LIVE_AVAILABILITY_SEASON';

export function getLiveAvailabilitySeason(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): string {
  const fromEnv = parseSeasonStartYear(env[LIVE_AVAILABILITY_SEASON_ENV]);
  if (fromEnv) return fromEnv;
  return String(calendarSeasonStartYear(now));
}

/** Show current injury badges only when the viewed season is the live NBA season. */
export function shouldShowCurrentAvailability(
  viewedSeason: string,
  liveAvailabilitySeason: string
): boolean {
  return viewedSeason === liveAvailabilitySeason;
}
