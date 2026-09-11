/**
 * Step 13F.3A — read-only BDL /v1/stats box entitlement canary.
 * Uses fetchBdlLive + Dynamo limiter. No serving writes. No lineups/GOAT.
 *
 *   npx tsx scripts/ops/2026-postgame-box-stats-canary.ts
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';
import { BdlRateLimitError, fetchBdlLive } from '../../lib/balldontlie/live-rate-limit';
import { isLineups2025StarterAnomaly } from '../../lib/betting/historical-starters';
import { loadPartialIdentityIndex } from '../../lib/identity/player-identity-store';
import { evaluateBoxStage } from '../../lib/postgame/box-stage';
import { parseBdlStatsPayload } from '../../lib/postgame/box-transform';
import { PINNED_ANALYTICS_SEASON } from '../../lib/season';

loadEnv({ path: path.join(process.cwd(), '.env') });

const PREFERRED_GAME_ID = '18447937';
const STATS_PATH = 'https://api.balldontlie.io/v1/stats';
const MAX_PAGES = 8;
const REQUIRED_FIELDS = [
  'player',
  'team',
  'min',
  'pts',
  'reb',
  'ast',
  'fgm',
  'fga',
  'fg3m',
  'fg3a',
  'ftm',
  'fta',
  'oreb',
  'dreb',
  'stl',
  'blk',
  'turnover',
  'pf',
] as const;

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
    BDL_RATE_LIMIT_WORKER: 'postgame-box-canary',
    MAX_RETRIES: '3',
  };
}

function assertNoSecret(haystack: string, key: string, where: string): void {
  if (key && haystack.includes(key)) {
    throw new Error(`CREDENTIAL_LEAK_STOP at ${where}: BDL key would have been written. Not repeating it.`);
  }
}

function nestedId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    return id == null ? null : String(id).trim() || null;
  }
  const s = String(value).trim();
  return s.length ? s : null;
}

function fieldPresence(row: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const field of REQUIRED_FIELDS) {
    out[field] = row[field] != null;
  }
  out['player.id'] = nestedId(row.player) != null || nestedId(row.player_id) != null;
  out['team.id'] = nestedId(row.team) != null || nestedId(row.team_id) != null;
  out['game.id'] = nestedId(row.game) != null || nestedId(row.game_id) != null;
  out.plus_minus = row.plus_minus != null;
  return out;
}

async function main() {
  if (PINNED_ANALYTICS_SEASON !== '2025') {
    throw new Error(`Refusing canary: PINNED_ANALYTICS_SEASON=${PINNED_ANALYTICS_SEASON}`);
  }
  const processFreeze = {
    DATA_MODE: process.env.DATA_MODE ?? '',
    OFFSEASON_MODE: process.env.OFFSEASON_MODE ?? '',
    CRON_DRY_RUN: process.env.CRON_DRY_RUN ?? '',
  };
  const key = requireKey();
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const text = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    assertNoSecret(text, key, 'console.log');
    origLog(...args);
  };

  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) throw new Error('SUPABASE_DB_URL missing (not printed)');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15000,
  });
  const readSql = async <T extends Record<string, unknown>>(
    text: string,
    params: unknown[] = []
  ): Promise<T[]> => {
    if (!/^\s*select\b/i.test(text)) {
      throw new Error('canary SQL must be SELECT-only');
    }
    const result = await pool.query(text, params);
    return result.rows as T[];
  };

  const quarantineBefore = await readSql<{ n: number; max_updated: string | null }>(
    `select count(*)::int as n, max(updated_at)::text as max_updated
       from analytics.player_identity_unresolved`
  );
  const pgl2026Before = await readSql<{ n: number }>(
    `select count(*)::int as n from analytics.player_game_logs where season = '2026'`
  );
  const stageTable = await readSql<{ rel: string | null }>(
    `select to_regclass('analytics.postgame_game_stages')::text as rel`
  );

  const preferred = await readSql<{
    game_id: string;
    season: string;
    status: string;
    start_time: string | null;
    home_team_id: string;
    away_team_id: string;
    home_score: number | null;
    away_score: number | null;
    home_abbr: string;
    away_abbr: string;
    home_name: string;
    away_name: string;
    pgl_count: number;
    home_pgl: number;
    away_pgl: number;
  }>(
    `select g.game_id, g.season, g.status, g.start_time::text as start_time,
            g.home_team_id, g.away_team_id, g.home_score, g.away_score,
            ht.abbreviation as home_abbr, at.abbreviation as away_abbr,
            ht.full_name as home_name, at.full_name as away_name,
            (select count(*)::int from analytics.player_game_logs p where p.game_id = g.game_id) as pgl_count,
            (select count(*)::int from analytics.player_game_logs p
              where p.game_id = g.game_id and p.team_id = g.home_team_id) as home_pgl,
            (select count(*)::int from analytics.player_game_logs p
              where p.game_id = g.game_id and p.team_id = g.away_team_id) as away_pgl
       from analytics.games g
       join analytics.teams ht on ht.team_id = g.home_team_id
       join analytics.teams at on at.team_id = g.away_team_id
      where g.game_id = $1`,
    [PREFERRED_GAME_ID]
  );

  let game = preferred[0];
  if (
    !game ||
    game.season !== '2025' ||
    game.status.toLowerCase() !== 'final' ||
    !game.home_score ||
    !game.away_score ||
    game.pgl_count < 10 ||
    isLineups2025StarterAnomaly(game.game_id)
  ) {
    const fallback = await readSql<typeof preferred[number]>(
      `select g.game_id, g.season, g.status, g.start_time::text as start_time,
              g.home_team_id, g.away_team_id, g.home_score, g.away_score,
              ht.abbreviation as home_abbr, at.abbreviation as away_abbr,
              ht.full_name as home_name, at.full_name as away_name,
              (select count(*)::int from analytics.player_game_logs p where p.game_id = g.game_id) as pgl_count,
              (select count(*)::int from analytics.player_game_logs p
                where p.game_id = g.game_id and p.team_id = g.home_team_id) as home_pgl,
              (select count(*)::int from analytics.player_game_logs p
                where p.game_id = g.game_id and p.team_id = g.away_team_id) as away_pgl
         from analytics.games g
         join analytics.teams ht on ht.team_id = g.home_team_id
         join analytics.teams at on at.team_id = g.away_team_id
        where g.season = '2025'
          and lower(btrim(g.status)) = 'final'
          and g.home_score > 0 and g.away_score > 0
          and g.game_id <> all($1::text[])
          and (select count(*) from analytics.player_game_logs p where p.game_id = g.game_id) between 18 and 40
        order by g.start_time desc
        limit 1`,
      [['18447931', '18447988']]
    );
    game = fallback[0];
  }
  if (!game) {
    throw new Error('No local 2025 Final with box coverage found');
  }
  if (game.season === '2026') {
    throw new Error('Refusing 2026 game for this canary');
  }

  const localPlayers = await readSql<{ player_id: string; team_id: string; points: number | null }>(
    `select player_id, team_id, points
       from analytics.player_game_logs
      where game_id = $1
      order by player_id`,
    [game.game_id]
  );

  const limiterEnv = liveLimiterEnv();
  const allRows: Record<string, unknown>[] = [];
  const pageSizes: number[] = [];
  let pages = 0;
  let lastStatus = 0;
  let cursor: number | null = null;
  let truncatedAtCap = false;
  let entitlement:
    | 'AVAILABLE'
    | 'BLOCKED_BY_SUBSCRIPTION'
    | 'INCONCLUSIVE' = 'INCONCLUSIVE';
  let stopReason: string | null = null;

  const throttleLogs: Record<string, unknown>[] = [];
  const origLog2 = console.log;
  console.log = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('{"evt":"bdl_throttle"')) {
      try {
        throttleLogs.push(JSON.parse(first) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
    origLog2(...args);
  };

  try {
    while (pages < MAX_PAGES) {
      const url = new URL(STATS_PATH);
      url.searchParams.append('game_ids[]', game.game_id);
      url.searchParams.set('per_page', '100');
      if (cursor != null) url.searchParams.set('cursor', String(cursor));
      assertNoSecret(url.toString(), key, 'request url');
      let res: Response;
      try {
        res = await fetchBdlLive(
          url.toString(),
          { method: 'GET', headers: { Authorization: key } },
          { env: limiterEnv, worker: 'postgame-box-canary' }
        );
      } catch (err) {
        if (err instanceof BdlRateLimitError) {
          lastStatus = err.code === 'timeout' ? 429 : 0;
          stopReason = `fetchBdlLive ${err.code}`;
          entitlement = err.code === 'timeout' ? 'INCONCLUSIVE' : 'INCONCLUSIVE';
          break;
        }
        throw err;
      }
      lastStatus = res.status;
      pages += 1;
      if (res.status === 401) {
        entitlement = 'BLOCKED_BY_SUBSCRIPTION';
        stopReason = 'SUBSCRIPTION_OR_ENTITLEMENT_BLOCKED';
        break;
      }
      if (res.status === 403) {
        entitlement = 'BLOCKED_BY_SUBSCRIPTION';
        stopReason = 'permission_rejected';
        break;
      }
      if (res.status >= 500) {
        stopReason = `provider_${res.status}`;
        break;
      }
      if (!res.ok) {
        stopReason = `http_${res.status}`;
        break;
      }
      const json = (await res.json()) as {
        data?: unknown[];
        meta?: { next_cursor?: number | null };
      };
      const chunk = Array.isArray(json.data) ? json.data : [];
      pageSizes.push(chunk.length);
      for (const item of chunk) {
        if (item && typeof item === 'object') allRows.push(item as Record<string, unknown>);
      }
      cursor = json.meta?.next_cursor ?? null;
      if (cursor == null) break;
    }
    if (cursor != null && lastStatus === 200) {
      truncatedAtCap = true;
      stopReason = 'more_than_8_pages';
    }
  } finally {
    console.log = origLog2;
  }

  if (lastStatus === 200 && !truncatedAtCap && !stopReason) {
    entitlement = 'AVAILABLE';
  }

  const parsed = parseBdlStatsPayload({ data: allRows });
  const gameIds = new Set<string>();
  const teamIds = new Set<string>();
  const playerIds = new Set<string>();
  for (const row of allRows) {
    const gid = nestedId(row.game) ?? nestedId(row.game_id);
    if (gid) gameIds.add(gid);
    const tid = nestedId(row.team) ?? nestedId(row.team_id);
    if (tid) teamIds.add(tid);
    const pid = nestedId(row.player) ?? nestedId(row.player_id);
    if (pid) playerIds.add(pid);
  }
  const unrelatedGames = [...gameIds].filter((id) => id !== game.game_id);
  const firstRow = allRows[0];
  const fields = firstRow ? fieldPresence(firstRow) : {};

  const localIds = new Set(localPlayers.map((r) => r.player_id));
  const providerOnly = [...playerIds].filter((id) => !localIds.has(id));
  const localOnly = [...localIds].filter((id) => !playerIds.has(id));
  const homeProvider = parsed.rows.filter((r) => r.teamId === game.home_team_id).length;
  const awayProvider = parsed.rows.filter((r) => r.teamId === game.away_team_id).length;

  let identity = {
    serving: 0,
    not_serving_yet: 0,
    fail_closed: 0,
    skipped: false,
    skipReason: null as string | null,
  };
  let gateResult: ReturnType<typeof evaluateBoxStage> | null = null;
  if (lastStatus === 200 && parsed.rows.length > 0) {
    const index = await loadPartialIdentityIndex(
      async (text, params) => {
        const rows = await readSql(text, params as unknown[]);
        return { rows };
      },
      'balldontlie',
      parsed.rows.map((r) => r.playerId)
    );
    const gated = evaluateBoxStage({
      game: {
        gameId: game.game_id,
        season: game.season,
        status: game.status,
        homeTeamId: game.home_team_id,
        awayTeamId: game.away_team_id,
        homeScore: game.home_score,
        awayScore: game.away_score,
      },
      payload: { data: allRows },
      httpStatus: lastStatus,
      pages,
      identityIndex: index,
      observedAt: new Date().toISOString(),
      attempt: 1,
    });
    gateResult = gated;
    identity = {
      serving: gated.outputCount,
      not_serving_yet: 0,
      fail_closed: 0,
      skipped: false,
      skipReason: null,
    };
    const { selectBoxRowsForPgl } = await import('../../lib/identity/box-identity');
    const split = selectBoxRowsForPgl(parsed.rows, (row) => row.playerId, index, new Date().toISOString());
    identity.serving = split.gate.accounting.serving;
    identity.not_serving_yet = split.gate.accounting.notServingYet;
    identity.fail_closed = split.gate.accounting.unresolved + split.gate.accounting.conflicts;
  }

  const quarantineAfter = await readSql<{ n: number; max_updated: string | null }>(
    `select count(*)::int as n, max(updated_at)::text as max_updated
       from analytics.player_identity_unresolved`
  );
  const pgl2026After = await readSql<{ n: number }>(
    `select count(*)::int as n from analytics.player_game_logs where season = '2026'`
  );

  await pool.end();

  const report = {
    selectedGame: {
      gameId: game.game_id,
      season: game.season,
      date: game.start_time,
      home: `${game.home_abbr} ${game.home_name} (${game.home_team_id})`,
      away: `${game.away_abbr} ${game.away_name} (${game.away_team_id})`,
      scores: `${game.home_score}-${game.away_score}`,
      status: game.status,
      localPlayerRowCount: game.pgl_count,
      localHomeRows: game.home_pgl,
      localAwayRows: game.away_pgl,
      anomaly: isLineups2025StarterAnomaly(game.game_id),
    },
    processFreeze,
    httpStatus: lastStatus,
    pages,
    pageSizes,
    truncatedAtCap,
    requestCount: pages,
    stopReason,
    BOX_PROVIDER_ENTITLEMENT: entitlement,
    filter: {
      requestedGameId: game.game_id,
      gameIdsRepresented: [...gameIds],
      unrelatedGames,
    },
    coverage: {
      statRowCount: allRows.length,
      mappedRowCount: parsed.rows.length,
      malformed: parsed.malformed,
      uniquePlayerIds: playerIds.size,
      teamIds: [...teamIds],
      homePlayerRows: homeProvider,
      awayPlayerRows: awayProvider,
    },
    fields,
    historical: {
      localCount: localPlayers.length,
      providerCount: playerIds.size,
      providerOnlyCount: providerOnly.length,
      localOnlyCount: localOnly.length,
      providerOnlySample: providerOnly.slice(0, 8),
      localOnlySample: localOnly.slice(0, 8),
    },
    identity,
    qualityGate: gateResult
      ? {
          status: gateResult.status,
          reasonCode: gateResult.reasonCode,
          inputCount: gateResult.inputCount,
          outputCount: gateResult.outputCount,
          identitySkipped: gateResult.identitySkipped,
          writesWouldHaveBeen: gateResult.writes.length,
        }
      : null,
    mutation: {
      quarantineBefore: quarantineBefore[0],
      quarantineAfter: quarantineAfter[0],
      pgl2026Before: pgl2026Before[0]?.n ?? null,
      pgl2026After: pgl2026After[0]?.n ?? null,
      stageTable: stageTable[0]?.rel ?? null,
      writesPerformed: 0,
    },
    throttleDecisions: throttleLogs.map((row) => ({
      decision: row.decision,
      wait_ms: row.wait_ms,
      attempt: row.attempt,
    })),
  };

  const serialized = JSON.stringify(report, null, 2);
  assertNoSecret(serialized, key, 'report json');
  origLog(serialized);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (/authorization|api[_-]?key/i.test(message)) {
    console.error('Canary failed (message redacted; possible secret-shaped text)');
  } else {
    console.error(message);
  }
  process.exit(1);
});
