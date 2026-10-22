/**
 * Canonical season-type policy for BDL game acquisition and regular-season serving writes.
 *
 * Three separate concepts. Do not collapse them:
 *   1. Provider query classification: the `season_type` sent to /v1/games. BDL game rows carry
 *      no game-type field of their own (`postseason=false` is not evidence of a regular-season
 *      game, and numeric game ids interleave preseason and regular season).
 *   2. Normalized season phase: lib/games/season-phase.ts (PRESEASON, REGULAR, IST, ...).
 *   3. Serving eligibility (this module): may a game row enter analytics.* serving tables.
 *
 * Lambda packages hold byte-identical copies of this file (copy-drift test). No imports.
 */

/**
 * Inclusive America/New_York calendar date of regular-season opening night
 * for each season start-year. Tips strictly before this are preseason.
 */
export const REGULAR_SEASON_OPEN_ET: Readonly<Record<string, string>> = {
  '2023': '2023-10-24',
  '2024': '2024-10-22',
  '2025': '2025-10-21',
  /** Official 2026–27 regular-season opening night (America/New_York). */
  '2026': '2026-10-20',
};

/** America/New_York play-in-inclusive postseason floor per season start-year. */
export const POSTSEASON_START_ET: Readonly<Record<string, string>> = {
  '2023': '2024-04-16',
  '2024': '2025-04-15',
  '2025': '2026-04-14',
};

/**
 * America/New_York date of the NBA Cup championship game. It does not count toward the regular
 * season, so it never enters serving tables. Each date had exactly one NBA game. Add a season only
 * from the official schedule; until then the championship is caught by its provider ist_stage.
 */
export const NBA_CUP_FINAL_ET: Readonly<Record<string, string>> = {
  '2023': '2023-12-09',
  '2024': '2024-12-17',
  '2025': '2025-12-16',
};

/** Provider ist_stage naming the Cup championship. Group, quarterfinal and semifinal stay false. */
export function isNbaCupChampionshipStage(stage: unknown): boolean {
  if (typeof stage !== 'string') return false;
  const s = stage.trim().toLowerCase();
  if (!s || /semi|quarter/.test(s)) return false;
  return /\bfinals?\b|championship/.test(s);
}

export const BDL_SEASON_TYPE_PRESEASON = 'preseason';
export const BDL_SEASON_TYPE_REGULAR = 'regular';
export const BDL_SEASON_TYPE_PLAYIN = 'playin';
export const BDL_SEASON_TYPE_PLAYOFFS = 'playoffs';

/** Provider season_type values whose rows may enter regular-season / postseason serving tables. */
export const BDL_SERVING_SEASON_TYPES: ReadonlySet<string> = new Set([
  BDL_SEASON_TYPE_REGULAR,
  'ist',
  BDL_SEASON_TYPE_PLAYIN,
  BDL_SEASON_TYPE_PLAYOFFS,
]);

/** Normalized season_phase values (lib/games/season-phase.ts) eligible for serving and projection. */
export const SERVING_SEASON_PHASES: ReadonlySet<string> = new Set(['REGULAR', 'IST', 'PLAYIN', 'PLAYOFFS']);

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** America/New_York calendar date of an instant, or null when unparseable. */
export function etDateOfInstant(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return ET_DATE.format(new Date(ms));
}

/** BDL `date` is the ET calendar day; `datetime` is the UTC tip. Prefer `date`. */
export function etDateOfProviderGame(game: { date?: unknown; datetime?: unknown } | null | undefined): string | null {
  if (!game) return null;
  if (typeof game.date === 'string') {
    const day = game.date.slice(0, 10);
    if (YMD.test(day)) return day;
  }
  return typeof game.datetime === 'string' ? etDateOfInstant(game.datetime) : null;
}

export function regularSeasonOpenEt(season: string | number | null | undefined): string | null {
  if (season == null) return null;
  return REGULAR_SEASON_OPEN_ET[String(season)] ?? null;
}

