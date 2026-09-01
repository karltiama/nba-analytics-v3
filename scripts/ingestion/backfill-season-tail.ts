/**
 * Report (and later execute) a 2025-26 playoff tail backfill.
 *
 * Default is report-only: reads Postgres, does not call BallDontLie.
 * Live fetch is deferred until API access is back:
 *
 *   npx tsx scripts/ingestion/backfill-season-tail.ts --season=2025
 *   npx tsx scripts/ingestion/backfill-season-tail.ts --season=2025 --execute --allow-live-api
 *
 * Execute wraps existing scripts:
 *   seed-raw-balldontlie.ts --season --start --end --stats --season-averages
 *   transform-raw-to-analytics.ts
 *
 * End date defaults to June 30 of the following year so Finals are in range.
 * seed-raw-balldontlie itself defaults to April 15, which drops playoffs.
 *
 * Env: SUPABASE_DB_URL (report). Execute also needs BALLDONTLIE_API_KEY.
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';

export type CliArgs = {
  season: number;
  start: string | null;
  end: string | null;
  execute: boolean;
  allowLiveApi: boolean;
};

export type Step = { label: string; args: string[] };

export type SeasonTailReport = {
  season: number;
  analyticsGames: number;
  analyticsFinal: number;
  analyticsLogs: number;
  lastGameEt: string | null;
  lastFinalEt: string | null;
  rawGames: number;
  rawPostseason: number;
  rawRegular: number;
  lastRawPostseasonEt: string | null;
  rawGamesAfterLastFinal: number;
  rawGamesAfterLastFinalWithStats: number;
  gamesByMonth: Array<{ month: string; games: number; final: number }>;
};

function fatal(msg: string): never {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

/** Inclusive playoff-safe end date for BDL season start year (e.g. 2025 → 2026-06-30). */
export function defaultTailEnd(season: number): string {
  return `${season + 1}-06-30`;
}

