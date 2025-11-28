import 'dotenv/config';
import { query } from '@/lib/db';

async function check() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  
  const games = await query(`
    SELECT 
      COALESCE(bs.canonical_game_id, bs.bbref_game_id) as game_id,
      bs.bbref_game_id,
      bs.canonical_game_id,
      bs.home_team_abbr,
      bs.away_team_abbr
    FROM bbref_schedule bs
    WHERE bs.game_date = $1::date
    ORDER BY game_id
  `, [today]);

  console.log(`Found ${games.length} games for ${today}\n`);

  // Check for duplicates
  const gameIdCounts: Record<string, number> = {};
  games.forEach((g: any) => {
    gameIdCounts[g.game_id] = (gameIdCounts[g.game_id] || 0) + 1;
  });

  const duplicates = Object.entries(gameIdCounts).filter(([_, count]) => count > 1);

  if (duplicates.length > 0) {
    console.log('⚠️  Found duplicate game_ids:\n');
    duplicates.forEach(([gameId, count]) => {
      console.log(`  ${gameId}: ${count} games`);
      const matchingGames = games.filter((g: any) => g.game_id === gameId);
      matchingGames.forEach((g: any) => {
        console.log(`    - ${g.away_team_abbr} @ ${g.home_team_abbr} (bbref: ${g.bbref_game_id}, canonical: ${g.canonical_game_id || 'null'})`);
      });
    });
  } else {
    console.log('✅ No duplicate game_ids found');
  }

  process.exit(0);
}

check().catch(console.error);

