-- =============================================================================
-- STORAGE AUDIT — READ ONLY
-- Run in the Supabase SQL editor. Safe: SELECT / catalog only. No DELETE,
-- TRUNCATE, DROP, VACUUM, ALTER, or UPDATE.
--
-- How to use:
--   1. Run A–E first (catalog stats; cheap).
--   2. Run F/G only after confirming the named tables exist in query 0.
--   3. If a query times out, skip it and continue; do not raise statement_timeout
--      without watching the dashboard.
--
-- Expected: these queries do not shrink database size and do not lock tables
-- for writes (AccessShareLock only).
-- =============================================================================

-- Optional: keep individual statements from running too long.
-- Comment out if you need a longer window for date-range scans.
SET LOCAL statement_timeout = '60s';

-- -----------------------------------------------------------------------------
-- 0. Inventory: which candidate tables actually exist
-- -----------------------------------------------------------------------------
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  c.relkind AS kind, -- r=table, m=matview, v=view, i=index
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('raw', 'analytics', 'public', 'research', 'paper', 'auth', 'storage')
  AND c.relkind IN ('r', 'm', 'p')
  AND c.relname = ANY (ARRAY[
    'player_prop_snapshots_v2',
    'player_prop_snapshots',
    'player_prop_market_outcomes',
    'player_prop_pull_runs',
    'player_prop_game_runs',
    'odds_snapshots',
    'odds_pull_runs',
    'player_injuries',
    'injury_pull_runs',
    'player_game_stats',
    'games',
    'players',
    'teams',
    'season_averages',
    'game_odds_history',
    'game_odds_current',
    'game_line_movement_summary',
    'player_props_current',
    'player_prop_current',
    'player_prop_history',
    'player_prop_movement_summary',
    'player_prop_lines',
    'player_game_logs',
    'team_game_stats',
    'team_season_averages',
    'player_season_averages',
    'player_injury_status_current',
    'player_injury_status_history',
    'bbref_player_game_stats',
    'bbref_team_game_stats',
    'bbref_games',
    'bbref_schedule',
    'bbref_team_season_stats',
    'bbref_boxscores_csv',
    'scraped_boxscores',
    'markets',
    'staging_events',
    'game_validation_results',
    'prop_decision_lines',
    'bets',
    'user_saved_props',
    'user_settings',
    'profiles',
    'player_team_rosters',
    'provider_id_map'
  ])
ORDER BY pg_total_relation_size(c.oid) DESC NULLS LAST;


-- =============================================================================
-- A. Database / schema size
-- =============================================================================

-- A1. Database total (this is closest to the Supabase "Database" gauge)
SELECT
  current_database() AS database,
  pg_size_pretty(pg_database_size(current_database())) AS database_size,
  pg_database_size(current_database()) AS database_bytes;

-- A2. Size by schema (heap + indexes + TOAST)
SELECT
  n.nspname AS schema,
  count(*) FILTER (WHERE c.relkind = 'r') AS tables,
  count(*) FILTER (WHERE c.relkind = 'i') AS indexes,
  count(*) FILTER (WHERE c.relkind = 'm') AS matviews,
  pg_size_pretty(sum(pg_relation_size(c.oid)) FILTER (WHERE c.relkind = 'r')) AS heap_size,
  pg_size_pretty(sum(pg_indexes_size(c.oid)) FILTER (WHERE c.relkind = 'r')) AS index_size,
  pg_size_pretty(sum(pg_total_relation_size(c.oid)) FILTER (WHERE c.relkind IN ('r', 'm'))) AS total_relation_size,
  sum(pg_total_relation_size(c.oid)) FILTER (WHERE c.relkind IN ('r', 'm')) AS total_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp%'
  AND n.nspname NOT LIKE 'pg_toast%'
GROUP BY n.nspname
ORDER BY total_bytes DESC NULLS LAST;

-- A3. Heap vs index vs TOAST for user tables (helps spot jsonb TOAST bloat)
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  pg_size_pretty(pg_relation_size(c.oid)) AS heap,
  pg_size_pretty(COALESCE(pg_relation_size(c.reltoastrelid), 0)) AS toast,
  pg_size_pretty(pg_indexes_size(c.oid)) AS indexes,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
  pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('raw', 'analytics', 'public', 'research', 'paper')
  AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 40;


