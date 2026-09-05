/**
 * Pure helpers + SQL fragments for team-page compact upcoming/recent schedule.
 * Source: analytics.games only. Season must be explicit (page season).
 */

import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';
import {
  isFinalStatus,
  normalizeGameStatus,
  type NormalizedGameStatus,
} from '@/lib/betting/normalize-game-status';
import { assertAnalyticsSeason } from '@/lib/teams/team-roster-presentation';

export const COMPACT_SCHEDULE_DEFAULT_LIMIT = 3;
export const GAME_DISPLAY_TZ = 'America/New_York';

/** Shared SELECT + joins — one games row + home/away teams (no N+1). */
export const TEAM_COMPACT_SCHEDULE_SELECT_SQL = `
  SELECT
    g.game_id,
    g.season,
    g.start_time,
    g.status,
    g.home_score,
    g.away_score,
    g.venue,
    t_home.team_id AS home_team_id,
    t_home.abbreviation AS home_abbr,
    t_home.full_name AS home_name,
    t_away.team_id AS away_team_id,
    t_away.abbreviation AS away_abbr,
    t_away.full_name AS away_name
  FROM analytics.games g
  JOIN analytics.teams t_home ON g.home_team_id = t_home.team_id
  JOIN analytics.teams t_away ON g.away_team_id = t_away.team_id
  WHERE (g.home_team_id = $1 OR g.away_team_id = $1)
    AND g.season = $2
`;

/** Upcoming: not Final, start_time >= asOf, ascending, limited. */
export const TEAM_COMPACT_UPCOMING_SQL = `
  ${TEAM_COMPACT_SCHEDULE_SELECT_SQL}
    AND g.start_time >= $3
    AND lower(trim(coalesce(g.status, ''))) IS DISTINCT FROM 'final'
  ORDER BY g.start_time ASC NULLS LAST
  LIMIT $4
`;

/** Recent: Final only, start_time < asOf, descending, limited. */
export const TEAM_COMPACT_RECENT_SQL = `
  ${TEAM_COMPACT_SCHEDULE_SELECT_SQL}
    AND g.start_time < $3
    AND lower(trim(coalesce(g.status, ''))) = 'final'
  ORDER BY g.start_time DESC NULLS LAST
  LIMIT $4
`;

export type CompactScheduleGame = {
  game_id: string;
  season: string;
  start_time: string | null;
  status_raw: string | null;
  status: NormalizedGameStatus;
  is_home: boolean;
  opponent_id: string;
  opponent_abbr: string;
  opponent_name: string;
  team_score: number | null;
  opponent_score: number | null;
  /** W/L only when Final and both scores present. */
  result: 'W' | 'L' | null;
  venue: string | null;
};

export type TeamCompactSchedule = {
  season: string;
  upcoming: CompactScheduleGame[];
  recent: CompactScheduleGame[];
};

export function assertCompactScheduleSeason(season: string): string {
  assertAnalyticsSeason(season);
  return season;
}

export function homeAwayMarker(isHome: boolean): 'vs' | '@' {
  return isHome ? 'vs' : '@';
}

export function formatOpponentLine(isHome: boolean, opponentAbbr: string): string {
  const abbr = opponentAbbr?.trim() || '—';
  return `${homeAwayMarker(isHome)} ${abbr}`;
}

export function formatCompactScheduleDate(
  startTime: string | Date | null | undefined
): string {
  if (startTime == null || startTime === '') return '—';
  const d = typeof startTime === 'string' ? new Date(startTime) : startTime;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: GAME_DISPLAY_TZ,
  });
}

/** Tipoff via shared ET helper — never invent a second formatter. */
export function formatCompactTipoff(
  startTime: string | Date | null | undefined
): string {
  const tip = formatTipoffEt(startTime);
  return tip || '—';
}

export function computeCompactResult(
  statusRaw: string | null | undefined,
  teamScore: number | null,
  opponentScore: number | null
): 'W' | 'L' | null {
  if (!isFinalStatus(statusRaw)) return null;
  if (teamScore == null || opponentScore == null) return null;
  if (Number.isNaN(teamScore) || Number.isNaN(opponentScore)) return null;
  return teamScore > opponentScore ? 'W' : 'L';
}

/** Score text for finals only; scheduled/missing → em dash (no fake 0–0). */
export function formatCompactScoreLine(
  result: 'W' | 'L' | null,
  teamScore: number | null,
  opponentScore: number | null
): string {
  if (result == null || teamScore == null || opponentScore == null) return '—';
  return `${result} ${teamScore}–${opponentScore}`;
}

export function mapCompactScheduleRow(
  teamId: string,
  r: Record<string, unknown>
): CompactScheduleGame {
  const homeTeamId = String(r.home_team_id);
  const isHome = homeTeamId === teamId;
  const statusRaw = r.status != null ? String(r.status) : null;
  const teamScoreRaw = isHome ? r.home_score : r.away_score;
  const oppScoreRaw = isHome ? r.away_score : r.home_score;
  const teamScore = teamScoreRaw != null ? Number(teamScoreRaw) : null;
  const opponentScore = oppScoreRaw != null ? Number(oppScoreRaw) : null;
  const result = computeCompactResult(statusRaw, teamScore, opponentScore);

  return {
    game_id: String(r.game_id),
    season: String(r.season ?? ''),
    start_time: r.start_time
      ? new Date(r.start_time as string).toISOString()
      : null,
    status_raw: statusRaw,
    status: normalizeGameStatus(statusRaw),
    is_home: isHome,
    opponent_id: String(isHome ? r.away_team_id : r.home_team_id),
    opponent_abbr: String(isHome ? r.away_abbr : r.home_abbr),
    opponent_name: String(isHome ? r.away_name : r.home_name),
    team_score: teamScore,
    opponent_score: opponentScore,
    result,
    venue: r.venue != null ? String(r.venue) : null,
  };
}

/** Safe game details route used elsewhere on team schedule. */
export function compactGameHref(gameId: string): string {
  return `/games/${gameId}`;
}

/** Preserve season on full schedule page (route already accepts ?season=). */
export function fullScheduleHref(routeTeamId: string, season: string): string {
  return `/teams/${routeTeamId}/schedule?season=${encodeURIComponent(season)}`;
}
