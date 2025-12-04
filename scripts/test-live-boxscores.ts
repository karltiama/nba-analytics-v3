import 'dotenv/config';

/**
 * Test Script: Live Box Scores from NBA.com API
 * 
 * Fetches today's games and their live box scores from NBA.com's official API
 * 
 * Usage:
 *   tsx scripts/test-live-boxscores.ts
 *   tsx scripts/test-live-boxscores.ts --date 2025-01-15
 */

const BASE_DELAY_MS = 2000; // 2 seconds between requests
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// NBA.com requires specific headers
const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
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
 * Get today's date in MM/DD/YYYY format for NBA API
 */
function getTodaysDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = now.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Fetch scoreboard (games for a specific date)
 */
async function fetchScoreboard(date: string): Promise<any> {
  const url = new URL('https://stats.nba.com/stats/scoreboardV2');
  url.searchParams.set('GameDate', date);
  url.searchParams.set('LeagueID', '00');
  url.searchParams.set('DayOffset', '0');

  console.log(`📅 Fetching scoreboard for ${date}...`);
  const response = await fetchWithRetry(url.toString());
  const data = await response.json();
  
  await sleep(addJitter(BASE_DELAY_MS));

  return data;
}

/**
 * Fetch box score for a specific game
 */
async function fetchBoxScore(gameId: string): Promise<any> {
  const url = new URL('https://stats.nba.com/stats/boxscoretraditionalv2');
  url.searchParams.set('GameID', gameId);
  url.searchParams.set('EndPeriod', '10');
  url.searchParams.set('EndRange', '0');
  url.searchParams.set('RangeType', '0');
  url.searchParams.set('StartPeriod', '1');
  url.searchParams.set('StartRange', '0');

  const response = await fetchWithRetry(url.toString());
  const data = await response.json();
  
  await sleep(addJitter(BASE_DELAY_MS));

  return data;
}

/**
 * Fetch game summary (includes quarter scores, live status)
 */
async function fetchGameSummary(gameId: string): Promise<any> {
  const url = new URL('https://stats.nba.com/stats/boxscoresummaryv2');
  url.searchParams.set('GameID', gameId);

  const response = await fetchWithRetry(url.toString());
  const data = await response.json();
  
  await sleep(addJitter(BASE_DELAY_MS));

  return data;
}

/**
 * Parse scoreboard response and extract games
 */
function parseScoreboard(data: any): Array<{
  gameId: string;
  date: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  period: number | null;
  timeRemaining: string | null;
}> {
  if (!data.resultSets || data.resultSets.length === 0) {
    return [];
  }

  const gameHeader = data.resultSets[0];
  const headers = gameHeader.headers;
  const rows = gameHeader.rowSet || [];

  // Get team info from resultSets - try multiple resultSets
  const teamMap: Record<number, { abbr: string }> = {};
  
  // Try resultSets[5] (LineScore) first
  const lineScore = data.resultSets[5];
  if (lineScore) {
    const lineScoreHeaders = lineScore.headers || [];
    const lineScoreRows = lineScore.rowSet || [];
    
    lineScoreRows.forEach((row: any[]) => {
      const team: any = {};
      lineScoreHeaders.forEach((header: string, idx: number) => {
        team[header] = row[idx];
      });
      if (team.TEAM_ID && team.TEAM_ABBREVIATION) {
        teamMap[team.TEAM_ID] = { abbr: team.TEAM_ABBREVIATION };
      }
    });
  }
  
  // Also try resultSets[1] (EastConfStandingsByDay) or other resultSets
  // Check all resultSets for team info
  data.resultSets.forEach((resultSet: any, idx: number) => {
    if (resultSet.headers && resultSet.rowSet) {
      const headers = resultSet.headers;
      const rows = resultSet.rowSet;
      
      rows.forEach((row: any[]) => {
        const item: any = {};
        headers.forEach((header: string, i: number) => {
          item[header] = row[i];
        });
        if (item.TEAM_ID && item.TEAM_ABBREVIATION && !teamMap[item.TEAM_ID]) {
          teamMap[item.TEAM_ID] = { abbr: item.TEAM_ABBREVIATION };
        }
      });
    }
  });

  const games = rows.map((row: any[]) => {
    const game: any = {};
    headers.forEach((header: string, idx: number) => {
      game[header] = row[idx];
    });

    return {
      gameId: game.GAME_ID?.toString() || '',
      date: game.GAME_DATE_EST || '',
      homeTeamId: game.HOME_TEAM_ID,
      awayTeamId: game.VISITOR_TEAM_ID,
      homeTeamAbbr: teamMap[game.HOME_TEAM_ID]?.abbr || 'UNK',
      awayTeamAbbr: teamMap[game.VISITOR_TEAM_ID]?.abbr || 'UNK',
      homeScore: game.HOME_TEAM_SCORE || null,
      awayScore: game.VISITOR_TEAM_SCORE || null,
      status: game.GAME_STATUS_TEXT || 'Scheduled',
      period: game.LIVE_PERIOD || null,
      timeRemaining: game.LIVE_PC_TIME || null,
    };
  });

  return games;
}

