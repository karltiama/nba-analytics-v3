/**
 * Server-only Historical Timeline read (Step 12G).
 * Compact quality from analytics.game_flow; events from one S3 Plays object.
 * Never import from client bundles.
 */
import { S3Storage } from '@/lib/aws/s3';
import { readCanonicalPlaysObject, type CanonicalPlaysStore } from '@/lib/archive/plays-2025-read';
import { query } from '@/lib/db';
import {
  buildGameFlowSummary,
  emptyTimeline,
  HISTORICAL_TIMELINE_SOURCE,
  normalizePlayEvents,
  qualityFromGameFlow,
  type GameFlowSummary,
  type HistoricalGameTimeline,
  type NormalizedTimelineEvent,
  type RotationFailureClass,
  type StreamClass,
  type TimelineQualityCode,
} from '@/lib/betting/historical-timeline';

const PROCESS_CACHE_MAX = 48;
const processCache = new Map<string, HistoricalGameTimeline>();

export type GameFlowServingRow = {
  game_id: string;
  season: string;
  source: string;
  timeline_available: boolean;
  score_reconciled: boolean;
  stream_complete: boolean;
  stream_class: string;
  quality_code: string;
  plays_final_home: number | null;
  plays_final_away: number | null;
  event_count: number;
  period_count: number;
  overtime_count: number;
  lead_changes: number | null;
  ties: number | null;
  largest_home_lead: number | null;
  largest_away_lead: number | null;
  largest_home_run: number | null;
  largest_away_run: number | null;
  home_points_by_period: number[] | null;
  away_points_by_period: number[] | null;
  rotation_available: boolean;
  rotation_failure_class: string | null;
};

function remember(gameId: string, value: HistoricalGameTimeline): HistoricalGameTimeline {
  if (processCache.size >= PROCESS_CACHE_MAX) {
    const oldest = processCache.keys().next().value;
    if (oldest) processCache.delete(oldest);
  }
  processCache.set(gameId, value);
  return value;
}

export function clearHistoricalTimelineProcessCache(): void {
  processCache.clear();
}

function asIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((n) => Number(n)).filter((n) => Number.isFinite(n));
}

export function mapGameFlowServingRow(row: GameFlowServingRow): GameFlowSummary {
  return {
    gameId: String(row.game_id),
    season: String(row.season),
    source: row.source || HISTORICAL_TIMELINE_SOURCE,
    timelineAvailable: row.timeline_available === true,
    scoreReconciled: row.score_reconciled === true,
    streamComplete: row.stream_complete === true,
    streamClass: (row.stream_class as StreamClass) || 'uncertain',
    qualityCode: (row.quality_code as TimelineQualityCode) || 'NO_EVENTS',
    playsFinalHome: row.plays_final_home,
    playsFinalAway: row.plays_final_away,
    eventCount: Number(row.event_count) || 0,
    periodCount: Number(row.period_count) || 0,
    overtimeCount: Number(row.overtime_count) || 0,
    leadChanges: row.lead_changes,
    ties: row.ties,
    largestHomeLead: row.largest_home_lead,
    largestAwayLead: row.largest_away_lead,
    largestHomeRun: row.largest_home_run,
    largestAwayRun: row.largest_away_run,
    homePointsByPeriod: asIntArray(row.home_points_by_period),
    awayPointsByPeriod: asIntArray(row.away_points_by_period),
    rotationAvailable: row.rotation_available === true,
    rotationFailureClass: (row.rotation_failure_class as RotationFailureClass | null) ?? null,
  };
}

export async function loadCertifiedGameFlowFlags(gameId: string): Promise<{
  timeline: boolean;
  rotationContext: boolean;
}> {
  const rows = await query<Pick<GameFlowServingRow, 'timeline_available' | 'rotation_available'>>(
    `SELECT timeline_available, rotation_available
     FROM analytics.game_flow
     WHERE game_id = $1`,
    [gameId]
  );
  const row = rows[0];
  return {
    timeline: row?.timeline_available === true,
    rotationContext: row?.rotation_available === true,
  };
}

async function loadCertifiedGameFlow(gameId: string): Promise<GameFlowSummary | null> {
  const rows = await query<GameFlowServingRow>(
    `SELECT
       game_id, season, source,
       timeline_available, score_reconciled, stream_complete, stream_class, quality_code,
       plays_final_home, plays_final_away,
       event_count, period_count, overtime_count,
       lead_changes, ties, largest_home_lead, largest_away_lead,
       largest_home_run, largest_away_run,
       home_points_by_period, away_points_by_period,
       rotation_available, rotation_failure_class
     FROM analytics.game_flow
     WHERE game_id = $1`,
    [gameId]
  );
  const row = rows[0];
  return row ? mapGameFlowServingRow(row) : null;
}

