/**
 * Seed raw.games from BallDontLie API (no public schema).
 * After running: npx tsx scripts/transform-raw-to-analytics.ts to populate analytics.games.
 */
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

/** BDL returns date as game calendar day (Eastern). Use noon UTC so displayed day in ET is correct. */
const parseGameDate = (dateStr: string, _timeStr?: string | null): Date => {
  const date = new Date(dateStr + 'T12:00:00.000Z');
  if (isNaN(date.getTime())) throw new Error(`Invalid date: ${dateStr}`);
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


/** Upsert into raw.games only (BDL source). Run transform-raw-to-analytics to populate analytics.games. */
const UPSERT_RAW_GAME = `
  insert into raw.games (id, date, season, status, period, time, period_detail, datetime, postseason, home_team_score, visitor_team_score, home_team, visitor_team)
  values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
  on conflict (id) do update set
    date = excluded.date,
    season = excluded.season,
    status = excluded.status,
    period = excluded.period,
    time = excluded.time,
    period_detail = excluded.period_detail,
    datetime = excluded.datetime,
    postseason = excluded.postseason,
    home_team_score = excluded.home_team_score,
    visitor_team_score = excluded.visitor_team_score,
    home_team = excluded.home_team,
    visitor_team = excluded.visitor_team;
`;

const processDate = async (targetDate: Date, _teamMap: Map<string, string>, client: any) => {
  const dateStr = targetDate.toISOString().split('T')[0];
  const month = targetDate.getMonth();
  const year = targetDate.getFullYear();
  const season = month <= 5 ? year - 1 : year;

  console.log(`Processing ${dateStr}...`);

  const games = await fetchGames(dateStr, dateStr, season);
  if (games.length === 0) {
    console.log(`No games found for ${dateStr}`);
    return;
  }

  console.log(`Found ${games.length} games for ${dateStr}`);

  for (const game of games) {
    try {
      const datetime = game.datetime ? new Date(game.datetime) : (game.date ? new Date(game.date + 'T12:00:00.000Z') : null);
      await client.query(UPSERT_RAW_GAME, [
        game.id,
        game.date,
        game.season,
        game.status,
        game.period ?? null,
        game.time ?? null,
        game.period_detail ?? null,
        datetime,
        game.postseason ?? false,
        game.home_team_score ?? null,
        game.visitor_team_score ?? null,
        JSON.stringify(game.home_team ?? null),
        JSON.stringify(game.visitor_team ?? null),
      ]);
      console.log(`Upserted raw game ${game.id} (${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation})`);
    } catch (error) {
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
    for (let i = 0; i < dates.length; i++) {
      await processDate(dates[i], new Map(), client);
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

