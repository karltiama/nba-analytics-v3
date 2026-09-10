/**
 * Step 13D one-shot injuries + game-odds canary.
 * Uses fetchBdlLive + Dynamo limiter. Dry-run transforms. No schedule thaw.
 * Does not call player props.
 *
 *   npx tsx scripts/ops/2026-injuries-odds-canary.ts
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { Pool } from 'pg';
import { fetchBdlLive } from '../../lib/balldontlie/live-rate-limit';
import { PINNED_ANALYTICS_SEASON } from '../../lib/season';
import {
  applyGameOddsObservation,
  classifySportsbookCoverage,
  estimateInjuriesOddsRequestBudget,
  type BookMarketState,
  type LifecycleAction,
} from '../../lib/betting/game-odds-lifecycle';
import { quotesFromBdlOddsRow, type BdlGameOddsRow } from '../../lib/betting/game-odds-from-bdl';
import {
  INJURY_FRESHNESS_FIELD,
  dryRunInjuryBoard,
  inventoryInjuryStatuses,
  partitionInjuryIdentity,
  type BdlInjuryCanaryRow,
} from '../../lib/injuries/canary-board';
import type { InjuryFieldSnapshot } from '../../lib/injuries/ingest-plan';

loadEnv({ path: path.join(process.cwd(), '.env') });

const OUT_JSON = path.join(process.cwd(), 'reports/operations/2026-27-injuries-game-odds-canary-live.json');
const OUT_JSON_13D1 = path.join(
  process.cwd(),
  'reports/operations/2026-27-goat-injuries-odds-recertification-live.json'
);

/** Owner-confirmed NBA GOAT in the BALLDONTLIE dashboard. Not inferred from HTTP 200. */
const ENTITLEMENT = 'BDL_ENTITLEMENT_CONFIRMED_GOAT';

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

function injuryPayloadAudit(rows: BdlInjuryCanaryRow[]) {
  const first = rows[0] as Record<string, unknown> | undefined;
  const player = (first?.player ?? null) as Record<string, unknown> | null;
  let descNull = 0;
  let statusNull = 0;
  let returnNull = 0;
  let hasProviderUpdatedAt = 0;
  for (const row of rows) {
    if (row.status == null || !String(row.status).trim()) statusNull += 1;
    if (row.description == null || !String(row.description).trim()) descNull += 1;
    if (row.return_date == null || !String(row.return_date).trim()) returnNull += 1;
    const rec = row as Record<string, unknown>;
    if (rec.updated_at != null || rec.updatedAt != null || rec.timestamp != null) {
      hasProviderUpdatedAt += 1;
    }
  }
  return {
    rowKeys: objectKeys(first),
    playerKeys: objectKeys(player),
    statusNull,
    descriptionNull: descNull,
    returnDateNull: returnNull,
    rowsWithProviderUpdatedAtLikeField: hasProviderUpdatedAt,
    sample: rows.slice(0, 3).map((row) => ({
      playerId: row.player?.id ?? null,
      teamId: row.player?.team_id ?? row.player?.team?.id ?? null,
      teamAbbr: row.player?.team?.abbreviation ?? null,
      status: row.status ?? null,
      descriptionNull: row.description == null || !String(row.description).trim(),
      returnDate: row.return_date ?? null,
    })),
  };
}

function oddsPayloadAudit(rows: BdlGameOddsRow[]) {
  const first = rows[0] as Record<string, unknown> | undefined;
  return {
    rowKeys: objectKeys(first),
    sample: rows.slice(0, 3).map((row) => ({
      gameId: row.game_id ?? null,
      vendor: row.vendor ?? null,
      moneylineHome: row.moneyline_home_odds ?? null,
      moneylineAway: row.moneyline_away_odds ?? null,
      spreadHome: row.spread_home_value ?? null,
      spreadAway: row.spread_away_value ?? null,
      spreadHomeOdds: row.spread_home_odds ?? null,
      spreadAwayOdds: row.spread_away_odds ?? null,
      total: row.total_value ?? null,
      overOdds: row.total_over_odds ?? null,
      underOdds: row.total_under_odds ?? null,
      providerUpdatedAt: row.updated_at ?? null,
    })),
  };
}

function requireKey(): string {
  const key =
    process.env.BALLDONTLIE_API_KEY?.trim() ||
    process.env.BALDONTLIE_API_KEY?.trim() ||
    '';
  if (!key) throw new Error('BALLDONTLIE_API_KEY missing in local .env (not printed)');
  return key;
}

function liveLimiterEnv(worker: string): Record<string, string | undefined> {
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
    BDL_RATE_LIMIT_WORKER: worker,
    MAX_RETRIES: '3',
  };
}

