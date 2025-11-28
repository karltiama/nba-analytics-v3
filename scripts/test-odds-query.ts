import 'dotenv/config';
import { query } from '@/lib/db';
import { getGamesOdds } from '@/lib/betting/queries';

async function test() {
  console.log('=== Testing Odds Query ===\n');

  // Get today's games
  const games = await query(`
    SELECT bbref_game_id, canonical_game_id, home_team_abbr, away_team_abbr
    FROM bbref_schedule
    WHERE game_date = CURRENT_DATE
    LIMIT 5
  `);

  console.log(`Found ${games.length} games today:\n`);
  games.forEach((g: any) => {
    console.log(`  ${g.away_team_abbr} @ ${g.home_team_abbr}`);
    console.log(`    bbref_game_id: ${g.bbref_game_id}`);
    console.log(`    canonical_game_id: ${g.canonical_game_id || 'null'}`);
  });

  // Check what game_ids we have in markets
  console.log('\n=== Markets Table ===\n');
  const markets = await query(`
    SELECT DISTINCT game_id, bookmaker, COUNT(*) as markets
    FROM markets
    WHERE snapshot_type = 'pre_game'
    GROUP BY game_id, bookmaker
    ORDER BY game_id, bookmaker
    LIMIT 10
  `);

  console.log(`Found ${markets.length} games with odds:\n`);
  markets.forEach((m: any) => {
    console.log(`  game_id: ${m.game_id}, bookmaker: ${m.bookmaker}, markets: ${m.markets}`);
  });

  // Try to get odds for first game
  if (games.length > 0) {
    const firstGame = games[0];
    const gameId = firstGame.canonical_game_id || firstGame.bbref_game_id;
    
    console.log(`\n=== Testing getGamesOdds for: ${gameId} ===\n`);
    const oddsMap = await getGamesOdds([gameId]);
    const odds = oddsMap[gameId];
    
    if (odds) {
      console.log('Odds found:');
      console.log(`  Bookmaker: ${odds.bookmaker}`);
      console.log(`  Home ML: ${odds.home.moneyline}`);
      console.log(`  Away ML: ${odds.away.moneyline}`);
      console.log(`  Home Spread: ${odds.home.spread}`);
      console.log(`  Away Spread: ${odds.away.spread}`);
      console.log(`  Total: ${odds.overUnder}`);
    } else {
      console.log('No odds found for this game');
    }
  }

  process.exit(0);
}

test().catch(console.error);

