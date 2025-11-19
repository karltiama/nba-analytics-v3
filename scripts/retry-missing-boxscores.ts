import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Retry fetching box scores for Final games that don't have them yet.
 * 
 * This script is designed to run periodically (e.g., daily) to catch box scores
 * that may have been delayed. It focuses on games that:
 * 1. Are marked as Final
 * 2. Have scores (indicating game completed)
 * 3. Don't have box scores yet
 * 4. Are at least 1 day old (to account for delays)
 * 
 * Usage:
 *   tsx scripts/retry-missing-boxscores.ts                    # All eligible games
 *   tsx scripts/retry-missing-boxscores.ts --days-back 3     # Games from last 3 days
 *   tsx scripts/retry-missing-boxscores.ts --max-games 50    # Limit to 50 games
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

// Import the fetch functions from fetch-missing-boxscores.ts
// For now, we'll duplicate the necessary functions

const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

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

async function fetchGameSummary(gameId: string): Promise<any> {
  const url = new URL('https://stats.nba.com/stats/boxscoresummaryv2');
  url.searchParams.set('GameID', gameId);
  const response = await fetchWithRetry(url.toString());
  const data = await response.json();
  await sleep(addJitter(BASE_DELAY_MS));
  return data;
}

async function fetchBoxScore(gameId: string): Promise<any> {
  const url = new URL('https://stats.nba.com/stats/boxscoretraditionalv3');
  url.searchParams.set('GameID', gameId);
  const response = await fetchWithRetry(url.toString());
  const data = await response.json();
  await sleep(addJitter(BASE_DELAY_MS));
  return data;
}

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
    return false;
  }
}

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

async function resolvePlayerId(nbaPlayerId: string, playerName: string): Promise<string | null> {
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
    const playerCheck = await pool.query(
      'SELECT player_id FROM players WHERE player_id = $1',
      [internalId]
    );
    if (playerCheck.rows.length > 0) {
      return internalId;
    }
  }

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
      await pool.query(`
        INSERT INTO provider_id_map (entity_type, internal_id, provider, provider_id, created_at, updated_at)
        VALUES ('player', $1, 'nba', $2, now(), now())
        ON CONFLICT (entity_type, provider, provider_id) DO NOTHING
      `, [playerId, nbaPlayerId.toString()]);
      return playerId;
    }
  }

  return null;
}

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

async function processBoxScore(gameId: string, nbaGameId: string): Promise<boolean> {
  try {
    // Verify game is actually Final
    const actuallyFinal = await isGameFinal(nbaGameId);
    if (!actuallyFinal) {
      return false;
    }

    const boxScoreData = await fetchBoxScore(nbaGameId);
    const boxscore = boxScoreData.boxScoreTraditional;
    
    if (!boxscore || !boxscore.homeTeam || !boxscore.awayTeam) {
      return false;
    }

    const homeTeam = boxscore.homeTeam;
    const awayTeam = boxscore.awayTeam;
    const allPlayers = [
      ...(homeTeam.players || []).map((p: any) => ({ ...p, teamId: homeTeam.teamId })),
      ...(awayTeam.players || []).map((p: any) => ({ ...p, teamId: awayTeam.teamId })),
    ];

    if (allPlayers.length === 0) {
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

        const internalPlayerId = await resolvePlayerId(playerId, playerName);
        const internalTeamId = await resolveTeamId(teamId);

        if (!internalPlayerId || !internalTeamId) {
          skipped++;
          continue;
        }

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
          gameId, internalPlayerId, internalTeamId, minutes, points, rebounds,
          assists, steals, blocks, turnovers, fgm, fga, fg3m, fg3a, ftm, fta,
          plusMinus, startPosition !== '' && startPosition !== null, comment || null,
        ]);

        inserted++;
      }

      await client.query('COMMIT');
      return inserted > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const daysBackIndex = args.indexOf('--days-back');
  const maxGamesIndex = args.indexOf('--max-games');
  
  const daysBack = daysBackIndex !== -1 && args[daysBackIndex + 1]
    ? parseInt(args[daysBackIndex + 1], 10)
    : 7; // Default: last 7 days
  
  const maxGames = maxGamesIndex !== -1 && args[maxGamesIndex + 1]
    ? parseInt(args[maxGamesIndex + 1], 10)
    : 100; // Default: max 100 games

  try {
    console.log(`\n🔄 Retrying box scores for Final games from last ${daysBack} days...\n`);
    
    const games = await pool.query(`
      SELECT DISTINCT
        g.game_id,
        COALESCE(
          (SELECT provider_id FROM provider_id_map 
           WHERE entity_type = 'game' AND provider = 'nba' AND internal_id = g.game_id LIMIT 1),
          CASE WHEN g.game_id LIKE '002%' THEN g.game_id ELSE NULL END
        ) as nba_game_id,
        g.start_time,
        g.home_score,
        g.away_score
      FROM games g
      LEFT JOIN player_game_stats pgs ON g.game_id = pgs.game_id
      WHERE g.status = 'Final'
        AND g.start_time >= NOW() - INTERVAL '${daysBack} days'
        AND g.start_time < NOW() - INTERVAL '1 day'
        AND g.home_score IS NOT NULL
        AND g.away_score IS NOT NULL
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
      ORDER BY g.start_time DESC
      LIMIT $1
    `, [maxGames]);

    if (games.rows.length === 0) {
      console.log('✅ No games found that need box scores retried!');
      await pool.end();
      return;
    }

    console.log(`📋 Found ${games.rows.length} games to retry\n`);

    let successCount = 0;
    let failCount = 0;
    let notFinalCount = 0;

    for (let i = 0; i < games.rows.length; i++) {
      const game = games.rows[i];
      console.log(`[${i + 1}/${games.rows.length}] ${game.game_id} (${game.start_time.toISOString().split('T')[0]})...`);

      if (!game.nba_game_id) {
        failCount++;
        continue;
      }

      const success = await processBoxScore(game.game_id, game.nba_game_id);
      if (success) {
        successCount++;
        console.log(`   ✅ Successfully fetched box score`);
      } else {
        // Check if it's because game isn't Final yet
        const isFinal = await isGameFinal(game.nba_game_id);
        if (!isFinal) {
          notFinalCount++;
          console.log(`   ⏭️  Game not Final yet (box scores may be delayed)`);
        } else {
          failCount++;
          console.log(`   ❌ Failed to fetch box score`);
        }
      }

      if ((i + 1) % 10 === 0) {
        console.log(`\n📊 Progress: ${i + 1}/${games.rows.length} (${successCount} success, ${failCount} failed, ${notFinalCount} not Final yet)\n`);
      }
    }

    console.log(`\n✅ Completed!`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`   Not Final yet: ${notFinalCount}`);
    console.log(`   Total requests: ${requestCount}`);
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