export type ServingIneligibleReason =
  | 'season_type_not_requested'
  | 'season_type_not_serving'
  | 'season_mismatch'
  | 'season_open_unknown'
  | 'invalid_game_date'
  | 'before_regular_season_open'
  | 'nba_cup_final';

export type ServingDecision =
  | { eligible: true }
  | { eligible: false; reason: ServingIneligibleReason };

/** Date + season fence only. Unknown season or unparseable date fails closed. */
export function servingDateDecision(
  season: string | number | null | undefined,
  etDate: string | null | undefined
): ServingDecision {
  const open = regularSeasonOpenEt(season);
  if (!open) return { eligible: false, reason: 'season_open_unknown' };
  if (!etDate || !YMD.test(etDate)) return { eligible: false, reason: 'invalid_game_date' };
  if (etDate < open) return { eligible: false, reason: 'before_regular_season_open' };
  if (NBA_CUP_FINAL_ET[String(season)] === etDate) return { eligible: false, reason: 'nba_cup_final' };
  return { eligible: true };
}

/**
 * Serving eligibility for one provider game row fetched with an explicit season_type.
 * A row from an unparameterized query is never eligible.
 */
export function classifyServingGame(input: {
  game: { season?: unknown; date?: unknown; datetime?: unknown; ist_stage?: unknown } | null | undefined;
  requestedSeasonType: string | null | undefined;
  expectedSeason: string | number;
}): ServingDecision {
  const requested = (input.requestedSeasonType ?? '').trim().toLowerCase();
  if (!requested) return { eligible: false, reason: 'season_type_not_requested' };
  if (!BDL_SERVING_SEASON_TYPES.has(requested)) return { eligible: false, reason: 'season_type_not_serving' };
  const season = input.game?.season;
  if (season == null || String(season) !== String(input.expectedSeason)) {
    return { eligible: false, reason: 'season_mismatch' };
  }
  if (isNbaCupChampionshipStage(input.game?.ist_stage)) return { eligible: false, reason: 'nba_cup_final' };
  return servingDateDecision(String(season), etDateOfProviderGame(input.game));
}

/**
 * Provider season_type queries for an inclusive ET window. Always `regular`; adds `playin` and
 * `playoffs` only when the season's postseason floor is known and inside or before the window end.
 */
export function providerSeasonTypesForWindow(
  season: string | number,
  endDateEt: string
): string[] {
  const types = [BDL_SEASON_TYPE_REGULAR];
  const floor = POSTSEASON_START_ET[String(season)];
  if (floor && YMD.test(endDateEt) && endDateEt >= floor) {
    types.push(BDL_SEASON_TYPE_PLAYIN, BDL_SEASON_TYPE_PLAYOFFS);
  }
  return types;
}

export type TaggedProviderGame<T> = { game: T; requestedSeasonType: string };

/** Splits fetched rows; later duplicates of the same provider id are dropped. */
export function partitionServingGames<
  T extends { id?: unknown; season?: unknown; date?: unknown; datetime?: unknown; ist_stage?: unknown },
>(
  tagged: readonly TaggedProviderGame<T>[],
  expectedSeason: string | number
): {
  eligible: T[];
  ineligible: Array<{ game: T; requestedSeasonType: string; reason: ServingIneligibleReason }>;
} {
  const eligible: T[] = [];
  const ineligible: Array<{ game: T; requestedSeasonType: string; reason: ServingIneligibleReason }> = [];
  const seen = new Set<string>();
  for (const { game, requestedSeasonType } of tagged) {
    const id = game?.id == null ? '' : String(game.id);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const decision = classifyServingGame({ game, requestedSeasonType, expectedSeason });
    if (decision.eligible) eligible.push(game);
    else ineligible.push({ game, requestedSeasonType, reason: decision.reason });
  }
  return { eligible, ineligible };
}

/**
 * SQL VALUES list of (season, open_et) for fencing serving aggregates. Seasons outside the map
 * are not represented; callers decide how to treat them.
 */
export function regularSeasonOpenValuesSql(): string {
  return Object.entries(REGULAR_SEASON_OPEN_ET)
    .map(([season, open]) => `('${season}', date '${open}')`)
    .join(', ');
}
