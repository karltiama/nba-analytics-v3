import 'dotenv/config';
import { Pool } from 'pg';
import * as cheerio from 'cheerio';

/**
 * Backfill team_game_stats from existing player_game_stats
 * 
 * This script:
 * 1. Finds games missing team_game_stats
 * 2. Aggregates team stats from player_game_stats
 * 3. Optionally fetches quarter-by-quarter scoring from Basketball Reference
 * 4. Inserts/updates team_game_stats
 * 
 * Usage:
 *   tsx scripts/backfill-team-stats.ts                    # Backfill all missing games
 *   tsx scripts/backfill-team-stats.ts --game-id 0022500251  # Backfill specific game
 *   tsx scripts/backfill-team-stats.ts --no-quarter-data     # Skip quarter data fetching
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

const BASE_DELAY_MS = 4000; // 4 seconds between requests (respect Basketball Reference rate limits)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch quarter-by-quarter scoring from Basketball Reference
 */
async function fetchQuarterDataFromBBRef(
  date: Date,
  homeTeamCode: string
): Promise<{ [teamCode: string]: { q1: number | null; q2: number | null; q3: number | null; q4: number | null; ot: number | null } } | null> {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const url = `https://www.basketball-reference.com/boxscores/${year}${month}${day}0${homeTeamCode}.html`;
  
  try {
    console.log(`  📊 Fetching quarter data from: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    
    if (!response.ok) {
      console.log(`  ⚠️  Could not fetch quarter data (HTTP ${response.status})`);
      return null;
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Basketball Reference stores quarter scores in a table with id "line_score"
    const quarterData: { [teamCode: string]: { q1: number | null; q2: number | null; q3: number | null; q4: number | null; ot: number | null } } = {};
    
    // Find the line score table
    const lineScoreTable = $('#line_score');
    if (lineScoreTable.length === 0) {
      console.log(`  ⚠️  Could not find line score table`);
      return null;
    }
    
    // Extract team codes and quarter scores
    lineScoreTable.find('tbody tr').each((idx, row) => {
      const $row = $(row);
      const teamLink = $row.find('th a');
      const teamHref = teamLink.attr('href') || '';
      const teamMatch = teamHref.match(/\/teams\/([A-Z]{3})\//);
      if (!teamMatch) return;
      
      const teamCode = teamMatch[1];
      const cells = $row.find('td');
      
      const q1 = parseInt($(cells[0]).text().trim()) || null;
      const q2 = parseInt($(cells[1]).text().trim()) || null;
      const q3 = parseInt($(cells[2]).text().trim()) || null;
      const q4 = parseInt($(cells[3]).text().trim()) || null;
      
      // Check for overtime columns
      let ot: number | null = null;
      if (cells.length > 4) {
        // Sum all OT columns
        let otTotal = 0;
        for (let i = 4; i < cells.length; i++) {
          const otValue = parseInt($(cells[i]).text().trim());
          if (!isNaN(otValue)) {
            otTotal += otValue;
          }
        }
        ot = otTotal > 0 ? otTotal : null;
      }
      
      quarterData[teamCode] = { q1, q2, q3, q4, ot };
    });
    
    if (Object.keys(quarterData).length === 0) {
      console.log(`  ⚠️  Could not extract quarter data`);
      return null;
    }
    
    console.log(`  ✅ Extracted quarter data for ${Object.keys(quarterData).length} teams`);
    return quarterData;
  } catch (error: any) {
    console.log(`  ⚠️  Error fetching quarter data: ${error.message}`);
    return null;
  }
}

/**
 * Aggregate team stats from player_game_stats
 */
async function aggregateTeamStats(gameId: string): Promise<Array<{
  team_id: string;
  points: number;
  field_goals_made: number;
  field_goals_attempted: number;
  three_pointers_made: number;
  three_pointers_attempted: number;
  free_throws_made: number;
  free_throws_attempted: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  minutes: number;
}>> {
  const result = await pool.query(`
    SELECT 
      team_id,
      SUM(points)::int as points,
      SUM(field_goals_made)::int as field_goals_made,
      SUM(field_goals_attempted)::int as field_goals_attempted,
      SUM(three_pointers_made)::int as three_pointers_made,
      SUM(three_pointers_attempted)::int as three_pointers_attempted,
      SUM(free_throws_made)::int as free_throws_made,
      SUM(free_throws_attempted)::int as free_throws_attempted,
      SUM(rebounds)::int as rebounds,
      SUM(assists)::int as assists,
      SUM(steals)::int as steals,
      SUM(blocks)::int as blocks,
      SUM(turnovers)::int as turnovers,
      SUM(minutes)::numeric as minutes
    FROM player_game_stats
    WHERE game_id = $1 AND dnp_reason IS NULL
    GROUP BY team_id
  `, [gameId]);
  
  return result.rows;
}

/**
 * Get team abbreviation from team_id
 */
async function getTeamAbbreviation(teamId: string): Promise<string | null> {
  const result = await pool.query(`
    SELECT abbreviation FROM teams WHERE team_id = $1
  `, [teamId]);
  return result.rows[0]?.abbreviation || null;
}

/**
 * Backfill team_game_stats for a single game
 */
async function backfillGame(gameId: string, fetchQuarterData: boolean = true): Promise<boolean> {
  // Get game info
  const gameResult = await pool.query(`
    SELECT 
      g.game_id,
      g.start_time,
      g.home_team_id,
      g.away_team_id,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.game_id = $1
  `, [gameId]);
  
  if (gameResult.rows.length === 0) {
    console.log(`❌ Game ${gameId} not found`);
    return false;
  }
  
  const game = gameResult.rows[0];
  console.log(`\n📋 Processing game ${gameId}: ${game.away_abbr} @ ${game.home_abbr} (${new Date(game.start_time).toISOString().split('T')[0]})`);
  
  // Aggregate team stats from player_game_stats
  const teamStats = await aggregateTeamStats(gameId);
  
  if (teamStats.length === 0) {
    console.log(`  ⚠️  No player_game_stats found for this game`);
    return false;
  }
  
  console.log(`  ✅ Found stats for ${teamStats.length} team(s)`);
  
  // Fetch quarter data from Basketball Reference if requested
  let quarterData: { [teamCode: string]: { q1: number | null; q2: number | null; q3: number | null; q4: number | null; ot: number | null } } | null = null;
  
  if (fetchQuarterData) {
    const gameDate = new Date(game.start_time);
    quarterData = await fetchQuarterDataFromBBRef(gameDate, game.home_abbr);
    await sleep(BASE_DELAY_MS); // Rate limiting
  }
  
  // Insert/update team_game_stats for each team
  let inserted = 0;
  
  for (const stats of teamStats) {
    const teamAbbr = await getTeamAbbreviation(stats.team_id);
    if (!teamAbbr) {
      console.log(`  ⚠️  Could not find abbreviation for team ${stats.team_id}`);
      continue;
    }
    
    const isHome = stats.team_id === game.home_team_id;
    
    // Get quarter data for this team
    let q1: number | null = null;
    let q2: number | null = null;
    let q3: number | null = null;
    let q4: number | null = null;
    let ot: number | null = null;
    
    if (quarterData && quarterData[teamAbbr]) {
      q1 = quarterData[teamAbbr].q1;
      q2 = quarterData[teamAbbr].q2;
      q3 = quarterData[teamAbbr].q3;
      q4 = quarterData[teamAbbr].q4;
      ot = quarterData[teamAbbr].ot;
    }
    
    // Calculate possessions: FGA + 0.44 * FTA - ORB + TOV
    // Since we don't have ORB/DRB breakdown, estimate ORB as 30% of total rebounds
    const estimatedOrb = Math.floor(0.3 * stats.rebounds);
    const possessions = stats.field_goals_attempted + 0.44 * stats.free_throws_attempted - estimatedOrb + stats.turnovers;
    
    try {
      await pool.query(`
        INSERT INTO team_game_stats (
          game_id, team_id, points, field_goals_made, field_goals_attempted,
          three_pointers_made, three_pointers_attempted, free_throws_made,
          free_throws_attempted, rebounds, assists, steals, blocks, turnovers,
          minutes, is_home, possessions,
          points_q1, points_q2, points_q3, points_q4, points_ot,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, now(), now()
        )
        ON CONFLICT (game_id, team_id) DO UPDATE SET
          points = EXCLUDED.points,
          field_goals_made = EXCLUDED.field_goals_made,
          field_goals_attempted = EXCLUDED.field_goals_attempted,
          three_pointers_made = EXCLUDED.three_pointers_made,
          three_pointers_attempted = EXCLUDED.three_pointers_attempted,
          free_throws_made = EXCLUDED.free_throws_made,
          free_throws_attempted = EXCLUDED.free_throws_attempted,
          rebounds = EXCLUDED.rebounds,
          assists = EXCLUDED.assists,
          steals = EXCLUDED.steals,
          blocks = EXCLUDED.blocks,
          turnovers = EXCLUDED.turnovers,
          minutes = EXCLUDED.minutes,
          possessions = EXCLUDED.possessions,
          points_q1 = COALESCE(EXCLUDED.points_q1, team_game_stats.points_q1),
          points_q2 = COALESCE(EXCLUDED.points_q2, team_game_stats.points_q2),
          points_q3 = COALESCE(EXCLUDED.points_q3, team_game_stats.points_q3),
          points_q4 = COALESCE(EXCLUDED.points_q4, team_game_stats.points_q4),
          points_ot = COALESCE(EXCLUDED.points_ot, team_game_stats.points_ot),
          updated_at = now()
      `, [
        gameId,
        stats.team_id,
        stats.points,
        stats.field_goals_made,
        stats.field_goals_attempted,
        stats.three_pointers_made,
        stats.three_pointers_attempted,
        stats.free_throws_made,
        stats.free_throws_attempted,
        stats.rebounds,
        stats.assists,
        stats.steals,
        stats.blocks,
        stats.turnovers,
        stats.minutes,
        isHome,
        possessions,
        q1,
        q2,
        q3,
        q4,
        ot,
      ]);
      
      inserted++;
      console.log(`  ✅ Inserted team_game_stats for ${teamAbbr}${q1 !== null ? ' (with quarter data)' : ''}`);
    } catch (error: any) {
      console.log(`  ❌ Error inserting team_game_stats for ${teamAbbr}: ${error.message}`);
    }
  }
  
  return inserted > 0;
}

async function main() {
  const args = process.argv.slice(2);
  const gameIdIndex = args.indexOf('--game-id');
  const noQuarterData = args.includes('--no-quarter-data');
  
  const fetchQuarterData = !noQuarterData;
  
  try {
    if (gameIdIndex !== -1 && args[gameIdIndex + 1]) {
      // Backfill specific game
      const gameId = args[gameIdIndex + 1];
      const success = await backfillGame(gameId, fetchQuarterData);
      process.exit(success ? 0 : 1);
    } else {
      // Backfill all games missing team_game_stats
      console.log('🔍 Finding games missing team_game_stats...\n');
      
      const missingGamesResult = await pool.query(`
        SELECT DISTINCT g.game_id, g.start_time
        FROM games g
        WHERE g.status = 'Final'
          AND NOT EXISTS (
            SELECT 1 FROM team_game_stats tgs 
            WHERE tgs.game_id = g.game_id 
            AND (tgs.team_id = g.home_team_id OR tgs.team_id = g.away_team_id)
          )
          AND EXISTS (SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id)
        ORDER BY g.start_time DESC
      `);
      
      const gameIds = missingGamesResult.rows.map(r => r.game_id);
      
      if (gameIds.length === 0) {
        console.log('✅ No games need backfilling');
        return;
      }
      
      console.log(`Found ${gameIds.length} games to backfill\n`);
      
      let successCount = 0;
      let failCount = 0;
      
      for (const gameId of gameIds) {
        const success = await backfillGame(gameId, fetchQuarterData);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
        
        // Rate limiting between games
        if (fetchQuarterData && gameId !== gameIds[gameIds.length - 1]) {
          await sleep(BASE_DELAY_MS);
        }
      }
      
      console.log(`\n✅ Backfill complete: ${successCount} succeeded, ${failCount} failed`);
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

