/**
 * Read-only loader for Research Snapshot player form.
 * Cutoff is the leg observation time. No injury report, no projections, no current prices.
 * Box scores count only when the game is Final and the row was first stored before the observation.
 */

import { loadTargetGame, type SqlQuery } from '@/lib/parlay-xray/context/load';
import { relatedSeasons } from '@/lib/parlay-xray/context/sql';
import {
  assembleResearchSnapshotFormLeg,
  RESEARCH_SNAPSHOT_FORM_MAX_LOGS,
  type ResearchSnapshotFormLegResult,
  type ResearchSnapshotFormRequestLeg,
  type ResearchSnapshotFormSources,
  type ResearchSnapshotPriorLog,
} from './research-snapshot-form';

export const RESEARCH_SNAPSHOT_FORM_LOGS_SQL = `
  SELECT l.player_id::text AS player_id,
         l.game_id::text AS game_id,
         l.team_id::text AS team_id,
         COALESCE(g.start_time, l.game_date::timestamptz) AS start_time,
         COALESCE(g.season, l.season)::text AS season,
         l.minutes,
         l.points,
         l.rebounds,
         l.assists,
         l.three_pointers_made,
         g.status AS game_status,
         l.created_at AS box_score_stored_at
    FROM analytics.player_game_logs l
    JOIN analytics.games g ON g.game_id = l.game_id
   WHERE l.player_id = $1
     AND COALESCE(g.start_time, l.game_date::timestamptz) < $2::timestamptz
     AND l.game_id <> $3
     AND COALESCE(g.season, l.season) = ANY($4::text[])
     AND lower(btrim(coalesce(g.status, ''))) = 'final'
     AND l.created_at < $2::timestamptz
   ORDER BY COALESCE(g.start_time, l.game_date::timestamptz) DESC
`;

export async function loadResearchSnapshotForm(
  legs: readonly ResearchSnapshotFormRequestLeg[],
  query: SqlQuery
): Promise<ResearchSnapshotFormLegResult[]> {
  const cache = new Map<string, ResearchSnapshotFormSources | null | 'failed' | 'limit'>();
  const results: ResearchSnapshotFormLegResult[] = [];
  for (const leg of legs) {
    const key = `${leg.playerId}|${leg.gameId}|${leg.snapshotAt}`;
    let cached = cache.get(key);
    if (cached === undefined) {
      cached = await loadOne(leg, query);
      cache.set(key, cached);
    }
    if (cached === 'failed') {
      results.push(assembleResearchSnapshotFormLeg(leg, null, { sourceFailed: true }));
      continue;
    }
    if (cached === 'limit') {
      results.push(assembleResearchSnapshotFormLeg(leg, null, { rowLimit: true }));
      continue;
    }
    results.push(assembleResearchSnapshotFormLeg(leg, cached));
  }
  return results;
}

async function loadOne(
  leg: ResearchSnapshotFormRequestLeg,
  query: SqlQuery
): Promise<ResearchSnapshotFormSources | null | 'failed' | 'limit'> {
  try {
    const target = await loadTargetGame(query, leg.gameId);
    if (!target) return null;
    const seasons = relatedSeasons(target.season);
    const rows = await query<Record<string, unknown>>(RESEARCH_SNAPSHOT_FORM_LOGS_SQL, [
      leg.playerId,
      leg.snapshotAt,
      target.gameId,
      seasons.length > 0 ? seasons : ['__none__'],
    ]);
    if (rows.length > RESEARCH_SNAPSHOT_FORM_MAX_LOGS) return 'limit';
    return {
      scheduledGame: {
        homeAbbr: target.homeAbbr,
        awayAbbr: target.awayAbbr,
        startTime: target.startTime,
        season: target.season,
        homeTeamId: target.homeTeamId,
        awayTeamId: target.awayTeamId,
      },
      logs: rows.flatMap(mapLog),
    };
  } catch {
    return 'failed';
  }
}

function mapLog(row: Record<string, unknown>): ResearchSnapshotPriorLog[] {
  const startTime = instant(row.start_time);
  if (!startTime) return [];
  return [
    {
      playerId: String(row.player_id),
      gameId: String(row.game_id),
      teamId: row.team_id == null ? null : String(row.team_id),
      startTime,
      season: row.season == null ? null : String(row.season),
      minutes: row.minutes as string | number | null,
      points: row.points == null ? null : Number(row.points),
      rebounds: row.rebounds == null ? null : Number(row.rebounds),
      assists: row.assists == null ? null : Number(row.assists),
      threePointersMade: row.three_pointers_made == null ? null : Number(row.three_pointers_made),
      gameStatus: row.game_status == null ? null : String(row.game_status),
      boxScoreStoredAt: instant(row.box_score_stored_at),
    },
  ];
}

function instant(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
