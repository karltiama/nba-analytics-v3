/**
 * Curated schema helpers for games Parquet.
 *
 * Slice 6 scope:
 * - source=existing_ingestion only
 * - entity=games only
 * - normalize + partition-local dedupe only (game_id)
 * - optional postseason/game_type passthrough only when present in raw rows
 */

export const CURATED_GAMES_COLUMNS = [
  'season',
  'game_id',
  'game_date',
  'start_time',
  'status',
  'home_team_id',
  'away_team_id',
  'home_team_abbr',
  'away_team_abbr',
  'home_score',
  'away_score',
  'venue',
  'is_postseason',
  'game_type',
] as const;

export type CuratedGame = {
  season: string;
  game_id: string;
  game_date: string;
  start_time: string | null;
  status: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  is_postseason: boolean | null;
  game_type: string | null;
};

export type NumericField = 'home_score' | 'away_score';
export type NullCoercionCounts = Record<NumericField, number>;

export function createNullCoercionCounts(): NullCoercionCounts {
  return {
    home_score: 0,
    away_score: 0,
  };
}

type RawRow = Record<string, unknown>;

function asNullableString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function parseNumeric(
  value: unknown,
  field: NumericField,
  nullCoercionCounts: NullCoercionCounts
): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    nullCoercionCounts[field] += 1;
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      nullCoercionCounts[field] += 1;
      return null;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      nullCoercionCounts[field] += 1;
      return null;
    }
    return n;
  }
  nullCoercionCounts[field] += 1;
  return null;
}

function parseNullableBoolean(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 't' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === 'f' || s === '0' || s === 'no') return false;
  }
  return null;
}

/**
 * Normalize one raw JSONL row into the curated games contract.
 * Returns null if game_id cannot be resolved.
 */
export function normalizeRawGameRow(args: {
  row: RawRow;
  season: number;
  partitionDate: string;
  nullCoercionCounts: NullCoercionCounts;
}): CuratedGame | null {
  const { row, season, partitionDate, nullCoercionCounts } = args;

  const gameId = asNullableString(row.game_id);
  if (!gameId) return null;

  const homeScore = parseNumeric(row.home_score, 'home_score', nullCoercionCounts);
  const awayScore = parseNumeric(row.away_score, 'away_score', nullCoercionCounts);

  // Requirement: include postseason/is_postseason only if present in raw.
  const rawIsPostseason = row.is_postseason ?? row.postseason;
  const isPostseason = parseNullableBoolean(rawIsPostseason);

  return {
    season: asNullableString(row.season) ?? String(season),
    game_id: gameId,
    game_date: asNullableString(row.game_date) ?? partitionDate,
    start_time: asNullableString(row.start_time),
    status: asNullableString(row.status),
    home_team_id: asNullableString(row.home_team_id),
    away_team_id: asNullableString(row.away_team_id),
    home_team_abbr: asNullableString(row.home_team_abbr),
    away_team_abbr: asNullableString(row.away_team_abbr),
    home_score: homeScore,
    away_score: awayScore,
    venue: asNullableString(row.venue),
    is_postseason: isPostseason,
    game_type: asNullableString(row.game_type),
  };
}

export function partitionDedupeKey(row: CuratedGame): string {
  return row.game_id;
}
