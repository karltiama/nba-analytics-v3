import 'dotenv/config';
import { Pool } from 'pg';
import { getBBRefTeamSeasonStats } from '../lib/teams/bbref-queries';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    // Get Detroit Pistons team_id
    const teamResult = await pool.query(
      `SELECT team_id, abbreviation, full_name FROM teams WHERE abbreviation = 'DET' LIMIT 1`
    );
    
    if (teamResult.rows.length === 0) {
      console.log('❌ Detroit Pistons not found');
      return;
    }
    
    const team = teamResult.rows[0];
    console.log(`\n🏀 ${team.full_name} (${team.abbreviation}) - BBRef Season Stats\n`);
    console.log('='.repeat(80));
    
    const stats = await getBBRefTeamSeasonStats(team.team_id);
    
    if (!stats || !stats.games_played) {
      console.log('No BBRef stats found for Detroit Pistons');
      return;
    }
    
    const gamesPlayed = Number(stats.games_played);
    const avgPoints = Number(stats.avg_points || 0);
    const avgPointsAgainst = Number(stats.avg_points_against || 0);
    const scoringDiff = Number(stats.scoring_differential || 0);
    
    console.log('\n📊 OVERVIEW');
    console.log('-'.repeat(80));
    console.log(`Games Played:        ${gamesPlayed}`);
    console.log(`Points Per Game:     ${avgPoints.toFixed(1)}`);
    console.log(`Points Against:      ${avgPointsAgainst.toFixed(1)}`);
    console.log(`Scoring Differential: ${scoringDiff > 0 ? '+' : ''}${scoringDiff.toFixed(1)}`);
    
    console.log('\n🎯 SHOOTING STATS');
    console.log('-'.repeat(80));
    console.log(`Field Goal %:        ${Number(stats.fg_pct || 0).toFixed(1)}%`);
    console.log(`FGM/FGA (Avg):       ${Number(stats.avg_fgm || 0).toFixed(1)} / ${Number(stats.avg_fga || 0).toFixed(1)}`);
    console.log(`FGM/FGA (Total):     ${Number(stats.total_fgm || 0)} / ${Number(stats.total_fga || 0)}`);
    console.log(`3-Point %:           ${Number(stats.three_pct || 0).toFixed(1)}%`);
    console.log(`3PM/3PA (Avg):      ${Number(stats.avg_3pm || 0).toFixed(1)} / ${Number(stats.avg_3pa || 0).toFixed(1)}`);
    console.log(`3PM/3PA (Total):    ${Number(stats.total_3pm || 0)} / ${Number(stats.total_3pa || 0)}`);
    console.log(`Free Throw %:        ${Number(stats.ft_pct || 0).toFixed(1)}%`);
    console.log(`FTM/FTA (Avg):      ${Number(stats.avg_ftm || 0).toFixed(1)} / ${Number(stats.avg_fta || 0).toFixed(1)}`);
    console.log(`FTM/FTA (Total):    ${Number(stats.total_ftm || 0)} / ${Number(stats.total_fta || 0)}`);
    
    console.log('\n📈 OTHER STATS (Per Game Averages)');
    console.log('-'.repeat(80));
    console.log(`Rebounds:            ${Number(stats.avg_rebounds || 0).toFixed(1)}`);
    console.log(`  Offensive:         ${Number(stats.avg_orb || 0).toFixed(1)}`);
    console.log(`  Defensive:         ${Number(stats.avg_drb || 0).toFixed(1)}`);
    console.log(`Assists:             ${Number(stats.avg_assists || 0).toFixed(1)}`);
    console.log(`Steals:              ${Number(stats.avg_steals || 0).toFixed(1)}`);
    console.log(`Blocks:              ${Number(stats.avg_blocks || 0).toFixed(1)}`);
    console.log(`Turnovers:           ${Number(stats.avg_turnovers || 0).toFixed(1)}`);
    console.log(`Personal Fouls:      ${Number(stats.avg_pf || 0).toFixed(1)}`);
    console.log(`Possessions:         ${Number(stats.avg_possessions || 0).toFixed(1)}`);
    
    console.log('\n📊 SEASON TOTALS');
    console.log('-'.repeat(80));
    console.log(`Total Points:        ${Number(stats.total_points || 0)}`);
    console.log(`Total Rebounds:      ${Number(stats.total_rebounds || 0)}`);
    console.log(`Total Assists:       ${Number(stats.total_assists || 0)}`);
    console.log(`Total Steals:        ${Number(stats.total_steals || 0)}`);
    console.log(`Total Blocks:        ${Number(stats.total_blocks || 0)}`);
    console.log(`Total Turnovers:     ${Number(stats.total_turnovers || 0)}`);
    console.log(`Total Personal Fouls: ${Number(stats.total_pf || 0)}`);
    
    console.log('\n' + '='.repeat(80));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();


