import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkTeamCoverage() {
  console.log('\n📊 Team Coverage for Completed Games (as of today)\n');
  
  const teams = await pool.query(`
    SELECT team_id, abbreviation, full_name
    FROM teams
    ORDER BY abbreviation
  `);
  
  const teamCoverage: Array<{
    abbreviation: string;
    totalGames: number;
    gamesWithStats: number;
    coverage: number;
  }> = [];
  
  for (const team of teams.rows) {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_games,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM bbref_team_game_stats btgs
          WHERE btgs.game_id = bg.bbref_game_id
            AND btgs.team_id = $1
        ) THEN 1 END) as games_with_stats
      FROM bbref_games bg
      WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
        AND bg.game_date <= CURRENT_DATE
        AND bg.status = 'Final'
    `, [team.team_id]);
    
    const total = parseInt(stats.rows[0].total_games);
    const withStats = parseInt(stats.rows[0].games_with_stats);
    const coverage = total > 0 ? Math.round((withStats / total) * 100) : 0;
    
    if (total > 0) {
      teamCoverage.push({
        abbreviation: team.abbreviation,
        totalGames: total,
        gamesWithStats: withStats,
        coverage
      });
    }
  }
  
  teamCoverage.sort((a, b) => a.coverage - b.coverage);
  
  console.log('Team | Coverage | Games with Stats / Total');
  console.log('─'.repeat(50));
  
  const below75 = teamCoverage.filter(t => t.coverage < 75);
  const below80 = teamCoverage.filter(t => t.coverage < 80);
  
  for (const team of teamCoverage) {
    const marker = team.coverage < 75 ? ' ⚠️' : team.coverage < 80 ? ' ⚡' : '';
    console.log(
      `${team.abbreviation.padEnd(6)} | ${team.coverage.toString().padStart(3)}% | ` +
      `${team.gamesWithStats}/${team.totalGames}${marker}`
    );
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Teams below 75%: ${below75.length}`);
  console.log(`   Teams below 80%: ${below80.length}`);
  console.log(`   Average coverage: ${Math.round(teamCoverage.reduce((sum, t) => sum + t.coverage, 0) / teamCoverage.length)}%`);
  
  if (below75.length > 0) {
    console.log(`\n⚠️  Teams below 75%:`);
    below75.forEach(t => {
      console.log(`   - ${t.abbreviation}: ${t.coverage}% (${t.gamesWithStats}/${t.totalGames})`);
    });
  }
  
  if (below80.length > 0 && below75.length === 0) {
    console.log(`\n⚡ Teams below 80%:`);
    below80.forEach(t => {
      console.log(`   - ${t.abbreviation}: ${t.coverage}% (${t.gamesWithStats}/${t.totalGames})`);
    });
  }
  
  await pool.end();
}

checkTeamCoverage();

