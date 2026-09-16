import type { CanonicalParlayLegResolution } from '@/lib/parlay-xray/resolution/types';
import { parseCutoffIso } from './cutoff';
import { relatedSeasons } from './sql';
import {
  CONTEXT_PLAYER_LOGS_SQL,
  CONTEXT_PROJECTION_SQL,
  CONTEXT_TARGET_GAME_SQL,
  CONTEXT_TEAM_STATS_SQL,
} from './sql';
import type { XRayContextSources, XrayArchivedProjection, XrayPriorPlayerLog, XrayPriorTeamStat } from './types';

export type SqlQuery = <T,>(sql: string, params?: unknown[]) => Promise<T[]>;

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : String(value);
}

export type TargetGameContextRow = {
  gameId: string;
  startTime: string;
  season: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeAbbr: string;
  awayAbbr: string;
};

export async function loadTargetGame(query: SqlQuery, gameId: string): Promise<TargetGameContextRow | null> {
  const rows = await query<{
    game_id: string;
    start_time: string | Date;
    season: string | null;
    home_team_id: string;
    away_team_id: string;
    home_abbr: string;
    away_abbr: string;
  }>(CONTEXT_TARGET_GAME_SQL, [gameId]);
  const row = rows[0];
  if (!row) return null;
  const startTime = iso(row.start_time);
  if (!startTime) return null;
  return {
    gameId: String(row.game_id),
    startTime,
    season: row.season == null ? null : String(row.season),
    homeTeamId: String(row.home_team_id),
    awayTeamId: String(row.away_team_id),
    homeAbbr: String(row.home_abbr),
    awayAbbr: String(row.away_abbr),
  };
}

function mapPlayerLog(row: Record<string, unknown>): XrayPriorPlayerLog {
  return {
    playerId: String(row.player_id),
    gameId: String(row.game_id),
    teamId: row.team_id == null ? null : String(row.team_id),
    startTime: iso(row.start_time as string)!,
    season: row.season == null ? null : String(row.season),
    minutes: row.minutes as string | number | null,
    points: row.points == null ? null : Number(row.points),
    rebounds: row.rebounds == null ? null : Number(row.rebounds),
    assists: row.assists == null ? null : Number(row.assists),
    threePointersMade: row.three_pointers_made == null ? null : Number(row.three_pointers_made),
  };
}

function mapTeamStat(row: Record<string, unknown>): XrayPriorTeamStat {
  return {
    teamId: String(row.team_id),
    gameId: String(row.game_id),
    opponentTeamId: row.opponent_team_id == null ? null : String(row.opponent_team_id),
    startTime: iso(row.start_time as string)!,
    season: row.season == null ? null : String(row.season),
    pace: row.pace == null ? null : Number(row.pace),
    pointsAllowed: row.points_allowed == null ? null : Number(row.points_allowed),
    teamPoints: row.team_points == null ? null : Number(row.team_points),
  };
}

function mapProjection(row: Record<string, unknown>): XrayArchivedProjection {
  return {
    playerId: String(row.player_id),
    gameId: String(row.game_id),
    modelVersion: String(row.model_version),
    generatedAt: iso(row.generated_at as string)!,
    intendedCutoffAt: iso(row.intended_cutoff_at as string)!,
    predictions:
      row.predictions && typeof row.predictions === 'object'
        ? (row.predictions as Record<string, unknown>)
        : null,
  };
}

function isMissingRelation(error: unknown, relation: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(relation) && /does not exist/i.test(message);
}

export async function loadXrayContextSources(
  query: SqlQuery,
  args: {
    playerId: string;
    gameId: string;
    cutoffAt: string;
    season: string | null;
    teamIds: string[];
  }
): Promise<XRayContextSources> {
  const cutoff = parseCutoffIso(args.cutoffAt);
  if (!cutoff) {
    return { priorPlayerLogs: [], priorTeamStats: [], projectionSnapshots: [] };
  }
  const seasons = relatedSeasons(args.season);
  const seasonParams = seasons.length > 0 ? seasons : ['__none__'];
  const teamIds = args.teamIds.filter(Boolean);
  const [logs, teams] = await Promise.all([
    query<Record<string, unknown>>(CONTEXT_PLAYER_LOGS_SQL, [args.playerId, cutoff, args.gameId, seasonParams]),
    teamIds.length === 0
      ? Promise.resolve([] as Record<string, unknown>[])
      : query<Record<string, unknown>>(CONTEXT_TEAM_STATS_SQL, [teamIds, cutoff, args.gameId, seasonParams]),
  ]);
  let projections: Record<string, unknown>[] = [];
  try {
    projections = await query<Record<string, unknown>>(CONTEXT_PROJECTION_SQL, [args.playerId, args.gameId, cutoff]);
  } catch (error) {
    if (!isMissingRelation(error, 'prediction_snapshots')) throw error;
  }
  return {
    priorPlayerLogs: logs.map(mapPlayerLog),
    priorTeamStats: teams.map(mapTeamStat),
    projectionSnapshots: projections.map(mapProjection),
  };
}

export function teamIdsFromResolution(
  resolution: CanonicalParlayLegResolution,
  target: TargetGameContextRow | null
): string[] {
  const ids = new Set<string>();
  const mapped = matchupTeamIds(resolution, target);
  if (mapped.playerTeamId) ids.add(mapped.playerTeamId);
  if (mapped.opponentTeamId) ids.add(mapped.opponentTeamId);
  if (target) {
    ids.add(target.homeTeamId);
    ids.add(target.awayTeamId);
  }
  return [...ids];
}

export function matchupTeamIds(
  resolution: CanonicalParlayLegResolution,
  target: TargetGameContextRow | null
): { playerTeamId: string | null; opponentTeamId: string | null } {
  const teamAbbr = resolution.teamResolution.value?.abbreviation ?? null;
  const oppAbbr = resolution.opponentResolution.value?.abbreviation ?? null;
  const fromTarget = (abbr: string | null): string | null => {
    if (!target || !abbr) return null;
    const needle = abbr.trim().toUpperCase();
    if (target.homeAbbr.trim().toUpperCase() === needle) return target.homeTeamId;
    if (target.awayAbbr.trim().toUpperCase() === needle) return target.awayTeamId;
    return null;
  };
  let playerTeamId = fromTarget(teamAbbr) ?? resolution.teamResolution.value?.teamId ?? null;
  let opponentTeamId = fromTarget(oppAbbr) ?? resolution.opponentResolution.value?.teamId ?? null;
  if (target && playerTeamId === target.homeTeamId) opponentTeamId = target.awayTeamId;
  if (target && playerTeamId === target.awayTeamId) opponentTeamId = target.homeTeamId;
  return { playerTeamId, opponentTeamId };
}
