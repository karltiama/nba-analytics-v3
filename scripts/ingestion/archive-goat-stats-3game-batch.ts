/**
 * Trial GOAT `/v1/stats` → S3 → validate.
 * Default: exactly the 3 proof games (18447793, 21707973, 21716138).
 * `--remaining-31`: the other 31 manifest GOAT IDs only; never refetch the 3.
 * Never writes Postgres. Never overwrites season-wide `_manifest.json`.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/ingestion/archive-goat-stats-3game-batch.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/ingestion/archive-goat-stats-3game-batch.ts --execute
 *   BDL_TRIAL_MODE=1 npx tsx scripts/ingestion/archive-goat-stats-remaining-31.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/ingestion/archive-goat-stats-remaining-31.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import {
  BDL_BASE_URL,
  BdlArchiveClient,
  readBdlApiKey,
  type BdlEnvelope,
} from '@/lib/balldontlie/archive-client';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag, rawEntityPrefix } from '@/lib/archive/trial-archive-plan';
import {
  assertTrialExecuteAllowed,
  resolveBdlRequestDelayMs,
} from '@/lib/balldontlie/trial-limiter';
import { GOAT_STATS_REPAIR_IDS } from '@/lib/ingestion/goat-stats-repair-queue';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

export const GOAT_STATS_3GAME_BATCH = ['18447793', '21707973', '21716138'] as const;
const DONE_IDS = new Set(GOAT_STATS_3GAME_BATCH.map(String));
const MANIFEST_PATH = 'reports/trial/2025-repair-manifest.json';
const CACHE_PATH = 'reports/trial/bdl-games-2025.json';
const CONSOLIDATED_PATH = 'reports/trial/2025-goat-stats-acquisition.json';
const SEASON = 2025;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type BoxClass =
  | 'READY_TO_MATERIALIZE'
  | 'READY_TO_REPLACE_INCOMPLETE_LOCAL_BOX'
  | 'SCORE_RECONCILIATION_SUSPECT'
  | 'ONE_TEAM_MISSING'
  | 'NO_STATS_RETURNED'
  | 'DUPLICATE_PLAYER'
  | 'IDENTITY_ISSUE'
  | 'ARCHIVE_INCOMPLETE'
  | 'OTHER';

type CachedGame = {
  id: number;
  home_team_score?: number | null;
  visitor_team_score?: number | null;
  home_team?: { id?: number; abbreviation?: string } | null;
  visitor_team?: { id?: number; abbreviation?: string } | null;
};

type StatRow = {
  pts?: number | null;
  player?: { id?: number | string | null } | null;
  team?: { id?: number | string | null } | null;
  game?: { id?: number | string | null } | null;
};

type HttpHit = {
  gameId: string;
  endpoint: string;
  requestNumber: number;
  httpStatus: number;
  retryAfterPresent: boolean;
  retryAfterValue: string | null;
  recordCountOnPage: number;
  at: string;
  spacingMsSincePrev: number | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function loadCachedGame(id: string): CachedGame | null {
  const doc = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as { games: CachedGame[] };
  return doc.games.find((g) => String(g.id) === id) ?? null;
}

function loadManifestGoatIds(): string[] {
  const doc = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    requiresGoatCount?: number;
    repairGames: Array<{ gameId?: number; gameIdText?: string; requiresGoat?: boolean }>;
  };
  const ids = [
    ...new Set(
      doc.repairGames
        .filter((g) => g.requiresGoat === true)
        .map((g) => String(g.gameIdText ?? g.gameId))
    ),
  ];
  if (ids.length !== 34 || doc.requiresGoatCount !== 34) {
    throw new Error(
      `manifest GOAT math failed: ids=${ids.length} requiresGoatCount=${String(doc.requiresGoatCount)}`
    );
  }
  return ids;
}

function remaining31FromManifest(): { total: number; already: number; remaining: string[] } {
  const all = loadManifestGoatIds();
  const remaining = all.filter((id) => !DONE_IDS.has(id));
  return { total: all.length, already: DONE_IDS.size, remaining };
}

function classify(args: {
  recordCount: number;
  homeRepresented: boolean;
  awayRepresented: boolean;
  scoreOk: boolean;
  duplicateCount: number;
  identityIssues: number;
  unexpectedTeamCount: number;
  archiveComplete: boolean;
  replaceIncomplete?: boolean;
}): BoxClass {
  if (!args.archiveComplete) return 'ARCHIVE_INCOMPLETE';
  if (args.recordCount === 0) return 'NO_STATS_RETURNED';
  if (args.identityIssues > 0) return 'IDENTITY_ISSUE';
  if (args.duplicateCount > 0) return 'DUPLICATE_PLAYER';
  if (!args.homeRepresented || !args.awayRepresented) return 'ONE_TEAM_MISSING';
  if (!args.scoreOk) return 'SCORE_RECONCILIATION_SUSPECT';
  if (args.replaceIncomplete) return 'READY_TO_REPLACE_INCOMPLETE_LOCAL_BOX';
  return 'READY_TO_MATERIALIZE';
}

async function snapshotPostgres(pool: {
  query: (sql: string) => Promise<{ rows: Array<Record<string, string>> }>;
}): Promise<Record<string, string>> {
  const res = await pool.query(
    `select
       (select count(*)::text from raw.player_game_stats) as raw_stats,
       (select count(*)::text from analytics.player_game_logs) as logs,
       (select count(*)::text from analytics.team_game_stats) as team_stats,
       (select count(*)::text from analytics.player_season_averages) as player_avgs,
       (select count(*)::text from analytics.team_season_averages) as team_avgs,
       (select count(*)::text from analytics.player_team_stints) as stints,
       pg_database_size(current_database())::text as db_bytes`
  );
  return res.rows[0]!;
}

function validateGame(args: {
  gameId: string;
  rows: StatRow[];
  official: CachedGame;
  archiveComplete: boolean;
  replaceIncomplete?: boolean;
}) {
  const homeId = String(args.official.home_team?.id ?? '');
  const awayId = String(args.official.visitor_team?.id ?? '');
  const officialHome = Number(args.official.home_team_score);
  const officialAway = Number(args.official.visitor_team_score);
  const playerIds = new Set<string>();
  const pairCounts = new Map<string, number>();
  let homePts = 0;
  let awayPts = 0;
  let homeN = 0;
  let awayN = 0;
  let unexpectedTeamCount = 0;
  let identityIssues = 0;
  let missingPlayer = 0;
  let missingTeam = 0;
  let missingGame = 0;

  for (const row of args.rows) {
    const pid = row.player?.id == null ? null : String(row.player.id);
    const tid = row.team?.id == null ? null : String(row.team.id);
    const gid = row.game?.id == null ? null : String(row.game.id);
    if (!pid) {
      missingPlayer += 1;
      identityIssues += 1;
    } else {
      playerIds.add(pid);
      const k = `${args.gameId}|${pid}`;
      pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
    }
    if (!tid) {
      missingTeam += 1;
      identityIssues += 1;
    }
    if (!gid || gid !== args.gameId) {
      missingGame += 1;
      identityIssues += 1;
    }
    const pts = typeof row.pts === 'number' ? row.pts : 0;
    if (tid === homeId) {
      homePts += pts;
      homeN += 1;
    } else if (tid === awayId) {
      awayPts += pts;
      awayN += 1;
    } else if (tid) {
      unexpectedTeamCount += 1;
    }
  }

  const duplicateCount = [...pairCounts.values()].filter((n) => n > 1).length;
  const homeRepresented = homeN > 0;
  const awayRepresented = awayN > 0;
  const scoreOk =
    Number.isFinite(officialHome) &&
    Number.isFinite(officialAway) &&
    homePts === officialHome &&
    awayPts === officialAway;
  const classification = classify({
    recordCount: args.rows.length,
    homeRepresented,
    awayRepresented,
    scoreOk,
    duplicateCount,
    identityIssues,
    unexpectedTeamCount,
    archiveComplete: args.archiveComplete,
    replaceIncomplete: args.replaceIncomplete && scoreOk,
  });

  return {
    gameId: args.gameId,
    matchup: `${args.official.visitor_team?.abbreviation ?? '?'} @ ${args.official.home_team?.abbreviation ?? '?'}`,
    recordsReturned: args.rows.length,
    distinctPlayers: playerIds.size,
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeAbbr: args.official.home_team?.abbreviation ?? null,
    awayAbbr: args.official.visitor_team?.abbreviation ?? null,
    homeRepresented,
    awayRepresented,
    homePlayerCount: homeN,
    awayPlayerCount: awayN,
    summedPointsByTeam: { home: homePts, away: awayPts },
    officialFinalScore: { home: officialHome, away: officialAway },
    scoreReconciliation: scoreOk ? 'MATCH' : 'MISMATCH',
    duplicateGamePlayerKeys: duplicateCount,
    unexpectedTeamIds: unexpectedTeamCount,
    missingPlayerIds: missingPlayer,
    missingTeamIds: missingTeam,
    missingOrMismatchedGameIds: missingGame,
    archiveComplete: args.archiveComplete,
    classification,
  };
}

function writeConsolidatedAcquisition(args: {
  remainingGames: Array<Record<string, unknown>>;
  remainingRequested: string[];
  remainingCompleted: number;
  systemicStop: string | null;
  postgresBefore: Record<string, string>;
  postgresAfter: Record<string, string>;
  postgresUnchanged: boolean;
  rateLimit: Record<string, unknown>;
  s3: Record<string, unknown>;
  safety: Record<string, unknown>;
}) {
  let prior3: unknown[] = [];
  try {
    const prior = JSON.parse(readFileSync('reports/trial/goat-stats-3game-batch.json', 'utf8')) as {
      games?: unknown[];
    };
    prior3 = prior.games ?? [];
  } catch {
    prior3 = [];
  }
  const all = [...prior3, ...args.remainingGames] as Array<Record<string, unknown>>;
  const classOf = (g: Record<string, unknown>) => String(g.classification ?? '');
  const acquired = all.filter((g) => g.archiveComplete === true && Number(g.recordsReturned ?? 0) > 0);
  const ready = all.filter((g) => classOf(g) === 'READY_TO_MATERIALIZE');
  const replace = all.filter((g) => classOf(g) === 'READY_TO_REPLACE_INCOMPLETE_LOCAL_BOX');
  const suspectClasses = new Set([
    'SCORE_RECONCILIATION_SUSPECT',
    'ONE_TEAM_MISSING',
    'DUPLICATE_PLAYER',
    'IDENTITY_ISSUE',
    'OTHER',
  ]);
  const missing = all.filter((g) => classOf(g) === 'NO_STATS_RETURNED');
  const archiveComplete = all.filter((g) => g.archiveComplete === true);
  const archiveIncomplete = all.filter((g) => classOf(g) === 'ARCHIVE_INCOMPLETE' || g.archiveComplete === false);
  const identity = all.filter((g) => classOf(g) === 'IDENTITY_ISSUE');
  const dups = all.filter((g) => classOf(g) === 'DUPLICATE_PLAYER');
  const safe = all
    .filter((g) => classOf(g) === 'READY_TO_MATERIALIZE' || classOf(g) === 'READY_TO_REPLACE_INCOMPLETE_LOCAL_BOX')
    .map((g) => String(g.gameId));
  const review = all.filter((g) => !safe.includes(String(g.gameId)));
  const all34Acquired = acquired.length === 34 && archiveIncomplete.length === 0;
  const idealGreen =
    all34Acquired &&
    ready.length === 33 &&
    replace.length === 1 &&
    identity.length === 0 &&
    dups.length === 0 &&
    missing.length === 0 &&
    args.systemicStop == null &&
    args.postgresUnchanged;
  const verdict = args.systemicStop
    ? 'RED — stop repair pipeline'
    : !args.postgresUnchanged
      ? 'RED — stop repair pipeline'
      : idealGreen
        ? 'GREEN — all repair stats acquired and validated; proceed to controlled Postgres materialization'
        : all34Acquired
          ? 'YELLOW — acquisition complete but some games require review'
          : 'RED — stop repair pipeline';
  const doc = {
    generatedAt: new Date().toISOString(),
    postgresMaterialize: false,
    queue: {
      totalManifestGoatIds: 34,
      alreadyArchivedValidated: 3,
      remainingRequested: args.remainingRequested.length,
      remainingCompleted: args.remainingCompleted,
    },
    prior3: {
      diagnostic: 'reports/trial/goat-stats-3game-batch.json',
      gameIds: [...GOAT_STATS_3GAME_BATCH],
      games: prior3,
    },
    remaining31: {
      gameIds: args.remainingRequested,
      games: args.remainingGames,
      systemicStop: args.systemicStop,
    },
    totals34: {
      acquired: acquired.length,
      readyToMaterialize: ready.length,
      readyToReplaceIncompleteLocalBox: replace.length,
      suspect: all.filter((g) => suspectClasses.has(classOf(g))).length,
      missing: missing.length,
      archiveComplete: archiveComplete.length,
      archiveIncomplete: archiveIncomplete.length,
      identityFailures: identity.length,
      duplicateFailures: dups.length,
    },
    exactGamesSafeToMaterialize: safe,
    exactGamesRequiringReview: review.map((g) => ({
      gameId: g.gameId,
      classification: g.classification,
      error: g.error ?? null,
    })),
    safety: args.safety,
    rateLimit: args.rateLimit,
    s3: args.s3,
    postgresBefore: args.postgresBefore,
    postgresAfter: args.postgresAfter,
    postgresUnchanged: args.postgresUnchanged,
    stepVerdict: verdict,
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(CONSOLIDATED_PATH, JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

async function main() {
  const argv = process.argv.slice(2);
  const { execute } = parseExecuteFlag(argv);
  const remaining31 = argv.includes('--remaining-31');
  const extra = argv.filter((a) => a.startsWith('--game'));
  if (extra.length > 0) {
    console.error('[fatal] do not pass extra game flags; queue is frozen');
    process.exit(1);
  }

  let batchIds: string[] = [...GOAT_STATS_3GAME_BATCH];
  let queueConfirm: { total: number; already: number; remaining: string[] } | null = null;
  if (remaining31) {
    queueConfirm = remaining31FromManifest();
    console.log(`total manifest GOAT IDs = ${queueConfirm.total}`);
    console.log(`already archived/validated = ${queueConfirm.already}`);
    console.log(`remaining = ${queueConfirm.remaining.length}`);
    const fromCode = GOAT_STATS_REPAIR_IDS.map(String).filter((id) => !DONE_IDS.has(id));
    const sameSet =
      queueConfirm.remaining.length === 31 &&
      queueConfirm.total === 34 &&
      queueConfirm.already === 3 &&
      queueConfirm.remaining.length === fromCode.length &&
      queueConfirm.remaining.every((id) => fromCode.includes(id)) &&
      !queueConfirm.remaining.some((id) => DONE_IDS.has(id));
    if (!sameSet) {
      console.error('[fatal] remaining queue math did not resolve exactly to 31; STOP');
      process.exit(2);
    }
    batchIds = queueConfirm.remaining;
  }
  const allowed = new Set(batchIds);
  for (const id of batchIds) {
    if (!GOAT_STATS_REPAIR_IDS.map(String).includes(id)) {
      console.error(`[fatal] ${id} is not in the frozen 34-id GOAT queue`);
      process.exit(1);
    }
  }
  if (remaining31) {
    for (const id of GOAT_STATS_3GAME_BATCH) {
      if (allowed.has(id)) {
        console.error(`[fatal] completed game ${id} must not be refetched`);
        process.exit(1);
      }
    }
  }

  const delay = resolveBdlRequestDelayMs();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const lockStatus = bdlAcquisitionLockStatus();
  const unsafe: string[] = [];
  if (!delay.trialMode) unsafe.push('BDL_TRIAL_MODE is not 1');
  if (delay.delayMs < 12_000) unsafe.push(`delay ${delay.delayMs}ms < 12000`);
  if (delay.concurrency !== 1) unsafe.push(`concurrency ${String(delay.concurrency)}`);
  if (lockStatus.active) unsafe.push(`acquisition lock busy pid=${lockStatus.pid}`);
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== '2025') unsafe.push(`season pin ${pin}`);
  if (!process.env.NBA_DATA_BUCKET?.trim()) unsafe.push('NBA_DATA_BUCKET missing');

  const outPath = remaining31
    ? 'reports/trial/goat-stats-remaining-31.json'
    : 'reports/trial/goat-stats-3game-batch.json';
  const repairManifestName = remaining31 ? '_repair_remaining31_manifest.json' : '_repair_3game_manifest.json';
  const safety = {
    trialMode: delay.trialMode,
    delayMs: delay.delayMs,
    concurrency: delay.concurrency,
    lockAvailable: !lockStatus.active,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    currentAnalyticsSeason: pin,
    batch: batchIds,
    remaining31Mode: remaining31,
    queueConfirm,
  };

  if (unsafe.length) {
    const report = { generatedAt: new Date().toISOString(), safety, unsafe, stopped: true };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const prefix = rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', SEASON, 'player_stats');
  console.log(
    JSON.stringify(
      {
        dryRun: !execute,
        prefix,
        keys: batchIds.map((id) => `${prefix}/game_id=${id}.json`),
        repairManifest: `${prefix}/${repairManifestName}`,
        seasonWideManifestUntouched: `${prefix}/_manifest.json`,
        postgresMaterialize: false,
        safety,
      },
      null,
      2
    )
  );

  if (!execute) {
    console.log('[dry-run] no /v1/stats requests and no S3 writes.');
    return;
  }

  assertTrialExecuteAllowed();
  const { default: pool } = await import('@/lib/db');
  const postgresBefore = await snapshotPostgres(pool);
  const httpHits: HttpHit[] = [];
  let requestNumber = 0;
  let hit429 = false;
  let retries = 0;
  let retryAfterUsed = 0;
  let lastFetchAt: number | null = null;
  let systemicStop: string | null = null;

  const client = new BdlArchiveClient({
    apiKey: readBdlApiKey(),
    maxRetries: 3,
    logger: (msg) => {
      if (msg.includes('429')) retries += 1;
      if (msg.includes('retry-after')) retryAfterUsed += 1;
      console.log(msg);
    },
  });

  const s3 = new S3Storage({ bucket: process.env.NBA_DATA_BUCKET!.trim() });
  const lock = acquireBdlAcquisitionLock();
  const gameResults: Array<Record<string, unknown>> = [];
  let wrote = 0;
  let skipped = 0;
  let fetches = 0;

  const pushHit = (hit: Omit<HttpHit, 'at' | 'spacingMsSincePrev'>) => {
    const now = Date.now();
    const spacingMsSincePrev = lastFetchAt == null ? null : now - lastFetchAt;
    lastFetchAt = now;
    httpHits.push({ ...hit, at: new Date(now).toISOString(), spacingMsSincePrev });
  };

  try {
    for (const gameId of batchIds) {
      if (!allowed.has(gameId)) {
        systemicStop = `request escaped intended set: ${gameId}`;
        break;
      }
      const official = loadCachedGame(gameId);
      if (!official) {
        gameResults.push({ gameId, classification: 'OTHER', error: 'missing from cached BDL games' });
        continue;
      }
      const key = `${prefix}/game_id=${gameId}.json`;
      if (key.endsWith('/_manifest.json') || !key.includes('/game_id=')) {
        systemicStop = `archive path collision for ${gameId}`;
        break;
      }
      let pages: BdlEnvelope[] = [];
      let archiveComplete = false;
      let skippedExisting = false;

      if (await s3.objectExists(key)) {
        skipped += 1;
        skippedExisting = true;
        const existing = await s3.getJson<{ pages?: BdlEnvelope[] }>(key);
        pages = existing?.pages ?? [];
        archiveComplete = pages.length > 0;
      } else {
        if (fetches > 0) {
          console.log(`[bdl-trial] sleeping ${delay.delayMs}ms before game_id=${gameId}`);
          await sleep(delay.delayMs);
        }
        let cursor: string | null = null;
        let firstPage = true;
        let stopBatch = false;
        while (true) {
          if (!firstPage) await sleep(delay.delayMs);
          firstPage = false;
          const params = new URLSearchParams();
          params.set('game_ids[]', gameId);
          params.set('per_page', '100');
          if (cursor) params.set('cursor', cursor);
          const url = `${BDL_BASE_URL}/stats?${params.toString()}`;
          const res = await client.fetchWithRetry(url);
          requestNumber += 1;
          fetches += 1;
          const retryAfterValue = res.headers.get('retry-after');
          const retryAfterPresent = retryAfterValue != null && retryAfterValue !== '';
          if (res.status === 429) {
            hit429 = true;
            stopBatch = true;
            systemicStop = '429 despite trial spacing; remaining games not fetched';
            pushHit({
              gameId,
              endpoint: `/v1/stats?game_ids[]=${gameId}`,
              requestNumber,
              httpStatus: 429,
              retryAfterPresent,
              retryAfterValue,
              recordCountOnPage: 0,
            });
            break;
          }
          const text = await res.text();
          if (res.status === 401 || res.status === 403) {
            stopBatch = true;
            systemicStop = `authentication regression HTTP ${res.status}`;
            pushHit({
              gameId,
              endpoint: `/v1/stats?game_ids[]=${gameId}`,
              requestNumber,
              httpStatus: res.status,
              retryAfterPresent,
              retryAfterValue,
              recordCountOnPage: 0,
            });
            gameResults.push({ gameId, classification: 'OTHER', error: `HTTP ${res.status}` });
            break;
          }
          if (!res.ok) {
            pushHit({
              gameId,
              endpoint: `/v1/stats?game_ids[]=${gameId}`,
              requestNumber,
              httpStatus: res.status,
              retryAfterPresent,
              retryAfterValue,
              recordCountOnPage: 0,
            });
            gameResults.push({
              gameId,
              classification: 'OTHER',
              error: `${res.status}: ${text.slice(0, 240)}`,
            });
            pages = [];
            break;
          }
          let body: BdlEnvelope;
          try {
            body = JSON.parse(text) as BdlEnvelope;
          } catch {
            stopBatch = true;
            systemicStop = 'provider schema suddenly changed (unparseable JSON)';
            break;
          }
          if (!Array.isArray(body.data)) {
            stopBatch = true;
            systemicStop = 'provider schema suddenly changed (data is not an array)';
            break;
          }
          pages.push(body);
          pushHit({
            gameId,
            endpoint: `/v1/stats?game_ids[]=${gameId}`,
            requestNumber,
            httpStatus: res.status,
            retryAfterPresent,
            retryAfterValue,
            recordCountOnPage: body.data.length,
          });
          const next = body.meta?.next_cursor ?? null;
          if (next == null) break;
          cursor = String(next);
        }
        if (stopBatch) {
          if (hit429) {
            gameResults.push({
              gameId,
              classification: 'OTHER',
              error: systemicStop,
            });
          }
          break;
        }
        if (pages.length > 0) {
          await archiveJsonObjectToS3({
            s3,
            key,
            body: {
              schemaVersion: 1,
              source: 'balldontlie',
              endpoint: '/v1/stats',
              season: SEASON,
              game_id: gameId,
              pages,
              fetchedAt: new Date().toISOString(),
            },
          });
          wrote += 1;
          archiveComplete = true;
        }
      }

      const rows = pages.flatMap((p) => (Array.isArray(p.data) ? (p.data as StatRow[]) : []));
      const wrongGame = rows.some((r) => r.game?.id != null && String(r.game.id) !== gameId);
      const validated = validateGame({
        gameId,
        rows,
        official,
        archiveComplete,
        replaceIncomplete: gameId === '18447793',
      });
      gameResults.push({ ...validated, skippedExisting, s3Key: key });
      if (wrongGame) {
        systemicStop = `wrong game data returned for requested ${gameId}`;
        break;
      }
    }

    await archiveJsonObjectToS3({
      s3,
      key: `${prefix}/${repairManifestName}`,
      overwrite: true,
      body: {
        schemaVersion: 1,
        entity: 'player_stats',
        season: SEASON,
        kind: remaining31 ? 'goat_stats_repair_remaining31' : 'goat_stats_repair_3game_batch',
        gameIds: batchIds,
        written: wrote,
        skipped,
        status: systemicStop ? 'partial' : 'success',
        postgresMaterialize: false,
        fetchedAt: new Date().toISOString(),
      },
    });
  } finally {
    lock.release();
  }

  const postgresAfter = await snapshotPostgres(pool);
  await pool.end().catch(() => undefined);
  const postgresUnchanged =
    postgresBefore.raw_stats === postgresAfter.raw_stats &&
    postgresBefore.logs === postgresAfter.logs &&
    postgresBefore.team_stats === postgresAfter.team_stats &&
    postgresBefore.player_avgs === postgresAfter.player_avgs &&
    postgresBefore.team_avgs === postgresAfter.team_avgs &&
    postgresBefore.stints === postgresAfter.stints &&
    postgresBefore.db_bytes === postgresAfter.db_bytes;

  const spacings = httpHits
    .map((h) => h.spacingMsSincePrev)
    .filter((n): n is number => typeof n === 'number');
  const avgSpacingMs =
    spacings.length > 0 ? Math.round(spacings.reduce((a, b) => a + b, 0) / spacings.length) : null;
  const rateLimit = {
    requestedGames: batchIds.length,
    completedGames: gameResults.filter((g) => g.archiveComplete === true).length,
    httpRequests: httpHits.length,
    count200: httpHits.filter((h) => h.httpStatus === 200).length,
    count429: httpHits.filter((h) => h.httpStatus === 429).length,
    retriesLogged: retries,
    retryAfterUsed,
    enforcedSpacingMs: delay.delayMs,
    averageActualSpacingMs: avgSpacingMs,
    spacingsMs: spacings,
    concurrency: delay.concurrency,
    skippedExistingS3: skipped,
  };
  const s3Result = {
    prefix,
    written: wrote,
    skipped,
    repairManifest: `${prefix}/${repairManifestName}`,
    seasonWideManifestUntouched: `${prefix}/_manifest.json`,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    writes: { postgres: false, s3Prefix: prefix, diagnosticReport: outPath },
    safety,
    httpHits,
    rateLimit,
    s3: s3Result,
    games: gameResults,
    postgresBefore,
    postgresAfter,
    postgresUnchanged,
    systemicStop,
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  if (remaining31) {
    writeConsolidatedAcquisition({
      remainingGames: gameResults,
      remainingRequested: batchIds,
      remainingCompleted: gameResults.filter((g) => g.archiveComplete === true).length,
      systemicStop,
      postgresBefore,
      postgresAfter,
      postgresUnchanged,
      rateLimit,
      s3: s3Result,
      safety,
    });
  }
  console.log(JSON.stringify(report, null, 2));
  if (systemicStop) process.exit(2);
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : err);
  process.exit(1);
});
