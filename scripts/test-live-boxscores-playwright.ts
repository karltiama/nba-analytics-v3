import 'dotenv/config';
import { chromium, Browser, Page } from 'playwright';
import { Pool } from 'pg';
import * as cheerio from 'cheerio';

/**
 * Test Script: Live Box Scores via Playwright (Headless Browser)
 * 
 * Uses Playwright to execute JavaScript and get fully rendered box score pages
 * 
 * Usage:
 *   tsx scripts/test-live-boxscores-playwright.ts
 *   tsx scripts/test-live-boxscores-playwright.ts --game-id 0022500251
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BASE_DELAY_MS = 2000;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

/**
 * Get team abbreviations from database
 */
async function getTeamAbbreviations(gameId: string): Promise<{ homeAbbr: string; awayAbbr: string } | null> {
  const result = await pool.query(`
    SELECT 
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.game_id = $1
  `, [gameId]);

  if (result.rows.length === 0) {
    return null;
  }

  return {
    homeAbbr: result.rows[0].home_abbr.toLowerCase(),
    awayAbbr: result.rows[0].away_abbr.toLowerCase(),
  };
}

/**
 * Get today's games from database
 */
async function getTodaysGames(): Promise<Array<{ game_id: string; home_abbr: string; away_abbr: string; status: string }>> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  
  const result = await pool.query(`
    SELECT 
      g.game_id,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      g.status
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE DATE((g.start_time AT TIME ZONE 'America/New_York')) = $1::date
    ORDER BY g.start_time
  `, [today]);

  return result.rows;
}

/**
 * Extract box score data from rendered HTML using Playwright
 */
