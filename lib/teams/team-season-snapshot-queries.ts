/**
 * Current-season team snapshot query (explicit season required).
 * No cross-season fallback.
 */

import { queryOne } from '@/lib/db';
import {
  TEAM_SEASON_SNAPSHOT_SQL,
  assertSnapshotSeason,
  emptyTeamSeasonSnapshot,
  mapTeamSeasonSnapshot,
  type TeamSeasonSnapshot,
} from '@/lib/teams/team-season-snapshot';
import type { TeamSeasonAverages } from '@/lib/teams/types';

export type { TeamSeasonSnapshot } from '@/lib/teams/team-season-snapshot';

export async function getTeamSeasonSnapshot(
  teamId: string,
  season: string
): Promise<TeamSeasonSnapshot> {
  const seasonNorm = assertSnapshotSeason(season);

  const row = await queryOne(TEAM_SEASON_SNAPSHOT_SQL, [teamId, seasonNorm]);
  if (!row) {
    return emptyTeamSeasonSnapshot(seasonNorm);
  }

  const mapped: TeamSeasonAverages = {
    team_id: String(row.team_id),
    season: String(row.season),
    games_played: Number(row.games_played) || 0,
    avg_points: row.avg_points != null ? Number(row.avg_points) : null,
    avg_rebounds: null,
    avg_assists: null,
    avg_steals: null,
    avg_blocks: null,
    avg_turnovers: null,
    avg_fgm: null,
    avg_fga: null,
    avg_3pm: null,
    avg_3pa: null,
    avg_ftm: null,
    avg_fta: null,
    avg_points_allowed: null,
    wins: Number(row.wins) || 0,
    losses: Number(row.losses) || 0,
    win_pct: null,
    home_wins: 0,
    home_losses: 0,
    away_wins: 0,
    away_losses: 0,
    avg_offensive_rating:
      row.avg_offensive_rating != null ? Number(row.avg_offensive_rating) : null,
    avg_defensive_rating:
      row.avg_defensive_rating != null ? Number(row.avg_defensive_rating) : null,
    avg_pace: row.avg_pace != null ? Number(row.avg_pace) : null,
    avg_efg_pct: null,
    avg_tov_pct: null,
    avg_orb_pct: null,
  };

  return mapTeamSeasonSnapshot(seasonNorm, mapped);
}
