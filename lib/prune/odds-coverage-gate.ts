/**
 * Read-only compact-coverage gate for a future raw.odds_snapshots prune.
 *
 * After raw snapshots are deleted they cannot be re-transformed. Line-movement
 * product reads analytics.game_odds_history, so every eligible raw game_id must
 * already exist there.
 *
 * analytics.game_odds_current is also required by this gate: getGameOdds reads
 * current for completed games, and there is no rebuild-from-history job. Current
 * is rebuildable from history in principle, but until that job exists a missing
 * current row would leave serving blank after raw prune.
 *
 * True last-before-tip closing lines are NOT required here. History stays in
 * Postgres for line movement; some last snapshots occur after tip (CLV quality).
 */

export type OddsCoverageDb = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type OddsCompactCoverageResult = {
  ok: boolean;
  reason: string;
  rawGames: number;
  missingHistory: string[];
  missingCurrent: string[];
  requireCurrent: true;
};

function asGameIds(rows: Array<Record<string, unknown>>): string[] {
  return rows
    .map((r) => String(r.game_id ?? ''))
    .filter((id) => id.length > 0)
    .sort();
}

/**
 * Distinct raw game IDs under consideration for a future prune.
 * When olderThanDays is set, only games that have at least one snapshot
 * older than that window are checked (those rows would be prune-eligible).
 */
export async function evaluateOddsCompactCoverage(
  db: OddsCoverageDb,
  opts?: { olderThanDays?: number }
): Promise<OddsCompactCoverageResult> {
  const olderThanDays = opts?.olderThanDays;
  const ageFilter =
    olderThanDays != null
      ? `AND (r.created_at AT TIME ZONE 'America/New_York')::date
         < (now() AT TIME ZONE 'America/New_York')::date - $1::int`
      : '';
  const params = olderThanDays != null ? [olderThanDays] : [];

  const rawGamesResult = await db.query(
    `SELECT count(DISTINCT r.game_id)::int AS n
     FROM raw.odds_snapshots r
     WHERE true ${ageFilter}`,
    params
  );
  const rawGames = Number(rawGamesResult.rows[0]?.n ?? 0);

  const missingHistoryResult = await db.query(
    `SELECT DISTINCT r.game_id
     FROM raw.odds_snapshots r
     WHERE true ${ageFilter}
       AND NOT EXISTS (
         SELECT 1 FROM analytics.game_odds_history h WHERE h.game_id = r.game_id
       )
     ORDER BY 1`,
    params
  );
  const missingCurrentResult = await db.query(
    `SELECT DISTINCT r.game_id
     FROM raw.odds_snapshots r
     WHERE true ${ageFilter}
       AND NOT EXISTS (
         SELECT 1 FROM analytics.game_odds_current c WHERE c.game_id = r.game_id
       )
     ORDER BY 1`,
    params
  );

  const missingHistory = asGameIds(missingHistoryResult.rows);
  const missingCurrent = asGameIds(missingCurrentResult.rows);

  if (missingHistory.length > 0) {
    return {
      ok: false,
      reason: `raw odds games missing game_odds_history: ${missingHistory.length}`,
      rawGames,
      missingHistory,
      missingCurrent,
      requireCurrent: true,
    };
  }
  if (missingCurrent.length > 0) {
    return {
      ok: false,
      reason: `raw odds games missing game_odds_current: ${missingCurrent.length}`,
      rawGames,
      missingHistory,
      missingCurrent,
      requireCurrent: true,
    };
  }

  return {
    ok: true,
    reason: 'all eligible raw odds games have history and current coverage',
    rawGames,
    missingHistory,
    missingCurrent,
    requireCurrent: true,
  };
}
