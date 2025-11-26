import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function diagnoseGamesPlayed() {
  try {
    console.log('🔍 Diagnosing BBRef Games Played Discrepancies...\n');

    // Get all teams
    const teams = await pool.query(`
      SELECT team_id, abbreviation, full_name
      FROM teams
      ORDER BY abbreviation
    `);

    console.log('Comparing game counts across sources:\n');
    console.log('Team | Games in bbref_games | Games in bbref_team_game_stats | Materialized View | Difference');
    console.log('─'.repeat(90));

    const discrepancies: Array<{
      team: string;
      gamesInTable: number;
      gamesWithStats: number;
      materializedView: number;
    }> = [];

    for (const team of teams.rows) {
      // Count games in bbref_games table
      const gamesInTable = await pool.query(`
        SELECT COUNT(DISTINCT bbref_game_id) as count
        FROM bbref_games
        WHERE (home_team_id = $1 OR away_team_id = $1)
          AND status = 'Final'
      `, [team.team_id]);

      // Count games with stats in bbref_team_game_stats
      const gamesWithStats = await pool.query(`
        SELECT COUNT(DISTINCT btgs.game_id) as count
        FROM bbref_team_game_stats btgs
        JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
        WHERE btgs.team_id = $1
          AND btgs.source = 'bbref'
          AND bg.status = 'Final'
      `, [team.team_id]);

      // Get from materialized view
      const materializedView = await pool.query(`
        SELECT games_played
        FROM bbref_team_season_stats
        WHERE team_id = $1
      `, [team.team_id]);

      const gamesInTableCount = parseInt(gamesInTable.rows[0]?.count || '0');
      const gamesWithStatsCount = parseInt(gamesWithStats.rows[0]?.count || '0');
      const materializedViewCount = parseInt(materializedView.rows[0]?.games_played || '0');

      const diff = gamesInTableCount - gamesWithStatsCount;

      console.log(
        `${team.abbreviation.padEnd(4)} | ${String(gamesInTableCount).padStart(21)} | ${String(gamesWithStatsCount).padStart(30)} | ${String(materializedViewCount).padStart(17)} | ${diff !== 0 ? `⚠️  ${diff}` : '✅'}`
      );

      if (diff !== 0 || gamesWithStatsCount !== materializedViewCount) {
        discrepancies.push({
          team: team.abbreviation,
          gamesInTable: gamesInTableCount,
          gamesWithStats: gamesWithStatsCount,
          materializedView: materializedViewCount,
        });
      }
    }

    if (discrepancies.length > 0) {
      console.log('\n⚠️  DISCREPANCIES FOUND:\n');
      
      for (const disc of discrepancies) {
        console.log(`\n📊 ${disc.team}:`);
        console.log(`   Games in bbref_games: ${disc.gamesInTable}`);
        console.log(`   Games with stats: ${disc.gamesWithStats}`);
        console.log(`   Materialized view: ${disc.materializedView}`);
        
        if (disc.gamesInTable > disc.gamesWithStats) {
          const missingGames = await pool.query(`
            SELECT 
              bg.bbref_game_id,
              bg.game_date,
              bg.home_team_id,
              bg.away_team_id,
              ht.abbreviation as home_team,
              at.abbreviation as away_team,
              bg.status
            FROM bbref_games bg
            JOIN teams ht ON bg.home_team_id = ht.team_id
            JOIN teams at ON bg.away_team_id = at.team_id
            WHERE (bg.home_team_id = (SELECT team_id FROM teams WHERE abbreviation = $1) 
                   OR bg.away_team_id = (SELECT team_id FROM teams WHERE abbreviation = $1))
              AND bg.status = 'Final'
              AND NOT EXISTS (
                SELECT 1 FROM bbref_team_game_stats btgs
                WHERE btgs.game_id = bg.bbref_game_id
                  AND btgs.team_id = (SELECT team_id FROM teams WHERE abbreviation = $1)
                  AND btgs.source = 'bbref'
              )
            ORDER BY bg.game_date DESC
            LIMIT 10
          `, [disc.team]);
          
          if (missingGames.rows.length > 0) {
            console.log(`   Missing stats for ${missingGames.rows.length} game(s):`);
            const teamIdResult = await pool.query(`SELECT team_id FROM teams WHERE abbreviation = $1`, [disc.team]);
            const teamId = teamIdResult.rows[0]?.team_id;
            missingGames.rows.forEach((game: any) => {
              const isHome = game.home_team_id === teamId;
              const opponent = isHome ? game.away_team : game.home_team;
              console.log(`     - ${game.game_date} vs ${opponent} (${game.bbref_game_id})`);
            });
          }
        }
      }
    } else {
      console.log('\n✅ All teams have matching game counts!');
    }

    // Summary statistics
    console.log('\n📈 SUMMARY:');
    const totalGamesInTable = await pool.query(`
      SELECT COUNT(DISTINCT bbref_game_id) as count
      FROM bbref_games
      WHERE status = 'Final'
    `);
    
    const totalGamesWithStats = await pool.query(`
      SELECT COUNT(DISTINCT btgs.game_id) as count
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE btgs.source = 'bbref'
        AND bg.status = 'Final'
    `);

    console.log(`Total Final games in bbref_games: ${totalGamesInTable.rows[0].count}`);
    console.log(`Total games with stats: ${totalGamesWithStats.rows[0].count}`);
    console.log(`Average games per team (from bbref_games): ${(parseInt(totalGamesInTable.rows[0].count) / teams.rows.length).toFixed(1)}`);
    console.log(`Average games per team (from stats): ${(parseInt(totalGamesWithStats.rows[0].count) / teams.rows.length).toFixed(1)}`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

diagnoseGamesPlayed();
