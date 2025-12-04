import 'dotenv/config';
import * as cheerio from 'cheerio';
import { Pool } from 'pg';

/**
 * Test Script: Live Box Scores via HTML Scraping
 * 
 * Scrapes live box scores from NBA.com HTML pages (more reliable than API)
 * 
 * Usage:
 *   tsx scripts/test-live-boxscores-html.ts
 *   tsx scripts/test-live-boxscores-html.ts --game-id 0022500251
 *   tsx scripts/test-live-boxscores-html.ts --date 2025-12-02
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BASE_DELAY_MS = 2000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const NBA_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function addJitter(delayMs: number): number {
  const jitter = Math.random() * delayMs * 0.2;
  return Math.floor(delayMs + jitter);
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...NBA_HEADERS,
          ...(options.headers || {}),
        },
      });

      if (response.ok) {
        return response;
      }

      if (response.status === 429 || response.status === 503) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`⚠️  Rate limited. Waiting ${Math.ceil(delay / 1000)}s before retry ${attempt + 1}/${retries}`);
        await sleep(addJitter(delay));
        continue;
      }

      if (attempt === retries) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      await sleep(addJitter(delay));
    } catch (error: any) {
      if (attempt === retries) {
        throw error;
      }
      console.warn(`⚠️  Request failed (attempt ${attempt + 1}/${retries}):`, error.message);
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      await sleep(addJitter(delay));
    }
  }

  throw new Error('Max retries exceeded');
}

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
async function getTodaysGames(): Promise<Array<{ game_id: string; home_abbr: string; away_abbr: string }>> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  
  const result = await pool.query(`
    SELECT 
      g.game_id,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE DATE((g.start_time AT TIME ZONE 'America/New_York')) = $1::date
    ORDER BY g.start_time
  `, [today]);

  return result.rows;
}

/**
 * Scrape box score from NBA.com HTML page
 */
