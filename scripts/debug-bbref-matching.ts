import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function debugMatching() {
  // Get a few bbref games
  const bbrefGames = await pool.query(`
    SELECT 
      g.game_id,
      DATE(g.start_time AT TIME ZONE 'America/New_York') as game_date,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      g.start_time
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.game_id LIKE 'bbref_%'
    ORDER BY g.start_time DESC
    LIMIT 5
  `);
  
  console.log('Checking bbref games for matches:\n');
  
  for (const bbref of bbrefGames.rows) {
    console.log(`\nBbref game: ${bbref.game_id}`);
    console.log(`  Date: ${bbref.game_date}`);
    console.log(`  Matchup: ${bbref.away_abbr} @ ${bbref.home_abbr}`);
    
    // Try to find matches
    const matches = await pool.query(`
      SELECT 
        g.game_id,
        DATE(g.start_time AT TIME ZONE 'America/New_York') as game_date,
        ht.abbreviation as home_abbr,
        at.abbreviation as away_abbr,
        CASE 
          WHEN g.game_id LIKE '002%' THEN 'NBA Stats'
          WHEN g.game_id LIKE '184%' THEN 'BallDontLie'
          ELSE 'Other'
        END as source
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE DATE(g.start_time AT TIME ZONE 'America/New_York') = $1::date
        AND (g.game_id LIKE '002%' OR g.game_id LIKE '184%')
      ORDER BY g.game_id
    `, [bbref.game_date]);
    
    console.log(`  Found ${matches.rows.length} games on this date:`);
    matches.rows.forEach(m => {
      console.log(`    ${m.game_id} (${m.source}): ${m.away_abbr} @ ${m.home_abbr}`);
      
      // Check if teams match
      const teamsMatch = (m.home_abbr === bbref.home_abbr && m.away_abbr === bbref.away_abbr) ||
                         (m.home_abbr === bbref.away_abbr && m.away_abbr === bbref.home_abbr);
      if (teamsMatch) {
        console.log(`      -> MATCH!`);
      } else {
        console.log(`      -> No match (teams don't match)`);
      }
    });
    
    // Also check if teams are swapped
    const swappedMatch = await pool.query(`
      SELECT 
        g.game_id,
        CASE 
          WHEN g.game_id LIKE '002%' THEN 'NBA Stats'
          WHEN g.game_id LIKE '184%' THEN 'BallDontLie'
          ELSE 'Other'
        END as source
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE DATE(g.start_time AT TIME ZONE 'America/New_York') = $1::date
        AND ht.abbreviation = $2
        AND at.abbreviation = $3
        AND (g.game_id LIKE '002%' OR g.game_id LIKE '184%')
      LIMIT 1
    `, [bbref.game_date, bbref.away_abbr, bbref.home_abbr]);
    
    if (swappedMatch.rows.length > 0) {
      console.log(`  Found match with swapped teams: ${swappedMatch.rows[0].game_id} (${swappedMatch.rows[0].source})`);
    }
  }
  
  await pool.end();
}

debugMatching().catch(console.error);

