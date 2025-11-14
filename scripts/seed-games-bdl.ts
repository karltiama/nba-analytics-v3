import 'dotenv/config';
import { Pool } from 'pg';
import { z } from 'zod';

const BALLDONTLIE_BASE_URL = 'https://api.balldontlie.io/v1';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;
// Free tier: 5 requests/min = 12 seconds between requests
// Increase delay if you have a paid tier
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
  // Assume Eastern timezone if no timezone info
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
      // Rate limited - exponential backoff
      const retryDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `Rate limited (429). Waiting ${retryDelay / 1000}s before retry (attempt ${attempt + 1}/${retries + 1})...`,
      );
      await sleep(retryDelay);
      continue;
    }

    if (!response.ok && response.status >= 500 && attempt < retries) {
      // Server error - retry with exponential backoff
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

  while (true) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      'seasons[]': String(season),
      per_page: '100',
    });

    if (cursor !== null) {
      params.append('cursor', String(cursor));
    }

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

const processDate = async (targetDate: Date, teamMap: Map<string, string>, client: any) => {
  const dateStr = targetDate.toISOString().split('T')[0];
  const season = targetDate.getFullYear() >= 10 ? targetDate.getFullYear() : targetDate.getFullYear() - 1;

  console.log(`Processing ${dateStr}...`);

  const games = await fetchGames(dateStr, dateStr, season);
  if (games.length === 0) {
    console.log(`No games found for ${dateStr}`);
    return;
  }

  console.log(`Found ${games.length} games for ${dateStr}`);

  for (const game of games) {
    try {
      await client.query('begin');

      const homeTeamId = String(game.home_team.id);
      const awayTeamId = String(game.visitor_team.id);

      const homeInternalId = teamMap.get(homeTeamId);
      const awayInternalId = teamMap.get(awayTeamId);

      if (!homeInternalId || !awayInternalId) {
        console.warn(
          `Missing team mapping for game ${game.id}: home=${homeTeamId}, away=${awayTeamId}`,
        );
        await client.query('rollback');
        continue;
      }

      const internalGameId = String(game.id);
      const startTime = parseGameDate(game.date, game.time);
      const seasonStr = normalizeSeason(game.season);

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

      // Also update NBA Stats games (002...) with scores if they exist
      // Match by ET date (not UTC) and team abbreviations to handle games that cross midnight ET
      // BallDontLie date is already in ET date format (YYYY-MM-DD)
      if (game.home_team_score !== null && game.visitor_team_score !== null) {
        // Check both the current date and previous day (games starting late can finish after midnight ET)
        const prevDate = new Date(dateStr);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateStr = prevDate.toISOString().split('T')[0];
        
        const updateResult = await client.query(
          `
          update games
          set home_score = $1,
              away_score = $2,
              status = $3,
              updated_at = now()
          from teams as home_team, teams as away_team
          where (
            (games.start_time at time zone 'America/New_York')::date = $4::date
            or (games.start_time at time zone 'America/New_York')::date = $5::date
          )
            and games.home_team_id = home_team.team_id
            and games.away_team_id = away_team.team_id
            and home_team.abbreviation = $6
            and away_team.abbreviation = $7
            and (games.home_score is null or games.away_score is null)
            and games.game_id like '002%'
          returning games.game_id, games.status as old_status
          `,
          [
            game.home_team_score,
            game.visitor_team_score,
            game.status,
            dateStr,
            prevDateStr,
            game.home_team.abbreviation,
            game.visitor_team.abbreviation,
          ],
        );
        
        if (updateResult.rows.length > 0) {
          console.log(
            `  Updated ${updateResult.rows.length} NBA Stats game(s) with scores - old status: ${updateResult.rows.map((r: any) => r.old_status).join(', ')}`,
          );
        }
      }

      await client.query('commit');
      console.log(`Inserted game ${internalGameId} (${game.home_team.abbreviation} vs ${game.visitor_team.abbreviation})`);
    } catch (error) {
      await client.query('rollback');
      console.error(`Failed to process game ${game.id}:`, error);
    }
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  let dates: Date[] = [];

  // Parse arguments
  if (args.includes('--yesterday')) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dates = [yesterday];
  } else {
    const dateIndex = args.indexOf('--date');
    if (dateIndex === -1 || !args[dateIndex + 1]) {
      console.error('Usage: tsx scripts/seed-games-bdl.ts --date YYYY-MM-DD [--end-date YYYY-MM-DD] [--week]');
      console.error('   or: tsx scripts/seed-games-bdl.ts --yesterday');
      process.exit(1);
    }

    const dateStr = args[dateIndex + 1];
    const targetDate = new Date(dateStr);
    if (isNaN(targetDate.getTime())) {
      console.error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD`);
      process.exit(1);
    }

    const endDateIndex = args.indexOf('--end-date');
    if (endDateIndex !== -1 && args[endDateIndex + 1]) {
      // Date range
      const endDateStr = args[endDateIndex + 1];
      const endDate = new Date(endDateStr);
      if (isNaN(endDate.getTime())) {
        console.error(`Invalid end date format: ${endDateStr}. Use YYYY-MM-DD`);
        process.exit(1);
      }
      if (endDate < targetDate) {
        console.error('End date must be after start date');
        process.exit(1);
      }
      // Generate all dates in range
      dates = [];
      const current = new Date(targetDate);
      while (current <= endDate) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
    } else if (args.includes('--week')) {
      dates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(targetDate);
        d.setDate(d.getDate() + i);
        return d;
      });
    } else {
      dates = [targetDate];
    }
  }

  const client = await pool.connect();

  try {
    const teamMap = await resolveTeamMapping(client);

    for (let i = 0; i < dates.length; i++) {
      await processDate(dates[i], teamMap, client);
      // Rate limit delay between dates (each date is a separate API call)
      if (i < dates.length - 1) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    console.log('Seed complete.');
  } catch (error) {
    console.error('Failed to seed games:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error('Unexpected error during seed:', error);
  process.exit(1);
});

