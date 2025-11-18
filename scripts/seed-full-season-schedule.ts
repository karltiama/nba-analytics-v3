import 'dotenv/config';
import { Pool } from 'pg';
import { z } from 'zod';

/**
 * One-time script to fetch and store the entire NBA season schedule.
 * 
 * This should be run once before the season starts (or early in the season)
 * to pre-populate all scheduled games. The daily ETL can then just update
 * statuses and scores instead of discovering games.
 * 
 * Usage:
 *   tsx scripts/seed-full-season-schedule.ts --season 2025
 *   tsx scripts/seed-full-season-schedule.ts --season 2025 --start-date 2025-10-21 --end-date 2026-04-15
 */

const BALLDONTLIE_BASE_URL = 'https://api.balldontlie.io/v1';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;
// Free tier: 5 requests/min = 12 seconds between requests
const REQUEST_DELAY_MS = Number.parseInt(process.env.BALLDONTLIE_REQUEST_DELAY_MS || '12000', 10);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 60000; // Start with 60 seconds for 429 errors

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

if (!BALLDONTLIE_API_KEY) {
  console.error('Missing BALLDONTLIE_API_KEY. Set it in your .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const GameSchema = z.object({
  id: z.number(),
  date: z.string(),
  season: z.number(),
  status: z.string(),
  home_team: z.object({
    id: z.number(),
    abbreviation: z.string(),
    city: z.string().optional().nullable(),
    conference: z.string().optional().nullable(),
    division: z.string().optional().nullable(),
    full_name: z.string(),
    name: z.string(),
  }),
  visitor_team: z.object({
    id: z.number(),
    abbreviation: z.string(),
    city: z.string().optional().nullable(),
    conference: z.string().optional().nullable(),
    division: z.string().optional().nullable(),
    full_name: z.string(),
    name: z.string(),
  }),
  home_team_score: z.number().nullable(),
  visitor_team_score: z.number().nullable(),
  time: z.string().optional().nullable(),
  postseason: z.boolean().optional().default(false),
});

const GamesResponseSchema = z.object({
  data: z.array(GameSchema),
  meta: z
    .object({
      next_cursor: z.number().nullable().optional(),
      per_page: z.number().optional(),
    })
    .optional()
    .default({ next_cursor: null }),
});

type GameRecord = z.infer<typeof GameSchema>;

const normalizeSeason = (season: number): string => {
  return `${season}-${String(season + 1).slice(-2)}`;
};

const parseGameDate = (dateStr: string, timeStr?: string | null): Date => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  // Return as UTC (you may want to adjust timezone handling)
  return date;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      const retryDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `Rate limited (429). Waiting ${retryDelay / 1000}s before retry (attempt ${attempt + 1}/${retries + 1})...`,
      );
      await sleep(retryDelay);
      continue;
    }

    if (!response.ok && response.status >= 500 && attempt < retries) {
      const retryDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `Server error (${response.status}). Waiting ${retryDelay / 1000}s before retry (attempt ${attempt + 1}/${retries + 1})...`,
      );
      await sleep(retryDelay);
      continue;
    }

    return response;
  }

  throw new Error(`Failed after ${retries + 1} attempts`);
};

