import 'dotenv/config';
import { Pool } from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL missing');

async function main() {
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const game = await pool.query(
      `SELECT g.game_id::text,
              g.start_time,
              g.season,
              ht.abbreviation AS home_abbr,
              at.abbreviation AS away_abbr,
              g.home_team_id::text AS home_team_id,
              g.away_team_id::text AS away_team_id
         FROM analytics.games g
         JOIN analytics.teams ht ON ht.team_id = g.home_team_id
         JOIN analytics.teams at ON at.team_id = g.away_team_id
        WHERE g.game_id = $1`,
      ['18447934'],
    );
    const rows = await pool.query(
      `
      SELECT p.full_name,
             m.player_id::text AS player_id,
             m.prop_type,
             m.vendor,
             m.reference_line::text AS three_hour_line,
             m.comparison_line::text AS close_line,
             m.reference_over_odds,
             m.comparison_over_odds
        FROM analytics.player_prop_market_movement m
        JOIN analytics.players p ON p.player_id = m.player_id
       WHERE m.game_id = $1
         AND m.vendor = 'draftkings'
         AND m.prop_type = ANY($2::text[])
         AND m.reference_line IS NOT NULL
         AND m.comparison_line IS NOT NULL
       ORDER BY p.full_name, m.prop_type
       LIMIT 80
      `,
      ['18447934', ['points', 'assists', 'rebounds']],
    );
    process.stdout.write(
      JSON.stringify({ game: game.rows[0] ?? null, n: rows.rowCount, rows: rows.rows }, null, 2),
    );
    process.stdout.write('\n');
  } finally {
    await pool.end();
  }
}

void main();
