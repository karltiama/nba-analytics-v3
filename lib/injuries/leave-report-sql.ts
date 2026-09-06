/**
 * Shared SQL for reconstructing leave-report transitions from raw injury pulls.
 * Used by the history backfill and the future prune coverage gate.
 *
 * Pulls are ordered by pull_run_id. Consecutive means next_id = prev_id + 1
 * (no intervening pull of any status). Only successful complete pulls qualify.
 */

import { MIN_COMPLETE_INJURY_ROW_COUNT } from './leave-report';

export const INJURY_LEAVE_REPORT_CANDIDATES_SQL = `
WITH complete AS (
  SELECT
    pull_run_id,
    pulled_at,
    rows_stored,
    lag(pull_run_id) OVER (ORDER BY pull_run_id) AS prev_id,
    lag(rows_stored) OVER (ORDER BY pull_run_id) AS prev_stored
  FROM raw.injury_pull_runs
  WHERE status = 'success'
    AND completed_at IS NOT NULL
    AND rows_stored IS NOT NULL
    AND rows_returned IS NOT NULL
    AND rows_stored = rows_returned
    AND rows_stored > 0
),
pairs AS (
  SELECT prev_id, pull_run_id AS next_id, pulled_at AS next_pulled_at, rows_stored, prev_stored
  FROM complete
  WHERE prev_id IS NOT NULL
    AND prev_id = pull_run_id - 1
    AND rows_stored >= GREATEST(${MIN_COMPLETE_INJURY_ROW_COUNT}, ceil(0.5 * prev_stored))
    AND prev_stored >= ${MIN_COMPLETE_INJURY_ROW_COUNT}
),
last_raw AS (
  SELECT DISTINCT ON (r.pull_run_id, r.provider_player_id)
    r.pull_run_id,
    r.provider_player_id::text AS player_id,
    r.status,
    r.description,
    r.return_date_raw,
    r.provider_team_id
  FROM raw.player_injuries r
  JOIN pairs p ON p.prev_id = r.pull_run_id
  ORDER BY r.pull_run_id, r.provider_player_id, r.created_at DESC
)
SELECT
  lr.player_id,
  p.prev_id,
  p.next_id,
  p.next_pulled_at,
  lr.status AS last_status,
  lr.description AS last_description,
  lr.return_date_raw AS last_return_date_raw,
  lr.provider_team_id AS last_provider_team_id
FROM last_raw lr
JOIN pairs p ON p.prev_id = lr.pull_run_id
WHERE NOT EXISTS (
  SELECT 1
  FROM raw.player_injuries n
  WHERE n.pull_run_id = p.next_id
    AND n.provider_player_id::text = lr.player_id
)
  AND EXISTS (
    SELECT 1 FROM analytics.players ap WHERE ap.player_id = lr.player_id
  )
`;

export const INJURY_FIRST_SEEN_GAPS_SQL = `
WITH first_seen AS (
  SELECT r.provider_player_id::text AS player_id, min(r.pull_run_id) AS first_pull
  FROM raw.player_injuries r
  GROUP BY 1
)
SELECT fs.player_id, fs.first_pull
FROM first_seen fs
WHERE EXISTS (SELECT 1 FROM analytics.players p WHERE p.player_id = fs.player_id)
  AND NOT EXISTS (
    SELECT 1
    FROM analytics.player_injury_status_history h
    WHERE h.player_id = fs.player_id
      AND h.pull_run_id = fs.first_pull
  )
ORDER BY fs.player_id
`;

export const INJURY_CHANGE_GAPS_SQL = `
WITH complete AS (
  SELECT
    pull_run_id,
    lag(pull_run_id) OVER (ORDER BY pull_run_id) AS prev_id
  FROM raw.injury_pull_runs
  WHERE status = 'success'
    AND completed_at IS NOT NULL
    AND rows_stored IS NOT NULL
    AND rows_returned IS NOT NULL
    AND rows_stored = rows_returned
    AND rows_stored > 0
),
pairs AS (
  SELECT prev_id, pull_run_id AS next_id
  FROM complete
  WHERE prev_id IS NOT NULL
    AND prev_id = pull_run_id - 1
),
last_raw AS (
  SELECT DISTINCT ON (r.pull_run_id, r.provider_player_id)
    r.pull_run_id,
    r.provider_player_id::text AS player_id,
    r.status,
    r.description,
    r.return_date_raw,
    r.provider_team_id
  FROM raw.player_injuries r
  ORDER BY r.pull_run_id, r.provider_player_id, r.created_at DESC
)
SELECT n.player_id, p.next_id
FROM pairs p
JOIN last_raw prev ON prev.pull_run_id = p.prev_id
JOIN last_raw n ON n.pull_run_id = p.next_id AND n.player_id = prev.player_id
WHERE (
    prev.status IS DISTINCT FROM n.status
    OR prev.description IS DISTINCT FROM n.description
    OR prev.return_date_raw IS DISTINCT FROM n.return_date_raw
    OR prev.provider_team_id IS DISTINCT FROM n.provider_team_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM analytics.player_injury_status_history h
    WHERE h.player_id = n.player_id
      AND h.pull_run_id = p.next_id
      AND h.status IS DISTINCT FROM 'RemovedFromReport'
  )
ORDER BY n.player_id, p.next_id
`;