/**
 * Parse box score response
 */
function parseBoxScore(data: any): {
  players: Array<{
    name: string;
    team: string;
    minutes: string;
    points: number;
    rebounds: number;
    assists: number;
    fg: string;
    threePt: string;
    ft: string;
  }>;
} {
  if (!data.resultSets || data.resultSets.length === 0) {
    return { players: [] };
  }

  const playerStats = data.resultSets[0];
  const headers = playerStats.headers;
  const rows = playerStats.rowSet || [];

  const players = rows.map((row: any[]) => {
    const player: any = {};
    headers.forEach((header: string, idx: number) => {
      player[header] = row[idx];
    });

    return {
      name: `${player.PLAYER_FIRST_NAME || ''} ${player.PLAYER_LAST_NAME || ''}`.trim(),
      team: player.TEAM_ABBREVIATION || '',
      minutes: player.MIN || '0:00',
      points: player.PTS || 0,
      rebounds: player.REB || 0,
      assists: player.AST || 0,
      fg: `${player.FGM || 0}-${player.FGA || 0}`,
      threePt: `${player.FG3M || 0}-${player.FG3A || 0}`,
      ft: `${player.FTM || 0}-${player.FTA || 0}`,
    };
  });

  return { players };
}

/**
 * Parse game summary response
 */
function parseGameSummary(data: any): {
  quarters: Array<{ team: string; q1: number; q2: number; q3: number; q4: number; total: number }>;
  status: string;
  period: number | null;
  timeRemaining: string | null;
} {
  if (!data.resultSets || data.resultSets.length === 0) {
    return { quarters: [], status: 'Unknown', period: null, timeRemaining: null };
  }

  // resultSets[1] = LineScore (quarter scores)
  const lineScore = data.resultSets[1];
  const headers = lineScore?.headers || [];
  const rows = lineScore?.rowSet || [];

  const quarters = rows.map((row: any[]) => {
    const team: any = {};
    headers.forEach((header: string, idx: number) => {
      team[header] = row[idx];
    });

    return {
      team: team.TEAM_ABBREVIATION || '',
      q1: team.PTS_QTR1 || 0,
      q2: team.PTS_QTR2 || 0,
      q3: team.PTS_QTR3 || 0,
      q4: team.PTS_QTR4 || 0,
      total: team.PTS || 0,
    };
  });

  // resultSets[0] = GameSummary (game status)
  const gameSummary = data.resultSets[0];
  const gameHeaders = gameSummary?.headers || [];
  const gameRow = gameSummary?.rowSet?.[0] || [];
  const game: any = {};
  gameHeaders.forEach((header: string, idx: number) => {
    game[header] = gameRow[idx];
  });

  return {
    quarters,
    status: game.GAME_STATUS_TEXT || 'Unknown',
    period: game.LIVE_PERIOD || null,
    timeRemaining: game.LIVE_PC_TIME || null,
  };
}