async function readErrorSnippet(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[redacted]').slice(0, 240);
}

function etDatesTodayTomorrow(): string[] {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });
  return [today, tomorrow];
}

function summarizeThrottle(logs: Record<string, unknown>[]) {
  const grants = logs.filter((l) => l.decision === 'granted');
  const four29 = logs.filter((l) => l.decision === 'provider_429');
  const waits = grants.map((l) => Number(l.wait_ms ?? 0));
  const retryAfter = four29
    .map((l) => l.retry_after_ms)
    .filter((v) => v != null)
    .map((v) => Number(v));
  return {
    httpAttempts: grants.length,
    throttleGrants: grants.length,
    throttle429: four29.length,
    retries: four29.length,
    throttleWaitsMs: waits,
    throttleWaitMaxMs: waits.length ? Math.max(...waits) : 0,
    retryAfterMs: retryAfter,
    throttleDecisions: logs.map((l) => l.decision),
  };
}

async function main() {
  if (PINNED_ANALYTICS_SEASON !== '2025') {
    throw new Error(`Refusing canary: PINNED_ANALYTICS_SEASON=${PINNED_ANALYTICS_SEASON}`);
  }
  if (process.argv.includes('--persist')) {
    throw new Error('13D canary refuses --persist; dry-run only');
  }

  const key = requireKey();
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

  const injuriesEnv = liveLimiterEnv('injuries-odds-canary-injuries');
  const oddsEnv = liveLimiterEnv('injuries-odds-canary-odds');

  const injuryRows: BdlInjuryCanaryRow[] = [];
  let injuryPages = 0;
  let injuryHttp200 = 0;
  let injuryLastStatus = 0;
  let injuryError: string | null = null;
  const injuryStarted = Date.now();
  let injuryCursor: number | null = null;
  while (true) {
    const url = new URL('https://api.balldontlie.io/nba/v1/player_injuries');
    url.searchParams.set('per_page', '100');
    if (injuryCursor != null) url.searchParams.set('cursor', String(injuryCursor));
    const res = await fetchBdlLive(
      url.toString(),
      { headers: { Authorization: key } },
      { env: injuriesEnv, worker: 'injuries-odds-canary-injuries' }
    );
    injuryLastStatus = res.status;
    injuryPages += 1;
    if (!res.ok) {
      injuryError = await readErrorSnippet(res);
      break;
    }
    injuryHttp200 += 1;
    const json = (await res.json()) as {
      data?: BdlInjuryCanaryRow[];
      meta?: { next_cursor?: number | null };
    };
    injuryRows.push(...(json.data ?? []));
    injuryCursor = json.meta?.next_cursor ?? null;
    if (injuryCursor == null) break;
  }
  const injuryDurationMs = Date.now() - injuryStarted;
  const injuryLogs = throttleLogs.filter((l) => l.worker === 'injuries-odds-canary-injuries');

  const dates = etDatesTodayTomorrow();
  const oddsRows: BdlGameOddsRow[] = [];
  let oddsPages = 0;
  let oddsHttp200 = 0;
  let oddsLastStatus = 0;
  let oddsError: string | null = null;
  const oddsStarted = Date.now();
  dateLoop: for (const dateStr of dates) {
    let cursor: number | null = null;
    while (true) {
      const url = new URL('https://api.balldontlie.io/v2/odds');
      url.searchParams.set('dates[]', dateStr);
      url.searchParams.set('per_page', '100');
      if (cursor != null) url.searchParams.set('cursor', String(cursor));
      const res = await fetchBdlLive(
        url.toString(),
        { headers: { Authorization: key } },
        { env: oddsEnv, worker: 'injuries-odds-canary-odds' }
      );
      oddsLastStatus = res.status;
      oddsPages += 1;
      if (!res.ok) {
        oddsError = await readErrorSnippet(res);
        break dateLoop;
      }
      oddsHttp200 += 1;
      const json = (await res.json()) as {
        data?: BdlGameOddsRow[];
        meta?: { next_cursor?: number | null };
      };
      oddsRows.push(...(json.data ?? []));
      cursor = json.meta?.next_cursor ?? null;
      if (cursor == null) break;
    }
  }
  const oddsDurationMs = Date.now() - oddsStarted;
  const oddsLogs = throttleLogs.filter((l) => l.worker === 'injuries-odds-canary-odds');

  console.log = origLog;

  let knownPlayerIds = new Set<string>();
  let previousCurrent = new Map<string, InjuryFieldSnapshot>();
  let previousCompleteRowCount: number | null = null;
  let knownGameIds = new Set<string>();
  let dbNote: string | null = null;

  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (dbUrl) {
    const pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
    try {
      const ids = [
        ...new Set(
          injuryRows
            .map((r) => (r.player?.id == null ? null : String(r.player.id)))
            .filter((id): id is string => Boolean(id))
        ),
      ];
      if (ids.length) {
        const players = await pool.query<{ player_id: string }>(
          `SELECT player_id::text AS player_id FROM analytics.players WHERE player_id::text = ANY($1::text[])`,
          [ids]
        );
        knownPlayerIds = new Set(players.rows.map((r) => String(r.player_id)));
      }
      const prev = await pool.query<InjuryFieldSnapshot>(
        `SELECT player_id::text as "playerId", team_id::text as "teamId", status,
                description, return_date_raw as "returnDateRaw"
         FROM analytics.player_injury_status_current`
      );
      previousCurrent = new Map(prev.rows.map((r) => [String(r.playerId), r]));
      const complete = await pool.query<{ rows_stored: number | string }>(
        `SELECT rows_stored FROM raw.injury_pull_runs
         WHERE status = 'success' AND completed_at IS NOT NULL
           AND rows_stored = rows_returned AND rows_stored > 0
         ORDER BY pull_run_id DESC LIMIT 1`
      );
      previousCompleteRowCount =
        complete.rows[0] != null ? Number(complete.rows[0].rows_stored) : null;

      const gameIds = [
        ...new Set(oddsRows.map((r) => (r.game_id == null ? '' : String(r.game_id))).filter(Boolean)),
      ];
      if (gameIds.length) {
        const games = await pool.query<{ game_id: string }>(
          `SELECT game_id::text AS game_id FROM analytics.games WHERE game_id::text = ANY($1::text[])`,
          [gameIds]
        );
        knownGameIds = new Set(games.rows.map((r) => String(r.game_id)));
      }
    } catch (err) {
      dbNote = `identity join failed: ${err instanceof Error ? err.message : 'unknown'}`;
    } finally {
      await pool.end();
    }
  } else {
    dbNote = 'SUPABASE_DB_URL missing; skipped identity/game joins';
  }

  const observedAt = new Date().toISOString();
  const part = partitionInjuryIdentity(injuryRows, knownPlayerIds);
  const injuryPlan = dryRunInjuryBoard({
    pullRunId: 0,
    observedAt,
    mappedRows: part.mapped,
    unmappedCount: part.unmapped.length,
    previousCurrent,
    previousCompleteRowCount,
  });

  const teams = new Set<string>();
  for (const row of injuryRows) {
    const abbr = row.player?.team?.abbreviation;
    if (abbr) teams.add(String(abbr));
    else if (row.player?.team_id != null) teams.add(String(row.player.team_id));
  }

  const store = new Map<string, BookMarketState>();
  const actionCounts: Record<string, number> = {};
  const vendors = new Set<string>();
  const unknownGames = new Set<string>();
  let ml = 0;
  let spread = 0;
  let total = 0;
  const oddsObservedAt = new Date().toISOString();
  for (const row of oddsRows) {
    const vendor = String(row.vendor ?? '').trim();
    if (vendor) vendors.add(vendor);
    const known = knownGameIds.size > 0 ? knownGameIds : undefined;
    for (const q of quotesFromBdlOddsRow(row, oddsObservedAt)) {
      const result = applyGameOddsObservation(
        store,
        q,
        known ? { knownGameIds: known } : undefined
      );
      actionCounts[result.action] = (actionCounts[result.action] ?? 0) + 1;
      if (result.action === 'skipped_unknown_game') unknownGames.add(q.gameId);
      if (result.action === 'first_observed' || result.action === 'current_update') {
        if (q.market === 'moneyline') ml += 1;
        if (q.market === 'spread') spread += 1;
        if (q.market === 'total') total += 1;
      }
    }
  }

  const coverage =
    oddsLastStatus === 401 || oddsLastStatus === 403
      ? 'UNAUTHORIZED'
      : classifySportsbookCoverage(vendors);
  const budget = estimateInjuriesOddsRequestBudget({
    injuryPagesPerPull: Math.max(1, injuryPages),
    injuryPullsPerDay: 3,
    oddsRequestsPerCycle: Math.max(1, dates.length),
    oddsCyclesPerDay: 4,
    intervalMs: 13_000,
  });

  const foStore = new Map<string, BookMarketState>();
  const liveQuotes = oddsRows.flatMap((row) => quotesFromBdlOddsRow(row, oddsObservedAt));
  for (const q of liveQuotes) {
    applyGameOddsObservation(foStore, q, knownGameIds.size > 0 ? { knownGameIds } : undefined);
  }
  const foAfterFirst = [...foStore.entries()].map(([key, state]) => ({
    key,
    foTotal: state.firstObserved.total,
    foMlHome: state.firstObserved.homeMoneyline,
    vendor: state.firstObserved.vendor,
    market: state.firstObserved.market,
  }));
  for (const q of liveQuotes) {
    applyGameOddsObservation(
      foStore,
      { ...q, observedAt: new Date(Date.parse(oddsObservedAt) + 1000).toISOString() },
      knownGameIds.size > 0 ? { knownGameIds } : undefined
    );
  }
  const bumped = liveQuotes.find((q) => q.market === 'total' && q.total != null);
  if (bumped) {
    applyGameOddsObservation(
      foStore,
      { ...bumped, total: (bumped.total ?? 0) + 1.5, observedAt: new Date(Date.parse(oddsObservedAt) + 2000).toISOString() },
      knownGameIds.size > 0 ? { knownGameIds } : undefined
    );
  }
  const foAfterLater = [...foStore.entries()].map(([key, state]) => ({
    key,
    foTotal: state.firstObserved.total,
    currentTotal: state.current.total,
    vendor: state.firstObserved.vendor,
  }));
  const foImmutable =
    liveQuotes.length === 0 ||
    foAfterFirst.every((a) => {
      const later = foAfterLater.find((b) => b.key === a.key);
      return later != null && later.foTotal === a.foTotal;
    });

  const report = {
    generatedAt: new Date().toISOString(),
    pin: PINNED_ANALYTICS_SEASON,
    persist: false,
    entitlement: ENTITLEMENT,
    entitlementSource: 'account_owner_dashboard_confirmation',
    operatingRate: { intervalMs: 13000, burst: 1, label: 'activation-canary safety rate' },
    injuries: {
      endpoint: 'GET /nba/v1/player_injuries',
      pages: injuryPages,
      lastStatus: injuryLastStatus,
      http401: injuryLastStatus === 401 ? 1 : 0,
      httpError: injuryError,
      durationMs: injuryDurationMs,
      http200: injuryHttp200,
      accounting: summarizeThrottle(injuryLogs),
      recordCount: injuryRows.length,
      teamsRepresented: teams.size,
      statusInventory: inventoryInjuryStatuses(injuryRows),
      payload: injuryPayloadAudit(injuryRows),
      identity: {
        mapped: part.mapped.length,
        unmapped: part.unmapped.length,
        unmappedIds: [
          ...new Set(
            part.unmapped
              .map((r) => (r.player?.id == null ? null : String(r.player.id)))
              .filter((id): id is string => Boolean(id))
          ),
        ].slice(0, 40),
        duplicates: part.duplicates,
        missingPlayerId: part.missingPlayerId,
        dbNote,
      },
      freshness: INJURY_FRESHNESS_FIELD,
      dryRun: injuryPlan.proposed,
      massClearBlocked: injuryPlan.massClearBlocked,
      completenessReason: injuryPlan.completenessReason,
      injuryAsOf: false,
    },
    odds: {
      endpoint: 'GET /v2/odds',
      dates,
      pages: oddsPages,
      lastStatus: oddsLastStatus,
      http401: oddsLastStatus === 401 ? 1 : 0,
      httpError: oddsError,
      durationMs: oddsDurationMs,
      http200: oddsHttp200,
      accounting: summarizeThrottle(oddsLogs),
      rowCount: oddsRows.length,
      games: new Set(oddsRows.map((r) => String(r.game_id ?? ''))).size,
      vendors: [...vendors],
      coverage,
      usableMoneylineObservations: ml,
      usableSpreadObservations: spread,
      usableTotalObservations: total,
      unknownGameIds: [...unknownGames],
      payload: oddsPayloadAudit(oddsRows),
      dryRunActions: actionCounts as Partial<Record<LifecycleAction, number>>,
      firstObservedCount: [...store.values()].length,
      firstObservedLiveShape: {
        immutable: foImmutable,
        emptyLiveRows: liveQuotes.length === 0,
        afterFirstCount: foAfterFirst.length,
      },
    },
    requestBudget: budget,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_JSON_13D1, JSON.stringify(report, null, 2));
  origLog(
    JSON.stringify(
      {
        ok: true,
        out: OUT_JSON_13D1,
        injuries: injuryRows.length,
        odds: oddsRows.length,
        injuryStatus: injuryLastStatus,
        oddsStatus: oddsLastStatus,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
