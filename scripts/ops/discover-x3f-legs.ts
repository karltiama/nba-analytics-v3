import 'dotenv/config';
import { Pool } from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL missing');

async function main() {
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const rows = await pool.query(
      `
      SELECT p.full_name,
             m.player_id::text AS player_id,
             m.prop_type,
             m.vendor,
             m.reference_kind,
             m.reference_line::text,
             m.reference_over_odds,
             m.reference_under_odds,
             m.reference_timestamp,
             m.comparison_kind,
             m.comparison_line::text,
             m.comparison_over_odds,
             m.comparison_under_odds,
             m.comparison_timestamp
        FROM analytics.player_prop_market_movement m
        JOIN analytics.players p ON p.player_id = m.player_id
       WHERE m.game_id = $1
         AND m.vendor = 'draftkings'
         AND (
           (m.player_id = $2 AND m.prop_type = ANY($3::text[]))
           OR (m.player_id = $4 AND m.prop_type = 'points')
           OR (m.player_id = $5 AND m.prop_type = 'points')
         )
       ORDER BY p.full_name, m.prop_type
      `,
      ['18447934', '1028037477', ['points', 'assists'], '666541', '132'],
    );
    const names = await pool.query(
      `SELECT player_id::text, full_name, first_name, last_name, player_entity_id::text AS entity_id
         FROM analytics.players
        WHERE player_id::text = ANY($1::text[])`,
      [['1028037477', '666541', '132']],
    );
    process.stdout.write(JSON.stringify({ players: names.rows, rows: rows.rows }, null, 2));
    process.stdout.write('\n');
  } finally {
    await pool.end();
  }
}

void main();