-- =============================================================================
-- B. Largest tables (top 25 by total disk usage)
-- =============================================================================
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  c.reltuples::bigint AS row_estimate,
  pg_size_pretty(pg_relation_size(c.oid)) AS table_data,
  pg_size_pretty(COALESCE(pg_relation_size(c.reltoastrelid), 0)) AS toast,
  pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  s.n_live_tup AS live_tuples,
  s.n_dead_tup AS dead_tuples,
  CASE
    WHEN COALESCE(s.n_live_tup, 0) + COALESCE(s.n_dead_tup, 0) = 0 THEN NULL
    ELSE round(
      100.0 * s.n_dead_tup / NULLIF(s.n_live_tup + s.n_dead_tup, 0),
      2
    )
  END AS dead_pct,
  pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s
  ON s.relid = c.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND c.relkind IN ('r', 'm', 'p')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 25;


-- =============================================================================
-- C. Largest indexes
-- =============================================================================
SELECT
  n.nspname AS schema,
  t.relname AS table_name,
  i.relname AS index_name,
  pg_size_pretty(pg_relation_size(i.oid)) AS index_size,
  pg_relation_size(i.oid) AS index_bytes,
  am.amname AS access_method,
  idx.indisunique AS is_unique,
  idx.indisprimary AS is_primary
FROM pg_index idx
JOIN pg_class i ON i.oid = idx.indexrelid
JOIN pg_class t ON t.oid = idx.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = i.relam
WHERE n.nspname IN ('raw', 'analytics', 'public', 'research', 'paper', 'auth')
ORDER BY pg_relation_size(i.oid) DESC
LIMIT 30;


-- =============================================================================
-- D. Row counts (estimates first — cheap)
-- Exact COUNT(*) is optional and slower; run D2 only for tables you care about.
-- =============================================================================

-- D1. Planner estimates + last analyze time
SELECT
  schemaname AS schema,
  relname AS table_name,
  n_live_tup AS live_estimate,
  n_dead_tup AS dead_estimate,
  last_analyze,
  last_autoanalyze,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname IN ('raw', 'analytics', 'public', 'research', 'paper')
ORDER BY n_live_tup DESC NULLS LAST
LIMIT 40;

-- D2. Exact counts — UNCOMMENT one table at a time if estimates look stale.
-- SELECT 'raw.player_prop_snapshots_v2' AS table_name, count(*) AS exact_rows FROM raw.player_prop_snapshots_v2;
-- SELECT 'raw.odds_snapshots' AS table_name, count(*) AS exact_rows FROM raw.odds_snapshots;
-- SELECT 'raw.player_injuries' AS table_name, count(*) AS exact_rows FROM raw.player_injuries;
-- SELECT 'raw.player_prop_snapshots' AS table_name, count(*) AS exact_rows FROM raw.player_prop_snapshots;
-- SELECT 'analytics.game_odds_history' AS table_name, count(*) AS exact_rows FROM analytics.game_odds_history;
-- SELECT 'analytics.player_props_current' AS table_name, count(*) AS exact_rows FROM analytics.player_props_current;
-- SELECT 'analytics.player_prop_history' AS table_name, count(*) AS exact_rows FROM analytics.player_prop_history;
-- SELECT 'analytics.player_game_logs' AS table_name, count(*) AS exact_rows FROM analytics.player_game_logs;
-- SELECT 'public.bbref_player_game_stats' AS table_name, count(*) AS exact_rows FROM public.bbref_player_game_stats;
-- SELECT 'public.player_game_stats' AS table_name, count(*) AS exact_rows FROM public.player_game_stats;
-- SELECT 'public.markets' AS table_name, count(*) AS exact_rows FROM public.markets;
-- SELECT 'public.staging_events' AS table_name, count(*) AS exact_rows FROM public.staging_events;
-- SELECT 'research.prop_decision_lines' AS table_name, count(*) AS exact_rows FROM research.prop_decision_lines;


-- =============================================================================
-- E. Dead tuples / bloat indicators
-- Do NOT run VACUUM FULL based on this alone.
-- =============================================================================
SELECT
  schemaname AS schema,
  relname AS table_name,
  n_live_tup,
  n_dead_tup,
  n_mod_since_analyze,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  vacuum_count,
  autovacuum_count,
  CASE
    WHEN n_live_tup + n_dead_tup = 0 THEN 0
    ELSE round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
  END AS dead_pct
FROM pg_stat_user_tables
WHERE schemaname IN ('raw', 'analytics', 'public', 'research', 'paper')
  AND (n_dead_tup > 1000 OR n_live_tup > 10000)
ORDER BY n_dead_tup DESC
LIMIT 40;

