import 'dotenv/config';
import { getBBRefTeamGameStats } from '../lib/teams/bbref-queries';

async function main() {
  try {
    console.log('\n✅ Verifying Nov 1 DAL @ DET Result\n');
    console.log('='.repeat(100));
    
    // Test with Pistons team ID (9)
    const stats = await getBBRefTeamGameStats('9', null);
    
    const nov1Game = stats.find((g: any) => 
      g.game_date_str === '2025-11-01' && 
      (g.home_team === 'DET' || g.away_team === 'DET') &&
      (g.home_team === 'DAL' || g.away_team === 'DAL')
    );
    
    if (nov1Game) {
      console.log('✅ Found Nov 1 game!');
      console.log(`\nDate: ${nov1Game.game_date_str}`);
      console.log(`Matchup: ${nov1Game.away_team} @ ${nov1Game.home_team}`);
      console.log(`Is Home: ${nov1Game.is_home}`);
      console.log(`Team Score: ${nov1Game.team_score}`);
      console.log(`Opponent Score: ${nov1Game.opponent_score}`);
      console.log(`Result: ${nov1Game.result || 'NULL'}`);
      console.log(`Points: ${nov1Game.points}`);
      
      if (nov1Game.result) {
        console.log(`\n✅ Result is showing: ${nov1Game.result} ${nov1Game.team_score}-${nov1Game.opponent_score}`);
      } else {
        console.log(`\n❌ Result is still NULL`);
      }
    } else {
      console.log('❌ Nov 1 game NOT found');
    }
    
    console.log('\n' + '='.repeat(100));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

main();




