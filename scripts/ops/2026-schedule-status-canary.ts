/**
 * Step 13C bounded live BDL schedule/status canary.
 * Uses fetchBdlLive + Dynamo limiter. Does not write games/props/odds.
 *
 *   npx tsx scripts/ops/2026-schedule-status-canary.ts
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { Pool } from 'pg';
import { fetchBdlLive } from '../../lib/balldontlie/live-rate-limit';
import {
  normalizeGameStatus,
  looksLikeTipoffOrDatetimeStatus,
} from '../../lib/betting/normalize-game-status';
import { PINNED_ANALYTICS_SEASON } from '../../lib/season';

loadEnv({ path: path.join(process.cwd(), '.env') });

const BDL_BASE = 'https://api.balldontlie.io/v1';
const SEASON = 2026;
const OUT_JSON = path.join(process.cwd(), 'reports/operations/2026-27-schedule-status-canary-live.json');

type BdlTeam = {
  id?: number;
  abbreviation?: string | null;
  full_name?: string | null;
  city?: string | null;
  name?: string | null;
};
type BdlGame = {
  id?: number | null;
  date?: string | null;
  datetime?: string | null;
  status?: string | null;
  season?: number | null;
  postseason?: boolean | null;
  home_team_score?: number | null;
  visitor_team_score?: number | null;
  home_team?: BdlTeam | null;
  visitor_team?: BdlTeam | null;
};

function requireKey(): string {
  const key =
    process.env.BALLDONTLIE_API_KEY?.trim() ||
    process.env.BALDONTLIE_API_KEY?.trim() ||
    '';
  if (!key) throw new Error('BALLDONTLIE_API_KEY missing in local .env (not printed)');
  return key;
}

function liveLimiterEnv(): Record<string, string | undefined> {
  return {
    DATA_MODE: 'live_api',
    OFFSEASON_MODE: '0',
    CRON_DRY_RUN: '0',
    BDL_RATE_LIMIT_BACKEND: 'dynamodb',
    BDL_RATE_LIMIT_TABLE: process.env.BDL_RATE_LIMIT_TABLE || 'nba-bdl-rate-limit',
    BDL_RATE_LIMIT_INTERVAL_MS: process.env.BDL_RATE_LIMIT_INTERVAL_MS || '13000',
    BDL_RATE_LIMIT_MAX_REQUESTS: '1',
    BDL_RATE_LIMIT_BURST: '1',
    BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS: process.env.BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS || '90000',
    BDL_RATE_LIMIT_WORKER: 'schedule-status-canary',
    MAX_RETRIES: '3',
  };
}

function teamLabel(t: BdlTeam | null | undefined): string {
  if (!t) return '';
  return (t.abbreviation || t.full_name || t.name || String(t.id ?? '')).trim();
}

function fmtTz(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

async function main() {
  if (PINNED_ANALYTICS_SEASON !== '2025') {
    throw new Error(`Refusing canary: PINNED_ANALYTICS_SEASON=${PINNED_ANALYTICS_SEASON}`);
  }
  const key = requireKey();
  const env = liveLimiterEnv();
  const throttleLogs: Record<string, unknown>[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('{"evt":"bdl_throttle"')) {
      try {
        throttleLogs.push(JSON.parse(first) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
    origLog(...args);
  };

  const started = Date.now();
  const games: BdlGame[] = [];
  let pages = 0;
  let httpOk = 0;
  let cursor: number | null = null;
  let lastStatus = 0;

  while (true) {
    const params = new URLSearchParams({
      'seasons[]': String(SEASON),
      per_page: '100',
    });
    if (cursor != null) params.set('cursor', String(cursor));
    const url = `${BDL_BASE}/games?${params.toString()}`;
    const res = await fetchBdlLive(
      url,
      { headers: { Authorization: key } },
      { env, worker: 'schedule-status-canary' }
    );
    lastStatus = res.status;
    pages += 1;
    if (!res.ok) {
      throw new Error(`BDL /v1/games ${res.status}`);
    }
    httpOk += 1;
    const json = (await res.json()) as { data?: BdlGame[]; meta?: { next_cursor?: number | null } };
    games.push(...(json.data ?? []));
    cursor = json.meta?.next_cursor ?? null;
    if (cursor == null) break;
  }

  console.log = origLog;
  const durationMs = Date.now() - started;

  const ids = games.map((g) => (g.id == null ? null : String(g.id)));
  const nullIds = ids.filter((id) => !id).length;
  const uniqueIds = new Set(ids.filter(Boolean) as string[]);
  const dupes = ids.length - nullIds - uniqueIds.size;

  const statusCounts: Record<string, number> = {};
  const normalizedCounts: Record<string, number> = {};
  for (const g of games) {
    const raw = String(g.status ?? '');
    statusCounts[raw] = (statusCounts[raw] ?? 0) + 1;
    const n = normalizeGameStatus(raw);
    normalizedCounts[n] = (normalizedCounts[n] ?? 0) + 1;
  }

  const regular = games.filter((g) => g.postseason !== true);
  const postseason = games.filter((g) => g.postseason === true);
  const dates = games.map((g) => g.date).filter(Boolean) as string[];
  dates.sort();
  const teams = new Set<string>();
  for (const g of games) {
    if (g.home_team?.id != null) teams.add(String(g.home_team.id));
    if (g.visitor_team?.id != null) teams.add(String(g.visitor_team.id));
  }

  const nullTips = games.filter((g) => !g.datetime).length;
  const grants = throttleLogs.filter((l) => l.decision === 'granted');
  const four29 = throttleLogs.filter((l) => l.decision === 'provider_429');
  const waits = grants.map((g) => Number(g.wait_ms) || 0);

  const sampleTips = ['NYK', 'LAL', 'GSW', 'BOS', 'POR']
    .map((abbr) => {
      const g = regular.find(
        (x) => x.home_team?.abbreviation === abbr || x.visitor_team?.abbreviation === abbr
      );
      if (!g?.datetime) return null;
      return {
        game_id: String(g.id),
        abbr,
        datetime: g.datetime,
        utc: new Date(g.datetime).toISOString(),
        et: fmtTz(g.datetime, 'America/New_York'),
        pt: fmtTz(g.datetime, 'America/Los_Angeles'),
        status: g.status,
      };
    })
    .filter(Boolean);

  let local: {
    count: number;
    ids: string[];
    rows: Array<{
      game_id: string;
      start_time: string | null;
      status: string | null;
      home_team_id: string | null;
      away_team_id: string | null;
      home_abbr?: string | null;
      away_abbr?: string | null;
    }>;
  } | null = null;

  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (dbUrl) {
    const pool = new Pool({ connectionString: dbUrl, max: 1 });
    try {
      const q = await pool.query(
        `select g.game_id::text as game_id, g.start_time::text as start_time, g.status,
                g.home_team_id::text as home_team_id, g.away_team_id::text as away_team_id,
                ht.abbreviation as home_abbr, at.abbreviation as away_abbr
         from analytics.games g
         left join analytics.teams ht on ht.team_id::text = g.home_team_id::text
         left join analytics.teams at on at.team_id::text = g.away_team_id::text
         where g.season = '2026'`
      );
      local = {
        count: q.rows.length,
        ids: q.rows.map((r) => String(r.game_id)),
        rows: q.rows.map((r) => ({
          game_id: String(r.game_id),
          start_time: r.start_time,
          status: r.status,
          home_team_id: r.home_team_id,
          away_team_id: r.away_team_id,
          home_abbr: r.home_abbr,
          away_abbr: r.away_abbr,
        })),
      };
    } finally {
      await pool.end();
    }
  }

  const liveIds = new Set(uniqueIds);
  const localIds = new Set(local?.ids ?? []);
  const presentLiveMissingLocal = [...liveIds].filter((id) => !localIds.has(id));
  const presentLocalAbsentLive = [...localIds].filter((id) => !liveIds.has(id));
  const matching = [...liveIds].filter((id) => localIds.has(id));

  const liveById = new Map(games.filter((g) => g.id != null).map((g) => [String(g.id), g]));
  const missingLocalDetails = presentLiveMissingLocal.slice(0, 80).map((id) => {
    const g = liveById.get(id)!;
    return {
      game_id: id,
      date: g.date,
      datetime: g.datetime,
      home: teamLabel(g.home_team),
      away: teamLabel(g.visitor_team),
      status: g.status,
      postseason: g.postseason === true,
    };
  });

  const extraLocalDetails = (local?.rows ?? [])
    .filter((r) => presentLocalAbsentLive.includes(r.game_id))
    .slice(0, 80)
    .map((r) => ({
      game_id: r.game_id,
      start_time: r.start_time,
      home: r.home_abbr,
      away: r.away_abbr,
      status: r.status,
    }));

  let inserts = presentLiveMissingLocal.length;
  let updates = 0;
  let unchanged = 0;
  let conflicts = 0;
  const localById = new Map((local?.rows ?? []).map((r) => [r.game_id, r]));
  for (const id of matching) {
    const live = liveById.get(id)!;
    const loc = localById.get(id)!;
    const liveStart = live.datetime ? new Date(live.datetime).toISOString() : null;
    const locStart = loc.start_time ? new Date(loc.start_time).toISOString() : null;
    const statusChanged = String(live.status ?? '') !== String(loc.status ?? '');
    const tipChanged = liveStart !== locStart;
    if (statusChanged || tipChanged) updates += 1;
    else unchanged += 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    pin: PINNED_ANALYTICS_SEASON,
    endpoint: 'GET /v1/games?seasons[]=2026',
    accounting: {
      httpRequests: httpOk,
      pages,
      lastStatus,
      durationMs,
      throttleGrants: grants.length,
      throttle429: four29.length,
      throttleWaitsMs: waits,
      throttleWaitMaxMs: waits.length ? Math.max(...waits) : 0,
      throttleDecisions: throttleLogs.map((l) => l.decision),
    },
    live: {
      total: games.length,
      uniqueIds: uniqueIds.size,
      nullIds,
      duplicateIds: dupes,
      regularSeason: regular.length,
      postseason: postseason.length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      teamCount: teams.size,
      nullDatetime: nullTips,
      statusCounts,
      normalizedCounts,
      tipoffLikeStatuses: games.filter((g) =>
        looksLikeTipoffOrDatetimeStatus(String(g.status ?? ''))
      ).length,
    },
    local: local
      ? { count: local.count, matching: matching.length }
      : { count: null, note: 'SUPABASE_DB_URL missing; skipped local compare' },
    reconciliation: {
      matchingIds: matching.length,
      presentLiveMissingLocal: presentLiveMissingLocal.length,
      presentLocalAbsentLive: presentLocalAbsentLive.length,
      dryRun: { inserts, updates, unchanged, conflicts },
      missingLocalSample: missingLocalDetails,
      extraLocalSample: extraLocalDetails,
    },
    canonicalTipField: 'bdl.datetime → analytics.games.start_time (timestamptz/UTC)',
    timezoneSamples: sampleTips,
    limiter: {
      backend: 'dynamodb',
      table: env.BDL_RATE_LIMIT_TABLE,
      intervalMs: Number(env.BDL_RATE_LIMIT_INTERVAL_MS || 13000),
      burst: 1,
      note: 'activation-canary safety rate; not a certified GOAT quota',
    },
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  origLog(JSON.stringify({ ok: true, out: OUT_JSON, liveTotal: games.length, pages, durationMs }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