async function scrapeNBAComBoxScore(gameId: string, homeAbbr: string, awayAbbr: string): Promise<any> {
  // Construct URL: https://www.nba.com/game/{away}-vs-{home}-{gameId}/box-score
  const url = `https://www.nba.com/game/${awayAbbr}-vs-${homeAbbr}-${gameId}/box-score`;
  
  console.log(`🌐 Scraping: ${url}`);
  
  const response = await fetchWithRetry(url);
  const html = await response.text();
  const $ = cheerio.load(html);

  // Debug: Check what scripts we have
  const scripts = $('script').toArray();
  console.log(`   Found ${scripts.length} script tags`);
  
  // Check for __NEXT_DATA__ script
  const nextDataScripts = scripts.filter((s) => $(s).attr('id') === '__NEXT_DATA__');
  if (nextDataScripts.length > 0) {
    console.log('   ✅ Found __NEXT_DATA__ script tag');
  } else {
    console.log('   ⚠️  No __NEXT_DATA__ script tag found');
    // Debug: show script IDs/types
    const scriptInfo = scripts.slice(0, 5).map((s) => {
      const id = $(s).attr('id');
      const type = $(s).attr('type');
      const content = $(s).html() || '';
      return { id, type, hasContent: content.length > 0, contentPreview: content.substring(0, 100) };
    });
    console.log('   Sample scripts:', JSON.stringify(scriptInfo, null, 2).substring(0, 300));
  }
  
  // First, try to find __NEXT_DATA__ script tag
  const nextDataScript = scripts.find((script) => {
    const id = $(script).attr('id');
    return id === '__NEXT_DATA__';
  });
  
  if (nextDataScript) {
    try {
      const content = $(nextDataScript).html() || '';
      if (!content) {
        console.log('   ⚠️  __NEXT_DATA__ script is empty');
      } else {
        const jsonData = JSON.parse(content);
        
        // Navigate through Next.js data structure
        const pageProps = jsonData.props?.pageProps;
        
        if (!pageProps) {
          console.log('   ⚠️  No pageProps found in __NEXT_DATA__');
          console.log('   Available keys:', Object.keys(jsonData.props || {}).join(', '));
        } else {
          console.log('   ✅ Found pageProps');
          console.log('   pageProps keys:', Object.keys(pageProps).join(', '));
          
          // Check events array for game data
          if (pageProps.events && Array.isArray(pageProps.events)) {
            console.log(`   Found ${pageProps.events.length} events`);
            // Find the game matching our gameId
            const gameEvent = pageProps.events.find((e: any) => 
              e.id === gameId || 
              e.gameId === gameId ||
              String(e.id).includes(String(gameId).slice(-6)) // Match last 6 digits
            );
            
            if (gameEvent) {
              console.log('   ✅ Found game in events array');
              console.log('   Game event keys:', Object.keys(gameEvent).join(', '));
              
              // Look for box score in the game event
              const boxScore = gameEvent.boxScore || 
                             gameEvent.boxScoreTraditional ||
                             gameEvent.gameData?.boxScore;
              
              if (boxScore) {
                return {
                  source: 'nba_com_json_events',
                  boxScore,
                  playerStats: [],
                  gameData: gameEvent,
                };
              }
            }
          }
          
          // Look for box score data in various possible locations
          const boxScore = pageProps.boxScore || 
                          pageProps.boxScoreTraditional || 
                          pageProps.gameData?.boxScore ||
                          pageProps.game?.boxScore ||
                          pageProps.boxscore;
          
          // Try to extract player stats from resultSets
          let playerStats: any[] = [];
          
          if (boxScore?.resultSets && Array.isArray(boxScore.resultSets)) {
            console.log(`   Found ${boxScore.resultSets.length} resultSets in boxScore`);
            
            // resultSets[0] is usually PlayerStats
            const playerStatsSet = boxScore.resultSets.find((rs: any) => 
              rs.name === 'PlayerStats' || 
              rs.name === 'PlayerGameStats' ||
              (rs.headers && Array.isArray(rs.headers) && rs.headers.includes('PLAYER_NAME'))
            ) || boxScore.resultSets[0];
            
            if (playerStatsSet) {
              console.log(`   Using resultSet: ${playerStatsSet.name || 'unnamed'}`);
              if (playerStatsSet.rowSet && Array.isArray(playerStatsSet.rowSet)) {
                const headers = playerStatsSet.headers || [];
                playerStats = playerStatsSet.rowSet.map((row: any[]) => {
                  const player: any = {};
                  headers.forEach((header: string, idx: number) => {
                    player[header] = row[idx];
                  });
                  return player;
                });
                console.log(`   Extracted ${playerStats.length} player stats`);
              }
            }
          }
          
          if (boxScore || playerStats.length > 0) {
            console.log(`   ✅ Found embedded JSON data (${playerStats.length} players)`);
            return {
              source: 'nba_com_json',
              boxScore,
              playerStats,
              gameData: pageProps.gameData || pageProps.game,
            };
          } else {
            console.log('   ⚠️  No box score data found in pageProps');
            // Game might not have started yet
            if (pageProps.game || pageProps.gameData) {
              const game = pageProps.game || pageProps.gameData;
              console.log(`   Game status: ${game.status || game.gameStatus || 'unknown'}`);
            }
          }
        }
      }
    } catch (e: any) {
      console.log(`   ❌ Failed to parse __NEXT_DATA__: ${e.message}`);
      console.log(`   Error: ${e.stack?.substring(0, 200)}`);
    }
  }
  
  // Fallback: Search all scripts for pageProps or boxScore
  for (const script of scripts) {
    const content = $(script).html() || '';
    
    if (content.includes('pageProps') && (content.includes('boxScore') || content.includes('playerStats'))) {
      try {
        // Try to extract JSON object
        const jsonMatch = content.match(/\{[\s\S]*"pageProps"[\s\S]*\}/);
        if (jsonMatch) {
          const jsonData = JSON.parse(jsonMatch[0]);
          const pageProps = jsonData.props?.pageProps || jsonData.pageProps;
          
          if (pageProps) {
            const boxScore = pageProps.boxScore || pageProps.boxScoreTraditional;
            if (boxScore) {
              console.log('   ✅ Found pageProps JSON data');
              return {
                source: 'nba_com_json',
                boxScore,
                playerStats: pageProps.playerStats || [],
                gameData: pageProps.gameData || pageProps.game,
              };
            }
          }
        }
      } catch (e: any) {
        // Continue trying other methods
      }
    }
  }

  // Method 2: Parse HTML tables - improved parsing
  const playerStats: any[] = [];
  
  // Try multiple table selectors
  const tableSelectors = [
    'table',
    '[class*="BoxScore"] table',
    '[class*="box-score"] table',
    '[data-testid*="box-score"] table',
  ];
  
  for (const selector of tableSelectors) {
    $(selector).each((index, table) => {
      const $table = $(table);
      const headers: string[] = [];
      
      // Extract headers from thead or first row
      $table.find('thead th, thead td').each((i, th) => {
        const text = $(th).text().trim();
        if (text && !headers.includes(text)) headers.push(text);
      });
      
      // If no thead, try first row
      if (headers.length === 0) {
        $table.find('tr:first-child th, tr:first-child td').each((i, th) => {
          const text = $(th).text().trim();
          if (text && !headers.includes(text)) headers.push(text);
        });
      }

      // Try to identify team from table context
      let teamAbbr = 'UNK';
      const $tableParent = $table.closest('[class*="team"], [class*="Team"], [class*="away"], [class*="home"]');
      if ($tableParent.length > 0) {
        const classAttr = $tableParent.attr('class') || '';
        const teamMatch = classAttr.match(/([A-Z]{3})/);
        if (teamMatch) teamAbbr = teamMatch[1];
      }

      // Extract player rows
      $table.find('tbody tr, tr:not(:first-child)').each((rowIdx, row) => {
        const $row = $(row);
        const rowText = $row.text().trim();
        
        // Skip empty rows, totals, or header-like rows
        if (!rowText || 
            rowText === 'MIN' || 
            rowText.includes('Totals') || 
            rowText.includes('Team Totals') ||
            rowText.length < 3) {
          return;
        }
        
        const cells = $row.find('td, th').toArray();
        if (cells.length < 3) return; // Need at least a few cells
        
        const rowData: any = { team: teamAbbr };
        
        cells.forEach((cell, colIdx) => {
          const header = headers[colIdx] || `col_${colIdx}`;
          const text = $(cell).text().trim();
          
          // Map common stat names
          const headerLower = header.toLowerCase();
          if (headerLower.includes('player') || headerLower.includes('name')) {
            rowData.Player = text;
            rowData.PLAYER_NAME = text;
          } else if (headerLower.includes('min') || header === 'MIN') {
            rowData.MIN = text;
            rowData.MINUTES = text;
          } else if (headerLower.includes('pts') || header === 'PTS') {
            rowData.PTS = parseInt(text) || 0;
            rowData.POINTS = parseInt(text) || 0;
          } else if (headerLower.includes('reb') || header === 'REB') {
            rowData.REB = parseInt(text) || 0;
            rowData.REBOUNDS = parseInt(text) || 0;
          } else if (headerLower.includes('ast') || header === 'AST') {
            rowData.AST = parseInt(text) || 0;
            rowData.ASSISTS = parseInt(text) || 0;
          } else if (headerLower.includes('fg') && !headerLower.includes('3')) {
            rowData.FG = text;
          } else if (headerLower.includes('3') || header === '3PT' || header === '3P') {
            rowData['3PT'] = text;
            rowData['3P'] = text;
          } else if (headerLower.includes('ft') || header === 'FT') {
            rowData.FT = text;
          }
          
          // Also store raw header mapping
          rowData[header] = text;
        });

        // Only add if it looks like a player row (has name and at least one stat)
        if (rowData.Player || rowData.PLAYER_NAME) {
          if (rowData.MIN || rowData.PTS || rowData.REB || rowData.AST) {
            playerStats.push(rowData);
          }
        }
      });
    });
  }

  if (playerStats.length > 0) {
    console.log(`   ✅ Found ${playerStats.length} player stat rows in HTML tables`);
    return {
      source: 'nba_com_html',
      playerStats,
    };
  }

  // Method 3: Look for data attributes
  const dataElements: any = {};
  $('[data-testid*="player"], [data-testid*="stat"]').each((i, el) => {
    const testId = $(el).attr('data-testid');
    const text = $(el).text().trim();
    if (testId && text) {
      dataElements[testId] = text;
    }
  });

  if (Object.keys(dataElements).length > 0) {
    console.log(`   ⚠️  Found ${Object.keys(dataElements).length} data-testid elements`);
    return {
      source: 'nba_com_data_attrs',
      dataElements,
    };
  }

  throw new Error('Could not extract box score data from HTML page');
}