async function main() {
  console.log('🏀 Testing Live Box Scores from NBA.com API\n');

  // Get date from args or use today
  const args = process.argv.slice(2);
  let dateStr: string;
  
  if (args.includes('--date')) {
    const dateIndex = args.indexOf('--date');
    const dateArg = args[dateIndex + 1];
    if (!dateArg) {
      console.error('❌ --date requires a date in YYYY-MM-DD format');
      process.exit(1);
    }
    // Convert YYYY-MM-DD to MM/DD/YYYY
    const [year, month, day] = dateArg.split('-');
    dateStr = `${month}/${day}/${year}`;
  } else {
    dateStr = getTodaysDate();
  }

  console.log(`📅 Date: ${dateStr}\n`);

  try {
    // Step 1: Fetch today's games
    const scoreboardData = await fetchScoreboard(dateStr);
    const games = parseScoreboard(scoreboardData);

    if (games.length === 0) {
      console.log('⚠️  No games found for this date');
      return;
    }

    console.log(`✅ Found ${games.length} game(s)\n`);

    // Step 2: Fetch box scores for each game
    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Game ${i + 1}/${games.length}: ${game.awayTeamAbbr} @ ${game.homeTeamAbbr}`);
      console.log(`Game ID: ${game.gameId}`);
      console.log(`Status: ${game.status}`);
      if (game.period) {
        console.log(`Period: ${game.period} | Time: ${game.timeRemaining || 'N/A'}`);
      }
      if (game.homeScore !== null && game.awayScore !== null) {
        console.log(`Score: ${game.awayTeamAbbr} ${game.awayScore} - ${game.homeScore} ${game.homeTeamAbbr}`);
      }
      console.log(`${'='.repeat(60)}\n`);

      try {
        // Fetch game summary (quarter scores, live status)
        console.log('📋 Fetching game summary...');
        const summaryData = await fetchGameSummary(game.gameId);
        const summary = parseGameSummary(summaryData);
        
        if (summary.quarters.length > 0) {
          console.log('\n📊 Quarter Scores:');
          summary.quarters.forEach((q) => {
            console.log(`   ${q.team}: Q1:${q.q1} Q2:${q.q2} Q3:${q.q3} Q4:${q.q4} Total:${q.total}`);
          });
        }

        if (summary.period) {
          console.log(`\n⏱️  Live: Period ${summary.period} | ${summary.timeRemaining || 'N/A'}`);
        }

        // Fetch box score (player stats)
        console.log('\n📊 Fetching box score...');
        const boxScoreData = await fetchBoxScore(game.gameId);
        
        // Debug: Check if we got data
        if (!boxScoreData.resultSets || boxScoreData.resultSets.length === 0) {
          console.log('⚠️  Box score API returned no resultSets');
        } else {
          console.log(`   Found ${boxScoreData.resultSets.length} resultSet(s)`);
          if (boxScoreData.resultSets[0]) {
            console.log(`   First resultSet: ${boxScoreData.resultSets[0].name || 'unnamed'}, ${boxScoreData.resultSets[0].rowSet?.length || 0} rows`);
          }
        }
        
        const boxScore = parseBoxScore(boxScoreData);

        if (boxScore.players.length > 0) {
          console.log(`\n✅ Found ${boxScore.players.length} player stat(s)\n`);
          
          // Group by team
          const byTeam: Record<string, typeof boxScore.players> = {};
          boxScore.players.forEach((p) => {
            if (!byTeam[p.team]) byTeam[p.team] = [];
            byTeam[p.team].push(p);
          });

          // Display top players by team
          Object.entries(byTeam).forEach(([team, players]) => {
            console.log(`\n${team} (${players.length} players):`);
            console.log('   Player'.padEnd(25) + 'MIN'.padEnd(8) + 'PTS'.padEnd(6) + 'REB'.padEnd(6) + 'AST'.padEnd(6) + 'FG'.padEnd(8) + '3PT'.padEnd(8) + 'FT');
            console.log('   ' + '-'.repeat(80));
            
            // Show top 5 players by points
            players
              .sort((a, b) => b.points - a.points)
              .slice(0, 5)
              .forEach((p) => {
                console.log(
                  `   ${p.name.padEnd(23)}${p.minutes.padEnd(8)}${String(p.points).padEnd(6)}${String(p.rebounds).padEnd(6)}${String(p.assists).padEnd(6)}${p.fg.padEnd(8)}${p.threePt.padEnd(8)}${p.ft}`
                );
              });
          });
        } else {
          console.log('⚠️  No player stats found (game may not have started yet)');
        }
      } catch (error: any) {
        console.error(`❌ Error fetching data for game ${game.gameId}:`, error.message);
      }

      // Add delay between games
      if (i < games.length - 1) {
        await sleep(addJitter(BASE_DELAY_MS));
      }
    }

    console.log('\n\n✅ Test complete!');
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

