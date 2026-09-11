/**
 * Transform raw.player_prop_snapshots -> analytics.player_prop_lines.
 * Flattens over_under markets into one row per side (over/under) with decimal odds and implied probability.
 * Idempotent — safe to run multiple times (ON CONFLICT DO NOTHING).
 *
 * Prerequisites: analytics_player_prop_lines_schema.sql applied.
 * Env: SUPABASE_DB_URL
 *
 * Usage:
 *   npx tsx scripts/transform-raw-player-props-to-lines.ts
 *   npx tsx scripts/transform-raw-player-props-to-lines.ts --pull-run-id 42
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { gateIngestIdentitiesFromDb } from '@/lib/identity/apply-ingest-gate';
import type { SqlQuery } from '@/lib/identity/player-identity-store';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const args = process.argv.slice(2);
const pullRunIdArg = args.includes('--pull-run-id')
  ? parseInt(args[args.indexOf('--pull-run-id') + 1], 10)
  : null;

async function main() {
  console.log('=== Transform: raw.player_prop_snapshots -> analytics.player_prop_lines ===');
  if (pullRunIdArg) console.log(`Filtering to pull_run_id: ${pullRunIdArg}`);

  const pullFilter = pullRunIdArg ? 'AND s.pull_run_id = $1' : '';
  const params: unknown[] = pullRunIdArg ? [pullRunIdArg] : [];

  const client = await pool.connect();
  try {
    const sqlQuery: SqlQuery = (text, params) => client.query(text, params);
    const idResult = await client.query<{ player_id: string }>(
      `SELECT DISTINCT s.player_id::text AS player_id
       FROM raw.player_prop_snapshots s
       WHERE s.game_id IN (SELECT game_id FROM analytics.games)
         ${pullFilter}`,
      params
    );
    const identityGate = await gateIngestIdentitiesFromDb({
      query: sqlQuery,
      provider: 'balldontlie',
      sourceContext: 'PLAYER_PROP',
      providerPlayerIds: idResult.rows.map((row) => row.player_id),
      observedAt: new Date().toISOString(),
      persistQuarantine: true,
    });
    const servingIds = [...identityGate.servingIds];
    const servingIdx = params.length + 1;
    const servingFilter = `AND s.player_id = ANY($${servingIdx}::text[])`;
    const insertParams = [...params, servingIds];
    const result = await client.query(
      `INSERT INTO analytics.player_prop_lines (
         game_id, player_id, player_name, team_id, sportsbook, market_type, side, line_value,
         odds_american, odds_decimal, implied_probability, snapshot_at
       )
       SELECT
         s.game_id, s.player_id, p.full_name, gl.team_id, s.vendor, s.prop_type,
         'over', s.line_value, s.over_odds,
         analytics.american_to_decimal(s.over_odds),
         analytics.american_to_implied_prob(s.over_odds),
         COALESCE(s.provider_updated_at, s.created_at)
       FROM raw.player_prop_snapshots s
       LEFT JOIN analytics.players p ON p.player_id = s.player_id
       LEFT JOIN analytics.player_game_logs gl ON gl.game_id = s.game_id AND gl.player_id = s.player_id
       WHERE s.market_type = 'over_under' AND s.over_odds IS NOT NULL
         AND s.game_id IN (SELECT game_id FROM analytics.games)
         ${servingFilter}
         ${pullFilter}

       UNION ALL

       SELECT
         s.game_id, s.player_id, p.full_name, gl.team_id, s.vendor, s.prop_type,
         'under', s.line_value, s.under_odds,
         analytics.american_to_decimal(s.under_odds),
         analytics.american_to_implied_prob(s.under_odds),
         COALESCE(s.provider_updated_at, s.created_at)
       FROM raw.player_prop_snapshots s
       LEFT JOIN analytics.players p ON p.player_id = s.player_id
       LEFT JOIN analytics.player_game_logs gl ON gl.game_id = s.game_id AND gl.player_id = s.player_id
       WHERE s.market_type = 'over_under' AND s.under_odds IS NOT NULL
         AND s.game_id IN (SELECT game_id FROM analytics.games)
         ${servingFilter}
         ${pullFilter}

       ON CONFLICT (game_id, player_id, sportsbook, market_type, side, line_value, snapshot_at) DO NOTHING`,
      insertParams
    );
    console.log(`Inserted ${result.rowCount ?? 0} rows into analytics.player_prop_lines`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Transform failed:', err);
  pool.end().finally(() => process.exit(1));
});
