import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function findFinalMissingGames() {
  console.log('\n🔍 Finding Final games missing team stats for teams below 75% coverage...\n');

  // Get teams below 75% coverage
  const teams = await pool.query(`
    SELECT 
      t.team_id,
      t.abbreviation,
      COUNT(DISTINCT bg.bbref_game_id) FILTER (WHERE bg.game_date <= CURRENT_DATE) as total_games,
      COUNT(DISTINCT btgs.game_id) FILTER (
        WHERE btgs.game_id IN (
          SELECT bbref_game_id FROM bbref_games WHERE game_date <= CURRENT_DATE
        )
      ) as games_with_stats
    FROM teams t
    LEFT JOIN bbref_games bg ON (bg.home_team_id = t.team_id OR bg.away_team_id = t.team_id)
    LEFT JOIN bbref_team_game_stats btgs ON btgs.team_id = t.team_id
    GROUP BY t.team_id, t.abbreviation
    HAVING COUNT(DISTINCT bg.bbref_game_id) FILTER (WHERE bg.game_date <= CURRENT_DATE) > 0
      AND (COUNT(DISTINCT btgs.game_id) FILTER (
        WHERE btgs.game_id IN (
          SELECT bbref_game_id FROM bbref_games WHERE game_date <= CURRENT_DATE
        )
      )::float / NULLIF(COUNT(DISTINCT bg.bbref_game_id) FILTER (WHERE bg.game_date <= CURRENT_DATE), 0) * 100) < 75
    ORDER BY 
      (COUNT(DISTINCT btgs.game_id) FILTER (
        WHERE btgs.game_id IN (
          SELECT bbref_game_id FROM bbref_games WHERE game_date <= CURRENT_DATE
        )
      )::float / NULLIF(COUNT(DISTINCT bg.bbref_game_id) FILTER (WHERE bg.game_date <= CURRENT_DATE), 0) * 100) ASC
  `);

  const gamesToScrape: Set<string> = new Set();

  for (const team of teams.rows) {
    const totalGames = parseInt(team.total_games) || 0;
    const gamesWithStats = parseInt(team.games_with_stats) || 0;
    const coverage = totalGames > 0 ? Math.round((gamesWithStats / totalGames) * 100) : 0;
    const needed = Math.ceil(totalGames * 0.75) - gamesWithStats;

    console.log(`\n${team.abbreviation}: ${coverage}% (${gamesWithStats}/${totalGames}) - needs ${needed} more games`);

    // Find Final games missing stats
    const missingFinal = await pool.query(`
      SELECT 
        bg.bbref_game_id,
        bg.game_date,
        ht.abbreviation as home_team_abbr,
        at.abbreviation as away_team_abbr,
        CASE WHEN bg.home_team_id = $1 THEN 'home' ELSE 'away' END as is_home
      FROM bbref_games bg
      JOIN teams ht ON bg.home_team_id = ht.team_id
      JOIN teams at ON bg.away_team_id = at.team_id
      WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
        AND bg.game_date <= CURRENT_DATE
        AND bg.status = 'Final'
        AND NOT EXISTS (
          SELECT 1 FROM bbref_team_game_stats btgs 
          WHERE btgs.game_id = bg.bbref_game_id 
            AND btgs.team_id = $1
        )
      ORDER BY bg.game_date DESC
      LIMIT $2
    `, [team.team_id, needed]);

    if (missingFinal.rows.length > 0) {
      console.log(`   Found ${missingFinal.rows.length} Final games to scrape:`);
      missingFinal.rows.forEach((game: any) => {
        const date = new Date(game.game_date).toISOString().split('T')[0];
        const vs = game.is_home === 'home' 
          ? `${game.away_team_abbr} @ ${game.home_team_abbr}`
          : `${team.abbreviation} @ ${game.home_team_abbr}`;
        console.log(`     - ${date}: ${vs} (${game.bbref_game_id})`);
        gamesToScrape.add(game.bbref_game_id);
      });
    } else {
      console.log(`   ⚠️  No Final games found - may need to wait for scheduled games to complete`);
    }
  }

  const gamesArray = Array.from(gamesToScrape);
  
  console.log(`\n📊 Summary:`);
  console.log(`   Teams below 75%: ${teams.rows.length}`);
  console.log(`   Final games ready to scrape: ${gamesArray.length}\n`);

  if (gamesArray.length > 0) {
    console.log('💡 To scrape these games, run:');
    console.log(`   npx tsx scripts/batch-scrape-missing-bbref-games.ts --game-ids ${gamesArray.join(',')}\n`);
  }

  await pool.end();
}

findFinalMissingGames();