async function scrapeBoxScoreWithPlaywright(
  browser: Browser,
  gameId: string,
  homeAbbr: string,
  awayAbbr: string
): Promise<any> {
  // NBA.com URL format: https://www.nba.com/game/{away}-vs-{home}-{gameId}/box-score#box-score
  const url = `https://www.nba.com/game/${awayAbbr}-vs-${homeAbbr}-${gameId}/box-score#box-score`;
  
  console.log(`🌐 Loading page with Playwright: ${url}`);
  
  const page = await browser.newPage();
  
  try {
    // Set viewport and user agent
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    // Navigate to page with more lenient wait strategy
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', // Less strict than networkidle
      timeout: 60000 // Increase timeout to 60 seconds
    });
    
    // Wait a bit for JavaScript to execute
    await page.waitForTimeout(5000);

    // Wait for box score content to load
    // Try multiple selectors that might indicate box score is loaded
    const selectors = [
      '[data-testid*="player"]',
      '[data-testid*="box-score"]',
      'table',
      '[class*="BoxScore"]',
      '[class*="PlayerStats"]',
    ];

    // Wait for page to be interactive
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
      console.log('   ✅ Page loaded (networkidle)');
    } catch (e) {
      console.log('   ⚠️  Network idle timeout, continuing anyway...');
    }
    
    // Additional wait for JavaScript to render content
    await page.waitForTimeout(3000);
    
    // Try to find content indicators
    let contentLoaded = false;
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        console.log(`   ✅ Found selector: ${selector}`);
        contentLoaded = true;
        break;
      } catch (e) {
        // Continue trying other selectors
      }
    }

    if (!contentLoaded) {
      console.log('   ⚠️  No box score selectors found, but continuing with HTML extraction...');
    }

    // Debug: Check page title and URL
    const pageTitle = await page.title();
    console.log(`   Page title: ${pageTitle}`);
    
    // Debug: Check if __NEXT_DATA__ script exists
    const hasNextData = await page.locator('script#__NEXT_DATA__').count();
    console.log(`   __NEXT_DATA__ scripts found: ${hasNextData}`);
    
    // Get the rendered HTML
    const html = await page.content();
    const $ = cheerio.load(html);

    // Method 1: Extract from __NEXT_DATA__ script (most reliable)
    const nextDataScript = $('script#__NEXT_DATA__').html();
    console.log(`   __NEXT_DATA__ script length: ${nextDataScript?.length || 0} chars`);
    if (nextDataScript) {
      try {
        const jsonData = JSON.parse(nextDataScript);
        console.log(`   JSON top-level keys: ${Object.keys(jsonData).join(', ')}`);
        
        const pageProps = jsonData.props?.pageProps;
        
        if (pageProps) {
          console.log(`   pageProps keys: ${Object.keys(pageProps).join(', ')}`);
          
          // Check if we have game data directly
          if (pageProps.game) {
            console.log(`   ✅ Found game object in pageProps`);
            const game = pageProps.game;
            
            // Check for player arrays directly in game object
            if (game.homeTeamPlayers && Array.isArray(game.homeTeamPlayers) && 
                game.awayTeamPlayers && Array.isArray(game.awayTeamPlayers)) {
              console.log(`   ✅ Found homeTeamPlayers (${game.homeTeamPlayers.length}) and awayTeamPlayers (${game.awayTeamPlayers.length})`);
              
              // Combine both teams' players
              const allPlayers = [
                ...game.homeTeamPlayers.map((p: any) => ({ ...p, TEAM_ABBREVIATION: game.homeTeam?.teamAbbreviation || 'UNK' })),
                ...game.awayTeamPlayers.map((p: any) => ({ ...p, TEAM_ABBREVIATION: game.awayTeam?.teamAbbreviation || 'UNK' }))
              ];
              
              if (allPlayers.length > 0) {
                console.log(`   ✅ Found ${allPlayers.length} players in game object`);
                
                // Check if players have stats (game might not have started)
                const hasStats = allPlayers.some((p: any) => 
                  p.PTS !== undefined || p.points !== undefined || 
                  p.MIN !== undefined || p.minutes !== undefined
                );
                
                if (!hasStats) {
                  console.log(`   ⚠️  Players found but no stats yet (game may not have started)`);
                  console.log(`   Game status: ${game.gameStatusText || game.gameStatus || 'unknown'}`);
                  // Don't return yet - try HTML table parsing which might have stats
                } else {
                  console.log(`   ✅ Extracted ${allPlayers.length} player stats from game object`);
                  return {
                    source: 'playwright_json_players',
                    playerStats: allPlayers,
                    gameData: game,
                  };
                }
              }
            }
            
            // Look for box score in game object
            if (game.boxScore || game.boxScoreTraditional) {
              const boxScore = game.boxScore || game.boxScoreTraditional;
              console.log(`   ✅ Found boxScore in game object`);
              
              if (boxScore.resultSets && Array.isArray(boxScore.resultSets)) {
                const playerStatsSet = boxScore.resultSets.find((rs: any) => 
                  rs.name === 'PlayerStats' || 
                  rs.name === 'PlayerGameStats' ||
                  (rs.headers && Array.isArray(rs.headers) && rs.headers.includes('PLAYER_NAME'))
                ) || boxScore.resultSets[0];
                
                if (playerStatsSet && playerStatsSet.rowSet) {
                  const headers = playerStatsSet.headers || [];
                  const playerStats = playerStatsSet.rowSet.map((row: any[]) => {
                    const player: any = {};
                    headers.forEach((header: string, idx: number) => {
                      player[header] = row[idx];
                    });
                    return player;
                  });

                  if (playerStats.length > 0) {
                    console.log(`   ✅ Extracted ${playerStats.length} player stats from JSON resultSets`);
                    return {
                      source: 'playwright_json',
                      playerStats,
                      boxScore,
                      gameData: game,
                    };
                  }
                }
              }
            }
          }
          
          // Look for box score in various locations
          const boxScore = pageProps.boxScore || 
                          pageProps.boxScoreTraditional || 
                          pageProps.gameData?.boxScore ||
                          pageProps.game?.boxScore;
          
          if (boxScore?.resultSets && Array.isArray(boxScore.resultSets)) {
            // Extract player stats from resultSets
            const playerStatsSet = boxScore.resultSets.find((rs: any) => 
              rs.name === 'PlayerStats' || 
              rs.name === 'PlayerGameStats' ||
              (rs.headers && Array.isArray(rs.headers) && rs.headers.includes('PLAYER_NAME'))
            ) || boxScore.resultSets[0];
            
            if (playerStatsSet && playerStatsSet.rowSet) {
              const headers = playerStatsSet.headers || [];
              const playerStats = playerStatsSet.rowSet.map((row: any[]) => {
                const player: any = {};
                headers.forEach((header: string, idx: number) => {
                  player[header] = row[idx];
                });
                return player;
              });

              if (playerStats.length > 0) {
                console.log(`   ✅ Extracted ${playerStats.length} player stats from JSON`);
                return {
                  source: 'playwright_json',
                  playerStats,
                  boxScore,
                  gameData: pageProps.gameData || pageProps.game,
                };
              }
            }
          }
        }
      } catch (e: any) {
        console.log(`   ⚠️  Failed to parse __NEXT_DATA__: ${e.message.substring(0, 50)}`);
      }
    }

    // Method 2: Extract from HTML tables (fallback)
    const playerStats: any[] = [];
    $('table').each((index, table) => {
      const $table = $(table);
      const headers: string[] = [];
      
      // Extract headers
      $table.find('thead th, thead td, tr:first-child th, tr:first-child td').each((i, th) => {
        const text = $(th).text().trim();
        if (text && !headers.includes(text)) headers.push(text);
      });

      // Extract rows
      $table.find('tbody tr, tr:not(:first-child)').each((rowIdx, row) => {
        const $row = $(row);
        const rowText = $row.text().trim();
        
        if (!rowText || rowText.includes('MIN') || rowText.includes('Totals')) {
          return;
        }
        
        const cells = $row.find('td, th').toArray();
        if (cells.length < 3) return;
        
        const rowData: any = {};
        cells.forEach((cell, colIdx) => {
          const header = headers[colIdx] || `col_${colIdx}`;
          const text = $(cell).text().trim();
          
          const headerLower = header.toLowerCase();
          if (headerLower.includes('player') || headerLower.includes('name')) {
            // Clean player name - remove duplicates and extra text
            const cleanName = text.split(/\s+/).filter((word, idx, arr) => {
              // Remove duplicate words
              return arr.indexOf(word) === idx;
            }).join(' ').replace(/[A-Z]\.\s*[A-Z]\./g, '').trim();
            rowData.Player = cleanName;
            rowData.PLAYER_NAME = cleanName;
          } else if (headerLower.includes('min') || header === 'MIN') {
            rowData.MIN = text;
          } else if (headerLower.includes('pts') || header === 'PTS') {
            rowData.PTS = parseInt(text) || 0;
          } else if (headerLower.includes('reb') || header === 'REB') {
            rowData.REB = parseInt(text) || 0;
          } else if (headerLower.includes('ast') || header === 'AST') {
            rowData.AST = parseInt(text) || 0;
          } else if (headerLower.includes('fg') && !headerLower.includes('3')) {
            rowData.FG = text;
          } else if (headerLower.includes('3') || header === '3PT') {
            rowData['3PT'] = text;
          } else if (headerLower.includes('ft') || header === 'FT') {
            rowData.FT = text;
          }
          
          rowData[header] = text;
        });

        // Skip totals rows and empty rows
        const playerName = rowData.Player || rowData.PLAYER_NAME || '';
        if (playerName && 
            !playerName.toUpperCase().includes('TOTALS') &&
            !playerName.toUpperCase().includes('TEAM') &&
            playerName.length > 1 &&
            (rowData.MIN || rowData.PTS || rowData.REB || rowData.AST)) {
          playerStats.push(rowData);
        }
      });
    });

    if (playerStats.length > 0) {
      console.log(`   ✅ Extracted ${playerStats.length} player stats from HTML tables`);
      
      // Try to get game data from __NEXT_DATA__ if we haven't already
      let gameData = null;
      try {
        const nextDataScript = $('script#__NEXT_DATA__').html();
        if (nextDataScript) {
          const jsonData = JSON.parse(nextDataScript);
          gameData = jsonData.props?.pageProps?.game;
        }
      } catch (e) {
        // Ignore
      }
      
      return {
        source: 'playwright_html',
        playerStats,
        gameData,
      };
    }

    // If we got here, we couldn't extract data
    console.log('   ⚠️  Could not extract box score data');
    
    // Debug: Check what's actually on the page
    const bodyText = await page.locator('body').textContent();
    console.log(`   Body text length: ${bodyText?.length || 0} chars`);
    console.log(`   HTML length: ${html.length} chars`);
    
    // Check for common error messages
    if (bodyText?.includes('404') || bodyText?.includes('Not Found')) {
      console.log('   ❌ Page appears to be 404 or not found');
    }
    
    if (bodyText?.includes('Game has not started')) {
      console.log('   ℹ️  Game has not started yet');
    }
    
    return {
      source: 'playwright_no_data',
      html: html.substring(0, 2000), // First 2000 chars for debugging
      bodyText: bodyText?.substring(0, 500), // First 500 chars of body text
    };

  } finally {
    await page.close();
  }
}

