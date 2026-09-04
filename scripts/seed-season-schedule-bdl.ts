/**
 * Thin CLI: seed one BDL season schedule into raw.games + analytics.games
 * via refreshBdlScheduleForEtDateRange (existing upsert path).
 *
 * Defaults target 2026–27 with free-tier pacing.
 *
 * Usage:
 *   npx tsx scripts/seed-season-schedule-bdl.ts
 *   npx tsx scripts/seed-season-schedule-bdl.ts --season 2026 --start 2026-10-01 --end 2027-06-30
 *   npx tsx scripts/seed-season-schedule-bdl.ts --probe-only
 *
 * Env:
 *   SUPABASE_DB_URL, BALLDONTLIE_API_KEY (or BALDONTLIE_API_KEY)
 *   BALLDONTLIE_REQUEST_DELAY_MS — default forced to 12000 here for free tier
 *     unless already set in the environment.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { refreshBdlScheduleForEtDateRange } from '@/lib/balldontlie/refresh-schedule-from-bdl';

const BDL_BASE = 'https://api.balldontlie.io/v1';
const FREE_TIER_DELAY_MS = 12_000;

type CliArgs = {
  season: number;
  start: string;
  end: string;
  probeOnly: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  let season = 2026;
  let start = '2026-10-01';
  let end = '2027-06-30';
  let probeOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--season' && argv[i + 1]) season = Number.parseInt(argv[++i], 10);
    else if (a === '--start' && argv[i + 1]) start = argv[++i];
    else if (a === '--end' && argv[i + 1]) end = argv[++i];
    else if (a === '--probe-only') probeOnly = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: npx tsx scripts/seed-season-schedule-bdl.ts [--season 2026] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--probe-only]`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(season) || season < 1900) {
    console.error(`Invalid --season: ${season}`);
    process.exit(1);
  }
  return { season, start, end, probeOnly };
}

async function probeFirstPage(opts: {
  season: number;
  start: string;
  end: string;
  apiKey: string;
  pool: Pool;
}): Promise<{
  ok: boolean;
  status: number;
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  nextCursor: number | null;
  unresolvedTeamIds: number[];
  distinctTeamIdsOnPage: number;
}> {
  const params = new URLSearchParams({
    start_date: opts.start,
    end_date: opts.end,
    'seasons[]': String(opts.season),
    per_page: '100',
  });
  const res = await fetch(`${BDL_BASE}/games?${params.toString()}`, {
    headers: { Authorization: opts.apiKey },
  });
  const status = res.status;
  if (!res.ok) {
    return {
      ok: false,
      status,
      count: 0,
      firstDate: null,
      lastDate: null,
      nextCursor: null,
      unresolvedTeamIds: [],
      distinctTeamIdsOnPage: 0,
    };
  }

  const json: any = await res.json();
  const games: any[] = json.data || [];
  const dates = games
    .map((g) => g.date as string | null | undefined)
    .filter((d): d is string => typeof d === 'string' && d.length > 0)
    .sort();
  const teamIds = new Set<number>();
  for (const g of games) {
    const homeId = g.home_team?.id;
    const awayId = g.visitor_team?.id;
    if (typeof homeId === 'number') teamIds.add(homeId);
    if (typeof awayId === 'number') teamIds.add(awayId);
  }

  const rawTeams = await opts.pool.query<{ id: number }>('select id from raw.teams');
  const rawSet = new Set(rawTeams.rows.map((r) => r.id));
  const unresolved = [...teamIds].filter((id) => !rawSet.has(id)).sort((a, b) => a - b);

  return {
    ok: true,
    status,
    count: games.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    nextCursor: json.meta?.next_cursor ?? null,
    unresolvedTeamIds: unresolved,
    distinctTeamIdsOnPage: teamIds.size,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Prefer free-tier pacing for this manual seed unless operator already set a delay.
  if (!process.env.BALLDONTLIE_REQUEST_DELAY_MS?.trim()) {
    process.env.BALLDONTLIE_REQUEST_DELAY_MS = String(FREE_TIER_DELAY_MS);
  }

  const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY)?.trim();
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!apiKey) {
    console.error('Missing BALLDONTLIE_API_KEY (or BALDONTLIE_API_KEY)');
    process.exit(1);
  }
  if (!dbUrl) {
    console.error('Missing SUPABASE_DB_URL');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  console.log(
    JSON.stringify({
      phase: 'config',
      season: args.season,
      start: args.start,
      end: args.end,
      per_page: 100,
      requestDelayMs: Number(process.env.BALLDONTLIE_REQUEST_DELAY_MS),
      probeOnly: args.probeOnly,
    })
  );

  try {
    console.log('--- probe first page (read-only / no DB writes) ---');
    const probe = await probeFirstPage({
      season: args.season,
      start: args.start,
      end: args.end,
      apiKey,
      pool,
    });
    console.log(JSON.stringify({ phase: 'probe', ...probe }, null, 2));

    if (!probe.ok) {
      console.error(`Probe failed with HTTP ${probe.status}; aborting without writes.`);
      process.exit(1);
    }
    if (probe.unresolvedTeamIds.length > 0) {
      console.error(
        `Probe found team IDs missing from raw.teams: ${probe.unresolvedTeamIds.join(', ')}. Aborting without writes.`
      );
      process.exit(1);
    }
    if (args.probeOnly) {
      console.log('Probe-only complete; no seed executed.');
      return;
    }

    console.log('--- seeding via refreshBdlScheduleForEtDateRange ---');
    const processed = await refreshBdlScheduleForEtDateRange(args.start, args.end, args.season);
    console.log(JSON.stringify({ phase: 'seed', processed }));

    const verify = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM raw.games WHERE season = $1) AS raw_count,
        (SELECT count(DISTINCT id)::int FROM raw.games WHERE season = $1) AS raw_distinct_ids,
        (SELECT min(date)::text FROM raw.games WHERE season = $1) AS raw_min_date,
        (SELECT max(date)::text FROM raw.games WHERE season = $1) AS raw_max_date,
        (SELECT count(*)::int FROM analytics.games WHERE season = $2) AS analytics_count,
        (SELECT count(DISTINCT game_id)::int FROM analytics.games WHERE season = $2) AS analytics_distinct_ids,
        (SELECT min(start_time)::text FROM analytics.games WHERE season = $2) AS analytics_min_start,
        (SELECT max(start_time)::text FROM analytics.games WHERE season = $2) AS analytics_max_start
    `, [args.season, String(args.season)]);

    const teams = await pool.query(
      `
      WITH g AS (
        SELECT home_team_id AS team_id FROM analytics.games WHERE season = $1
        UNION
        SELECT away_team_id FROM analytics.games WHERE season = $1
      )
      SELECT
        (SELECT count(*)::int FROM g) AS distinct_teams,
        (
          SELECT count(*)::int
          FROM g
          LEFT JOIN analytics.teams t ON t.team_id = g.team_id
          WHERE t.team_id IS NULL
        ) AS unresolved_analytics_teams,
        (
          SELECT count(*)::int
          FROM raw.games r
          WHERE r.season = $2
            AND (
              NOT EXISTS (SELECT 1 FROM raw.teams t WHERE t.id = (r.home_team->>'id')::int)
              OR NOT EXISTS (SELECT 1 FROM raw.teams t WHERE t.id = (r.visitor_team->>'id')::int)
            )
        ) AS unresolved_raw_team_refs
      `,
      [String(args.season), args.season]
    );

    console.log(
      JSON.stringify(
        {
          phase: 'verify',
          ...verify.rows[0],
          ...teams.rows[0],
          duplicates:
            Number(verify.rows[0].raw_count) !== Number(verify.rows[0].raw_distinct_ids) ||
            Number(verify.rows[0].analytics_count) !== Number(verify.rows[0].analytics_distinct_ids),
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
