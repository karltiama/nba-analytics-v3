/**
 * Backfill raw.game_period_scores from BDL /v1/games for one season.
 * Only games already in raw.games are written (FK). Dry run by default.
 *
 *   npx tsx scripts/ingestion/backfill-game-period-scores.ts --season 2026
 *   npx tsx scripts/ingestion/backfill-game-period-scores.ts --season 2026 --execute --i-understand-production-write
 *
 * Env: SUPABASE_DB_URL, BALLDONTLIE_API_KEY.
 * Apply db/schemas/MIGRATION_raw_game_period_scores.sql first.
 */
import dotenv from 'dotenv';
import { Pool } from 'pg';
import {
  extractPeriodScores,
  periodScoresParams,
  upsertGamePeriodScoresSql,
  type PeriodScores,
} from '../../lambda/nightly-bdl-updater/period-scores';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const BDL_BASE = 'https://api.balldontlie.io/v1';
const PAGE_DELAY_MS = 1_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchSeasonGames(season: number, apiKey: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | null = null;
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ 'seasons[]': String(season), per_page: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${BDL_BASE}/games?${params}`, { headers: { Authorization: apiKey } });
    if (res.status === 429) {
      console.warn('  429 from BDL; waiting 30s');
      await sleep(30_000);
      page--;
      continue;
    }
    if (!res.ok) throw new Error(`BDL /games returned ${res.status}`);
    const json: any = await res.json();
    out.push(...(json.data ?? []));
    cursor = json.meta?.next_cursor != null ? String(json.meta.next_cursor) : null;
    console.log(`  page ${page}: ${json.data?.length ?? 0} games`);
    if (!cursor) break;
    await sleep(PAGE_DELAY_MS);
  }
  return out;
}

async function main() {
  const season = Number(arg('--season'));
  if (!Number.isInteger(season) || season < 2000) {
    console.error('Pass --season <start year>, e.g. --season 2026');
    process.exit(1);
  }
  const execute = process.argv.includes('--execute');
  if (execute && !process.argv.includes('--i-understand-production-write')) {
    console.error('--execute also needs --i-understand-production-write');
    process.exit(1);
  }
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY)?.trim();
  if (!dbUrl || !apiKey) {
    console.error('Set SUPABASE_DB_URL and BALLDONTLIE_API_KEY');
    process.exit(1);
  }

  const useSsl = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  try {
    const rel = await pool.query<{ rel: string | null }>(`select to_regclass('raw.game_period_scores')::text as rel`);
    if (!rel.rows[0]?.rel && execute) {
      console.error('raw.game_period_scores does not exist. Apply MIGRATION_raw_game_period_scores.sql first.');
      process.exit(1);
    }

    console.log(`Fetching BDL games for season ${season}...`);
    const games = await fetchSeasonGames(season, apiKey);
    const known = await pool.query<{ id: number }>(`select id from raw.games where season = $1`, [season]);
    const knownIds = new Set(known.rows.map((r) => Number(r.id)));

    const rows: PeriodScores[] = [];
    let finals = 0;
    let notInRaw = 0;
    for (const g of games) {
      if (String(g.status ?? '').trim().toLowerCase() !== 'final') continue;
      finals++;
      if (!knownIds.has(Number(g.id))) {
        notInRaw++;
        continue;
      }
      const p = extractPeriodScores(g);
      if (p) rows.push(p);
    }
    const unreconciled = rows.filter((r) => !r.reconciled);
    const ot = rows.filter((r) => r.overtimeCount > 0).length;

    console.log(
      JSON.stringify(
        {
          season,
          mode: execute ? 'execute' : 'dry-run',
          bdl_games: games.length,
          bdl_finals: finals,
          finals_not_in_raw_games: notInRaw,
          rows_to_write: rows.length,
          finals_missing_quarters: finals - notInRaw - rows.length,
          overtime_games: ot,
          not_matching_final: unreconciled.length,
          not_matching_final_ids: unreconciled.slice(0, 20).map((r) => r.gameId),
        },
        null,
        2
      )
    );

    if (!execute) {
      console.log('Dry run. Nothing written.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const r of rows) await client.query(upsertGamePeriodScoresSql, periodScoresParams(r));
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    const after = await pool.query<{ n: string }>(
      `select count(*) n from raw.game_period_scores where season = $1`,
      [season]
    );
    console.log(`Wrote ${rows.length}. raw.game_period_scores season ${season} rows: ${after.rows[0]?.n}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
