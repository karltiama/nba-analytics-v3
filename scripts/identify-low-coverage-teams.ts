import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function identifyLowCoverageTeams() {
  console.log('\n🔍 Identifying Teams Below 75% Coverage (Completed Games Only)\n');
  
  // Get all teams
  const teams = await pool.query(`
    SELECT team_id, abbreviation, full_name
    FROM teams
    ORDER BY abbreviation
  `);
  
  const lowCoverageTeams: Array<{
    team: string;
    abbreviation: string;
    totalGames: number;
    gamesWithStats: number;
    coverage: number;
    missingGames: Array<{ game_id: string; game_date: string; opponent: string; is_home: boolean }>;
  }> = [];
  
  for (const team of teams.rows) {
    // Get completed games count
    const completedGames = await pool.query(`
      SELECT COUNT(*) as total
      FROM bbref_games bg
      WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
        AND bg.game_date <= CURRENT_DATE
        AND bg.status = 'Final'
    `, [team.team_id]);
    
    const totalGames = parseInt(completedGames.rows[0].total);
    
    if (totalGames === 0) continue;
    
    // Get games with stats
    const gamesWithStats = await pool.query(`
      SELECT COUNT(DISTINCT btgs.game_id) as count
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE btgs.team_id = $1
        AND bg.game_date <= CURRENT_DATE
        AND bg.status = 'Final'
    `, [team.team_id]);
    
    const withStats = parseInt(gamesWithStats.rows[0].count);
    const coverage = Math.round((withStats / totalGames) * 100);
    
    if (coverage < 75) {
      // Get missing games
      const missingGames = await pool.query(`
        SELECT 
          bg.bbref_game_id,
          bg.game_date::text as game_date,
          CASE 
            WHEN bg.home_team_id = $1 THEN ht.abbreviation
            ELSE at.abbreviation
          END as opponent,
          bg.home_team_id = $1 as is_home
        FROM bbref_games bg
        LEFT JOIN teams ht ON bg.home_team_id = ht.team_id
        LEFT JOIN teams at ON bg.away_team_id = at.team_id
        WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
          AND bg.game_date <= CURRENT_DATE
          AND bg.status = 'Final'
          AND NOT EXISTS (
            SELECT 1 FROM bbref_team_game_stats btgs
            WHERE btgs.game_id = bg.bbref_game_id
              AND btgs.team_id = $1
          )
        ORDER BY bg.game_date ASC
      `, [team.team_id]);
      
      lowCoverageTeams.push({
        team: team.full_name,
        abbreviation: team.abbreviation,
        totalGames,
        gamesWithStats: withStats,
        coverage,
        missingGames: missingGames.rows.map((r: any) => ({
          game_id: r.bbref_game_id,
          game_date: r.game_date,
          opponent: r.opponent,
          is_home: r.is_home
        }))
      });
    }
  }
  
  // Sort by coverage (lowest first)
  lowCoverageTeams.sort((a, b) => a.coverage - b.coverage);
  
  console.log(`Found ${lowCoverageTeams.length} teams below 75% coverage:\n`);
  console.log('Team | Coverage | Completed Games | Missing Games');
  console.log('─'.repeat(70));
  
  let totalMissingGames = 0;
  const allMissingGameIds: string[] = [];
  
  for (const team of lowCoverageTeams) {
    console.log(
      `${team.abbreviation.padEnd(6)} | ${team.coverage.toString().padStart(3)}% | ` +
      `${team.gamesWithStats}/${team.totalGames} | ${team.missingGames.length}`
    );
    totalMissingGames += team.missingGames.length;
    team.missingGames.forEach(g => {
      if (!allMissingGameIds.includes(g.game_id)) {
        allMissingGameIds.push(g.game_id);
      }
    });
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Teams below 75%: ${lowCoverageTeams.length}`);
  console.log(`   Total missing games: ${totalMissingGames}`);
  console.log(`   Unique games to scrape: ${allMissingGameIds.length}`);
  
  console.log(`\n📋 Missing Games by Team:\n`);
  for (const team of lowCoverageTeams) {
    console.log(`${team.abbreviation} (${team.coverage}% coverage):`);
    team.missingGames.forEach(game => {
      const vs = game.is_home ? 'vs' : '@';
      console.log(`   - ${game.game_date} ${vs} ${game.opponent} (${game.game_id})`);
    });
    console.log('');
  }
  
  console.log(`\n💡 To scrape these games, run:`);
  console.log(`   npx tsx scripts/batch-scrape-missing-bbref-games.ts --game-ids ${allMissingGameIds.join(',')}`);
  
  await pool.end();
}

identifyLowCoverageTeams();
