/**
 * Read-only meaningful-history coverage gate for a future raw.player_injuries prune.
 *
 * Does NOT require every raw snapshot to have a history row.
 * Completeness:
 *  1. First-seen: every analytics player in the raw corpus has a history row at
 *     their first pull_run_id.
 *  2. Change: every consecutive dual-presence tuple change has a non-leave-report
 *     history row at the later pull.
 *  3. Leave-report: every disappearance across a successful complete consecutive
 *     pair has status=RemovedFromReport history at the later pull_run_id.
 *  4. Internal consistency: no duplicate (player_id, pull_run_id) RemovedFromReport rows.
 *
 * Any unresolved leave-report that would become unrecoverable after raw deletion
 * blocks prune.
 */

import { REMOVED_FROM_REPORT_STATUS } from '@/lib/injuries/leave-report';
import {
  INJURY_CHANGE_GAPS_SQL,
  INJURY_FIRST_SEEN_GAPS_SQL,
  INJURY_LEAVE_REPORT_CANDIDATES_SQL,
} from '@/lib/injuries/leave-report-sql';

export type InjuryCoverageDb = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type InjuryTransitionCoverageResult = {
  ok: boolean;
  reason: string;
  candidateLeaveReports: number;
  unresolvedLeaveReports: number;
  missingFirstSeen: number;
  missingChanges: number;
  duplicateLeaveReports: number;
};

function countRows(rows: Array<Record<string, unknown>>): number {
  if (rows.length === 1 && rows[0] && 'n' in rows[0]) {
    return Number(rows[0].n ?? 0);
  }
  return rows.length;
}

export async function evaluateInjuryTransitionCoverage(
  db: InjuryCoverageDb
): Promise<InjuryTransitionCoverageResult> {
  const candidates = await db.query(
    `SELECT count(*)::int AS n FROM (${INJURY_LEAVE_REPORT_CANDIDATES_SQL}) c`
  );
  const unresolved = await db.query(
    `SELECT count(*)::int AS n
     FROM (${INJURY_LEAVE_REPORT_CANDIDATES_SQL}) c
     WHERE NOT EXISTS (
       SELECT 1
       FROM analytics.player_injury_status_history h
       WHERE h.player_id = c.player_id
         AND h.pull_run_id = c.next_id
         AND h.status = '${REMOVED_FROM_REPORT_STATUS}'
     )`
  );
  const firstSeen = await db.query(
    `SELECT count(*)::int AS n FROM (${INJURY_FIRST_SEEN_GAPS_SQL}) g`
  );
  const changes = await db.query(
    `SELECT count(*)::int AS n FROM (${INJURY_CHANGE_GAPS_SQL}) g`
  );
  const dupes = await db.query(
    `SELECT count(*)::int AS n
     FROM (
       SELECT player_id, pull_run_id
       FROM analytics.player_injury_status_history
       WHERE status = '${REMOVED_FROM_REPORT_STATUS}'
       GROUP BY player_id, pull_run_id
       HAVING count(*) > 1
     ) d`
  );

  const candidateLeaveReports = countRows(candidates.rows);
  const unresolvedLeaveReports = countRows(unresolved.rows);
  const missingFirstSeen = countRows(firstSeen.rows);
  const missingChanges = countRows(changes.rows);
  const duplicateLeaveReports = countRows(dupes.rows);

  if (unresolvedLeaveReports > 0) {
    return {
      ok: false,
      reason: `unresolved leave-report transitions: ${unresolvedLeaveReports}`,
      candidateLeaveReports,
      unresolvedLeaveReports,
      missingFirstSeen,
      missingChanges,
      duplicateLeaveReports,
    };
  }
  if (missingFirstSeen > 0) {
    return {
      ok: false,
      reason: `missing first-seen history rows: ${missingFirstSeen}`,
      candidateLeaveReports,
      unresolvedLeaveReports,
      missingFirstSeen,
      missingChanges,
      duplicateLeaveReports,
    };
  }
  if (missingChanges > 0) {
    return {
      ok: false,
      reason: `missing change history rows: ${missingChanges}`,
      candidateLeaveReports,
      unresolvedLeaveReports,
      missingFirstSeen,
      missingChanges,
      duplicateLeaveReports,
    };
  }
  if (duplicateLeaveReports > 0) {
    return {
      ok: false,
      reason: `duplicate RemovedFromReport rows: ${duplicateLeaveReports}`,
      candidateLeaveReports,
      unresolvedLeaveReports,
      missingFirstSeen,
      missingChanges,
      duplicateLeaveReports,
    };
  }

  return {
    ok: true,
    reason: 'meaningful injury transitions are represented in history',
    candidateLeaveReports,
    unresolvedLeaveReports,
    missingFirstSeen,
    missingChanges,
    duplicateLeaveReports,
  };
}