/**
 * Scrape box score from ESPN (alternative source)
 */
async function scrapeESPNBoxScore(gameId: string): Promise<any> {
  // ESPN URL format: https://www.espn.com/nba/boxscore/_/gameId/{gameId}
  // Note: ESPN game IDs are different from NBA Stats IDs
  // For now, we'll skip ESPN as it requires different game ID mapping
  throw new Error('ESPN scraping not yet implemented (requires ESPN game ID mapping)');
}

/**
 * Parse and display box score data
 */
function displayBoxScore(data: any, gameId: string, homeAbbr: string, awayAbbr: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Box Score: ${awayAbbr.toUpperCase()} @ ${homeAbbr.toUpperCase()}`);
  console.log(`Game ID: ${gameId}`);
  console.log(`Source: ${data.source}`);
  console.log(`${'='.repeat(60)}\n`);

  // Handle both JSON format (from Next.js) and HTML table format
  let playerStats = data.playerStats;
  
  // If we have boxScore with resultSets, extract player stats
  if (!playerStats && data.boxScore?.resultSets) {
    const playerStatsSet = data.boxScore.resultSets.find((rs: any) => 
      rs.name === 'PlayerStats' || 
      rs.name === 'PlayerGameStats' ||
      (rs.headers && rs.headers.includes('PLAYER_NAME'))
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
  
  if (playerStats && Array.isArray(playerStats)) {
    // Group by team
    const byTeam: Record<string, any[]> = {};
    playerStats.forEach((p: any) => {
      const team = p.team || p.TEAM_ABBREVIATION || p.TEAM_ID || 'UNK';
      if (!byTeam[team]) byTeam[team] = [];
      byTeam[team].push(p);
    });

    Object.entries(byTeam).forEach(([team, players]) => {
      console.log(`\n${team} (${players.length} players):`);
      console.log('   Player'.padEnd(25) + 'MIN'.padEnd(8) + 'PTS'.padEnd(6) + 'REB'.padEnd(6) + 'AST'.padEnd(6) + 'FG'.padEnd(10) + '3PT'.padEnd(10) + 'FT');
      console.log('   ' + '-'.repeat(80));
      
      const validPlayers = players
        .filter((p: any) => {
          const name = p.Player || p.PLAYER_NAME || p.name || p['Player'] || '';
          return name && 
                 name !== 'Team Totals' && 
                 !name.includes('Totals') &&
                 !name.includes('MIN') &&
                 name.length > 1;
        })
        .sort((a: any, b: any) => {
          const aPts = a.PTS || a.POINTS || 0;
          const bPts = b.PTS || b.POINTS || 0;
          return bPts - aPts;
        })
        .slice(0, 10); // Show top 10 players
      
      if (validPlayers.length === 0) {
        console.log('   ⚠️  No valid player rows found');
        // Debug: show first few rows
        if (players.length > 0) {
          console.log('   Sample row:', JSON.stringify(players[0], null, 2).substring(0, 200));
        }
      } else {
        validPlayers.forEach((p: any) => {
          const name = (p.Player || p.PLAYER_NAME || p.name || p['Player'] || 'Unknown').substring(0, 23);
          const min = String(p.MIN || p.MINUTES || p['MIN'] || '0:00').substring(0, 7);
          const pts = String(p.PTS || p.POINTS || p['PTS'] || 0).substring(0, 5);
          const reb = String(p.REB || p.REBOUNDS || p['REB'] || 0).substring(0, 5);
          const ast = String(p.AST || p.ASSISTS || p['AST'] || 0).substring(0, 5);
          const fg = String(p.FG || p['FG'] || '0-0').substring(0, 9);
          const threePt = String(p['3PT'] || p['3P'] || '0-0').substring(0, 9);
          const ft = String(p.FT || p['FT'] || '0-0').substring(0, 9);
          
          console.log(
            `   ${name.padEnd(23)}${min.padEnd(8)}${pts.padEnd(6)}${reb.padEnd(6)}${ast.padEnd(6)}${fg.padEnd(10)}${threePt.padEnd(10)}${ft}`
          );
        });
      }
    });
  } else {
    console.log('⚠️  No player stats found in parsed data');
    console.log('Raw data keys:', Object.keys(data));
  }
}

async function main() {
  console.log('🏀 Testing Live Box Scores via HTML Scraping\n');

  const args = process.argv.slice(2);
  
  try {
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

      const data = await scrapeNBAComBoxScore(gameId, teamAbbrs.homeAbbr, teamAbbrs.awayAbbr);
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
        console.log(`\n[${i + 1}/${games.length}] Testing game: ${game.game_id}`);
        
        try {
          const data = await scrapeNBAComBoxScore(game.game_id, game.home_abbr, game.away_abbr);
          displayBoxScore(data, game.game_id, game.home_abbr, game.away_abbr);
          
          // Add delay between games
          if (i < games.length - 1) {
            await sleep(addJitter(BASE_DELAY_MS));
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
    await pool.end();
  }
}

main();

