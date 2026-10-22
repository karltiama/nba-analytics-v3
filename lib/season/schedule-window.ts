/**
 * Whether the league is between seasons, from stored schedule edges only.
 * A season is the span from its earliest tip to its latest tip. Empty days
 * inside that span stay in season. No calendar month is hardcoded.
 */

export type ScheduleEdge = { season: string; startMs: number; endMs: number };
export type SeasonSpan = { startMs: number; endMs: number };

export const ANALYTICS_SEASON_SPAN_SQL = `
SELECT season::text AS season, min(start_time) AS first_tip, max(start_time) AS last_tip
FROM analytics.games
WHERE start_time IS NOT NULL
GROUP BY season
`;

/** Observed preseason, regular, play-in, and playoff tips. Read only. */
export const SCOREBOARD_SEASON_SPAN_SQL = `
SELECT season::text AS season, min(scheduled_tip) AS first_tip, max(scheduled_tip) AS last_tip
FROM display.scoreboard_games
WHERE season_type IN ('preseason', 'regular', 'playin', 'playoffs')
  AND scheduled_tip IS NOT NULL
GROUP BY season
`;

type Queryable = {
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

function instant(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function seasonSpans(edges: readonly ScheduleEdge[]): SeasonSpan[] {
  const bySeason = new Map<string, SeasonSpan>();
  for (const edge of edges) {
    const season = edge.season.trim();
    if (!season || !Number.isFinite(edge.startMs) || !Number.isFinite(edge.endMs)) continue;
    const startMs = Math.min(edge.startMs, edge.endMs);
    const endMs = Math.max(edge.startMs, edge.endMs);
    const prev = bySeason.get(season);
    if (!prev) bySeason.set(season, { startMs, endMs });
    else {
      prev.startMs = Math.min(prev.startMs, startMs);
      prev.endMs = Math.max(prev.endMs, endMs);
    }
  }
  return [...bySeason.values()];
}

/** No stored season is not evidence of an offseason. */
export function isOffseason(nowMs: number, spans: readonly SeasonSpan[]): boolean {
  if (!Number.isFinite(nowMs) || spans.length === 0) return false;
  return spans.every((span) => nowMs < span.startMs || nowMs > span.endMs);
}

function edgeFromRow(row: Record<string, unknown>): ScheduleEdge | null {
  const season = typeof row.season === 'string' ? row.season : row.season == null ? '' : String(row.season);
  const startMs = instant(row.first_tip);
  const endMs = instant(row.last_tip);
  if (!season.trim() || startMs == null || endMs == null) return null;
  return { season, startMs, endMs };
}

export async function readOffseason(db: Queryable, now: Date): Promise<boolean> {
  const [analytics, scoreboard] = await Promise.all([
    db.query(ANALYTICS_SEASON_SPAN_SQL),
    db.query(SCOREBOARD_SEASON_SPAN_SQL),
  ]);
  const edges = [...analytics.rows, ...scoreboard.rows]
    .map(edgeFromRow)
    .filter((edge): edge is ScheduleEdge => edge != null);
  return isOffseason(now.getTime(), seasonSpans(edges));
}
