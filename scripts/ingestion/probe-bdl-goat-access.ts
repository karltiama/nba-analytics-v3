/**
 * Trial-safe GOAT access probe. One request per paid endpoint. No Postgres/S3 writes.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/ingestion/probe-bdl-goat-access.ts
 *
 * Stops further probes if a 429 is observed. Does not print the API key.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import {
  BDL_NBA_BASE_URL,
  BdlArchiveClient,
  readBdlApiKey,
} from '@/lib/balldontlie/archive-client';
import { fetchLineupsFromBallDontLie, LINEUPS_PATH } from '@/lib/balldontlie/lineups';
import {
  assertTrialExecuteAllowed,
  resolveBdlRequestDelayMs,
} from '@/lib/balldontlie/trial-limiter';
import { INCOMPLETE_BOX_STATS_ID } from '@/lib/ingestion/goat-stats-repair-queue';
import { ADVANCED_STATS_V2_PATH } from '@/lib/archive/advanced-stats-v2';
import { OPENING_GAME_ODDS_PATH } from '@/lib/archive/opening-game-odds';
import { DISTINCT_DECISION_LINE_GAMES_SQL, OPENING_PLAYER_PROPS_PATH } from '@/lib/archive/opening-player-props';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const OUT_PATH = 'reports/trial/goat-access-probe.json';
const STATS_GAME_ID = INCOMPLETE_BOX_STATS_ID;
const LINEUPS_GAME_ID = String(INCOMPLETE_BOX_STATS_ID);
/** Opening night 2025-10-21. Some decision-line games have props but no opening game odds. */
const OPENING_ODDS_GAME_ID = '18446819';
const ADVANCED_SEASON = 2024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ProbeResult = {
  name: string;
  endpoint: string;
  requestNumber: number;
  enforcedDelayMs: number;
  httpStatus: number | null;
  ok: boolean;
  recordCount: number;
  retryAfterPresent: boolean;
  retryAfterValue: string | null;
  retryAfterUsed: boolean;
  hit429: boolean;
  historicalDataConfirmed: boolean;
  readyForAcquisition: boolean;
  sampleKeys: string[];
  fieldChecks: Record<string, boolean>;
  notes: string[];
  error?: string;
};

