import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function compareTeams() {
  console.log('\n📊 Comparing Team Game Counts (Completed Games Only)\n');
  
  const teams = await pool.query(`
    SELECT team_id, abbreviation
    FROM teams
    ORDER BY abbreviation
  `);
  
  const teamStats: Array<{
    abbreviation: string;
    completedGames: number;
    gamesWithStats: number;
    coverage: number;
  }> = [];
  
  for (const team of teams.rows) {
    const completed = await pool.query(`
      SELECT COUNT(*) as count
      FROM bbref_games bg
      WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
        AND bg.game_date <= CURRENT_DATE
        AND bg.status = 'Final'
    `, [team.team_id]);
    
    const withStats = await pool.query(`
      SELECT COUNT(DISTINCT btgs.game_id) as count
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE btgs.team_id = $1
        AND btgs.source = 'bbref'
        AND bg.game_date <= CURRENT_DATE
        AND bg.status = 'Final'
    `, [team.team_id]);
    
    const completedCount = parseInt(completed.rows[0].count);
    const statsCount = parseInt(withStats.rows[0].count);
    const coverage = completedCount > 0 ? Math.round((statsCount / completedCount) * 100) : 0;
    
    teamStats.push({
      abbreviation: team.abbreviation,
      completedGames: completedCount,
      gamesWithStats: statsCount,
      coverage
    });
  }
  
  // Sort by completed games
  teamStats.sort((a, b) => b.completedGames - a.completedGames);
  
  console.log('Team | Completed Games | Games with Stats | Coverage');
  console.log('─'.repeat(60));
  
  teamStats.forEach(team => {
    const marker = team.completedGames < 10 ? '⚠️' : team.coverage < 100 ? '⚡' : '✅';
    console.log(
      `${marker} ${team.abbreviation.padEnd(6)} | ${team.completedGames.toString().padStart(3)} | ` +
      `${team.gamesWithStats.toString().padStart(3)} | ${team.coverage}%`
    );
  });
  
  const avgCompleted = Math.round(teamStats.reduce((sum, t) => sum + t.completedGames, 0) / teamStats.length);
  const minCompleted = Math.min(...teamStats.map(t => t.completedGames));
  const maxCompleted = Math.max(...teamStats.map(t => t.completedGames));
  
  console.log(`\n📊 Summary:`);
  console.log(`   Average completed games: ${avgCompleted}`);
  console.log(`   Min: ${minCompleted}, Max: ${maxCompleted}`);
  console.log(`   Utah (UTA): ${teamStats.find(t => t.abbreviation === 'UTA')?.completedGames} completed games`);
  
  const lowGameTeams = teamStats.filter(t => t.completedGames < 10);
  if (lowGameTeams.length > 0) {
    console.log(`\n⚠️  Teams with fewer than 10 completed games:`);
    lowGameTeams.forEach(t => {
      console.log(`   - ${t.abbreviation}: ${t.completedGames} games`);
    });
  }
  
  await pool.end();
}

compareTeams();