-- E2. Autovacuum settings that affect whether space is reused
SHOW autovacuum;
SHOW autovacuum_vacuum_scale_factor;
SHOW autovacuum_vacuum_threshold;


-- =============================================================================
-- F. Date ranges for historical / snapshot tables
-- Skip any statement whose table is missing from query 0.
-- These use indexed timestamp columns where the schema defined them.
-- =============================================================================

-- F0. Timestamp / date columns on user tables (discover grain before scanning)
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('raw', 'analytics', 'public', 'research', 'paper')
  AND c.relkind = 'r'
  AND NOT a.attisdropped
  AND a.attnum > 0
  AND format_type(a.atttypid, a.atttypmod) IN (
    'timestamp with time zone',
    'timestamp without time zone',
    'date'
  )
ORDER BY 1, 2, 3;

-- F1. raw.player_prop_snapshots_v2
SELECT
  'raw.player_prop_snapshots_v2' AS table_name,
  min(fetched_at) AS oldest,
  max(fetched_at) AS newest,
  count(*) AS rows
FROM raw.player_prop_snapshots_v2;

SELECT
  date_trunc('month', fetched_at AT TIME ZONE 'America/New_York') AS month_et,
  count(*) AS rows
FROM raw.player_prop_snapshots_v2
GROUP BY 1
ORDER BY 1;

SELECT
  date_trunc('day', fetched_at AT TIME ZONE 'America/New_York')::date AS day_et,
  count(*) AS rows
FROM raw.player_prop_snapshots_v2
GROUP BY 1
ORDER BY 1 DESC
LIMIT 31;

-- How much would a 3-day / 14-day / 30-day retention remove? (count only)
SELECT
  count(*) FILTER (WHERE fetched_at < now() - interval '3 days') AS older_than_3d,
  count(*) FILTER (WHERE fetched_at < now() - interval '14 days') AS older_than_14d,
  count(*) FILTER (WHERE fetched_at < now() - interval '30 days') AS older_than_30d,
  count(*) FILTER (WHERE fetched_at >= now() - interval '3 days') AS last_3d,
  count(*) AS total
FROM raw.player_prop_snapshots_v2;

SELECT
  count(*) FILTER (WHERE raw_json IS NOT NULL) AS rows_with_raw_json,
  count(*) FILTER (WHERE raw_json IS NULL) AS rows_without_raw_json
FROM raw.player_prop_snapshots_v2;

-- F2. raw.odds_snapshots
SELECT
  'raw.odds_snapshots' AS table_name,
  min(created_at) AS oldest,
  max(created_at) AS newest,
  count(*) AS rows
FROM raw.odds_snapshots;

SELECT
  date_trunc('month', created_at AT TIME ZONE 'America/New_York') AS month_et,
  count(*) AS rows
FROM raw.odds_snapshots
GROUP BY 1
ORDER BY 1;

SELECT
  count(*) FILTER (WHERE created_at < now() - interval '7 days') AS older_than_7d,
  count(*) FILTER (WHERE created_at < now() - interval '30 days') AS older_than_30d,
  count(*) FILTER (WHERE raw_payload IS NOT NULL) AS rows_with_payload,
  count(*) AS total
FROM raw.odds_snapshots;

-- F3. analytics.game_odds_history
SELECT
  'analytics.game_odds_history' AS table_name,
  min(snapshot_at) AS oldest,
  max(snapshot_at) AS newest,
  count(*) AS rows
FROM analytics.game_odds_history;

SELECT
  g.season,
  count(*) AS rows
FROM analytics.game_odds_history h
JOIN analytics.games g ON g.game_id = h.game_id
GROUP BY g.season
ORDER BY g.season;

-- F4. analytics.player_props_current
SELECT
  'analytics.player_props_current' AS table_name,
  min(snapshot_at) AS oldest,
  max(snapshot_at) AS newest,
  count(*) AS rows
FROM analytics.player_props_current;

SELECT
  g.status,
  count(*) AS rows
FROM analytics.player_props_current p
LEFT JOIN analytics.games g ON g.game_id = p.game_id::text
GROUP BY g.status
ORDER BY rows DESC;

-- Rows the current prune-props job would delete (Final + start_time older than 3 days)
SELECT count(*) AS prune_props_current_eligible
FROM analytics.player_props_current p
JOIN analytics.games g ON g.game_id = p.game_id::text
WHERE g.status = 'Final'
  AND g.start_time < now() - interval '3 days';

-- F5. raw.player_injuries
SELECT
  'raw.player_injuries' AS table_name,
  min(created_at) AS oldest,
  max(created_at) AS newest,
  count(*) AS rows
