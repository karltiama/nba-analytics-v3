/**
 * Read-only coverage + one redacted example for STEP 14P.X3B.
 * Prints aggregates and one market row. No outcomes. No writes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { HISTORICAL_REPLAY_COVERAGE_SQL } from '@/lib/parlay-xray/replay/sql';

function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    let text = '';
    try {
      text = readFileSync(join(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eq = line.indexOf('=');
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes('--run')) {
    console.error('Refusing to run without --run');
    process.exit(2);
  }
  loadEnv();
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('Missing SUPABASE_DB_URL');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const coverage = await pool.query(HISTORICAL_REPLAY_COVERAGE_SQL);
    const vendors = await pool.query(
      `SELECT vendor, count(*)::int AS n FROM analytics.player_prop_market_movement GROUP BY vendor ORDER BY vendor`
    );
    const markets = await pool.query(
      `SELECT prop_type, count(*)::int AS n FROM analytics.player_prop_market_movement GROUP BY prop_type ORDER BY prop_type`
    );
    const example = await pool.query(
      `SELECT m.game_id, p.full_name, m.prop_type, m.vendor,
              m.reference_kind, m.reference_line, m.reference_over_odds, m.reference_timestamp,
              m.comparison_kind, m.comparison_line, m.comparison_over_odds, m.comparison_timestamp
       FROM analytics.player_prop_market_movement m
       LEFT JOIN analytics.players p ON p.player_id = m.player_id
       WHERE m.prop_type = 'points'
         AND m.vendor = 'draftkings'
         AND m.reference_line IS NOT NULL
         AND m.comparison_line IS NOT NULL
       ORDER BY m.game_id, p.full_name
       LIMIT 1`
    );
    console.log(
      JSON.stringify(
        {
          coverage: coverage.rows[0],
          vendors: vendors.rows,
          markets: markets.rows,
          example: example.rows[0] ?? null,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
