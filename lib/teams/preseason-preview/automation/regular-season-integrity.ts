/**
 * Public regular-season snapshot integrity (pure — no DB).
 */

export const MIN_REGULAR_SEASON_GAMES = 70;
export const MAX_REGULAR_SEASON_GAMES = 82;
export const REGULAR_SEASON_SCOPE = 'REGULAR_SEASON' as const;
export const INVALID_REGULAR_SEASON_SNAPSHOT =
  'INVALID_REGULAR_SEASON_SNAPSHOT' as const;

/**
 * Aggregate W/L + mean ORTG/DRTG/pace for regular-season games only.
 * $1 team_id, $2 season, $3 postseason floor ET date,
 * $4 text[] of Cup Championship ET dates to exclude (may be empty).
 */
export const REGULAR_SEASON_TEAM_SNAPSHOT_SQL = `
  SELECT
    count(*)::int AS games_played,
    count(*) FILTER (WHERE tgs.result = 'W')::int AS wins,
    count(*) FILTER (WHERE tgs.result = 'L')::int AS losses,
    avg(tgs.offensive_rating)::float8 AS avg_offensive_rating,
    avg(tgs.defensive_rating)::float8 AS avg_defensive_rating,
    avg(tgs.pace)::float8 AS avg_pace
  FROM analytics.team_game_stats tgs
  JOIN analytics.games g ON g.game_id = tgs.game_id
  WHERE tgs.team_id = $1
    AND tgs.season = $2
    AND g.start_time IS NOT NULL
    AND (timezone('America/New_York', g.start_time))::date < $3::date
    AND (
      cardinality($4::text[]) = 0
      OR (timezone('America/New_York', g.start_time))::date::text
        <> ALL ($4::text[])
    )
`;

export type RegularSeasonSnapshotDebug = {
  teamId: string;
  season: string;
  postseasonStartEt: string | null;
  cupChampionshipExcludedEt: readonly string[];
  gamesPlayed: number;
  wins: number | null;
  losses: number | null;
  metricsScope: typeof REGULAR_SEASON_SCOPE;
};

export class InvalidRegularSeasonSnapshotError extends Error {
  readonly code = INVALID_REGULAR_SEASON_SNAPSHOT;
  readonly debug: RegularSeasonSnapshotDebug;

  constructor(message: string, debug: RegularSeasonSnapshotDebug) {
    super(`${INVALID_REGULAR_SEASON_SNAPSHOT}: ${message}`);
    this.name = 'InvalidRegularSeasonSnapshotError';
    this.debug = debug;
  }
}

/**
 * Pure integrity checks for a public regular-season snapshot.
 * Does not mutate or normalize values.
 */
export function assertValidRegularSeasonSnapshot(args: {
  gamesPlayed: number;
  wins: number | null;
  losses: number | null;
  metricsScope: string;
  debug: RegularSeasonSnapshotDebug;
}): void {
  const { gamesPlayed, wins, losses, metricsScope, debug } = args;

  if (metricsScope !== REGULAR_SEASON_SCOPE) {
    throw new InvalidRegularSeasonSnapshotError(
      `record scope must be ${REGULAR_SEASON_SCOPE}, got ${metricsScope}`,
      debug
    );
  }

  if (wins == null || losses == null) {
    throw new InvalidRegularSeasonSnapshotError(
      'wins and losses are required for a public regular-season snapshot',
      debug
    );
  }

  if (wins < 0 || losses < 0) {
    throw new InvalidRegularSeasonSnapshotError(
      `wins and losses must be >= 0 (wins=${wins}, losses=${losses})`,
      {
        ...debug,
        wins,
        losses,
        gamesPlayed,
      }
    );
  }

  if (wins + losses !== gamesPlayed) {
    throw new InvalidRegularSeasonSnapshotError(
      `wins + losses (${wins + losses}) != games_played (${gamesPlayed})`,
      {
        ...debug,
        wins,
        losses,
        gamesPlayed,
      }
    );
  }

  if (gamesPlayed > MAX_REGULAR_SEASON_GAMES) {
    throw new InvalidRegularSeasonSnapshotError(
      `games_played ${gamesPlayed} exceeds public NBA regular-season max ${MAX_REGULAR_SEASON_GAMES}`,
      {
        ...debug,
        wins,
        losses,
        gamesPlayed,
      }
    );
  }
}