FROM raw.player_injuries;

SELECT
  date_trunc('month', created_at AT TIME ZONE 'America/New_York') AS month_et,
  count(*) AS rows
FROM raw.player_injuries
GROUP BY 1
ORDER BY 1;

-- F6. analytics.player_injury_status_history
SELECT
  'analytics.player_injury_status_history' AS table_name,
  min(snapshot_at) AS oldest,
  max(snapshot_at) AS newest,
  count(*) AS rows
FROM analytics.player_injury_status_history;

-- F7. raw.player_game_stats (BDL box scores)
SELECT
  'raw.player_game_stats' AS table_name,
  min(created_at) AS oldest,
  max(created_at) AS newest,
  count(*) AS rows
FROM raw.player_game_stats;

-- F8. analytics.player_game_logs
SELECT
  'analytics.player_game_logs' AS table_name,
  min(game_date) AS oldest_game_date,
  max(game_date) AS newest_game_date,
  count(*) AS rows
FROM analytics.player_game_logs;

SELECT
  season,
  count(*) AS rows
FROM analytics.player_game_logs
GROUP BY season
ORDER BY season;

-- F9. public.markets (legacy Odds API)
SELECT
  'public.markets' AS table_name,
  min(fetched_at) AS oldest,
  max(fetched_at) AS newest,
  count(*) AS rows
FROM public.markets;

-- F10. public.staging_events
SELECT
  'public.staging_events' AS table_name,
  min(fetched_at) AS oldest,
  max(fetched_at) AS newest,
  count(*) AS rows,
  count(*) FILTER (WHERE processed = false) AS unprocessed
FROM public.staging_events;

-- F11. research.prop_decision_lines (closing-line materialization)
SELECT
  'research.prop_decision_lines' AS table_name,
  min(decision_at) AS oldest,
  max(decision_at) AS newest,
  count(*) AS rows
FROM research.prop_decision_lines;

-- F12. Legacy v1 props (if present)
SELECT
  'raw.player_prop_snapshots' AS table_name,
  min(created_at) AS oldest,
  max(created_at) AS newest,
  count(*) AS rows
FROM raw.player_prop_snapshots;

SELECT
  'analytics.player_prop_history' AS table_name,
  min(snapshot_at) AS oldest,
  max(snapshot_at) AS newest,
  count(*) AS rows
FROM analytics.player_prop_history;

-- F13. BBRef / public box scores
SELECT
  'bbref_player_game_stats' AS table_name,
  min(created_at) AS oldest,
  max(created_at) AS newest,
  count(*) AS rows,
  count(DISTINCT game_id) AS games
FROM bbref_player_game_stats;

SELECT
  'player_game_stats' AS table_name,
  min(created_at) AS oldest,
  max(created_at) AS newest,
  count(*) AS rows,
  count(DISTINCT game_id) AS games
FROM player_game_stats;


-- =============================================================================
-- G. Duplicate / redundant data (counts only — do not delete from this)
-- Naming overlap is not proof of safe deletion. Trace app usage separately.
-- =============================================================================

-- G1. Box-score copies: BDL analytics vs public vs BBRef
SELECT
  'analytics.player_game_logs' AS src,
  count(*) AS rows,
  count(DISTINCT game_id) AS games
FROM analytics.player_game_logs
UNION ALL
SELECT 'public.player_game_stats', count(*), count(DISTINCT game_id)
FROM player_game_stats
UNION ALL
SELECT 'bbref_player_game_stats', count(*), count(DISTINCT game_id)
FROM bbref_player_game_stats
UNION ALL
SELECT 'raw.player_game_stats', count(*), count(DISTINCT game_id)
FROM raw.player_game_stats;

-- G2. Current prop tables
SELECT
  'analytics.player_props_current' AS src,
  count(*) AS rows
FROM analytics.player_props_current
UNION ALL
SELECT 'analytics.player_prop_current', count(*)
FROM analytics.player_prop_current
UNION ALL
SELECT 'analytics.player_prop_lines', count(*)
FROM analytics.player_prop_lines;

-- G3. Odds copies: raw vs analytics vs public.markets
SELECT 'raw.odds_snapshots' AS src, count(*) AS rows FROM raw.odds_snapshots
UNION ALL
SELECT 'analytics.game_odds_history', count(*) FROM analytics.game_odds_history
UNION ALL
SELECT 'analytics.game_odds_current', count(*) FROM analytics.game_odds_current
UNION ALL
SELECT 'public.markets', count(*) FROM public.markets;

