import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Materializes closing-line snapshots (last pre-tip row per market) from
 * raw.player_prop_snapshots_v2 into research.prop_decision_lines for all
 * Final games not yet materialized.
 *
 * Safe to re-run: ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   npx tsx scripts/materialize-closing-lines.ts          # dry-run (count only)
 *   npx tsx scripts/materialize-closing-lines.ts --execute # actually insert
 */

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const MATERIALIZE_SQL = `
INSERT INTO research.prop_decision_lines
  (game_id, player_id, player_name, team_id, sportsbook, prop_type,
   market_type, side, line_value, odds_american, odds_decimal,
   implied_probability, decision_at, game_start_time)
SELECT DISTINCT ON (r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side)
  g.game_id,
  r.player_id::text,
  r.player_name,
  r.team_id,
  r.sportsbook,
  r.prop_type,
  r.market_type,
  r.side,
  r.line_value,
  r.odds_american,
  r.odds_decimal,
  r.implied_probability,
  r.fetched_at,
  g.start_time
FROM raw.player_prop_snapshots_v2 r
INNER JOIN analytics.games g ON g.game_id = r.game_id::text
WHERE g.status = 'Final'
  AND g.start_time IS NOT NULL
  AND r.fetched_at < g.start_time
  AND lower(coalesce(r.market_type, '')) = 'over_under'
  AND lower(r.side) IN ('over', 'under')
  AND NOT EXISTS (
    SELECT 1 FROM research.prop_decision_lines m
    WHERE m.game_id = g.game_id
      AND m.player_id = r.player_id::text
      AND m.sportsbook = r.sportsbook
      AND m.prop_type = r.prop_type
      AND m.side = r.side
  )
ORDER BY
  r.game_id,
  r.player_id,
  r.sportsbook,
  r.prop_type,
  r.side,
  r.fetched_at DESC
ON CONFLICT (game_id, player_id, sportsbook, prop_type, side) DO NOTHING
`;

const COUNT_SQL = `
SELECT count(*) AS unmaterialized
FROM (
  SELECT DISTINCT r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side
  FROM raw.player_prop_snapshots_v2 r
  INNER JOIN analytics.games g ON g.game_id = r.game_id::text
  WHERE g.status = 'Final'
    AND g.start_time IS NOT NULL
    AND r.fetched_at < g.start_time
    AND lower(coalesce(r.market_type, '')) = 'over_under'
    AND lower(r.side) IN ('over', 'under')
    AND NOT EXISTS (
      SELECT 1 FROM research.prop_decision_lines m
      WHERE m.game_id = g.game_id
        AND m.player_id = r.player_id::text
        AND m.sportsbook = r.sportsbook
        AND m.prop_type = r.prop_type
        AND m.side = r.side
    )
) sub
`;

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL');

  const pool = new Pool({ connectionString: dbUrl });
  const execute = hasFlag('--execute');

  try {
    const existing = await pool.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM research.prop_decision_lines`
    );
    console.log(`Existing materialized rows: ${existing.rows[0]?.cnt}`);

    const pending = await pool.query<{ unmaterialized: string }>(COUNT_SQL);
    const count = Number(pending.rows[0]?.unmaterialized ?? '0');
    console.log(`Unmaterialized closing-line keys in raw: ${count}`);

    if (!execute) {
      console.log('Dry run. Re-run with --execute to materialize.');
      return;
    }

    if (count === 0) {
      console.log('Nothing to materialize.');
      return;
    }

    const result = await pool.query(MATERIALIZE_SQL);
    console.log(`Materialized ${result.rowCount ?? 0} rows into research.prop_decision_lines.`);

    const total = await pool.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM research.prop_decision_lines`
    );
    console.log(`Total materialized rows: ${total.rows[0]?.cnt}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Materialize script failed:', err);
  process.exit(1);
});
