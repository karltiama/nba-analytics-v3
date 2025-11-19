import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Safely fetch missing box scores for games in a date range.
 * 
 * This script:
 * 1. Finds Final games without box scores in the specified date range
 * 2. Fetches box scores from NBA.com using our scraper
 * 3. Parses and stores player stats safely with rate limiting
 * 
 * Usage:
 *   tsx scripts/fetch-missing-boxscores.ts --start-date 2025-10-21 --end-date 2025-11-17
 *   tsx scripts/fetch-missing-boxscores.ts --start-date 2025-10-21 --end-date 2025-11-17 --dry-run
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BASE_DELAY_MS = Number.parseInt(process.env.NBA_SCRAPE_DELAY_MS || '2000', 10);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const MAX_REQUESTS_PER_HOUR = Number.parseInt(process.env.NBA_SCRAPE_MAX_PER_HOUR || '1000', 10);

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

// NBA.com headers
const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Rate limiting tracking
let requestCount = 0;
let requestWindowStart = Date.now();
const REQUEST_WINDOW_MS = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function addJitter(delayMs: number): number {
  const jitter = Math.random() * delayMs * 0.2;
  return Math.floor(delayMs + jitter);
}

function checkRateLimit(): void {
  const now = Date.now();
  if (now - requestWindowStart > REQUEST_WINDOW_MS) {
    requestCount = 0;
    requestWindowStart = now;
  }
  if (requestCount >= MAX_REQUESTS_PER_HOUR) {
    const waitTime = REQUEST_WINDOW_MS - (now - requestWindowStart);
    throw new Error(
      `Rate limit exceeded: ${requestCount} requests in this hour. ` +
      `Wait ${Math.ceil(waitTime / 1000 / 60)} minutes before retrying.`
    );
  }
  requestCount++;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<Response> {
  checkRateLimit();
  
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

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter 
          ? parseInt(retryAfter) * 1000 
          : RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`⚠️  Rate limited (429). Waiting ${Math.ceil(delay / 1000)}s...`);
        await sleep(addJitter(delay));
        continue;
      }

      if (response.status === 503) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`⚠️  Service unavailable (503). Waiting ${Math.ceil(delay / 1000)}s...`);
        await sleep(addJitter(delay));
        continue;
      }

      if (response.status === 403 || response.status === 401) {
        throw new Error(`HTTP ${response.status}: Access denied`);
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
 * Fetch game summary to check status
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
 * Fetch box score for a game using V3 endpoint (better structure)
 */
async function fetchBoxScore(gameId: string): Promise<any> {
  const url = new URL('https://stats.nba.com/stats/boxscoretraditionalv3');
  url.searchParams.set('GameID', gameId);

  const response = await fetchWithRetry(url.toString());
  const data = await response.json();
  await sleep(addJitter(BASE_DELAY_MS));
  return data;
}

/**
 * Check if game is actually Final by querying NBA.com
 */
async function isGameFinal(nbaGameId: string): Promise<boolean> {
  try {
    const summaryData = await fetchGameSummary(nbaGameId);
    const gameSummary = summaryData.resultSets?.find((rs: any) => rs.name === 'GameSummary');
    
    if (!gameSummary || !gameSummary.rowSet || gameSummary.rowSet.length === 0) {
      return false;
    }

    const headers = gameSummary.headers;
    const row = gameSummary.rowSet[0];
    const statusIndex = headers.indexOf('GAME_STATUS_TEXT');
    
    if (statusIndex === -1) return false;
    
    const statusText = row[statusIndex]?.toLowerCase() || '';
    return statusText === 'final' || statusText.includes('final');
  } catch (error) {
    console.warn(`   ⚠️  Could not check game status: ${error}`);
    return false;
  }
}

/**
 * Parse minutes from MM:SS format to decimal minutes
 */
function parseMinutes(value: string | null | undefined): number | null {
  if (!value || value === '' || value === '0' || value === '0:00') {
    return 0;
  }
  try {
    const parts = value.split(':');
    if (parts.length !== 2) return null;
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    return Math.round((minutes + seconds / 60) * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Get games missing box scores in date range
 */
async function getGamesMissingBoxScores(startDate: string, endDate: string): Promise<Array<{
  game_id: string;
  nba_game_id: string;
  season: string;
  start_time: Date;
  home_team_id: string;
  away_team_id: string;
}>> {
  const result = await pool.query(`
    SELECT DISTINCT
      g.game_id,
      COALESCE(
        (SELECT provider_id FROM provider_id_map 
         WHERE entity_type = 'game' AND provider = 'nba' AND internal_id = g.game_id LIMIT 1),
        CASE WHEN g.game_id LIKE '002%' THEN g.game_id ELSE NULL END
      ) as nba_game_id,
      g.season,
      g.start_time,
      g.home_team_id,
      g.away_team_id
    FROM games g
    LEFT JOIN player_game_stats pgs ON g.game_id = pgs.game_id
    WHERE g.status = 'Final'
      AND g.start_time::date BETWEEN $1::date AND $2::date
      AND pgs.game_id IS NULL
      AND (
        g.game_id LIKE '002%' OR
        EXISTS (
          SELECT 1 FROM provider_id_map pm
          WHERE pm.entity_type = 'game'
            AND pm.provider = 'nba'
            AND pm.internal_id = g.game_id
        )
      )
      AND COALESCE(
        (SELECT provider_id FROM provider_id_map 
         WHERE entity_type = 'game' AND provider = 'nba' AND internal_id = g.game_id LIMIT 1),
        CASE WHEN g.game_id LIKE '002%' THEN g.game_id ELSE NULL END
      ) IS NOT NULL
    ORDER BY g.start_time ASC
    LIMIT 100
  `, [startDate, endDate]);

  return result.rows;
}

/**
 * Resolve player ID from NBA Stats player ID
 */
async function resolvePlayerId(nbaPlayerId: string, playerName: string): Promise<string | null> {
  // Check provider_id_map first
  const mappingResult = await pool.query(`
    SELECT internal_id
    FROM provider_id_map
    WHERE entity_type = 'player'
      AND provider = 'nba'
      AND provider_id = $1
    LIMIT 1
  `, [nbaPlayerId.toString()]);

  if (mappingResult.rows.length > 0) {
    const internalId = mappingResult.rows[0].internal_id;
    // Verify player exists
    const playerCheck = await pool.query(
      'SELECT player_id FROM players WHERE player_id = $1',
      [internalId]
    );
    if (playerCheck.rows.length > 0) {
      return internalId;
    }
  }

  // Try to find by name
  const nameParts = playerName.split(' ');
  if (nameParts.length >= 2) {
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    
    const nameResult = await pool.query(`
      SELECT player_id
      FROM players
      WHERE (first_name ILIKE $1 AND last_name ILIKE $2)
         OR full_name ILIKE $3
      LIMIT 1
    `, [firstName, lastName, `%${playerName}%`]);

    if (nameResult.rows.length > 0) {
      const playerId = nameResult.rows[0].player_id;
      // Create provider mapping
      await pool.query(`
        INSERT INTO provider_id_map (entity_type, internal_id, provider, provider_id, created_at, updated_at)
        VALUES ('player', $1, 'nba', $2, now(), now())
        ON CONFLICT (entity_type, provider, provider_id) DO NOTHING
      `, [playerId, nbaPlayerId.toString()]);
      return playerId;
    }
  }

  // Player not found
  console.warn(`⚠️  Player not found: ${playerName} (NBA ID: ${nbaPlayerId})`);
  return null;
}

/**
 * Resolve team ID from NBA Stats team ID
 */
async function resolveTeamId(nbaTeamId: string): Promise<string | null> {
  const result = await pool.query(`
    SELECT internal_id
    FROM provider_id_map
    WHERE entity_type = 'team'
      AND provider = 'nba'
      AND provider_id = $1
    LIMIT 1
  `, [nbaTeamId.toString()]);

  return result.rows.length > 0 ? result.rows[0].internal_id : null;
}

/**
 * Process and store box score for a game
 */
async function processBoxScore(
  gameId: string,
  nbaGameId: string,
  dryRun: boolean = false
): Promise<boolean> {
  try {
    console.log(`\n📊 Processing game ${gameId} (NBA ID: ${nbaGameId})...`);

    if (dryRun) {
      console.log(`   [DRY RUN] Would fetch box score for ${nbaGameId}`);
      return true;
    }

    // First check if game is actually Final
    const actuallyFinal = await isGameFinal(nbaGameId);
    if (!actuallyFinal) {
      console.log(`   ⏭️  Game is not Final yet, skipping (will update status in database)`);
      // Update game status to Scheduled
      await pool.query(
        `UPDATE games SET status = 'Scheduled', updated_at = now() WHERE game_id = $1`,
        [gameId]
      );
      return false;
    }

    const boxScoreData = await fetchBoxScore(nbaGameId);

    // V3 endpoint returns boxScoreTraditional object with homeTeam/awayTeam
    const boxscore = boxScoreData.boxScoreTraditional;
    if (!boxscore || !boxscore.homeTeam || !boxscore.awayTeam) {
      console.warn(`   ⚠️  No box score data returned for game ${nbaGameId}`);
      return false;
    }

    const homeTeam = boxscore.homeTeam;
    const awayTeam = boxscore.awayTeam;
    const allPlayers = [
      ...(homeTeam.players || []).map((p: any) => ({ ...p, teamId: homeTeam.teamId })),
      ...(awayTeam.players || []).map((p: any) => ({ ...p, teamId: awayTeam.teamId })),
    ];

    if (allPlayers.length === 0) {
      console.warn(`   ⚠️  No player stats found for game ${nbaGameId}`);
      return false;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let inserted = 0;
      let skipped = 0;

      for (const player of allPlayers) {
        const playerId = player.personId?.toString();
        const playerName = `${player.firstName || ''} ${player.familyName || ''}`.trim();
        const teamId = player.teamId?.toString();
        const stats = player.statistics || {};
        
        const minutes = parseMinutes(stats.minutes);
        const points = stats.points ?? null;
        const rebounds = stats.reboundsTotal ?? null;
        const assists = stats.assists ?? null;
        const steals = stats.steals ?? null;
        const blocks = stats.blocks ?? null;
        const turnovers = stats.turnovers ?? null;
        const fgm = stats.fieldGoalsMade ?? null;
        const fga = stats.fieldGoalsAttempted ?? null;
        const fg3m = stats.threePointersMade ?? null;
        const fg3a = stats.threePointersAttempted ?? null;
        const ftm = stats.freeThrowsMade ?? null;
        const fta = stats.freeThrowsAttempted ?? null;
        const plusMinus = stats.plusMinusPoints ?? null;
        const startPosition = player.position || '';
        const comment = player.comment || '';

        if (!playerId || !teamId) {
          skipped++;
          continue;
        }

        // Resolve player and team IDs
        const internalPlayerId = await resolvePlayerId(playerId, playerName);
        const internalTeamId = await resolveTeamId(teamId);

        if (!internalPlayerId || !internalTeamId) {
          skipped++;
          continue;
        }

        // Insert player game stats
        await client.query(`
          INSERT INTO player_game_stats (
            game_id, player_id, team_id, minutes, points, rebounds, assists,
            steals, blocks, turnovers, field_goals_made, field_goals_attempted,
            three_pointers_made, three_pointers_attempted, free_throws_made,
            free_throws_attempted, plus_minus, started, dnp_reason,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now(), now())
          ON CONFLICT (game_id, player_id) DO UPDATE SET
            minutes = EXCLUDED.minutes,
            points = EXCLUDED.points,
            rebounds = EXCLUDED.rebounds,
            assists = EXCLUDED.assists,
            steals = EXCLUDED.steals,
            blocks = EXCLUDED.blocks,
            turnovers = EXCLUDED.turnovers,
            field_goals_made = EXCLUDED.field_goals_made,
            field_goals_attempted = EXCLUDED.field_goals_attempted,
            three_pointers_made = EXCLUDED.three_pointers_made,
            three_pointers_attempted = EXCLUDED.three_pointers_attempted,
            free_throws_made = EXCLUDED.free_throws_made,
            free_throws_attempted = EXCLUDED.free_throws_attempted,
            plus_minus = EXCLUDED.plus_minus,
            started = EXCLUDED.started,
            dnp_reason = EXCLUDED.dnp_reason,
            updated_at = now()
        `, [
          gameId,
          internalPlayerId,
          internalTeamId,
          minutes,
          points,
          rebounds,
          assists,
          steals,
          blocks,
          turnovers,
          fgm,
          fga,
          fg3m,
          fg3a,
          ftm,
          fta,
          plusMinus,
          startPosition !== '' && startPosition !== null,
          comment || null,
        ]);

        inserted++;
      }

      await client.query('COMMIT');
      console.log(`   ✅ Inserted ${inserted} player stats${skipped > 0 ? `, skipped ${skipped}` : ''}`);
      return inserted > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error(`   ❌ Error processing game ${gameId}:`, error.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const startDateIndex = args.indexOf('--start-date');
  const endDateIndex = args.indexOf('--end-date');
  const dryRun = args.includes('--dry-run');

  if (startDateIndex === -1 || !args[startDateIndex + 1]) {
    console.error('Missing --start-date');
    process.exit(1);
  }

  if (endDateIndex === -1 || !args[endDateIndex + 1]) {
    console.error('Missing --end-date');
    process.exit(1);
  }

  const startDate = args[startDateIndex + 1];
  const endDate = args[endDateIndex + 1];

  try {
    console.log(`\n🔍 Finding games missing box scores from ${startDate} to ${endDate}...`);
    const games = await getGamesMissingBoxScores(startDate, endDate);

    if (games.length === 0) {
      console.log('✅ No games missing box scores in this date range!');
      return;
    }

    console.log(`\n📋 Found ${games.length} games missing box scores`);
    
    if (dryRun) {
      console.log('\n🔍 [DRY RUN] Games that would be processed:');
      games.forEach((g, idx) => {
        console.log(`   ${idx + 1}. ${g.game_id} (NBA: ${g.nba_game_id}) - ${g.start_time.toISOString().split('T')[0]}`);
      });
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      console.log(`\n[${i + 1}/${games.length}] Processing game ${game.game_id}...`);

      if (!game.nba_game_id) {
        console.warn(`   ⚠️  No NBA game ID found for ${game.game_id}, skipping`);
        failCount++;
        continue;
      }

      const success = await processBoxScore(game.game_id, game.nba_game_id, false);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Progress update
      if ((i + 1) % 10 === 0) {
        console.log(`\n📊 Progress: ${i + 1}/${games.length} games processed (${successCount} success, ${failCount} failed)`);
        console.log(`   Rate limit: ${requestCount}/${MAX_REQUESTS_PER_HOUR} requests this hour`);
      }
    }

    console.log(`\n✅ Completed!`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`   Total requests: ${requestCount}`);
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