const fetchGames = async (startDate: string, endDate: string, season: number) => {
  const games: GameRecord[] = [];
  let cursor: number | null = null;
  let pageCount = 0;

  while (true) {
    pageCount++;
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      'seasons[]': String(season),
      per_page: '100',
    });

    if (cursor !== null) {
      params.append('cursor', String(cursor));
    }

    console.log(`Fetching page ${pageCount}... (cursor: ${cursor ?? 'none'})`);

    const response = await fetchWithRetry(`${BALLDONTLIE_BASE_URL}/games?${params.toString()}`, {
      headers: {
        Authorization: BALLDONTLIE_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch games (status ${response.status})`);
    }

    const parsed = GamesResponseSchema.parse(await response.json());
    games.push(...parsed.data);
    console.log(`  Fetched ${parsed.data.length} games (total: ${games.length})`);

    cursor = parsed.meta?.next_cursor ?? null;
    if (!cursor) {
      break;
    }

    // Rate limit delay between requests
    await sleep(REQUEST_DELAY_MS);
  }

  return games;
};

const resolveTeamMapping = async (client: any): Promise<Map<string, string>> => {
  const result = await client.query(
    `
    select provider_id, internal_id
    from provider_id_map
    where entity_type = 'team'
      and provider = 'balldontlie'
    `,
  );

  const mapping = new Map<string, string>();
  for (const row of result.rows) {
    mapping.set(row.provider_id, row.internal_id);
  }

  if (mapping.size === 0) {
    throw new Error("No team mappings found for provider='balldontlie'. Seed teams first.");
  }

  return mapping;
};

const UPSERT_GAME = `
  insert into games (
    game_id, season, start_time, status, home_team_id, away_team_id,
    home_score, away_score, venue, created_at, updated_at
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
  on conflict (game_id) do update set
    season = excluded.season,
    start_time = excluded.start_time,
    status = excluded.status,
    home_team_id = excluded.home_team_id,
    away_team_id = excluded.away_team_id,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    venue = excluded.venue,
    updated_at = now();
`;

const UPSERT_PROVIDER_MAP_GAME = `
  insert into provider_id_map (
    entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
  ) values ('game', $1, 'balldontlie', $2, $3::jsonb, now(), now(), now())
  on conflict (entity_type, provider, provider_id) do update set
    internal_id = excluded.internal_id,
    metadata = excluded.metadata,
    fetched_at = excluded.fetched_at,
    updated_at = now();
`;

const main = async () => {
  const args = process.argv.slice(2);
  
  // Parse season (required)
  const seasonIndex = args.indexOf('--season');
  if (seasonIndex === -1 || !args[seasonIndex + 1]) {
    console.error('Usage: tsx scripts/seed-full-season-schedule.ts --season 2025 [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]');
    console.error('');
    console.error('Examples:');
    console.error('  tsx scripts/seed-full-season-schedule.ts --season 2025');
    console.error('  tsx scripts/seed-full-season-schedule.ts --season 2025 --start-date 2025-10-21 --end-date 2026-04-15');
    process.exit(1);
  }

  const season = Number.parseInt(args[seasonIndex + 1], 10);
  if (isNaN(season)) {
    console.error(`Invalid season: ${args[seasonIndex + 1]}. Must be a year (e.g., 2025)`);
    process.exit(1);
  }

  // Parse optional date range
  let startDate: string;
  let endDate: string;

  const startDateIndex = args.indexOf('--start-date');
  const endDateIndex = args.indexOf('--end-date');

  if (startDateIndex !== -1 && args[startDateIndex + 1]) {
    startDate = args[startDateIndex + 1];
  } else {
    // Default: October 1st of the season year
    startDate = `${season}-10-01`;
  }

  if (endDateIndex !== -1 && args[endDateIndex + 1]) {
    endDate = args[endDateIndex + 1];
  } else {
    // Default: June 30th of the next year (covers playoffs)
    endDate = `${season + 1}-06-30`;
  }

  // Validate dates
  const startDateObj = new Date(startDate);
  const endDateObj = new Date(endDate);
  if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
    console.error('Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  if (endDateObj < startDateObj) {
    console.error('End date must be after start date');
    process.exit(1);
  }

  console.log(`Fetching full season schedule for ${season}-${String(season + 1).slice(-2)}`);
  console.log(`Date range: ${startDate} to ${endDate}`);
  console.log('');

  const client = await pool.connect();

  try {
    const teamMap = await resolveTeamMapping(client);
    console.log(`Resolved ${teamMap.size} team mappings`);
    console.log('');

    // Fetch all games for the season
    const games = await fetchGames(startDate, endDate, season);
    console.log('');
    console.log(`Total games fetched: ${games.length}`);
    console.log('');

    if (games.length === 0) {
      console.log('No games found. The schedule may not be available yet.');
      return;
    }

    // Process and insert games
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      
      try {
        await client.query('begin');

        const homeTeamId = String(game.home_team.id);
        const awayTeamId = String(game.visitor_team.id);

        const homeInternalId = teamMap.get(homeTeamId);
        const awayInternalId = teamMap.get(awayTeamId);

        if (!homeInternalId || !awayInternalId) {
          console.warn(
            `[${i + 1}/${games.length}] Skipping game ${game.id}: Missing team mapping (home=${homeTeamId}, away=${awayTeamId})`,
          );
          await client.query('rollback');
          skipped++;
          continue;
        }

        const internalGameId = String(game.id);
        const startTime = parseGameDate(game.date, game.time);
        const seasonStr = normalizeSeason(game.season);

        // Check if game already exists
        const existingResult = await client.query(
          'select game_id from games where game_id = $1',
          [internalGameId],
        );
        const isNew = existingResult.rows.length === 0;

        const insertValues = [
          internalGameId,
          seasonStr,
          startTime,
          game.status,
          homeInternalId,
          awayInternalId,
          game.home_team_score,
          game.visitor_team_score,
          null, // venue
        ];

        await client.query(UPSERT_GAME, insertValues);

        await client.query(UPSERT_PROVIDER_MAP_GAME, [
          internalGameId,
          String(game.id),
          JSON.stringify({ source: 'balldontlie', postseason: game.postseason }),
        ]);

        await client.query('commit');

        if (isNew) {
          inserted++;
        } else {
          updated++;
        }

        if ((i + 1) % 50 === 0) {
          console.log(`Processed ${i + 1}/${games.length} games... (${inserted} inserted, ${updated} updated, ${skipped} skipped)`);
        }
      } catch (error) {
        await client.query('rollback');
        console.error(`[${i + 1}/${games.length}] Failed to process game ${game.id}:`, error);
        errors++;
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Summary:');
    console.log(`  Total games fetched: ${games.length}`);
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Errors: ${errors}`);
    console.log('='.repeat(60));
    console.log('');
    console.log('Schedule seeding complete!');
    console.log('');
    console.log('Next steps:');
    console.log('  - Run daily ETL to update game statuses and scores');
    console.log('  - Games are stored with status from BallDontLie API');
    console.log('  - Daily ETL can query games WHERE status != \'Final\' to update');
  } catch (error) {
    console.error('Failed to seed schedule:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error('Unexpected error during schedule seed:', error);
  process.exit(1);
});

