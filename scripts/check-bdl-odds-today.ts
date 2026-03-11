/**
 * Check if BallDontLie /v2/odds has data for today's games (ET).
 * No DB writes — API-only. Use to verify odds availability before running the full odds Lambda.
 *
 *   npx tsx scripts/check-bdl-odds-today.ts
 *   npx tsx scripts/check-bdl-odds-today.ts 2026-03-12   # specific date
 */
import 'dotenv/config';
import { z } from 'zod';

const BDL_BASE = 'https://api.balldontlie.io/v2';
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;

const BdlOddsRowSchema = z.object({
  id: z.number(),
  game_id: z.number(),
  vendor: z.string(),
  spread_home_value: z.string().nullable().optional(),
  spread_home_odds: z.number().nullable().optional(),
  spread_away_value: z.string().nullable().optional(),
  spread_away_odds: z.number().nullable().optional(),
  moneyline_home_odds: z.number().nullable().optional(),
  moneyline_away_odds: z.number().nullable().optional(),
  total_value: z.string().nullable().optional(),
  total_over_odds: z.number().nullable().optional(),
  total_under_odds: z.number().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

const BdlOddsResponseSchema = z.object({
  data: z.array(BdlOddsRowSchema),
  meta: z.object({
    next_cursor: z.number().nullable().optional(),
    per_page: z.number().optional(),
  }).optional(),
});

function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function main(): Promise<void> {
  if (!BALLDONTLIE_API_KEY) {
    console.error('Missing BALLDONTLIE_API_KEY (or BALDONTLIE_API_KEY). Set in .env');
    process.exit(1);
  }

  const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const dateStr = dateArg ?? getTodayET();

  const url = new URL(`${BDL_BASE}/odds`);
  url.searchParams.set('dates[]', dateStr);
  url.searchParams.set('per_page', '100');

  console.log(`Checking BDL /v2/odds for date: ${dateStr}`);
  console.log(`URL: ${url.origin}${url.pathname}?dates[]=${dateStr}&per_page=100`);

  const res = await fetch(url.toString(), {
    headers: { Authorization: BALLDONTLIE_API_KEY },
  });

  if (res.status === 429) {
    console.error('Rate limited (429). Try again later.');
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`BDL API error: ${res.status} ${res.statusText}`);
    console.error(body);
    process.exit(1);
  }

  const json = await res.json();
  const parsed = BdlOddsResponseSchema.safeParse(json);

  if (!parsed.success) {
    console.error('Unexpected response shape:', parsed.error.message);
    console.error(JSON.stringify(json, null, 2).slice(0, 500));
    process.exit(1);
  }

  const rows = parsed.data.data;
  const gameIds = [...new Set(rows.map((r) => r.game_id))];
  const vendors = [...new Set(rows.map((r) => r.vendor))];

  console.log('');
  console.log('--- Result ---');
  console.log(`Date:           ${dateStr}`);
  console.log(`Odds available: ${rows.length > 0 ? 'Yes' : 'No'}`);
  console.log(`Total rows:     ${rows.length}`);
  console.log(`Unique games:   ${gameIds.length}`);
  console.log(`Vendors:        ${vendors.join(', ') || '—'}`);
  if (gameIds.length > 0) {
    console.log(`Game IDs:       ${gameIds.slice(0, 10).join(', ')}${gameIds.length > 10 ? '...' : ''}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
