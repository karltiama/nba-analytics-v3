import 'dotenv/config';
import { getBBRefTeamGameStats } from '../lib/teams/bbref-queries';

async function main() {
  try {
    console.log('\n🔍 Testing Team ID Resolution\n');
    console.log('='.repeat(100));
    
    // Test with NBA numeric ID (what URL might use)
    console.log('\n1️⃣ Testing with NBA numeric ID: 1610612765');
    console.log('-'.repeat(100));
    try {
      const result1 = await getBBRefTeamGameStats('1610612765', 5);
      console.log(`✅ Found ${result1.length} games`);
      result1.forEach((game: any, i: number) => {
        console.log(`  ${i + 1}. ${game.game_date_str} - ${game.away_team} @ ${game.home_team}`);
      });
    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    // Test with database ID
    console.log('\n2️⃣ Testing with database ID: 9');
    console.log('-'.repeat(100));
    try {
      const result2 = await getBBRefTeamGameStats('9', 5);
      console.log(`✅ Found ${result2.length} games`);
      result2.forEach((game: any, i: number) => {
        console.log(`  ${i + 1}. ${game.game_date_str} - ${game.away_team} @ ${game.home_team}`);
      });
    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    // Check specifically for Nov 1 game
    console.log('\n3️⃣ Checking for Nov 1 DAL @ DET game');
    console.log('-'.repeat(100));
    const allGames = await getBBRefTeamGameStats('1610612765', null);
    const nov1Game = allGames.find((g: any) => 
      g.game_date_str === '2025-11-01' && 
      (g.home_team === 'DET' || g.away_team === 'DET') &&
      (g.home_team === 'DAL' || g.away_team === 'DAL')
    );
    
    if (nov1Game) {
      console.log('✅ Found Nov 1 game!');
      console.log(`   Date: ${nov1Game.game_date_str}`);
      console.log(`   Matchup: ${nov1Game.away_team} @ ${nov1Game.home_team}`);
      console.log(`   Result: ${nov1Game.result} ${nov1Game.team_score}-${nov1Game.opponent_score}`);
      console.log(`   Points: ${nov1Game.points}`);
    } else {
      console.log('❌ Nov 1 game NOT found');
      console.log(`   Total games found: ${allGames.length}`);
      if (allGames.length > 0) {
        console.log('   Sample dates:');
        allGames.slice(0, 5).forEach((g: any) => {
          console.log(`     - ${g.game_date_str}: ${g.away_team} @ ${g.home_team}`);
        });
      }
    }
    
    console.log('\n' + '='.repeat(100));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

main();