async function loadOfficialScores(gameId: string): Promise<{
  season: string | null;
  home: number | null;
  away: number | null;
} | null> {
  const rows = await query<{ season: string | null; home_score: number | null; away_score: number | null }>(
    `SELECT season::text AS season, home_score, away_score
     FROM analytics.games
     WHERE game_id = $1`,
    [gameId]
  );
  const row = rows[0];
  if (!row) return null;
  return { season: row.season, home: row.home_score, away: row.away_score };
}

async function enrichPlayerNames(events: NormalizedTimelineEvent[]): Promise<NormalizedTimelineEvent[]> {
  const ids = [
    ...new Set(
      events.flatMap((event) => [event.primaryPlayerId, event.secondaryPlayerId]).filter((id): id is string => Boolean(id))
    ),
  ];
  if (ids.length === 0) return events;
  const rows = await query<{ player_id: string; full_name: string | null }>(
    `SELECT player_id, full_name
     FROM analytics.players
     WHERE player_id = ANY($1::text[])`,
    [ids]
  );
  const names = new Map(rows.map((row) => [row.player_id, row.full_name ?? null]));
  return events.map((event) => ({
    ...event,
    primaryPlayerName: event.primaryPlayerId ? names.get(event.primaryPlayerId) ?? null : null,
    secondaryPlayerName: event.secondaryPlayerId ? names.get(event.secondaryPlayerId) ?? null : null,
  }));
}

export function createPlaysStore(): CanonicalPlaysStore {
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) {
    throw new Error('NBA_DATA_BUCKET is required to read canonical 2025 Plays objects');
  }
  return new S3Storage({ bucket });
}

/**
 * One-game Timeline contract. Events stay S3-backed.
 * Truncated streams return available=false and events=[] so 12H cannot
 * present a misleading full play-by-play.
 */
export async function getHistoricalGameTimeline(
  gameId: string,
  opts?: { store?: CanonicalPlaysStore; skipCache?: boolean }
): Promise<HistoricalGameTimeline> {
  if (!opts?.skipCache) {
    const cached = processCache.get(gameId);
    if (cached) return cached;
  }

  const official = await loadOfficialScores(gameId);
  if (!official) {
    return remember(gameId, emptyTimeline(gameId, null, null));
  }

  const flow = await loadCertifiedGameFlow(gameId);
  if (!flow || !flow.timelineAvailable) {
    const unavailable: HistoricalGameTimeline = {
      available: false,
      quality: flow
        ? qualityFromGameFlow(flow)
        : emptyTimeline(gameId, official.home, official.away).quality,
      gameFlow: flow,
      events: [],
      officialHomeScore: official.home,
      officialAwayScore: official.away,
    };
    return remember(gameId, unavailable);
  }

  const store = opts?.store ?? createPlaysStore();
  const read = await readCanonicalPlaysObject(store, gameId);
  if (!read.ok) {
    const failed: HistoricalGameTimeline = {
      available: false,
      quality: { ...qualityFromGameFlow(flow), timelineAvailable: false },
      gameFlow: { ...flow, timelineAvailable: false },
      events: [],
      officialHomeScore: official.home,
      officialAwayScore: official.away,
    };
    return remember(gameId, failed);
  }

  const { events, orderMalformed } = normalizePlayEvents(read.rows, gameId);
  if (orderMalformed) {
    const failed: HistoricalGameTimeline = {
      available: false,
      quality: { ...qualityFromGameFlow(flow), timelineAvailable: false, qualityCode: 'MALFORMED_ORDER' },
      gameFlow: flow,
      events: [],
      officialHomeScore: official.home,
      officialAwayScore: official.away,
    };
    return remember(gameId, failed);
  }

  const derived = buildGameFlowSummary({
    gameId,
    season: flow.season,
    events,
    orderMalformed,
    officialHome: official.home,
    officialAway: official.away,
  });
  const named = await enrichPlayerNames(events);
  const result: HistoricalGameTimeline = {
    available: derived.timelineAvailable,
    quality: qualityFromGameFlow(derived),
    gameFlow: flow,
    events: derived.timelineAvailable ? named : [],
    officialHomeScore: official.home,
    officialAwayScore: official.away,
  };
  return remember(gameId, result);
}

export const HISTORICAL_TIMELINE_CACHE_POLICY = {
  kind: 'next-unstable-cache-plus-process-lru',
  maxEntries: PROCESS_CACHE_MAX,
  cacheKey: 'historical-timeline-v1',
  reason:
    '2025 Plays objects are immutable. API wraps getHistoricalGameTimeline with Next unstable_cache keyed by game_id; process LRU remains an in-runtime helper. Do not copy 642k events into Postgres.',
} as const;