-- G4. Injury copies
SELECT 'raw.player_injuries' AS src, count(*) AS rows FROM raw.player_injuries
UNION ALL
SELECT 'analytics.player_injury_status_current', count(*) FROM analytics.player_injury_status_current
UNION ALL
SELECT 'analytics.player_injury_status_history', count(*) FROM analytics.player_injury_status_history;

-- G5. Closing-line coverage vs remaining raw snapshots for Final games
SELECT
  (SELECT count(*) FROM research.prop_decision_lines) AS materialized_closing_lines,
  (
    SELECT count(*)
    FROM (
      SELECT DISTINCT r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side
      FROM raw.player_prop_snapshots_v2 r
      JOIN analytics.games g ON g.game_id = r.game_id::text
      WHERE g.status = 'Final'
        AND g.start_time IS NOT NULL
        AND r.fetched_at < g.start_time
        AND lower(coalesce(r.market_type, '')) = 'over_under'
        AND lower(r.side) IN ('over', 'under')
        AND NOT EXISTS (
          SELECT 1
          FROM research.prop_decision_lines m
          WHERE m.game_id = g.game_id
            AND m.player_id = r.player_id::text
            AND m.sportsbook = r.sportsbook
            AND m.prop_type = r.prop_type
            AND m.side = r.side
        )
    ) pending
  ) AS unmaterialized_closing_keys_still_in_raw;

-- G6. Deprecated-table presence (existence + size; do not drop)
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  c.reltuples::bigint AS row_estimate,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND c.relname IN (
    'scraped_boxscores',
    'bbref_boxscores_csv',
    'bbref_player_game_stats',
    'bbref_team_game_stats',
    'player_prop_snapshots',
    'player_prop_market_outcomes',
    'player_prop_history',
    'player_prop_movement_summary',
    'staging_events',
    'markets'
  )
ORDER BY pg_total_relation_size(c.oid) DESC;


-- =============================================================================
-- H. JSONB / TOAST drivers (sample column widths — cheap)
-- =============================================================================
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  a.attname AS jsonb_column
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('raw', 'analytics', 'public')
  AND c.relkind = 'r'
  AND NOT a.attisdropped
  AND a.attnum > 0
  AND format_type(a.atttypid, a.atttypmod) IN ('jsonb', 'json')
ORDER BY 1, 2, 3;

-- Sampled payload sizes (skip if table missing). Uses a cap so this stays cheap.
SELECT
  avg(pg_column_size(raw_payload))::int AS avg_bytes,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY pg_column_size(raw_payload))::int AS p95_bytes,
  max(pg_column_size(raw_payload)) AS max_bytes
FROM (
  SELECT raw_payload
  FROM raw.odds_snapshots
  WHERE raw_payload IS NOT NULL
  LIMIT 5000
) s;

SELECT
  avg(pg_column_size(raw_payload))::int AS avg_bytes,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY pg_column_size(raw_payload))::int AS p95_bytes
FROM (
  SELECT raw_payload
  FROM raw.player_injuries
  WHERE raw_payload IS NOT NULL
  LIMIT 5000
) s;


-- =============================================================================
-- I. Maintenance / reclaim reality check (read-only)
-- =============================================================================

-- I1. Compare database size vs summed relation sizes (gap can be free space,
--     FSM/VM, or objects outside the schemas above)
SELECT
  pg_database_size(current_database()) AS database_bytes,
  (
    SELECT sum(pg_total_relation_size(c.oid))
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_toast%'
  ) AS summed_relation_bytes,
  pg_size_pretty(pg_database_size(current_database())) AS database_pretty,
  pg_size_pretty((
    SELECT sum(pg_total_relation_size(c.oid))
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_toast%'
  )) AS summed_pretty;

-- I2. Is pg_repack available? (non-disruptive rewrite alternative to VACUUM FULL)
SELECT e.extname, e.extversion
FROM pg_extension e
WHERE e.extname IN ('pg_repack', 'pgstattuple', 'pg_stat_statements');

-- I3. Auth / storage schemas (usually small; confirm they are not the 631 MB)
SELECT
  n.nspname AS schema,
  pg_size_pretty(sum(pg_total_relation_size(c.oid))) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('auth', 'storage', 'realtime', 'supabase_functions', 'extensions')
  AND c.relkind IN ('r', 'm', 'i')
GROUP BY n.nspname
ORDER BY sum(pg_total_relation_size(c.oid)) DESC;
