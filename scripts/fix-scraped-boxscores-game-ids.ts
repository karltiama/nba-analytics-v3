import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

// Team code mapping: BBRef code -> NBA abbreviation
const TEAM_CODE_MAP: Record<string, string> = {
  'ATL': 'ATL', 'BOS': 'BOS', 'BRK': 'BKN', 'CHO': 'CHA', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GSW': 'GSW',
  'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM',
  'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NOP': 'NOP', 'NYK': 'NYK',
  'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI', 'PHO': 'PHX', 'POR': 'POR',
  'SAC': 'SAC', 'SAS': 'SAS', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS'
};

async function fixGameIds() {
  try {
    console.log('🔧 Fixing game_ids in scraped_boxscores to match bbref_games...\n');

    // Get all unique game_ids from scraped_boxscores that don't match bbref_game_id format
    const scrapedGames = await pool.query(`
      SELECT DISTINCT 
        sb.game_id,
        MIN(sb.game_date) as game_date,
        array_agg(DISTINCT sb.team_code) as team_codes
      FROM scraped_boxscores sb
      WHERE sb.source = 'bbref_csv'
        AND sb.game_id NOT LIKE 'bbref_%'
      GROUP BY sb.game_id
      ORDER BY sb.game_id
    `);

    console.log(`Found ${scrapedGames.rows.length} games with non-BBRef game_ids\n`);

    let updated = 0;
    let notFound = 0;
    const notFoundGames: string[] = [];

    for (const game of scrapedGames.rows) {
      const { game_id, game_date, team_codes } = game;
      
      // Try to find matching bbref_game_id by date and teams
      // We need at least 2 team codes to match properly
      if (team_codes.length < 2) {
        console.log(`⚠️  Game ${game_id}: Only found ${team_codes.length} team code(s), skipping`);
        notFound++;
        notFoundGames.push(game_id);
        continue;
      }

      // Resolve team_ids from team_codes
      const teamIds: string[] = [];
      for (const teamCode of team_codes) {
        const nbaAbbr = TEAM_CODE_MAP[teamCode] || teamCode;
        const result = await pool.query(`
          SELECT team_id FROM teams WHERE abbreviation = $1 LIMIT 1
        `, [nbaAbbr]);
        if (result.rows.length > 0) {
          teamIds.push(result.rows[0].team_id);
        }
      }

      if (teamIds.length < 2) {
        console.log(`⚠️  Game ${game_id}: Could not resolve team_ids for team codes: ${team_codes.join(', ')}`);
        notFound++;
        notFoundGames.push(game_id);
        continue;
      }

      // Find bbref_game_id that matches date and both teams
      const bbrefGame = await pool.query(`
        SELECT bg.bbref_game_id
        FROM bbref_games bg
        WHERE bg.game_date = $1
          AND bg.home_team_id = ANY($2)
          AND bg.away_team_id = ANY($2)
          AND bg.home_team_id != bg.away_team_id
        LIMIT 1
      `, [game_date, teamIds]);

      if (bbrefGame.rows.length > 0) {
        const bbrefGameId = bbrefGame.rows[0].bbref_game_id;
        console.log(`✅ Mapping ${game_id} → ${bbrefGameId}`);
        
        await pool.query(`
          UPDATE scraped_boxscores
          SET game_id = $1
          WHERE game_id = $2 AND source = 'bbref_csv'
        `, [bbrefGameId, game_id]);
        
        updated++;
      } else {
        console.log(`❌ Could not find bbref_game_id for ${game_id} (date: ${game_date}, teams: ${team_codes.join(', ')})`);
        notFound++;
        notFoundGames.push(game_id);
      }
    }

    console.log(`\n✅ Updated ${updated} games`);
    console.log(`❌ Could not map ${notFound} games`);
    
    if (notFoundGames.length > 0 && notFoundGames.length <= 10) {
      console.log(`\nGames that couldn't be mapped:`);
      notFoundGames.forEach(id => console.log(`  - ${id}`));
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixGameIds();


