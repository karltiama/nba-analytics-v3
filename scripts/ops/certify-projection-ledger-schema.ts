/**
 * Applies the projection-ledger migration if needed, then proves constraints
 * inside a transaction that rolls back. Does not leave prediction rows.
 *
 * Usage: npx tsx scripts/ops/certify-projection-ledger-schema.ts
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const sqlPath = path.resolve('db/schemas/MIGRATION_projection_ledger.sql');

const certification = `
DO $cert$
DECLARE
  gid text;
  tip timestamptz;
  p1 text;
  p2 text;
  p3 text;
  sid uuid;
  official_id uuid;
  n int;
BEGIN
  SELECT g.game_id, g.start_time INTO gid, tip
    FROM analytics.games g
   WHERE g.start_time IS NOT NULL
   ORDER BY g.start_time DESC
   LIMIT 1;
  SELECT player_id INTO p1 FROM analytics.players ORDER BY player_id LIMIT 1;
  SELECT player_id INTO p2 FROM analytics.players WHERE player_id <> p1 ORDER BY player_id LIMIT 1;
  SELECT player_id INTO p3 FROM analytics.players WHERE player_id NOT IN (p1, p2) ORDER BY player_id LIMIT 1;
  IF gid IS NULL OR p1 IS NULL OR p2 IS NULL OR p3 IS NULL THEN
    RAISE EXCEPTION 'certification fixtures missing';
  END IF;

  BEGIN
    INSERT INTO analytics.projection_snapshots (
      game_id, player_id, season, input_season_key, market, snapshot_policy,
      provenance_type, timing_status, projection_value, base_projection_value, serving_track,
      projection_model_id, projection_model_version, calibration_version, code_revision, config_fingerprint,
      generated_at, intended_cutoff_at, game_tip_time, latest_input_game_start_time,
      l5_avg, l10_avg, season_avg, sample_games_used, season_games_played, sigma_effective, input_snapshot
    ) VALUES (
      gid, p1, '2026', '2025', 'points', 'T_MINUS_60',
      'PROSPECTIVE_LIVE', 'LATE_BEFORE_TIP', 10, 9, 'trackB_calibrated',
      'production_70_30', 'trackB.1', 'v1', 'cert-sha', 'cert-fp',
      tip, tip - interval '60 minutes', tip, tip - interval '10 days',
      10, 10, 10, 10, 70, 4, '{"cert":true}'::jsonb
    );
    RAISE EXCEPTION 'live at tip was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%was accepted%' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO analytics.projection_snapshots (
      game_id, player_id, season, input_season_key, market, snapshot_policy,
      provenance_type, timing_status, projection_value, base_projection_value, serving_track,
      projection_model_id, projection_model_version, calibration_version, code_revision, config_fingerprint,
      generated_at, intended_cutoff_at, game_tip_time,
      l5_avg, l10_avg, season_avg, sample_games_used, season_games_played, sigma_effective, input_snapshot
    ) VALUES (
      gid, p1, '2026', '2025', 'steals', 'T_MINUS_60',
      'TEST', 'NOT_APPLICABLE', 1, 1, 'trackB_calibrated',
      'production_70_30', 'trackB.1', 'v1', 'cert-sha', 'cert-fp',
      tip - interval '60 minutes', tip - interval '60 minutes', tip,
      1, 1, 1, 1, 1, 1, '{}'::jsonb
    );
    RAISE EXCEPTION 'steals market was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%was accepted%' THEN RAISE; END IF;
  END;

  INSERT INTO analytics.projection_snapshots (
    game_id, player_id, season, input_season_key, market, snapshot_policy,
    provenance_type, timing_status, projection_value, base_projection_value, serving_track,
    projection_model_id, projection_model_version, calibration_version, code_revision, config_fingerprint,
    generated_at, intended_cutoff_at, game_tip_time, latest_input_game_start_time,
    l5_avg, l10_avg, season_avg, sample_games_used, season_games_played, sigma_effective, input_snapshot
  ) VALUES (
    gid, p1, '2026', '2025', 'points', 'T_MINUS_60',
    'RECONSTRUCTED_BACKFILL', 'NOT_APPLICABLE', 18.5, 17, 'trackB_calibrated',
    'production_70_30', 'trackB.1', 'v1', 'cert-sha', 'cert-fp',
    tip + interval '3 hours', tip - interval '60 minutes', tip, tip - interval '10 days',
    20, 18, 16, 10, 70, 4, '{"cert":"backfill"}'::jsonb
  ) RETURNING projection_snapshot_id INTO sid;

  IF (SELECT capture_eligible_at_write FROM analytics.projection_snapshots WHERE projection_snapshot_id = sid) THEN
    RAISE EXCEPTION 'backfill was capture eligible';
  END IF;
  IF EXISTS (SELECT 1 FROM analytics.v_projection_performance WHERE projection_snapshot_id = sid) THEN
    RAISE EXCEPTION 'backfill appeared in the official view';
  END IF;

  INSERT INTO analytics.projection_snapshots (
    game_id, player_id, season, input_season_key, market, snapshot_policy,
    provenance_type, timing_status, projection_value, base_projection_value, serving_track,
    projection_model_id, projection_model_version, calibration_version, code_revision, config_fingerprint,
    generated_at, intended_cutoff_at, game_tip_time,
    l5_avg, l10_avg, season_avg, sample_games_used, season_games_played, sigma_effective, input_snapshot
  ) VALUES (
    gid, p1, '2026', '2025', 'rebounds', 'T_MINUS_60',
    'TEST', 'NOT_APPLICABLE', 8, 7, 'trackB_calibrated',
    'production_70_30', 'trackB.1', 'v1', 'cert-sha', 'cert-fp',
    tip - interval '60 minutes', tip - interval '60 minutes', tip,
    8, 8, 8, 10, 70, 2, '{}'::jsonb
  ) RETURNING projection_snapshot_id INTO sid;
  IF EXISTS (SELECT 1 FROM analytics.v_projection_performance WHERE projection_snapshot_id = sid) THEN
    RAISE EXCEPTION 'test row appeared in the official view';
  END IF;

  INSERT INTO analytics.projection_snapshots (
    game_id, player_id, season, input_season_key, market, snapshot_policy,
    provenance_type, timing_status, projection_value, base_projection_value, serving_track,
    projection_model_id, projection_model_version, calibration_version, code_revision, config_fingerprint,
    generated_at, intended_cutoff_at, game_tip_time, latest_input_game_start_time,
    l5_avg, l10_avg, season_avg, sample_games_used, season_games_played, sigma_effective, input_snapshot
  ) VALUES (
    gid, p2, '2026', '2025', 'points', 'T_MINUS_60',
    'PROSPECTIVE_LIVE', 'ON_TIME', 21.4, 19, 'trackB_calibrated',
    'production_70_30', 'trackB.1', 'v1', 'sha-first', 'cert-fp',
    tip - interval '60 minutes', tip - interval '60 minutes', tip, tip - interval '12 days',
    22, 20, 16, 10, 70, 4, '{}'::jsonb
  ) RETURNING projection_snapshot_id INTO official_id;

  SELECT count(*) INTO n FROM analytics.v_projection_performance WHERE projection_snapshot_id = official_id;
  IF n <> 1 THEN
    RAISE EXCEPTION 'official parent with zero sportsbook children was not visible, count %', n;
  END IF;
  IF (SELECT capture_eligible_at_write FROM analytics.projection_snapshots WHERE projection_snapshot_id = official_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'on-time live row was not capture-eligible at write';
  END IF;

  BEGIN
    INSERT INTO analytics.projection_snapshots (
      game_id, player_id, season, input_season_key, market, snapshot_policy,
      provenance_type, timing_status, projection_value, base_projection_value, serving_track,
      projection_model_id, projection_model_version, calibration_version, code_revision, config_fingerprint,
      generated_at, intended_cutoff_at, game_tip_time,
      l5_avg, l10_avg, season_avg, sample_games_used, season_games_played, sigma_effective, input_snapshot
    ) VALUES (
      gid, p2, '2026', '2025', 'points', 'T_MINUS_60',
      'PROSPECTIVE_LIVE', 'ON_TIME', 99, 19, 'trackB_calibrated',
      'production_70_30', 'trackB.1', 'v1', 'sha-second', 'cert-fp',
      tip - interval '61 minutes', tip - interval '60 minutes', tip,
      22, 20, 16, 10, 70, 4, '{}'::jsonb
    );
    RAISE EXCEPTION 'second official slot was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%was accepted%' THEN RAISE; END IF;
  END;

  INSERT INTO analytics.projection_snapshots (
    game_id, player_id, season, input_season_key, market, snapshot_policy,
    provenance_type, timing_status, projection_value, base_projection_value, serving_track,
    projection_model_id, projection_model_version, calibration_version, code_revision, config_fingerprint,
    generated_at, intended_cutoff_at, game_tip_time,
    l5_avg, l10_avg, season_avg, sample_games_used, season_games_played, sigma_effective, input_snapshot
  ) VALUES (
    gid, p3, '2026', '2025', 'points', 'T_MINUS_60',
    'PROSPECTIVE_LIVE', 'ON_TIME', 21.4, 19, 'trackB_calibrated',
    'production_70_30', 'trackB.1', 'v1', 'sha-stale', 'cert-fp',
    tip - interval '30 minutes', tip - interval '30 minutes', tip + interval '30 minutes',
    22, 20, 16, 10, 70, 4, '{}'::jsonb
  ) RETURNING projection_snapshot_id INTO sid;
  IF EXISTS (SELECT 1 FROM analytics.v_projection_performance WHERE projection_snapshot_id = sid) THEN
    RAISE EXCEPTION 'moved tip remained in the official view';
  END IF;

  INSERT INTO analytics.projection_market_snapshots (
    projection_snapshot_id, sportsbook, side, line_value, odds_american, odds_decimal,
    market_implied_probability, observed_at, source_table
  ) VALUES
    (official_id, 'draftkings', 'over', 20.5, -110, 1.91, 0.52, tip - interval '70 minutes', 'analytics.player_props_current'),
    (official_id, 'draftkings', 'over', 21.5, -120, 1.83, 0.55, tip - interval '70 minutes', 'analytics.player_props_current'),
    (official_id, 'fanduel', 'under', 20.5, -105, 1.95, 0.51, tip - interval '70 minutes', 'analytics.player_props_current');
  SELECT count(*) INTO n FROM analytics.projection_market_snapshots WHERE projection_snapshot_id = official_id;
  IF n <> 3 THEN
    RAISE EXCEPTION 'expected 3 sportsbook facts, found %', n;
  END IF;

  BEGIN
    INSERT INTO analytics.projection_market_snapshots (
      projection_snapshot_id, sportsbook, side, line_value, odds_american, odds_decimal,
      market_implied_probability, observed_at, source_table
    ) VALUES (
      official_id, 'betmgm', 'over', 20.5, -110, 1.91, 0.52, tip, 'analytics.player_props_current'
    );
    RAISE EXCEPTION 'late market observation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%was accepted%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE analytics.projection_snapshots SET projection_value = 0 WHERE projection_snapshot_id = official_id;
    RAISE EXCEPTION 'update was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%was accepted%' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM analytics.projection_snapshots WHERE projection_snapshot_id = official_id;
    RAISE EXCEPTION 'delete was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%was accepted%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'certification rollback';
END
$cert$;
`;

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (!connectionString) throw new Error('Missing SUPABASE_DB_URL');
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  try {
    const migration = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(migration);
    try {
      await pool.query(certification);
      throw new Error('certification transaction committed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('certification rollback')) throw error;
    }
    const counts = await pool.query<{ snapshots: string; markets: string; attempts: string; live: string }>(
      `SELECT
         (SELECT count(*) FROM analytics.projection_snapshots)::text AS snapshots,
         (SELECT count(*) FROM analytics.projection_market_snapshots)::text AS markets,
         (SELECT count(*) FROM analytics.projection_publish_attempts)::text AS attempts,
         (SELECT count(*) FROM analytics.projection_snapshots WHERE provenance_type = 'PROSPECTIVE_LIVE')::text AS live`
    );
    const catalog = await pool.query<{ kind: string; name: string }>(
      `SELECT 'table' AS kind, c.relname AS name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'analytics'
          AND c.relname IN (
            'projection_snapshots',
            'projection_market_snapshots',
            'projection_publish_attempts',
            'v_projection_performance',
            'v_projection_performance_grades'
          )
       UNION ALL
       SELECT 'constraint', con.conname
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'analytics'
          AND c.relname IN ('projection_snapshots', 'projection_market_snapshots', 'projection_publish_attempts')
       UNION ALL
       SELECT 'index', i.relname
         FROM pg_class i
         JOIN pg_namespace n ON n.oid = i.relnamespace
        WHERE n.nspname = 'analytics'
          AND i.relkind = 'i'
          AND i.relname LIKE 'projection_%'
       ORDER BY 1, 2`
    );
    console.log(JSON.stringify({ counts: counts.rows[0], catalog: catalog.rows }, null, 2));
    const row = counts.rows[0];
    if (!row || row.snapshots !== '0' || row.markets !== '0' || row.live !== '0') {
      throw new Error('projection ledger certification left rows behind');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
