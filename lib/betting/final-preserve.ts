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

/** Shared analytics.games upsert used by nightly, date-range refresh, and frequent status sync. */
export const ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL = `
  insert into analytics.games (game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score, venue)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  on conflict (game_id) do update set
    season = excluded.season,
    /* ${FINAL_PRESERVE_SQL_MARKER} */
    start_time = case
      when ${FINAL_PRESERVE_SQL_EXISTING_ANALYTICS}
       and ${FINAL_PRESERVE_SQL_INCOMING_NOT_FINAL}
      then analytics.games.start_time
      else excluded.start_time
    end,
    status = case
      when ${FINAL_PRESERVE_SQL_EXISTING_ANALYTICS}
       and ${FINAL_PRESERVE_SQL_INCOMING_NOT_FINAL}
      then analytics.games.status
      else excluded.status
    end,
    home_team_id = excluded.home_team_id,
    away_team_id = excluded.away_team_id,
    home_score = case
      when ${FINAL_PRESERVE_SQL_EXISTING_ANALYTICS}
       and ${FINAL_PRESERVE_SQL_INCOMING_NOT_FINAL}
      then analytics.games.home_score
      else excluded.home_score
    end,
    away_score = case
      when ${FINAL_PRESERVE_SQL_EXISTING_ANALYTICS}
       and ${FINAL_PRESERVE_SQL_INCOMING_NOT_FINAL}
      then analytics.games.away_score
      else excluded.away_score
    end,
    venue = excluded.venue,
    updated_at = now();
`;
