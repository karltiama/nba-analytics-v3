import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  console.log('--- SENTIMENT DIAGNOSTIC ---');

  // 1. Injuries
  const injuries = await pool.query('SELECT count(*) FROM analytics.player_injury_status_current');
  console.log('Injuries in DB:', injuries.rows[0].count);

  // 2. High Scoring Players
  const highScorers = await pool.query('SELECT count(*) FROM analytics.player_season_averages WHERE pts_avg > 25');
  console.log('Players > 25 PPG:', highScorers.rows[0].count);

  // 3. Back-to-Back (Check yesterday - today is 2026-04-01)
  const gamesYesterday = await pool.query("SELECT count(*) FROM analytics.games WHERE game_date = '2026-03-31'");
  console.log('Games Played Yesterday:', gamesYesterday.rows[0].count);

  // 4. Team Averages (For Defense)
  const teamAvgs = await pool.query('SELECT count(*) FROM analytics.team_season_averages');
  console.log('Team Averages Rows:', teamAvgs.rows[0].count);

  // 5. Sample Prop Row Check
  const sampleProp = await pool.query(`
    SELECT p.player_name, p.team_id, g.home_team_id, g.away_team_id
    FROM analytics.player_props_current p
    INNER JOIN analytics.games g ON g.game_id = p.game_id::text
    LIMIT 1
  `);
  console.log('\nSample Prop Row:', sampleProp.rows[0]);

  await pool.end();
}

main();
