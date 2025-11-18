import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

(async () => {
  console.log('Analyzing BallDontLie games to understand the mismatch...\n');

  // Check if BallDontLie games might be duplicates with different dates
  const bdlGames = await pool.query(
    `
    SELECT 
      bdl.game_id,
      bdl.start_time,
      ht.abbreviation as home,
      at.abbreviation as away,
      bdl.home_score,
      bdl.away_score
    FROM games bdl
    JOIN teams ht ON bdl.home_team_id = ht.team_id
    JOIN teams at ON bdl.away_team_id = at.team_id
    WHERE bdl.game_id LIKE '184%'
      AND bdl.status = 'Final'
      AND EXTRACT(MONTH FROM bdl.start_time AT TIME ZONE 'America/New_York') = 11
      AND EXTRACT(YEAR FROM bdl.start_time AT TIME ZONE 'America/New_York') = 2025
      AND NOT EXISTS (SELECT 1 FROM player_game_stats WHERE game_id = bdl.game_id)
    ORDER BY bdl.start_time
    LIMIT 5
    `
  );

  console.log('Sample BallDontLie games without stats:');
  for (const bdl of bdlGames.rows) {
    console.log(`\n${bdl.game_id}: ${bdl.away} @ ${bdl.home} on ${bdl.start_time.toISOString().split('T')[0]} (${bdl.home_score}-${bdl.away_score})`);
    
    // Check for NBA Stats games with same teams within 3 days
    const nearbyNBA = await pool.query(
      `
      SELECT 
        nba.game_id,
        nba.start_time,
        nba.home_score,
        nba.away_score,
        (SELECT COUNT(*) FROM player_game_stats WHERE game_id = nba.game_id) as has_stats
      FROM games nba
      JOIN teams nba_home ON nba.home_team_id = nba_home.team_id
      JOIN teams nba_away ON nba.away_team_id = nba_away.team_id
      WHERE nba.game_id LIKE '002%'
        AND nba_home.abbreviation = $1
        AND nba_away.abbreviation = $2
        AND ABS(EXTRACT(EPOCH FROM (nba.start_time - $3))) < 259200  -- Within 3 days
      ORDER BY ABS(EXTRACT(EPOCH FROM (nba.start_time - $3)))
      LIMIT 3
      `,
      [bdl.home, bdl.away, bdl.start_time]
    );
    
    if (nearbyNBA.rows.length > 0) {
      console.log(`  Nearby NBA Stats games:`);
      nearbyNBA.rows.forEach(nba => {
        const daysDiff = Math.abs((new Date(nba.start_time).getTime() - new Date(bdl.start_time).getTime()) / (1000 * 60 * 60 * 24));
        console.log(`    ${nba.game_id}: ${nba.start_time.toISOString().split('T')[0]} (${daysDiff.toFixed(1)} days diff, has stats: ${nba.has_stats > 0})`);
      });
    } else {
      console.log(`  No nearby NBA Stats games found`);
    }
  }

  await pool.end();
})();


