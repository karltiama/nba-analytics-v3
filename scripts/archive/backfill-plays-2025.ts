/**
 * Season 2025 Plays raw archive (Step 9E).
 * Canonical S3 only. No possessions, WOWY, or serving tables. No 2022.
 *
 * Reuses /nba/v1/plays + BdlArchiveClient. Copies valid Step 9D
 * characterization objects instead of refetching.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-plays-2025.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-plays-2025.ts --execute
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-plays-2025.ts --certify-only
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import {
  extractLineupRows,
  lineups2025CanonicalPrefix,
  lineups2025GameObjectKey,
  loadAuthoritativeBdl2025GameInventory,
  nestedId,
  validateLineupArchiveBody,
} from '@/lib/archive/lineups-2025';
import {
  PLAYS_2025_AVAILABILITY_LIMITATION,
  PLAYS_2025_EXPECTED_TARGET,
  PLAYS_2025_MAX_CRAWL_MS,
  PLAYS_2025_STARTER_ANOMALY_IDS,
  PLAYS_CHAR_PREFIX,
  PLAYS_MAX_PAGES_PER_GAME,
  PLAYS_PATH_PRIMARY,
  classifyRotationReliability,
  extractPlayRows,
  plays2025CanonicalPrefix,
  plays2025GameObjectKey,
  validatePlaysArchiveBody,
  type PlaysArchiveJson,
} from '@/lib/archive/plays';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import { assertTrialExecuteAllowed, resolveBdlRequestDelayMs } from '@/lib/balldontlie/trial-limiter';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const EXPECTED_DB_BYTES = 342_846_611;
const TRIAL_START_ISO = '2026-09-08T12:10:59.422Z';
const REPORT_JSON = 'reports/trial/plays-2025-full-archive-report.json';
const REPORT_MD = 'reports/trial/plays-2025-full-archive-report.md';
const PROGRESS_JSON = 'reports/trial/plays-2025-full-archive-progress.json';
const MAX_CONSECUTIVE_FAILURES = 5;
const SENTINEL_ABS = 1_000_000;
const ANOMALY = new Set<string>(PLAYS_2025_STARTER_ANOMALY_IDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, unknown>;

type GameMeta = {
  game_id: string;
  start_time: Date | null;
  home_team_id: string;
  away_team_id: string;
  home_abbr: string;
  away_abbr: string;
  home_score: number | null;
  away_score: number | null;
  postseason: boolean | null;
};

function sid(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function asObj(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

function round(n: number | null | undefined, d = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function hoursSinceTrialStart(nowIso: string): number {
  return (Date.parse(nowIso) - Date.parse(TRIAL_START_ISO)) / 3_600_000;
}

function etDate(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function participantId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'object') return sid(v);
  return nestedId(v) ?? sid((v as Json).player_id);
}

function envelopeHasMore(body: Json): boolean {
  const meta = asObj(body.meta) ?? {};
  return meta.next_cursor != null || meta.next_page != null;
}

function isCanonicalGameKey(prefix: string, key: string): boolean {
  if (!key.startsWith(`${prefix}/`)) return false;
  if (key.includes('/_characterization_')) return false;
  return /\/game_id=\d+\.json$/.test(key);
}

function writeProgress(body: Json) {
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(PROGRESS_JSON, JSON.stringify(body, null, 2) + '\n');
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo]!;
  return round(sorted[lo]! * (hi - i) + sorted[hi]! * (i - lo), 2);
}

function clockOk(raw: unknown): boolean {
  const s = sid(raw);
  if (!s) return false;
  return /^\d{1,2}:\d{2}(?:\.\d+)?$/.test(s);
}

function classifyType(type: string): string {
  const t = type.toLowerCase();
  if (type === 'Substitution' || /substitut/.test(t)) return 'substitution';
  if (/\bfree throw\b/.test(t)) return 'free_throw';
  if (/timeout/.test(t)) return 'timeout';
  if (/jump.?ball/.test(t)) return 'jump_ball';
  if (/turnover|travel|shot clock|palming|back court/.test(t)) return 'turnover';
  if (/rebound/.test(t)) return 'rebound';
  if (/foul|flagrant|technical/.test(t)) return 'foul';
  if (/period|end game|end period/.test(t)) return 'period_boundary';
  if (/review|challenge/.test(t)) return 'review';
  return 'other';
}

async function fetchPlaysPage(
  bdl: BdlArchiveClient,
  gameId: string,
  extra: Record<string, string> = {}
): Promise<{ status: number; url: string; body: Json; hasMore: boolean }> {
  const params = new URLSearchParams({ game_id: gameId, ...extra });
  const url = `${bdl.baseUrl}${PLAYS_PATH_PRIMARY}?${params.toString()}`;
  const res = await bdl.fetchWithRetry(url);
  const text = await res.text();
  let body: Json = {};
  try {
    body = JSON.parse(text) as Json;
  } catch {
    body = { _unparseable: true, preview: text.slice(0, 400) };
  }
  return { status: res.status, url, body, hasMore: envelopeHasMore(body) };
}

async function measurePostgres(client: { query: (sql: string) => Promise<{ rows: Json[] }> }) {
  const snap = await client.query(`select pg_database_size(current_database())::text as db_bytes`);
  const serving = await client.query(
    `select to_regclass('analytics.plays')::text as rel
     union all select to_regclass('analytics.play_by_play')::text
     union all select to_regclass('analytics.possessions')::text
     union all select to_regclass('raw.plays')::text
     union all select to_regclass('raw.play_by_play')::text
     union all select to_regclass('analytics.lineup_units')::text
     union all select to_regclass('analytics.player_stints_from_plays')::text
     union all select to_regclass('analytics.wowy')::text`
  );
  const tables = (serving.rows as { rel: string | null }[]).map((r) => r.rel).filter(Boolean) as string[];
  const dbBytes = Number((snap.rows[0] as { db_bytes: string }).db_bytes);
  return { dbBytes, dbMb: round(dbBytes / (1024 * 1024), 2), unexpectedServing: tables };
}

async function listReusableCharacterization(
  s3: S3Storage,
  charPrefix: string,
  targetIds: Set<string>
): Promise<{ gameId: string; key: string; body: Json }[]> {
  const out: { gameId: string; key: string; body: Json }[] = [];
  const prefix = charPrefix.endsWith('/') ? charPrefix : `${charPrefix}/`;
  for await (const o of s3.listByPrefix(prefix)) {
    const m = o.key.match(/game_id=(\d+)\.json$/);
    if (!m) continue;
    const gameId = m[1]!;
    if (!targetIds.has(gameId)) continue;
    const body = await s3.getJson<Json>(o.key);
    const v = validatePlaysArchiveBody(gameId, body);
    if (!v.ok || !body) {
      console.log(`[plays-2025] characterization skip game_id=${gameId} reason=${v.reason}`);
      continue;
    }
    out.push({ gameId, key: o.key, body });
  }
  return out;
}

async function alreadyCanonical(s3: S3Storage, canonicalPrefix: string): Promise<Set<string>> {
  const have = new Set<string>();
  const prefix = canonicalPrefix.endsWith('/') ? canonicalPrefix : `${canonicalPrefix}/`;
  for await (const o of s3.listByPrefix(prefix)) {
    if (!isCanonicalGameKey(canonicalPrefix, o.key)) continue;
    const m = o.key.match(/game_id=(\d+)\.json$/);
    if (m) have.add(m[1]!);
  }
  return have;
}

async function loadStarters(
  s3: S3Storage,
  gameId: string
): Promise<{ ok: boolean; reason: string; byTeam: Record<string, string[]>; counts: Record<string, number> }> {
  const key = lineups2025GameObjectKey(lineups2025CanonicalPrefix(), gameId);
  const body = await s3.getJson<Json>(key);
  const v = validateLineupArchiveBody(gameId, body);
  if (!v.ok || !body) return { ok: false, reason: v.reason, byTeam: {}, counts: {} };
  const rows = extractLineupRows(body);
  const byTeam: Record<string, string[]> = {};
  for (const r of rows) {
    if (r.starter !== true) continue;
    const teamId = nestedId(r.team);
    const playerId = nestedId(r.player);
    if (!teamId || !playerId) continue;
    byTeam[teamId] = byTeam[teamId] ?? [];
    byTeam[teamId].push(playerId);
  }
  const counts: Record<string, number> = {};
  for (const [t, ids] of Object.entries(byTeam)) counts[t] = ids.length;
  const sizes = Object.values(byTeam).map((a) => a.length);
  const ok = sizes.length === 2 && sizes.every((n) => n === 5);
  return { ok, reason: ok ? 'ok' : `starter_counts=${JSON.stringify(counts)}`, byTeam, counts };
}

type SubFailure = {
  gameId: string;
  date: string | null;
  matchup: string;
  period: unknown;
  clock: unknown;
  order: unknown;
  type: unknown;
  text: unknown;
  participants: string[];
  teamId: string | null;
  onCourtBefore: string[];
  classification: string;
  periodBoundary: boolean;
};

function replayRotations(args: {
  gameId: string;
  date: string | null;
  matchup: string;
  homeTeamId: string;
  awayTeamId: string;
  starters: Record<string, string[]>;
  rows: PlaysArchiveJson[];
}): {
  ok: boolean;
  substitutions: number;
  homeSubs: number;
  awaySubs: number;
  firstFailure: SubFailure | null;
  periodBoundarySizeIssues: Json[];
} {
  const home = new Set(args.starters[args.homeTeamId] ?? []);
  const away = new Set(args.starters[args.awayTeamId] ?? []);
  let substitutions = 0;
  let homeSubs = 0;
  let awaySubs = 0;
  let prevPeriod: number | null = null;
  let prevType: string | null = null;
  const periodBoundarySizeIssues: Json[] = [];

  const fail = (
    ev: PlaysArchiveJson,
    parts: string[],
    teamId: string | null,
    onBefore: string[],
    classification: string,
    periodBoundary: boolean
  ): SubFailure => ({
    gameId: args.gameId,
    date: args.date,
    matchup: args.matchup,
    period: ev.period,
    clock: ev.clock,
    order: ev.order,
    type: ev.type,
    text: ev.text,
    participants: parts,
    teamId,
    onCourtBefore: onBefore,
    classification,
    periodBoundary,
  });

  for (const ev of args.rows) {
    const period = typeof ev.period === 'number' ? ev.period : Number(ev.period);
    const type = sid(ev.type);
    const periodChanged = prevPeriod != null && Number.isFinite(period) && period !== prevPeriod;
    const afterEndPeriod = prevType === 'End Period';
    const periodBoundary = periodChanged || afterEndPeriod;

    if (type === 'End Period' || type === 'End Game') {
      if (home.size !== 5 || away.size !== 5) {
        periodBoundarySizeIssues.push({
          gameId: args.gameId,
          order: ev.order,
          period: ev.period,
          clock: ev.clock,
          type,
          homeSize: home.size,
          awaySize: away.size,
        });
      }
    }

    if (type === 'Substitution') {
      substitutions += 1;
      const teamId = nestedId(ev.team);
      const parts = Array.isArray(ev.participants)
        ? (ev.participants as unknown[]).map((p) => participantId(p)).filter((id): id is string => !!id)
        : [];
      const on =
        teamId === args.homeTeamId ? home : teamId === args.awayTeamId ? away : null;
      if (!on) {
        return {
          ok: false,
          substitutions,
          homeSubs,
          awaySubs,
          firstFailure: fail(ev, parts, teamId, [], 'UNKNOWN_TEAM', periodBoundary),
          periodBoundarySizeIssues,
        };
      }
      const onBefore = [...on];
      if (teamId === args.homeTeamId) homeSubs += 1;
      else awaySubs += 1;
      const unique = [...new Set(parts)];
      if (unique.length !== 2) {
        return {
          ok: false,
          substitutions,
          homeSubs,
          awaySubs,
          firstFailure: fail(ev, parts, teamId, onBefore, 'MISSING_PARTICIPANT', periodBoundary),
          periodBoundarySizeIssues,
        };
      }
      const outC = unique.filter((id) => on.has(id));
      const inC = unique.filter((id) => !on.has(id));
      let code: string | null = null;
      if (outC.length === 2) code = 'BOTH_ON_COURT';
      else if (inC.length === 2) code = 'BOTH_OFF_COURT';
      else if (outC.length !== 1) code = 'OUT_NOT_ON_COURT';
      else if (inC.length !== 1) code = 'IN_ALREADY_ON_COURT';
      if (code) {
        return {
          ok: false,
          substitutions,
          homeSubs,
          awaySubs,
          firstFailure: fail(ev, parts, teamId, onBefore, code, periodBoundary),
          periodBoundarySizeIssues,
        };
      }
      on.delete(outC[0]!);
      on.add(inC[0]!);
      if (on.size !== 5) {
        return {
          ok: false,
          substitutions,
          homeSubs,
          awaySubs,
          firstFailure: fail(ev, parts, teamId, onBefore, 'TEAM_SIZE_NOT_5', periodBoundary),
          periodBoundarySizeIssues,
        };
      }
    }

    if (Number.isFinite(period)) prevPeriod = period;
    if (type) prevType = type;
  }

  return {
    ok: home.size === 5 && away.size === 5 && periodBoundarySizeIssues.length === 0,
    substitutions,
    homeSubs,
    awaySubs,
    firstFailure:
      home.size === 5 && away.size === 5
        ? null
        : {
            gameId: args.gameId,
            date: args.date,
            matchup: args.matchup,
            period: null,
            clock: null,
            order: null,
            type: null,
            text: null,
            participants: [],
            teamId: null,
            onCourtBefore: [...home, ...away],
            classification: 'TEAM_SIZE_NOT_5',
            periodBoundary: false,
          },
    periodBoundarySizeIssues,
  };
}

function renderMd(report: Json): string {
  return `# Plays 2025 full archive (Step 9E)

Generated: ${report.generatedAt}

**Archive verdict:** ${report.archiveVerdict}

**Step verdict:** ${report.stepVerdict}

**Rotation reliability:** ${JSON.stringify((report.fullSeasonRotationReconstruction as Json)?.reliability)}

Do NOT start 2022. Do NOT build possessions or WOWY. Do NOT create serving tables.

Machine-readable: \`${REPORT_JSON}\`

## Safety State
${JSON.stringify(report.safety, null, 2)}

## Target Definition
${JSON.stringify(report.targetDefinition, null, 2)}

## Characterization Reuse
${JSON.stringify(report.characterizationReuse, null, 2)}

## Time Gate
${JSON.stringify(report.timeGate, null, 2)}

## Acquisition Result
${JSON.stringify(report.acquisitionResult, null, 2)}

## Rate-Limit Result
${JSON.stringify(report.rateLimitResult, null, 2)}

## Event Grain
${JSON.stringify(report.eventGrain, null, 2)}

## Identity Certification
${JSON.stringify(report.identityCertification, null, 2)}

## Event-Type Inventory
${JSON.stringify(report.eventTypeInventory, null, 2)}

## Score Reconciliation
${JSON.stringify(report.scoreReconciliation, null, 2)}

## Starter Eligibility
${JSON.stringify(report.starterEligibility, null, 2)}

## Substitution Semantics
${JSON.stringify(report.substitutionSemantics, null, 2)}

## Full-Season Rotation Reconstruction
${JSON.stringify(report.fullSeasonRotationReconstruction, null, 2)}

## Rotation Failure Cases
${JSON.stringify(report.rotationFailureCases, null, 2)}

## Period-Boundary Result
${JSON.stringify(report.periodBoundaryResult, null, 2)}

## Substitution Statistics
${JSON.stringify(report.substitutionStatistics, null, 2)}

## Period / Clock Integrity
${JSON.stringify(report.periodClockIntegrity, null, 2)}

## Wallclock Result
${JSON.stringify(report.wallclockResult, null, 2)}

## Shot Coordinate Result
${JSON.stringify(report.shotCoordinateResult, null, 2)}

## Possession Feasibility
${JSON.stringify(report.possessionFeasibility, null, 2)}

## WOWY Feasibility
${JSON.stringify(report.wowyFeasibility, null, 2)}

## S3 Certification
${JSON.stringify(report.s3Certification, null, 2)}

## Product Interpretation
${JSON.stringify(report.productInterpretation, null, 2)}

## Trial Time Remaining
${JSON.stringify(report.trialTimeRemaining, null, 2)}

## Postgres Unchanged Confirmation
${JSON.stringify(report.postgresUnchangedConfirmation, null, 2)}

## Archive Verdict
${report.archiveVerdict}

## Step Verdict
${report.stepVerdict}

## Manifest Limitations
${JSON.stringify(report.manifestLimitations, null, 2)}
`;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const argv = process.argv.slice(2);
  const { dryRun, execute } = parseExecuteFlag(argv);
  const certifyOnly = argv.includes('--certify-only');
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockBefore = bdlAcquisitionLockStatus();
  const frozen = mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun;

  const inventory = loadAuthoritativeBdl2025GameInventory();
  const targetIds = inventory.gameIds;
  const canonicalPrefix = plays2025CanonicalPrefix();

  const client = await pool.connect();
  let isolationBefore: Awaited<ReturnType<typeof measurePostgres>>;
  let gamesById = new Map<string, GameMeta>();
  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout = '180000'");
    isolationBefore = await measurePostgres(client);
    const gres = await client.query<GameMeta>(
      `select
         g.game_id,
         g.start_time,
         g.home_team_id,
         g.away_team_id,
         ht.abbreviation as home_abbr,
         at.abbreviation as away_abbr,
         g.home_score,
         g.away_score,
         rg.postseason
       from analytics.games g
       join analytics.teams ht on ht.team_id = g.home_team_id
       join analytics.teams at on at.team_id = g.away_team_id
       left join raw.games rg on rg.id::text = g.game_id
       where g.game_id = any($1::text[])`,
      [targetIds]
    );
    gamesById = new Map(
      gres.rows.map((r) => [
        r.game_id,
        {
          ...r,
          home_score: r.home_score == null ? null : Number(r.home_score),
          away_score: r.away_score == null ? null : Number(r.away_score),
        },
      ])
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if (!frozen || pin !== '2025') {
    throw new Error(`Safety stop: frozen=${frozen} pin=${pin} dataMode=${mode.dataMode}`);
  }
  if (isolationBefore.dbBytes !== EXPECTED_DB_BYTES) {
    throw new Error(`Safety stop: postgres bytes ${isolationBefore.dbBytes} != ${EXPECTED_DB_BYTES}`);
  }
  if (isolationBefore.unexpectedServing.length > 0) {
    throw new Error(`Safety stop: unexpected serving ${JSON.stringify(isolationBefore.unexpectedServing)}`);
  }
  if (targetIds.length !== PLAYS_2025_EXPECTED_TARGET) {
    throw new Error(`Safety stop: target ${targetIds.length} != ${PLAYS_2025_EXPECTED_TARGET}`);
  }
  if (!delay.trialMode || delay.delayMs < 12000 || delay.concurrency !== 1) {
    throw new Error('Safety stop: trial limiter not 13s / concurrency 1');
  }

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });
  const targetSet = new Set(targetIds);

  console.log('[plays-2025] listing characterization + canonical objects (no BDL HTTP)');
  const reusable = await listReusableCharacterization(s3, PLAYS_CHAR_PREFIX, targetSet);
  const already = await alreadyCanonical(s3, canonicalPrefix);
  const reusableIds = new Set(reusable.map((r) => r.gameId));
  const needFetch = targetIds.filter((id) => !already.has(id) && !reusableIds.has(id));
  const needCopy = reusable.filter((r) => !already.has(r.gameId));
  const projectedRequests = needFetch.length;
  const projectedMs = projectedRequests * delay.delayMs;
  const elapsedH = hoursSinceTrialStart(generatedAt);
  const remainingH = 48 - elapsedH;
  const projectedAfterH = remainingH - projectedMs / 3_600_000;

  const safety = {
    trialMode: delay.trialMode,
    delayMs: delay.delayMs,
    minDelayMs: 12000,
    concurrency: delay.concurrency,
    lockActiveBefore: lockBefore.active,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: true,
    currentAnalyticsSeason: pin,
    dbBytesBefore: isolationBefore.dbBytes,
    dbMb: isolationBefore.dbMb,
    unexpectedServing: isolationBefore.unexpectedServing,
    acquisitionPathWritesPostgres: false,
  };
  const targetDefinition = {
    count: targetIds.length,
    expected: PLAYS_2025_EXPECTED_TARGET,
    dateMin: inventory.dateMin,
    dateMax: inventory.dateMax,
    regularSeason: inventory.regularSeason,
    postseason: inventory.postseason,
    excludedLocalOnly: '21681993',
    source: inventory.cachePath,
  };
  const reuse = {
    characterizationPrefix: PLAYS_CHAR_PREFIX,
    reusableValid: reusable.length,
    alreadyCanonical: already.size,
    needCopy: needCopy.length,
    needFetch: needFetch.length,
    expectedReusableUpTo: 10,
    expectedNewIfAll10Reused: 1312,
  };
  const timeGate = {
    trialElapsedHours: round(elapsedH, 3),
    trialRemainingHours: round(remainingH, 3),
    protectedReserveHours: 6,
    usableAfterReserveHours: round(remainingH - 6, 3),
    reusableResponses: reusable.length,
    requiredProviderRequests: projectedRequests,
    projectedCrawlMs: projectedMs,
    projectedCrawlHours: round(projectedMs / 3_600_000, 3),
    projectedRemainingAfterCrawlHours: round(projectedAfterH, 3),
    maxAllowedHours: 6,
    proceed: projectedMs <= PLAYS_2025_MAX_CRAWL_MS,
  };

  console.log(JSON.stringify({ safety, targetDefinition, reuse, timeGate }, null, 2));

  if (!timeGate.proceed) {
    throw new Error(`Safety stop: projected crawl ${timeGate.projectedCrawlHours}h exceeds 6h`);
  }

  if (dryRun && !certifyOnly && !execute) {
    console.log('[dry-run] no Plays fetches. Characterization reuse counted above.');
    await pool.end().catch(() => undefined);
    return;
  }

  let reusedGames = 0;
  let newlyRequested = 0;
  let written = 0;
  let skippedExisting = already.size;
  let successes = 0;
  let zeroResult = 0;
  const failedGames: string[] = [];
  const truncatedGames: string[] = [];
  const wallStart = Date.now();
  let metrics = {
    httpAttempts: 0,
    httpSuccess: 0,
    status429: 0,
    retries: 0,
    retryAfterUsed: 0,
    spacingSamplesMs: [] as number[],
  };
  let stoppedReason: string | null = null;

  if (execute && !certifyOnly) {
    assertTrialExecuteAllowed();
    const lock = acquireBdlAcquisitionLock();
    const bdl = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
    let consecutiveFailures = 0;
    let httpN = 0;
    try {
      await archiveJsonObjectToS3({
        s3,
        key: `${canonicalPrefix}/_run.json`,
        body: {
          schemaVersion: 1,
          entity: 'plays',
          season: 2025,
          status: 'running',
          startedAt: generatedAt,
          targetGames: targetIds.length,
          reuse,
          timeGate,
          postgresMaterialize: false,
        },
        overwrite: true,
      });

      for (const item of needCopy) {
        const dest = plays2025GameObjectKey(canonicalPrefix, item.gameId);
        await archiveJsonObjectToS3({ s3, key: dest, body: item.body });
        reusedGames += 1;
        written += 1;
        const n = extractPlayRows(item.body).length;
        if (n === 0) zeroResult += 1;
        else successes += 1;
      }

      for (const gameId of needFetch) {
        if (Date.now() - wallStart > PLAYS_2025_MAX_CRAWL_MS) {
          stoppedReason = 'wall clock exceeded 6 hour crawl cap';
          break;
        }
        if (httpN > 0) await sleep(delay.delayMs);
        httpN += 1;
        newlyRequested += 1;
        try {
          const pageMeta: Json[] = [];
          let page = await fetchPlaysPage(bdl, gameId);
          pageMeta.push({
            pageIndex: 1,
            status: page.status,
            hasMore: page.hasMore,
            meta: asObj(page.body)?.meta ?? null,
            url: page.url,
            body: page.body,
          });
          if (page.status !== 200) throw new Error(`HTTP ${page.status}`);
          let truncated = false;
          while (page.hasMore && pageMeta.length < PLAYS_MAX_PAGES_PER_GAME) {
            await sleep(delay.delayMs);
            httpN += 1;
            const meta = asObj(page.body.meta) ?? {};
            const extra: Record<string, string> = {};
            if (meta.next_cursor != null) extra.cursor = String(meta.next_cursor);
            else if (meta.next_page != null) extra.page = String(meta.next_page);
            else break;
            page = await fetchPlaysPage(bdl, gameId, extra);
            pageMeta.push({
              pageIndex: pageMeta.length + 1,
              status: page.status,
              hasMore: page.hasMore,
              meta: asObj(page.body)?.meta ?? null,
              url: page.url,
              body: page.body,
            });
            if (page.status !== 200) throw new Error(`HTTP ${page.status} page ${pageMeta.length}`);
          }
          if (page.hasMore) {
            truncated = true;
            truncatedGames.push(gameId);
          }
          const body = {
            game_id: gameId,
            path: PLAYS_PATH_PRIMARY,
            fetchedAt: new Date().toISOString(),
            truncated,
            paginationObserved: pageMeta.length > 1 || truncated,
            pages: pageMeta,
          };
          const v = validatePlaysArchiveBody(gameId, body);
          if (!v.ok) throw new Error(`invalid plays body: ${v.reason}`);
          const dest = plays2025GameObjectKey(canonicalPrefix, gameId);
          await archiveJsonObjectToS3({ s3, key: dest, body });
          written += 1;
          const n = extractPlayRows(body).length;
          if (n === 0) zeroResult += 1;
          else successes += 1;
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures += 1;
          failedGames.push(gameId);
          console.error(`[plays-2025] FAIL game_id=${gameId} ${err instanceof Error ? err.message : String(err)}`);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            throw new Error(`Stopping: ${MAX_CONSECUTIVE_FAILURES} consecutive Plays fetch failures`);
          }
        }
        if (httpN % 25 === 0 || httpN === needFetch.length) {
          writeProgress({
            updatedAt: new Date().toISOString(),
            httpN,
            needFetch: needFetch.length,
            reusedGames,
            written,
            failedGames,
            successes,
            zeroResult,
            truncatedGames,
            stoppedReason,
          });
          console.log(
            `[plays-2025] progress fetch ${httpN}/${needFetch.length} reused=${reusedGames} fail=${failedGames.length}`
          );
        }
      }
      metrics = bdl.getMetrics();
    } finally {
      lock.release();
    }
  }

  const wallMs = Date.now() - wallStart;
  const spacing = metrics.spacingSamplesMs;
  const rateLimit = {
    configuredSpacingMs: delay.delayMs,
    concurrency: 1,
    averageMs: spacing.length ? round(spacing.reduce((a, b) => a + b, 0) / spacing.length, 1) : null,
    minimumMs: spacing.length ? Math.min(...spacing) : null,
    maximumMs: spacing.length ? Math.max(...spacing) : null,
    minObservedAtLeast12000: spacing.length ? Math.min(...spacing) >= 12000 : metrics.httpAttempts <= 1,
  };

  console.log('[plays-2025] certifying canonical objects from S3 (no new BDL HTTP unless crawl just ran)');

  const missingCanonical: string[] = [];
  const invalidCanonical: string[] = [];
  const eventCounts: number[] = [];
  const grain = {
    totalEvents: 0,
    distinctKeys: 0,
    duplicateLogicalKeys: 0,
    gamesWithDuplicateOrders: [] as string[],
    nullGameIds: 0,
    nullOrders: 0,
    gamesWithOrderGaps: [] as string[],
    gamesNotStartingAt1: [] as string[],
    gamesNotMonotonic: [] as string[],
  };
  const identity = {
    wrongGameEvents: 0,
    unknownGameEvents: 0,
    wrongSeasonGames: [] as string[],
    validTeamEvents: 0,
    nullTeamEvents: 0,
    unknownTeamEvents: 0,
  };
  const typeCounts = new Map<string, number>();
  let scoringPlays = 0;
  let shootingPlays = 0;
  let substitutionEvents = 0;
  const clock = {
    nullPeriods: 0,
    nullClocks: 0,
    malformedClocks: 0,
    periodValues: new Set<number>(),
    otGames: [] as string[],
    maxPeriod: 0,
    endPeriod: 0,
  };
  const wall = { populated: 0, nulls: 0, reversals: 0, duplicates: 0, gamesWithReversals: [] as string[] };
  const shot = {
    shooting: 0,
    xPop: 0,
    yPop: 0,
    both: 0,
    plausible: 0,
    sentinel: 0,
  };
  const scoreRows: Json[] = [];
  const scoreMismatches: Json[] = [];
  const participantIds = new Set<string>();
  const rotationFailures: SubFailure[] = [];
  const periodBoundaryFails: SubFailure[] = [];
  const periodBoundarySizeIssues: Json[] = [];
  const eligibleIds: string[] = [];
  const notEligible: Json[] = [];
  let reconstructedOk = 0;
  const subPerGame: number[] = [];
  const subPerGameRs: number[] = [];
  const subPerGamePost: number[] = [];
  const zeroSubGames: string[] = [];
  const teamSubPerGame: number[] = [];
  let objectBytes = 0;
  let objectCount = 0;
  let charBytes = 0;
  let charCount = 0;

  for await (const o of s3.listByPrefix(canonicalPrefix.endsWith('/') ? canonicalPrefix : `${canonicalPrefix}/`)) {
    if (isCanonicalGameKey(canonicalPrefix, o.key)) {
      objectCount += 1;
      objectBytes += o.size;
    }
  }
  for await (const o of s3.listByPrefix(PLAYS_CHAR_PREFIX.endsWith('/') ? PLAYS_CHAR_PREFIX : `${PLAYS_CHAR_PREFIX}/`)) {
    charCount += 1;
    charBytes += o.size;
  }

  let certifiedEvents = 0;
  for (const gameId of targetIds) {
    const key = plays2025GameObjectKey(canonicalPrefix, gameId);
    const body = await s3.getJson<Json>(key);
    const meta = gamesById.get(gameId);
    const matchup = meta ? `${meta.away_abbr} @ ${meta.home_abbr}` : 'unknown';
    const date = meta ? etDate(meta.start_time) : null;
    if (!body) {
      missingCanonical.push(gameId);
      continue;
    }
    const v = validatePlaysArchiveBody(gameId, body);
    if (!v.ok) {
      invalidCanonical.push(gameId);
      continue;
    }
    const rows = extractPlayRows(body);
    certifiedEvents += rows.length;
    eventCounts.push(rows.length);
    if (execute && already.has(gameId) && !reusableIds.has(gameId)) {
      /* already counted in skippedExisting */
    }

    const orders: number[] = [];
    const orderSet = new Set<number>();
    let mono = true;
    let prevOrder = -Infinity;
    let prevWall = 0;
    const wallSeen = new Set<string>();
    let gameWallRev = false;
    let last: PlaysArchiveJson | null = null;
    const gamePeriods = new Set<number>();

    for (const r of rows) {
      last = r;
      const gid = sid(r.game_id);
      if (gid == null) grain.nullGameIds += 1;
      else if (gid !== gameId) identity.wrongGameEvents += 1;
      const o = Number(r.order);
      if (!Number.isFinite(o)) grain.nullOrders += 1;
      else {
        orders.push(o);
        orderSet.add(o);
        if (o < prevOrder) mono = false;
        prevOrder = o;
      }
      const type = sid(r.type) ?? '';
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      if (type === 'Substitution') substitutionEvents += 1;
      if (r.scoring_play === true) scoringPlays += 1;
      if (r.shooting_play === true) {
        shootingPlays += 1;
        shot.shooting += 1;
        const x = typeof r.coordinate_x === 'number' ? r.coordinate_x : null;
        const y = typeof r.coordinate_y === 'number' ? r.coordinate_y : null;
        if (x != null) shot.xPop += 1;
        if (y != null) shot.yPop += 1;
        if (x != null && y != null) {
          shot.both += 1;
          if (Math.abs(x) >= SENTINEL_ABS || Math.abs(y) >= SENTINEL_ABS) shot.sentinel += 1;
          else shot.plausible += 1;
        }
      }
      const tid = nestedId(r.team);
      if (!tid) identity.nullTeamEvents += 1;
      else if (meta && tid !== meta.home_team_id && tid !== meta.away_team_id) identity.unknownTeamEvents += 1;
      else identity.validTeamEvents += 1;
      if (Array.isArray(r.participants)) {
        for (const p of r.participants as unknown[]) {
          const id = participantId(p);
          if (id) participantIds.add(id);
        }
      }
      if (r.period == null) clock.nullPeriods += 1;
      else if (typeof r.period === 'number') {
        clock.periodValues.add(r.period);
        gamePeriods.add(r.period);
        if (r.period > clock.maxPeriod) clock.maxPeriod = r.period;
      }
      if (r.clock == null || sid(r.clock) == null) clock.nullClocks += 1;
      else if (!clockOk(r.clock)) clock.malformedClocks += 1;
      if (type === 'End Period') clock.endPeriod += 1;
      const w = sid(r.wallclock);
      if (!w) wall.nulls += 1;
      else {
        wall.populated += 1;
        if (wallSeen.has(w)) wall.duplicates += 1;
        wallSeen.add(w);
        const t = Date.parse(w);
        if (Number.isFinite(t)) {
          if (prevWall && t < prevWall) {
            wall.reversals += 1;
            gameWallRev = true;
          }
          prevWall = t;
        }
      }
    }

    grain.totalEvents += rows.length;
    grain.distinctKeys += orderSet.size;
    const finite = orders.filter((n) => Number.isFinite(n));
    const dups = finite.length - orderSet.size;
    if (dups > 0) {
      grain.duplicateLogicalKeys += dups;
      grain.gamesWithDuplicateOrders.push(gameId);
    }
    if (finite.length) {
      const minO = Math.min(...finite);
      const maxO = Math.max(...finite);
      if (minO !== 1) grain.gamesNotStartingAt1.push(gameId);
      if (maxO - minO + 1 !== orderSet.size) grain.gamesWithOrderGaps.push(gameId);
    }
    if (!mono) grain.gamesNotMonotonic.push(gameId);
    if (gameWallRev) wall.gamesWithReversals.push(gameId);
    if ([...gamePeriods].some((p) => p >= 5)) clock.otGames.push(gameId);

    const lastHome = last ? Number(last.home_score) : NaN;
    const lastAway = last ? Number(last.away_score) : NaN;
    const match =
      meta != null &&
      Number.isFinite(lastHome) &&
      Number.isFinite(lastAway) &&
      lastHome === meta.home_score &&
      lastAway === meta.away_score;
    const scoreRow = {
      gameId,
      plays: Number.isFinite(lastHome) ? { home: lastHome, away: lastAway } : null,
      analytics: meta ? { home: meta.home_score, away: meta.away_score } : null,
      exactMatch: match,
    };
    scoreRows.push(scoreRow);
    if (!match) scoreMismatches.push(scoreRow);

    const starters = await loadStarters(s3, gameId);
    if (ANOMALY.has(gameId)) {
      notEligible.push({ gameId, reason: 'starter_archive_anomaly', counts: starters.counts });
    } else if (!starters.ok || !meta) {
      notEligible.push({ gameId, reason: starters.reason, counts: starters.counts });
    } else {
      eligibleIds.push(gameId);
      const replay = replayRotations({
        gameId,
        date,
        matchup,
        homeTeamId: meta.home_team_id,
        awayTeamId: meta.away_team_id,
        starters: starters.byTeam,
        rows,
      });
      subPerGame.push(replay.substitutions);
      teamSubPerGame.push(replay.homeSubs, replay.awaySubs);
      const isPost = meta.postseason === true || (date != null && date >= '2026-04-18');
      if (isPost) subPerGamePost.push(replay.substitutions);
      else subPerGameRs.push(replay.substitutions);
      if (replay.substitutions === 0) zeroSubGames.push(gameId);
      periodBoundarySizeIssues.push(...replay.periodBoundarySizeIssues);
      if (replay.ok) reconstructedOk += 1;
      else if (replay.firstFailure) {
        rotationFailures.push(replay.firstFailure);
        if (replay.firstFailure.periodBoundary) periodBoundaryFails.push(replay.firstFailure);
      }
    }
  }

  const mapClient = await pool.connect();
  let mappedParticipants = 0;
  let isolationAfter: Awaited<ReturnType<typeof measurePostgres>>;
  try {
    await mapClient.query('begin read only');
    isolationAfter = await measurePostgres(mapClient);
    const ids = [...participantIds];
    if (ids.length) {
      const r = await mapClient.query(
        `select count(*)::int as n from (
           select unnest($1::text[]) as pid
         ) s
         where exists (select 1 from analytics.players p where p.player_id = s.pid)
            or exists (
              select 1 from analytics.player_provider_ids i
              where i.provider = 'balldontlie' and i.provider_player_id = s.pid
            )`,
        [ids]
      );
      mappedParticipants = Number((r.rows[0] as { n: string | number }).n);
    }
    await mapClient.query('commit');
  } catch (err) {
    await mapClient.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    mapClient.release();
  }

  const eligible = eligibleIds.length;
  const reliability = classifyRotationReliability(reconstructedOk, eligible);
  const subSorted = [...subPerGame].sort((a, b) => a - b);
  const groups: Record<string, string[]> = {};
  for (const t of typeCounts.keys()) {
    const g = classifyType(t);
    groups[g] = groups[g] ?? [];
    if (!groups[g]!.includes(t)) groups[g]!.push(t);
  }
  const topTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);

  const scoreMatchN = scoreRows.filter((r) => r.exactMatch === true).length;
  const avgEvents = eventCounts.length ? eventCounts.reduce((a, b) => a + b, 0) / eventCounts.length : 0;
  const possessionFeasibility = {
    classification: 'POSSESSION_COMPLEX_BUT_POSSIBLE',
    complications: [
      'offensive rebounds',
      'team/null-team rebounds',
      'technical free throws',
      'flagrant/clear-path free throws',
      'jump balls',
      'reviews/challenges',
      'period endings',
      'null-team administrative events',
      'assists/steals/blocks not separate types',
    ],
    note: 'No possession engine was built.',
  };

  let archiveVerdict:
    | 'HIGH_VALUE_ARCHIVE_CONFIRMED'
    | 'ARCHIVE_VALUABLE_WITH_ROTATION_LIMITS'
    | 'EVENT_ARCHIVE_ONLY'
    | 'LOW_VALUE' = 'LOW_VALUE';
  if (reliability.classification === 'EXCELLENT' || reliability.classification === 'GOOD') {
    archiveVerdict = 'HIGH_VALUE_ARCHIVE_CONFIRMED';
  } else if (reliability.classification === 'MIXED') {
    archiveVerdict = 'ARCHIVE_VALUABLE_WITH_ROTATION_LIMITS';
  } else if (eventCounts.length >= PLAYS_2025_EXPECTED_TARGET * 0.95 && scoreMatchN >= eventCounts.length * 0.95) {
    archiveVerdict = 'EVENT_ARCHIVE_ONLY';
  }

  const stepVerdict =
    archiveVerdict === 'HIGH_VALUE_ARCHIVE_CONFIRMED'
      ? 'GREEN — full Plays archive confirms high-value event and rotation data'
      : archiveVerdict === 'ARCHIVE_VALUABLE_WITH_ROTATION_LIMITS'
        ? 'YELLOW — Plays archive useful but rotation reconstruction requires scoped use'
        : archiveVerdict === 'EVENT_ARCHIVE_ONLY'
          ? 'YELLOW — Plays archive useful but rotation reconstruction requires scoped use'
          : 'RED — full-season Plays quality does not justify rotation/event investment';

  const finishedAt = new Date().toISOString();
  const elapsedAfter = hoursSinceTrialStart(finishedAt);
  const remainingAfter = 48 - elapsedAfter;

  const manifestLimitations = {
    certified: [
      'event order',
      'event clock',
      'scores',
      'substitution timeline',
      'participants',
      'team context',
    ],
    notAutomaticallyCertified: [
      'possession boundaries',
      'participant roles',
      'exact substitution IN/OUT labels',
      'shot coordinate geometry',
      'WOWY',
      'active roster status',
    ],
    note: 'IN/OUT is inferred during reconstruction from current on-court state. That inference is not stored as raw provider truth.',
  };

  const report: Json = {
    generatedAt: finishedAt,
    step: '9E',
    started2022: false,
    postgresWrites: false,
    builtPossessions: false,
    builtWowy: false,
    safety,
    targetDefinition,
    characterizationReuse: reuse,
    timeGate,
    acquisitionResult: {
      target: PLAYS_2025_EXPECTED_TARGET,
      reused: execute && !certifyOnly ? reusedGames : reuse.reusableValid,
      newlyRequested: newlyRequested,
      skippedExisting,
      written,
      successful: successes,
      zeroResult,
      failed: failedGames,
      truncated: truncatedGames,
      stoppedReason,
      totalEvents: grain.totalEvents,
      averageEventsPerGame: round(avgEvents, 1),
      minEventsPerGame: eventCounts.length ? Math.min(...eventCounts) : null,
      maxEventsPerGame: eventCounts.length ? Math.max(...eventCounts) : null,
      httpAttempts: metrics.httpAttempts,
      httpSuccess: metrics.httpSuccess,
      status429: metrics.status429,
      retries: metrics.retries,
      retryAfterUsed: metrics.retryAfterUsed,
      wallClockMs: wallMs,
    },
    rateLimitResult: rateLimit,
    eventGrain: grain,
    identityCertification: {
      targetGames: targetIds.length,
      missingCanonical,
      invalidCanonical,
      ...identity,
      participants: {
        uniqueIds: participantIds.size,
        mapped: mappedParticipants,
        unmapped: participantIds.size - mappedParticipants,
        conflicts: 0,
        matchMethod: 'analytics.players.player_id or analytics.player_provider_ids provider=balldontlie',
      },
    },
    eventTypeInventory: {
      distinctTypes: typeCounts.size,
      topTypes: Object.fromEntries(topTypes),
      substitution: substitutionEvents,
      scoringPlays,
      shootingPlays,
      groups,
    },
    scoreReconciliation: {
      matched: scoreMatchN,
      of: scoreRows.length,
      mismatches: scoreMismatches,
      missingFinalScore: scoreRows.filter((r) => r.plays == null).map((r) => r.gameId),
    },
    starterEligibility: {
      expectedEligible: 1320,
      eligible,
      notEligible,
      anomalyIds: [...ANOMALY],
    },
    substitutionSemantics: {
      exactType: 'Substitution',
      total: substitutionEvents,
      direction: 'participant on court = OUT; participant off court = IN; no name parsing',
    },
    fullSeasonRotationReconstruction: {
      eligible,
      reconstructedSuccessfully: reconstructedOk,
      failed: rotationFailures.length,
      successPct: reliability.pct,
      reliability: reliability.classification,
    },
    rotationFailureCases: rotationFailures,
    periodBoundaryResult: {
      substitutionFailuresAtPeriodChange: periodBoundaryFails,
      sizeNot5AtEndPeriod: periodBoundarySizeIssues,
      note: 'Period-boundary clustering = substitution failure immediately after period change or End Period, or five-man size invalid at End Period/End Game.',
    },
    substitutionStatistics: {
      total: substitutionEvents,
      medianPerGame: quantile(subSorted, 0.5),
      p25: quantile(subSorted, 0.25),
      p75: quantile(subSorted, 0.75),
      min: subSorted[0] ?? null,
      max: subSorted[subSorted.length - 1] ?? null,
      regularSeasonGames: subPerGameRs.length,
      postseasonGames: subPerGamePost.length,
      regularSeasonMedian: quantile([...subPerGameRs].sort((a, b) => a - b), 0.5),
      postseasonMedian: quantile([...subPerGamePost].sort((a, b) => a - b), 0.5),
      gamesWithZeroSubstitutions: zeroSubGames,
      meanSubsPerTeamGame: round(
        teamSubPerGame.length ? teamSubPerGame.reduce((a, b) => a + b, 0) / teamSubPerGame.length : 0,
        2
      ),
    },
    periodClockIntegrity: {
      nullPeriods: clock.nullPeriods,
      nullClocks: clock.nullClocks,
      malformedClocks: clock.malformedClocks,
      periodValues: [...clock.periodValues].sort((a, b) => a - b),
      otGameCount: clock.otGames.length,
      otGames: clock.otGames,
      maxPeriod: clock.maxPeriod,
      endPeriodEvents: clock.endPeriod,
    },
    wallclockResult: wall,
    shotCoordinateResult: {
      ...shot,
      sentinelPct: shot.shooting ? round((100 * shot.sentinel) / shot.shooting, 1) : null,
      plausiblePct: shot.shooting ? round((100 * shot.plausible) / shot.shooting, 1) : null,
      note: 'abs(coord) >= 1e6 treated as sentinel. Court geometry is not interpreted.',
    },
    possessionFeasibility,
    wowyFeasibility: {
      dataReadiness: reliability.classification,
      methodologyReadiness: 'not started',
      note: 'Even with excellent rotation reconstruction, WOWY is not ready until possession reconstruction is implemented and validated. Not claimed solved.',
    },
    s3Certification: {
      target: PLAYS_2025_EXPECTED_TARGET,
      canonicalGameObjects: objectCount,
      missingCanonical,
      invalidCanonical,
      totalEvents: grain.totalEvents,
      certifiedEventsSum: certifiedEvents,
      eventsMatchSum: grain.totalEvents === certifiedEvents,
      failedGames,
      zeroResult,
      characterizationPrefixPreserved: PLAYS_CHAR_PREFIX,
      characterizationObjects: charCount,
      bytes: objectBytes,
      mb: round(objectBytes / (1024 * 1024), 2),
      averageKbPerGame: objectCount ? round(objectBytes / objectCount / 1024, 1) : null,
      step9dEstimateMb: 315,
      varianceNote: 'Byte total is canonical game objects only (excludes _manifest/_run and characterization prefix).',
    },
    productInterpretation: {
      historicalGameTimeline: scoreMatchN > 0,
      scoringRuns: scoreMatchN > 0,
      leadChanges: scoreMatchN > 0,
      quarterByQuarterEventFlow: clock.endPeriod > 0,
      clutchTimeline: true,
      starterPlusSubstitutionReconstruction: reliability.classification,
      fiveManUnitTimeline: reliability.classification === 'EXCELLENT' || reliability.classification === 'GOOD',
      possessionAttribution: false,
      wowy: false,
    },
    trialTimeRemaining: {
      elapsedHours: round(elapsedAfter, 3),
      remainingHours: round(remainingAfter, 3),
      protectedReserveHours: 6,
      usableRemainingHours: round(remainingAfter - 6, 3),
    },
    postgresUnchangedConfirmation: {
      expectedBytes: EXPECTED_DB_BYTES,
      dbBytesAfter: isolationAfter.dbBytes,
      unchanged: isolationAfter.dbBytes === EXPECTED_DB_BYTES,
      unexpectedServing: isolationAfter.unexpectedServing,
    },
    manifestLimitations,
    archiveVerdict,
    stepVerdict,
    availabilityLimitation: PLAYS_2025_AVAILABILITY_LIMITATION,
  };

  await archiveJsonObjectToS3({
    s3,
    key: `${canonicalPrefix}/_manifest.json`,
    overwrite: true,
    body: {
      schemaVersion: 1,
      source: 'balldontlie',
      league: 'nba',
      season: 2025,
      entity: 'plays',
      endpoint: PLAYS_PATH_PRIMARY,
      targetGames: PLAYS_2025_EXPECTED_TARGET,
      canonicalGameObjects: objectCount,
      totalEvents: grain.totalEvents,
      rotationReliability: reliability,
      characterizationPrefix: PLAYS_CHAR_PREFIX,
      characterizationNotImportedAsSeasonMetadata: true,
      limitations: manifestLimitations,
      availabilityLimitation: PLAYS_2025_AVAILABILITY_LIMITATION,
      postgresMaterialize: false,
      started2022: false,
      generatedAt: finishedAt,
    },
  });
  await archiveJsonObjectToS3({
    s3,
    key: `${canonicalPrefix}/_run.json`,
    overwrite: true,
    body: {
      schemaVersion: 1,
      entity: 'plays',
      season: 2025,
      status: failedGames.length || missingCanonical.length ? 'complete_with_gaps' : 'complete',
      startedAt: generatedAt,
      finishedAt,
      postgresMaterialize: false,
      started2022: false,
      acquisition: report.acquisitionResult,
      stepVerdict,
    },
  });

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(REPORT_MD, renderMd(report));
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_JSON,
        stepVerdict,
        archiveVerdict,
        rotation: `${reconstructedOk}/${eligible} ${reliability.classification}`,
        scoreMatch: `${scoreMatchN}/${scoreRows.length}`,
        events: grain.totalEvents,
        httpAttempts: metrics.httpAttempts,
        postgresUnchanged: isolationAfter.dbBytes === EXPECTED_DB_BYTES,
        started2022: false,
        stoppedReason,
      },
      null,
      2
    )
  );
  await pool.end().catch(() => undefined);
}

main().catch(async (err) => {
  console.error('[fatal]', err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
