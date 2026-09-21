/**
 * Regular-season-only prior snapshot from team_game_stats + games.
 *
 * Scope: games with ET tipoff date strictly before WOWY_POSTSEASON_START_ET
 * (play-in inclusive postseason floor), excluding NBA Cup Championship tips
 * listed in NBA_CUP_CHAMPIONSHIP_ET. Same calendar family used by WOWY.
 *
 * Public snapshots hard-fail on impossible records (INVALID_REGULAR_SEASON_SNAPSHOT)
 * rather than silently capping or normalizing.
 *
 * Returns unavailable when postseason floor is missing for the season or
 * fewer than MIN_REGULAR_SEASON_GAMES rows after filter.
 */

import { queryOne } from '@/lib/db';
import {
  NBA_CUP_CHAMPIONSHIP_ET,
  WOWY_POSTSEASON_START_ET,
} from '@/lib/wowy/calendar';
import type { FactProvenance, PacketRegularSeasonSnapshot } from './types';
import {
  assertValidRegularSeasonSnapshot,
  MIN_REGULAR_SEASON_GAMES,
  REGULAR_SEASON_SCOPE,
  REGULAR_SEASON_TEAM_SNAPSHOT_SQL,
  type RegularSeasonSnapshotDebug,
} from './regular-season-integrity';

export {
  assertValidRegularSeasonSnapshot,
  InvalidRegularSeasonSnapshotError,
  INVALID_REGULAR_SEASON_SNAPSHOT,
  MAX_REGULAR_SEASON_GAMES,
  MIN_REGULAR_SEASON_GAMES,
  REGULAR_SEASON_SCOPE,
  REGULAR_SEASON_TEAM_SNAPSHOT_SQL,
} from './regular-season-integrity';
export type { RegularSeasonSnapshotDebug } from './regular-season-integrity';

export async function loadRegularSeasonTeamSnapshot(args: {
  teamId: string;
  season: string;
}): Promise<PacketRegularSeasonSnapshot> {
  const postseasonStart = WOWY_POSTSEASON_START_ET[args.season] ?? null;
  const cupExcluded = [...(NBA_CUP_CHAMPIONSHIP_ET[args.season] ?? [])];
  const provenance: FactProvenance = {
    method: 'regular_season_team_snapshot_v1.2.1',
    tables: ['analytics.team_game_stats', 'analytics.games'],
    season: args.season,
    note: postseasonStart
      ? `ET tipoff date < ${postseasonStart} (WOWY_POSTSEASON_START_ET); exclude Cup Championship ET [${cupExcluded.join(',') || 'none'}]`
      : 'No WOWY_POSTSEASON_START_ET for season — cannot safely split regular/postseason',
  };

  if (!postseasonStart) {
    return unavailable(
      args.season,
      'Regular-season snapshot unavailable: missing postseason calendar floor for season',
      provenance
    );
  }

  const row = await queryOne<{
    games_played: number;
    wins: number;
    losses: number;
    avg_offensive_rating: number | null;
    avg_defensive_rating: number | null;
    avg_pace: number | null;
  }>(REGULAR_SEASON_TEAM_SNAPSHOT_SQL, [
    args.teamId,
    args.season,
    postseasonStart,
    cupExcluded,
  ]);

  const gp = row?.games_played ?? 0;
  if (gp < MIN_REGULAR_SEASON_GAMES) {
    return unavailable(
      args.season,
      `Regular-season snapshot unavailable: only ${gp} games before ${postseasonStart} (need >= ${MIN_REGULAR_SEASON_GAMES})`,
      provenance
    );
  }

  const wins = row?.wins ?? null;
  const losses = row?.losses ?? null;
  const debug: RegularSeasonSnapshotDebug = {
    teamId: args.teamId,
    season: args.season,
    postseasonStartEt: postseasonStart,
    cupChampionshipExcludedEt: cupExcluded,
    gamesPlayed: gp,
    wins,
    losses,
    metricsScope: REGULAR_SEASON_SCOPE,
  };

  assertValidRegularSeasonSnapshot({
    gamesPlayed: gp,
    wins,
    losses,
    metricsScope: REGULAR_SEASON_SCOPE,
    debug,
  });

  const record =
    wins != null && losses != null ? `${wins}–${losses}` : null;

  return {
    season: args.season,
    available: true,
    unavailableReason: null,
    metricsScope: 'regular_season',
    postseasonStartEt: postseasonStart,
    gamesPlayed: gp,
    wins,
    losses,
    record,
    offensiveRating:
      row?.avg_offensive_rating != null ? Number(row.avg_offensive_rating) : null,
    defensiveRating:
      row?.avg_defensive_rating != null ? Number(row.avg_defensive_rating) : null,
    pace: row?.avg_pace != null ? Number(row.avg_pace) : null,
    provenance,
  };
}

function unavailable(
  season: string,
  reason: string,
  provenance: FactProvenance
): PacketRegularSeasonSnapshot {
  return {
    season,
    available: false,
    unavailableReason: reason,
    metricsScope: 'regular_season',
    postseasonStartEt: WOWY_POSTSEASON_START_ET[season] ?? null,
    gamesPlayed: 0,
    wins: null,
    losses: null,
    record: null,
    offensiveRating: null,
    defensiveRating: null,
    pace: null,
    provenance,
  };
}
