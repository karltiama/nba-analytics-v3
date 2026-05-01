/**
 * Curated schema helpers for player_game_logs Parquet.
 *
 * Slice 5 scope:
 * - source=existing_ingestion only
 * - entity=player_game_logs only
 * - normalize + partition-local dedupe only (player_id + game_id)
 */

export const CURATED_PLAYER_GAME_LOGS_COLUMNS = [
  'season',
  'game_id',
  'game_date',
  'player_id',
  'player_name',
  'team_id',
  'team_abbr',
  'opponent_team_id',
  'opponent_abbr',
  'minutes',
  'points',
  'rebounds',
  'assists',
  'threes',
  'pra',
] as const;

export type CuratedPlayerGameLog = {
  season: string;
  game_id: string;
  game_date: string;
  player_id: string;
  player_name: string | null;
  team_id: string | null;
  team_abbr: string | null;
  opponent_team_id: string | null;
  opponent_abbr: string | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threes: number | null;
  pra: number | null;
};

export type NumericField =
  | 'minutes'
  | 'points'
  | 'rebounds'
  | 'assists'
  | 'threes'
  | 'pra';

export type NullCoercionCounts = Record<NumericField, number>;

export function createNullCoercionCounts(): NullCoercionCounts {
  return {
    minutes: 0,
    points: 0,
    rebounds: 0,
    assists: 0,
    threes: 0,
    pra: 0,
  };
}

type RawRow = Record<string, unknown>;

function asNullableString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function isCompletedGameStatus(status: string | null): boolean {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  return normalized === 'final' || normalized === 'final/ot' || normalized === 'final/2ot';
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
    if (field === 'minutes') {
      const mmss = trimmed.match(/^(\d+):([0-5]\d)$/);
      if (mmss) {
        const minutes = Number(mmss[1]);
        const seconds = Number(mmss[2]);
        return minutes + seconds / 60;
      }
    }
    const match = trimmed.match(/-?\d+(\.\d+)?/);
    if (!match) {
      nullCoercionCounts[field] += 1;
      return null;
    }
    const n = Number(match[0]);
    if (!Number.isFinite(n)) {
      nullCoercionCounts[field] += 1;
      return null;
    }
    return n;
  }
  nullCoercionCounts[field] += 1;
  return null;
}

/**
 * Normalize one raw JSONL row into the curated contract.
 * Returns null when row cannot be keyed for dedupe/output.
 */
export function normalizeRawPlayerGameLogRow(args: {
  row: RawRow;
  season: number;
  partitionDate: string;
  nullCoercionCounts: NullCoercionCounts;
}): CuratedPlayerGameLog | null {
  const { row, season, partitionDate, nullCoercionCounts } = args;

  const playerId = asNullableString(row.player_id);
  const gameId = asNullableString(row.game_id);
  if (!playerId || !gameId) return null;
  const gameStatus = asNullableString(row.game_status ?? row.status);
  if (gameStatus && !isCompletedGameStatus(gameStatus)) return null;

  const points = parseNumeric(row.points, 'points', nullCoercionCounts);
  const rebounds = parseNumeric(row.rebounds, 'rebounds', nullCoercionCounts);
  const assists = parseNumeric(row.assists, 'assists', nullCoercionCounts);
  const threes = parseNumeric(
    row.threes ?? row.three_pointers_made,
    'threes',
    nullCoercionCounts
  );
  const minutes = parseNumeric(row.minutes, 'minutes', nullCoercionCounts);
  let pra = parseNumeric(row.pra, 'pra', nullCoercionCounts);
  if (pra == null && points != null && rebounds != null && assists != null) {
    pra = points + rebounds + assists;
  }

  return {
    season: String(season),
    game_id: gameId,
    game_date: asNullableString(row.game_date) ?? partitionDate,
    player_id: playerId,
    player_name: asNullableString(row.player_name),
    team_id: asNullableString(row.team_id),
    team_abbr: asNullableString(row.team_abbr),
    opponent_team_id: asNullableString(row.opponent_team_id),
    opponent_abbr: asNullableString(row.opponent_abbr),
    minutes,
    points,
    rebounds,
    assists,
    threes,
    pra,
  };
}

export function partitionDedupeKey(row: CuratedPlayerGameLog): string {
  return `${row.player_id}::${row.game_id}`;
}
