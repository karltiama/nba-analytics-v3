// Load .env from parent directory BEFORE any other imports
const path = require('path');
const fs = require('fs');
const rootEnv = path.join(__dirname, '../../.env');
if (fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
} else {
  require('dotenv').config();
}

// Now import db (which requires env vars)
import { query } from '../../lib/db';

async function verify() {
  try {
    // Check recent staging events
    const recent = await query(
      `SELECT COUNT(*) as count, MAX(fetched_at) as latest 
       FROM staging_events 
       WHERE source = $1 AND fetched_at > NOW() - INTERVAL '10 minutes'`,
      ['oddsapi']
    );
    console.log('Recent staging events:', recent[0]);

    // Check recent markets
    const markets = await query(
      `SELECT COUNT(*) as count, COUNT(DISTINCT game_id) as games, bookmaker 
       FROM markets 
       WHERE snapshot_type = $1 AND fetched_at > NOW() - INTERVAL '10 minutes'
       GROUP BY bookmaker`,
      ['pre_game']
    );
    console.log('\nRecent markets by bookmaker:');
    markets.forEach((m: any) => {
      console.log(`  ${m.bookmaker}: ${m.count} markets for ${m.games} games`);
    });

    // Check today's games with odds
    const gamesWithOdds = await query(
      `SELECT 
         COUNT(DISTINCT bs.bbref_game_id) as total_games,
         COUNT(DISTINCT m.game_id) as games_with_odds
       FROM bbref_schedule bs
       LEFT JOIN markets m ON (m.game_id = bs.canonical_game_id OR m.game_id = bs.bbref_game_id)
         AND m.snapshot_type = 'pre_game'
         AND m.fetched_at > NOW() - INTERVAL '10 minutes'
       WHERE bs.game_date = CURRENT_DATE`
    );
    console.log('\nToday\'s games:');
    console.log(`  Total games: ${gamesWithOdds[0].total_games}`);
    console.log(`  Games with odds: ${gamesWithOdds[0].games_with_odds}`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

verify();

