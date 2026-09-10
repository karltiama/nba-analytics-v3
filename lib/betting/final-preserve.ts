/**
 * Certified Final is terminal for schedule/status refresh.
 *
 * Valid progression: Scheduled → In Progress → Final, or Scheduled → Final.
 * Final → Final may still update scores/datetime (correction of a completed game).
 * Final → Scheduled / In Progress / tipoff ISO must never occur from a stale provider refresh.
 *
 * status_state is not used here. 2025 BDL payloads include it, but live schedule
 * sync still keys off stored `status`. See Step 13C.1 report for later migration.
 */

import { isFinalStatus } from '@/lib/betting/normalize-game-status';

/** Marker copied into nightly + refresh-schedule SQL. Tests grep for this string. */
export const FINAL_PRESERVE_SQL_MARKER = 'final-preserve-guard';

export function shouldPreserveCertifiedFinal(args: {
  existingStatus: string | null | undefined;
  incomingStatus: string | null | undefined;
}): boolean {
  return isFinalStatus(args.existingStatus) && !isFinalStatus(args.incomingStatus);
}

/** PostgreSQL predicate fragments: existing row is certified Final and incoming is not. */
export const FINAL_PRESERVE_SQL_EXISTING_RAW = `lower(btrim(coalesce(raw.games.status, ''))) = 'final'`;
export const FINAL_PRESERVE_SQL_INCOMING_NOT_FINAL = `lower(btrim(coalesce(excluded.status, ''))) is distinct from 'final'`;
export const FINAL_PRESERVE_SQL_EXISTING_ANALYTICS = `lower(btrim(coalesce(analytics.games.status, ''))) = 'final'`;