function keysOf(v: unknown): string[] {
  if (!v || typeof v !== 'object') return [];
  return Object.keys(v as Record<string, unknown>).slice(0, 40);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function present(obj: Record<string, unknown> | null, path: string): boolean {
  if (!obj) return false;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur !== undefined && cur !== null;
}

async function loadOpeningPropsGameId(): Promise<{ gameId: string | null; distinctCount: number | null; error?: string }> {
  try {
    const { default: pool } = await import('@/lib/db');
    const countRes = await pool.query<{ n: string }>(
      `select count(distinct game_id)::text as n from research.prop_decision_lines where game_id is not null`
    );
    const oneRes = await pool.query<{ game_id: string }>(`${DISTINCT_DECISION_LINE_GAMES_SQL} limit 1`);
    const gameId = oneRes.rows[0]?.game_id ? String(oneRes.rows[0].game_id) : null;
    const distinctCount = countRes.rows[0]?.n != null ? Number(countRes.rows[0].n) : null;
    await pool.end().catch(() => undefined);
    return { gameId, distinctCount };
  } catch (e) {
    return {
      gameId: null,
      distinctCount: null,
      error: e instanceof Error ? e.message.slice(0, 240) : String(e).slice(0, 240),
    };
  }
}

function parseEnvelope(body: unknown): { data: unknown[]; meta: Record<string, unknown> } {
  const rec = asRecord(body);
  const data = Array.isArray(rec?.data) ? rec.data : [];
  const meta = asRecord(rec?.meta) ?? {};
  return { data, meta };
}

async function main() {
  assertTrialExecuteAllowed();
  const delay = resolveBdlRequestDelayMs();
  const mode = readIngestionMode();
  const seasonPin = getAnalyticsSeason();
  const lockStatus = bdlAcquisitionLockStatus();

  const safety = {
    trialMode: delay.trialMode,
    delayMs: delay.delayMs,
    delaySource: delay.source,
    concurrency: delay.concurrency,
    acquisitionLockAvailable: !lockStatus.active,
    acquisitionLockPid: lockStatus.pid,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    shouldSkipMutations: mode.shouldSkipMutations,
    currentAnalyticsSeason: seasonPin,
    bdlTrialModeEnv: (process.env.BDL_TRIAL_MODE ?? '').trim(),
    envDelayMs: process.env.BALLDONTLIE_REQUEST_DELAY_MS ?? null,
  };

  const unsafe: string[] = [];
  if (!delay.trialMode) unsafe.push('BDL_TRIAL_MODE is not 1');
  if (delay.delayMs < 12_000) unsafe.push(`delay ${delay.delayMs}ms < 12000`);
  if (delay.concurrency !== 1) unsafe.push(`concurrency ${delay.concurrency} !== 1`);
  if (lockStatus.active) unsafe.push(`acquisition lock busy pid=${lockStatus.pid}`);
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode} (expected replay)`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE is not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN is not 1');
  if (seasonPin !== '2025') unsafe.push(`CURRENT_ANALYTICS_SEASON effective pin is ${seasonPin}, expected 2025`);
  if (!mode.shouldSkipMutations) unsafe.push('ingestion freeze is not active');

  if (unsafe.length > 0) {
    const report = { generatedAt: new Date().toISOString(), safety, unsafe, stopped: true, probes: [] };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    console.error('[stop] unsafe trial environment; no API requests sent.');
    process.exit(2);
  }

  const propsQueue = await loadOpeningPropsGameId();
  const openingPropsGameId = propsQueue.gameId;
  const openingOddsGameId = OPENING_ODDS_GAME_ID;

  const client = new BdlArchiveClient({
    apiKey: readBdlApiKey(),
    baseUrl: BDL_NBA_BASE_URL,
    maxRetries: 0,
  });

  const probes: ProbeResult[] = [];
  let stoppedFor429 = false;
  const lock = acquireBdlAcquisitionLock();

  const runHttpProbe = async (args: {
    name: string;
    path: string;
    params: Record<string, string>;
    enforcedDelayMs: number;
    inspect: (data: unknown[], meta: Record<string, unknown>, sample: Record<string, unknown> | null) => {
      historicalDataConfirmed: boolean;
      readyForAcquisition: boolean;
      fieldChecks: Record<string, boolean>;
      notes: string[];
    };
  }): Promise<ProbeResult> => {
    const url = new URL(args.path, `${BDL_NBA_BASE_URL}/`);
    for (const [k, v] of Object.entries(args.params)) url.searchParams.set(k, v);
    const endpoint = `${url.pathname}?${url.searchParams.toString()}`;
    const res = await client.fetchWithRetry(url.toString());
    const requestNumber = probes.length + 1;
    const retryAfterValue = res.headers.get('retry-after');
    const hit429 = res.status === 429;
    let recordCount = 0;
    let sampleKeys: string[] = [];
    let fieldChecks: Record<string, boolean> = {};
    let historicalDataConfirmed = false;
    let readyForAcquisition = false;
    const notes: string[] = [];
    let error: string | undefined;
    if (hit429) {
      notes.push('429 observed; further probes stopped.');
    } else {
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        error = `unparseable body: ${text.slice(0, 180)}`;
      }
      if (parsed) {
        const { data, meta } = parseEnvelope(parsed);
        recordCount = data.length;
        const sample = asRecord(data[0]);
        sampleKeys = keysOf(sample);
        const inspected = args.inspect(data, meta, sample);
        fieldChecks = inspected.fieldChecks;
        historicalDataConfirmed = inspected.historicalDataConfirmed;
        readyForAcquisition = inspected.readyForAcquisition && res.ok;
        notes.push(...inspected.notes);
      }
      if (!res.ok) {
        error = `${res.status}: ${text.slice(0, 240)}`;
        readyForAcquisition = false;
      }
    }
    return {
      name: args.name,
      endpoint,
      requestNumber,
      enforcedDelayMs: args.enforcedDelayMs,
      httpStatus: res.status,
      ok: res.ok,
      recordCount,
      retryAfterPresent: retryAfterValue != null && retryAfterValue !== '',
      retryAfterValue,
      retryAfterUsed: false,
      hit429,
      historicalDataConfirmed,
      readyForAcquisition,
      sampleKeys,
      fieldChecks,
      notes,
      error,
    };
  };

  try {
    const jobs: Array<{ delayBefore: number; run: () => Promise<ProbeResult> }> = [
      {
        delayBefore: 0,
        run: () =>
          runHttpProbe({
            name: '/v1/stats',
            path: '/v1/stats',
            params: { 'game_ids[]': String(STATS_GAME_ID), per_page: '5' },
            enforcedDelayMs: 0,
            inspect: (data, meta, sample) => {
              const fieldChecks = {
                envelope_data: data.length >= 0,
                meta_present: Object.keys(meta).length > 0,
                player: present(sample, 'player') || present(sample, 'player.id'),
                game: present(sample, 'game') || present(sample, 'game.id'),
                pts: present(sample, 'pts'),
                min: present(sample, 'min'),
                team: present(sample, 'team'),
              };
              const historical = data.length > 0 && (fieldChecks.player || fieldChecks.pts);
              return {
                historicalDataConfirmed: historical,
                readyForAcquisition: historical,
                fieldChecks,
                notes: [`repair game_id=${STATS_GAME_ID}; response not persisted`],
              };
            },
          }),
      },
      {
        delayBefore: delay.delayMs,
        run: () =>
          runHttpProbe({
            name: 'Advanced Stats V2',
            path: ADVANCED_STATS_V2_PATH,
            params: { 'seasons[]': String(ADVANCED_SEASON), period: '0', per_page: '1' },
            enforcedDelayMs: delay.delayMs,
            inspect: (data, meta, sample) => {
              const fieldChecks = {
                http_envelope: true,
                meta_next_cursor: meta.next_cursor !== undefined,
                meta_per_page: meta.per_page !== undefined,
                period: present(sample, 'period'),
                pie: present(sample, 'pie'),
                offensive_rating: present(sample, 'offensive_rating'),
                defensive_rating: present(sample, 'defensive_rating'),
                true_shooting_percentage: present(sample, 'true_shooting_percentage'),
                usage_percentage: present(sample, 'usage_percentage'),
                player: present(sample, 'player'),
                game: present(sample, 'game'),
                team: present(sample, 'team'),
              };
              const historical = data.length > 0;
              const ready =
                historical &&
                (fieldChecks.pie || fieldChecks.offensive_rating || fieldChecks.true_shooting_percentage);
              return {
                historicalDataConfirmed: historical,
                readyForAcquisition: ready,
                fieldChecks,
                notes: [`season=${ADVANCED_SEASON} period=0 per_page=1; not archived`],
              };
            },
          }),
      },
      {
        delayBefore: delay.delayMs,
        run: () => {
          if (!openingPropsGameId) {
            return Promise.resolve({
              name: 'Opening Player Props',
              endpoint: OPENING_PLAYER_PROPS_PATH,
              requestNumber: probes.length + 1,
              enforcedDelayMs: delay.delayMs,
              httpStatus: null,
              ok: false,
              recordCount: 0,
              retryAfterPresent: false,
              retryAfterValue: null,
              retryAfterUsed: false,
              hit429: false,
              historicalDataConfirmed: false,
              readyForAcquisition: false,
              sampleKeys: [],
              fieldChecks: {},
              notes: ['skipped: could not load a decision-line game_id'],
              error: propsQueue.error ?? 'empty queue',
            });
          }
          return runHttpProbe({
            name: 'Opening Player Props',
            path: OPENING_PLAYER_PROPS_PATH,
            params: { game_id: openingPropsGameId },
            enforcedDelayMs: delay.delayMs,
            inspect: (data, _meta, sample) => {
              const market = asRecord(sample?.market);
              const fieldChecks = {
                game_id: present(sample, 'game_id'),
                player_id: present(sample, 'player_id'),
                vendor: present(sample, 'vendor'),
                prop_type: present(sample, 'prop_type'),
                line_value: present(sample, 'line_value'),
                market: Boolean(market),
                opened_at: present(sample, 'opened_at'),
                updated_at: present(sample, 'updated_at'),
                over_odds: present(market, 'over_odds'),
                under_odds: present(market, 'under_odds'),
              };
              const historical = data.length > 0;
              const idsOk = fieldChecks.game_id && fieldChecks.player_id && fieldChecks.vendor && fieldChecks.prop_type;
              const lineOk = fieldChecks.line_value || fieldChecks.over_odds;
              return {
                historicalDataConfirmed: historical,
                readyForAcquisition: historical && idsOk && lineOk,
                fieldChecks,
                notes: [
                  `game_id=${openingPropsGameId} from research.prop_decision_lines (distinct=${propsQueue.distinctCount}); 129-game crawl not started`,
                ],
              };
            },
          });
        },
      },
      {
        delayBefore: delay.delayMs,
        run: () =>
          runHttpProbe({
            name: 'Opening Game Odds',
            path: OPENING_GAME_ODDS_PATH,
            params: { 'game_ids[]': openingOddsGameId, per_page: '5' },
            enforcedDelayMs: delay.delayMs,
            inspect: (data, _meta, sample) => {
              const fieldChecks = {
                vendor: present(sample, 'vendor'),
                game_id: present(sample, 'game_id'),
                spread_home_value: present(sample, 'spread_home_value'),
                spread_away_value: present(sample, 'spread_away_value'),
                total_value: present(sample, 'total_value'),
                moneyline_home_odds: present(sample, 'moneyline_home_odds'),
                moneyline_away_odds: present(sample, 'moneyline_away_odds'),
                opened_at: present(sample, 'opened_at'),
                updated_at: present(sample, 'updated_at'),
              };
              const historical = data.length > 0;
              const bookOk = fieldChecks.vendor;
              const marketOk =
                fieldChecks.spread_home_value || fieldChecks.total_value || fieldChecks.moneyline_home_odds;
              return {
                historicalDataConfirmed: historical,
                readyForAcquisition: historical && bookOk && marketOk,
                fieldChecks,
                notes: [`game_ids[]=${openingOddsGameId}; no bulk fetch`],
              };
            },
          }),
      },
      {
        delayBefore: delay.delayMs,
        run: async () => {
          const origFetch = globalThis.fetch;
          let httpStatus: number | null = null;
          let retryAfterValue: string | null = null;
          let ok = false;
          globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const res = await origFetch(input, init);
            httpStatus = res.status;
            retryAfterValue = res.headers.get('retry-after');
            ok = res.ok;
            return res;
          }) as typeof fetch;
          let body: Awaited<ReturnType<typeof fetchLineupsFromBallDontLie>> = null;
          try {
            body = await fetchLineupsFromBallDontLie(LINEUPS_GAME_ID, readBdlApiKey());
          } finally {
            globalThis.fetch = origFetch;
          }
          const data = body?.data ?? [];
          const sample = asRecord(data[0]);
          const player = asRecord(sample?.player);
          const fieldChecks = {
            players_returned: data.length > 0,
            team_id: present(player, 'team_id') || present(sample, 'team_id'),
            starter: typeof sample?.starter === 'boolean',
            position: present(sample, 'position'),
            player_id: present(player, 'id'),
          };
          const hit429 = httpStatus === 429;
          return {
            name: 'Lineups',
            endpoint: `${LINEUPS_PATH}?game_ids[]=${LINEUPS_GAME_ID}`,
            requestNumber: probes.length + 1,
            enforcedDelayMs: delay.delayMs,
            httpStatus,
            ok,
            recordCount: data.length,
            retryAfterPresent: retryAfterValue != null && retryAfterValue !== '',
            retryAfterValue,
            retryAfterUsed: false,
            hit429,
            historicalDataConfirmed: data.length > 0,
            readyForAcquisition: ok && fieldChecks.players_returned && fieldChecks.player_id && fieldChecks.starter,
            sampleKeys: keysOf(sample),
            fieldChecks,
            notes: [
              `used fetchLineupsFromBallDontLie for 2025 completed game ${LINEUPS_GAME_ID}; 1,297-game crawl not started`,
            ],
            error: !ok ? `lineup client HTTP ${httpStatus}` : undefined,
          };
        },
      },
    ];

    for (const job of jobs) {
      if (job.delayBefore > 0) {
        console.log(`[bdl-trial] sleeping ${job.delayBefore}ms before next probe`);
        await sleep(job.delayBefore);
      }
      const row = await job.run();
      probes.push(row);
      console.log(
        JSON.stringify({
          endpoint: row.endpoint,
          http: row.httpStatus,
          requestNumber: row.requestNumber,
          enforcedDelayMs: row.enforcedDelayMs,
          hit429: row.hit429,
          retryAfterPresent: row.retryAfterPresent,
          retryAfterUsed: row.retryAfterUsed,
          records: row.recordCount,
        })
      );
      if (row.hit429) {
        stoppedFor429 = true;
        break;
      }
    }
  } finally {
    lock.release();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    writes: { postgres: false, s3: false, diagnosticReport: OUT_PATH },
    safety,
    propsQueue,
    statsGameId: STATS_GAME_ID,
    lineupsGameId: LINEUPS_GAME_ID,
    openingOddsGameId,
    stoppedFor429,
    probes,
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (stoppedFor429) process.exit(2);
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : err);
  process.exit(1);
});