/**
 * Display box score data
 */
function displayBoxScore(data: any, gameId: string, homeAbbr: string, awayAbbr: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Box Score: ${awayAbbr.toUpperCase()} @ ${homeAbbr.toUpperCase()}`);
  console.log(`Game ID: ${gameId}`);
  console.log(`Source: ${data.source}`);
  console.log(`${'='.repeat(60)}\n`);

  // Handle both JSON format and HTML table format
  let playerStats = data.playerStats;
  
  if (!playerStats && data.boxScore?.resultSets) {
    const playerStatsSet = data.boxScore.resultSets.find((rs: any) => 
      rs.name === 'PlayerStats' || 
      (rs.headers && Array.isArray(rs.headers) && rs.headers.includes('PLAYER_NAME'))
    ) || data.boxScore.resultSets[0];
    
    if (playerStatsSet && playerStatsSet.rowSet) {
      const headers = playerStatsSet.headers || [];
      playerStats = playerStatsSet.rowSet.map((row: any[]) => {
        const player: any = {};
        headers.forEach((header: string, idx: number) => {
          player[header] = row[idx];
        });
        return player;
      });
    }
  }
  
  if (playerStats && Array.isArray(playerStats) && playerStats.length > 0) {
    // Group by team
    const byTeam: Record<string, any[]> = {};
    playerStats.forEach((p: any) => {
      const team = p.TEAM_ABBREVIATION || p.team || 'UNK';
      if (!byTeam[team]) byTeam[team] = [];
      byTeam[team].push(p);
    });

    Object.entries(byTeam).forEach(([team, players]) => {
      console.log(`\n${team} (${players.length} players):`);
      console.log('   Player'.padEnd(25) + 'MIN'.padEnd(8) + 'PTS'.padEnd(6) + 'REB'.padEnd(6) + 'AST'.padEnd(6) + 'FG'.padEnd(10) + '3PT'.padEnd(10) + 'FT');
      console.log('   ' + '-'.repeat(80));
      
      const validPlayers = players
        .filter((p: any) => {
          const name = p.PLAYER_NAME || p.Player || p.name || '';
          return name && 
                 name !== 'Team Totals' && 
                 !name.includes('Totals') &&
                 name.length > 1;
        })
        .sort((a: any, b: any) => {
          const aPts = a.PTS || a.POINTS || 0;
          const bPts = b.PTS || b.POINTS || 0;
          return bPts - aPts;
        })
        .slice(0, 10);
      
      if (validPlayers.length === 0) {
        console.log('   ⚠️  No valid player rows found');
      } else {
        validPlayers.forEach((p: any) => {
          // Handle different field name formats
          const name = (p.PLAYER_NAME || p.playerName || p.name || p.Player || 'Unknown').substring(0, 23);
          
          // Try various field name formats for stats
          const min = String(
            p.MIN || p.minutes || p.min || p.MINUTES || 
            (p.minutesPlayed ? `${Math.floor(p.minutesPlayed)}:${String(Math.round((p.minutesPlayed % 1) * 60)).padStart(2, '0')}` : null) ||
            '0:00'
          ).substring(0, 7);
          
          const pts = String(p.PTS || p.points || p.POINTS || 0).substring(0, 5);
          const reb = String(p.REB || p.rebounds || p.REBOUNDS || p.reb || 0).substring(0, 5);
          const ast = String(p.AST || p.assists || p.ASSISTS || p.ast || 0).substring(0, 5);
          
          // Field goals
          const fg = String(
            (p.FGM !== undefined && p.FGA !== undefined) ? `${p.FGM}-${p.FGA}` :
            (p.fieldGoalsMade !== undefined && p.fieldGoalsAttempted !== undefined) ? `${p.fieldGoalsMade}-${p.fieldGoalsAttempted}` :
            p.FG || p.fg || '0-0'
          ).substring(0, 9);
          
          // Three pointers
          const threePt = String(
            (p.FG3M !== undefined && p.FG3A !== undefined) ? `${p.FG3M}-${p.FG3A}` :
            (p.threePointersMade !== undefined && p.threePointersAttempted !== undefined) ? `${p.threePointersMade}-${p.threePointersAttempted}` :
            p['3PT'] || p['3P'] || '0-0'
          ).substring(0, 9);
          
          // Free throws
          const ft = String(
            (p.FTM !== undefined && p.FTA !== undefined) ? `${p.FTM}-${p.FTA}` :
            (p.freeThrowsMade !== undefined && p.freeThrowsAttempted !== undefined) ? `${p.freeThrowsMade}-${p.freeThrowsAttempted}` :
            p.FT || p.ft || '0-0'
          ).substring(0, 9);
          
          console.log(
            `   ${name.padEnd(23)}${min.padEnd(8)}${pts.padEnd(6)}${reb.padEnd(6)}${ast.padEnd(6)}${fg.padEnd(10)}${threePt.padEnd(10)}${ft}`
          );
        });
      }
    });
  } else {
    console.log('⚠️  No player stats found');
    if (data.gameData) {
      console.log('Game status:', data.gameData.status || data.gameData.gameStatus || 'unknown');
    }
  }
}

async function main() {
  console.log('🏀 Testing Live Box Scores via Playwright\n');

  const args = process.argv.slice(2);
  let browser: Browser | null = null;

  try {
    // Launch browser
    console.log('🚀 Launching browser...');
    browser = await chromium.launch({ 
      headless: true, // Set to false to see browser
    });
    console.log('✅ Browser launched\n');

    if (args.includes('--game-id')) {
      // Test specific game
      const gameIdIndex = args.indexOf('--game-id');
      const gameId = args[gameIdIndex + 1];
      
      if (!gameId) {
        console.error('❌ --game-id requires a game ID');
        process.exit(1);
      }

      const teamAbbrs = await getTeamAbbreviations(gameId);
      if (!teamAbbrs) {
        console.error(`❌ Could not find team abbreviations for game ${gameId}`);
        process.exit(1);
      }

      console.log(`Testing game: ${gameId}`);
      console.log(`Teams: ${teamAbbrs.awayAbbr.toUpperCase()} @ ${teamAbbrs.homeAbbr.toUpperCase()}\n`);

      const data = await scrapeBoxScoreWithPlaywright(
        browser,
        gameId,
        teamAbbrs.homeAbbr,
        teamAbbrs.awayAbbr
      );
      
      displayBoxScore(data, gameId, teamAbbrs.homeAbbr, teamAbbrs.awayAbbr);
      
    } else {
      // Test today's games
      const games = await getTodaysGames();
      
      if (games.length === 0) {
        console.log('⚠️  No games found for today');
        return;
      }

      console.log(`Found ${games.length} game(s) for today\n`);

      for (let i = 0; i < games.length; i++) {
        const game = games[i];
        console.log(`\n[${i + 1}/${games.length}] Testing game: ${game.game_id} (${game.status})`);
        
        try {
          const data = await scrapeBoxScoreWithPlaywright(
            browser,
            game.game_id,
            game.home_abbr,
            game.away_abbr
          );
          
          displayBoxScore(data, game.game_id, game.home_abbr, game.away_abbr);
          
          // Add delay between games
          if (i < games.length - 1) {
            await new Promise(resolve => setTimeout(resolve, BASE_DELAY_MS));
          }
        } catch (error: any) {
          console.error(`❌ Error scraping game ${game.game_id}:`, error.message);
        }
      }
    }

    console.log('\n\n✅ Test complete!');
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
    await pool.end();
  }
}

main();

