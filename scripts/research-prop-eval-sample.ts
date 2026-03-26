/**
 * Sample query against research.v_prop_eval_units (same filters as the API).
 *
 *   npx tsx scripts/research-prop-eval-sample.ts
 *   npx tsx scripts/research-prop-eval-sample.ts --after 2025-01-01 --before 2025-04-01 --limit 20
 */
import 'dotenv/config';
import { Pool } from 'pg';

function parseArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  const after = parseArg('--after');
  const before = parseArg('--before');
  const limit = Math.min(500, Math.max(1, parseInt(parseArg('--limit') ?? '25', 10) || 25));

  const conditions: string[] = [];
  const params: unknown[] = [];
  let n = 1;
  if (after && /^\d{4}-\d{2}-\d{2}$/.test(after)) {
    conditions.push(`game_date >= $${n}::date`);
    params.push(after);
    n++;
  }
  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
    conditions.push(`game_date < $${n}::date`);
    params.push(before);
    n++;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT game_id, player_id, prop_type, side, line_value, stat_actual, bet_won, game_date
     FROM research.v_prop_eval_units
     ${where}
     ORDER BY game_date DESC NULLS LAST
     LIMIT $${n}`,
    [...params, limit]
  );

  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