export function addOneDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) fatal(`Invalid date: ${ymd}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq !== -1) {
      flags[raw.slice(2, eq)] = raw.slice(eq + 1);
      continue;
    }
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }

  const seasonRaw = flags.season;
  const season =
    typeof seasonRaw === 'string' ? Number(seasonRaw) : typeof seasonRaw === 'number' ? seasonRaw : 2025;
  if (!Number.isInteger(season) || season < 1900 || season > 3000) {
    fatal('Invalid --season. Example: --season=2025');
  }

  const start = typeof flags.start === 'string' ? flags.start : null;
  const end = typeof flags.end === 'string' ? flags.end : null;
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) fatal('--start must be YYYY-MM-DD');
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) fatal('--end must be YYYY-MM-DD');

  return {
    season,
    start,
    end,
    execute: flags.execute === true,
    allowLiveApi: flags['allow-live-api'] === true,
  };
}

export function resolveWindow(
  args: CliArgs,
  report: SeasonTailReport
): { start: string; end: string; startSource: string } {
  const end = args.end ?? defaultTailEnd(args.season);
  if (args.start) return { start: args.start, end, startSource: '--start' };
  const anchor = report.lastFinalEt ?? report.lastGameEt;
  if (anchor) return { start: addOneDay(anchor), end, startSource: `day after last ${report.lastFinalEt ? 'Final' : 'game'} (${anchor})` };
  return { start: `${args.season + 1}-04-15`, end, startSource: 'playoff-start heuristic (no games in DB)' };
}

export function buildSteps(season: number, start: string, end: string): Step[] {
  return [
    {
      label: 'Seed raw games + box scores from BallDontLie',
      args: [
        'tsx',
        'scripts/seed-raw-balldontlie.ts',
        '--season',
        String(season),
        '--start',
        start,
        '--end',
        end,
        '--stats',
        '--season-averages',
      ],
    },
    {
      label: 'Transform raw.* → analytics.*',
      args: ['tsx', 'scripts/transform-raw-to-analytics.ts'],
    },
  ];
}

async function loadSeasonTailReport(db: Pool, season: number): Promise<SeasonTailReport> {
  const seasonText = String(season);

  const analytics = await db.query<{
    games: string;
    finals: string;
    last_game: string | null;
    last_final: string | null;
  }>(
    `select
       count(*)::text as games,
       count(*) filter (where status = 'Final')::text as finals,
       to_char(max(start_time at time zone 'America/New_York')::date, 'YYYY-MM-DD') as last_game,
       to_char(
         max(start_time at time zone 'America/New_York')
           filter (where status = 'Final')::date,
         'YYYY-MM-DD'
       ) as last_final
     from analytics.games
     where season = $1`,
    [seasonText]
  );

  const logs = await db.query<{ n: string }>(
    `select count(*)::text as n
     from analytics.player_game_logs
     where season = $1`,
    [seasonText]
  );

  const byMonth = await db.query<{ month: string; games: string; final: string }>(
    `select
       to_char(start_time at time zone 'America/New_York', 'YYYY-MM') as month,
       count(*)::text as games,
       count(*) filter (where status = 'Final')::text as final
     from analytics.games
     where season = $1 and start_time is not null
     group by 1
     order by 1`,
    [seasonText]
  );

  const raw = await db.query<{
    games: string;
    postseason: string;
    regular: string;
    last_post: string | null;
  }>(
    `select
       count(*)::text as games,
       count(*) filter (where postseason is true)::text as postseason,
       count(*) filter (where coalesce(postseason, false) is false)::text as regular,
       to_char(max(date::date) filter (where postseason is true), 'YYYY-MM-DD') as last_post
     from raw.games
     where season::text = $1`,
    [seasonText]
  );

  const a = analytics.rows[0];
  const tail = await db.query<{ games: string; with_stats: string }>(
    `select
       count(*)::text as games,
       count(*) filter (
         where exists (
           select 1 from raw.player_game_stats s where s.game_id = g.id
         )
       )::text as with_stats
     from raw.games g
     where g.season::text = $1
       and $2::date is not null
       and g.date::date > $2::date`,
    [seasonText, a?.last_final ?? null]
  );

  const r = raw.rows[0];
  const t = tail.rows[0];
  return {
    season,
    analyticsGames: Number(a?.games ?? 0),
    analyticsFinal: Number(a?.finals ?? 0),
    analyticsLogs: Number(logs.rows[0]?.n ?? 0),
    lastGameEt: a?.last_game ?? null,
    lastFinalEt: a?.last_final ?? null,
    rawGames: Number(r?.games ?? 0),
    rawPostseason: Number(r?.postseason ?? 0),
    rawRegular: Number(r?.regular ?? 0),
    lastRawPostseasonEt: r?.last_post ?? null,
    rawGamesAfterLastFinal: Number(t?.games ?? 0),
    rawGamesAfterLastFinalWithStats: Number(t?.with_stats ?? 0),
    gamesByMonth: byMonth.rows.map((row) => ({
      month: row.month,
      games: Number(row.games),
      final: Number(row.final),
    })),
  };
}

function printReport(report: SeasonTailReport, window: { start: string; end: string; startSource: string }): void {
  console.log(`=== Season ${report.season} tail (report, no API) ===`);
  console.log(`  season              : ${report.season} (${report.season}-${String(report.season + 1).slice(-2)})`);
  console.log(`  analytics.games     : ${report.analyticsGames} (${report.analyticsFinal} Final)`);
  console.log(`  analytics.logs      : ${report.analyticsLogs}`);
  console.log(`  last game (ET)      : ${report.lastGameEt ?? '(none)'}`);
  console.log(`  last Final (ET)     : ${report.lastFinalEt ?? '(none)'}`);
  console.log(`  raw.games           : ${report.rawGames} (regular=${report.rawRegular}, postseason=${report.rawPostseason})`);
  console.log(`  last raw postseason : ${report.lastRawPostseasonEt ?? '(none)'}`);
  console.log(
    `  raw after last Final: ${report.rawGamesAfterLastFinal} games (${report.rawGamesAfterLastFinalWithStats} already have box scores)`
  );
  if (report.rawGamesAfterLastFinalWithStats > 0) {
    console.log(
      '  note                 : raw already has later box scores. transform-raw-to-analytics may close analytics without API.'
    );
  }
  console.log('  games by month (ET):');
  for (const row of report.gamesByMonth) {
    console.log(`    ${row.month}  games=${row.games}  Final=${row.final}`);
  }
  console.log('');
  console.log('  Typical NBA calendar: regular season through mid-April; playoffs through ~June.');
  console.log('  seed-raw-balldontlie default --end is April 15 — that window excludes most playoffs.');
  console.log('');
  console.log(`  recommended fetch   : ${window.start} .. ${window.end}`);
  console.log(`  start source        : ${window.startSource}`);
  console.log('');
  console.log('  When BALLDONTLIE_API_KEY works again:');
  console.log(
    `    npx tsx scripts/ingestion/backfill-season-tail.ts --season=${report.season} --start=${window.start} --end=${window.end} --execute --allow-live-api`
  );
  console.log('  Then re-archive: npm run archive:existing -- --season=' + report.season);
}

async function runStep(label: string, args: string[]): Promise<void> {
  console.log(`\n[step] ${label}`);
  console.log(`       npx ${args.join(' ')}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Step failed: ${label} (exit ${code ?? 'unknown'})`));
    });
  });
}

function makePool(): Pool {
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) fatal('Missing SUPABASE_DB_URL');
  const useSsl = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');
  return new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = makePool();
  try {
    const report = await loadSeasonTailReport(db, args.season);
    const window = resolveWindow(args, report);
    printReport(report, window);

    if (!args.execute) {
      console.log('\n[report] no provider calls, no writes. Pass --execute --allow-live-api when the API is back.');
      return;
    }
    if (!args.allowLiveApi) {
      fatal(
        '--execute requires --allow-live-api. Do not run this while OFFSEASON freeze is on and the BDL key is dead.'
      );
    }

    const steps = buildSteps(args.season, window.start, window.end);
    for (const step of steps) {
      await runStep(step.label, step.args);
    }
    console.log('\n[complete] tail ingest finished. Recompute season averages via a live nightly run, then re-archive.');
  } finally {
    await db.end().catch(() => {});
  }
}

const isDirectRun =
  typeof process.argv[1] === 'string' && process.argv[1].replace(/\\/g, '/').includes('backfill-season-tail');

if (isDirectRun) {
  main().catch((err) => {
    console.error('[fatal] unhandled error:', err);
    process.exit(1);
  });
}
