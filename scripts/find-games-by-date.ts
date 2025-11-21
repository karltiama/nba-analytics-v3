import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function findGamesByDate(date: string) {
  console.log(`\nFinding games for ${date}...\n`);
  
  // Check bbref_schedule first
  const bbrefResult = await pool.query(`
    SELECT 
      canonical_game_id,
      game_date,
      home_team_abbr,
      away_team_abbr,
      bbref_game_id
    FROM bbref_schedule
    WHERE game_date = $1::date
    ORDER BY game_date, home_team_abbr
  `, [date]);
  
  if (bbrefResult.rows.length > 0) {
    console.log(`Found ${bbrefResult.rows.length} games in bbref_schedule:\n`);
    bbrefResult.rows.forEach((r, i) => {
      console.log(`${i + 1}. ${r.away_team_abbr} @ ${r.home_team_abbr}`);
      console.log(`   Game ID: ${r.canonical_game_id || 'N/A'}`);
      console.log(`   BBRef ID: ${r.bbref_game_id}`);
      console.log('');
    });
    return bbrefResult.rows.map(r => r.canonical_game_id).filter(Boolean);
  }
  
  // Fallback to games table
  const gamesResult = await pool.query(`
    SELECT 
      g.game_id,
      DATE(g.start_time AT TIME ZONE 'America/New_York') as game_date,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE DATE(g.start_time AT TIME ZONE 'America/New_York') = $1::date
    ORDER BY g.start_time
  `, [date]);
  
  if (gamesResult.rows.length > 0) {
    console.log(`Found ${gamesResult.rows.length} games in games table:\n`);
    gamesResult.rows.forEach((r, i) => {
      console.log(`${i + 1}. ${r.away_abbr} @ ${r.home_abbr}`);
      console.log(`   Game ID: ${r.game_id}`);
      console.log('');
    });
    return gamesResult.rows.map(r => r.game_id);
  }
  
  console.log('No games found for this date.');
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  const date = args[0] || '2025-10-21';
  
  try {
    const gameIds = await findGamesByDate(date);
    
    if (gameIds.length > 0) {
      console.log(`\nGame IDs to scrape:\n${gameIds.join('\n')}\n`);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

