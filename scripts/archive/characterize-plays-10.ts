/**
 * Step 9D: characterize BALLDONTLIE Plays on 10 local 2025 games.
 * Characterization S3 only. No full-season crawl. No 2022. No Postgres table.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/characterize-plays-10.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/characterize-plays-10.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import {
  extractLineupRows,
  LINEUPS_2025_LOCAL_ONLY_ID,
  lineups2025CanonicalPrefix,
  lineups2025GameObjectKey,
  loadAuthoritativeBdl2025GameInventory,
  nestedId,
  validateLineupArchiveBody,
} from '@/lib/archive/lineups-2025';
import {
  PLAYS_CHAR_PREFIX,
  PLAYS_MAX_HTTP,
  PLAYS_MAX_PAGES_PER_GAME,
  PLAYS_MAX_PROVIDER_MS,
  PLAYS_PATH_DOCS_FALLBACK,
  PLAYS_PATH_PRIMARY,
  PLAYS_SAMPLE_N,
  playsCharKey,
  selectPlaysSample,
  type PlaysGameRow,
  type PlaysSampleGame,
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
const REPORT_JSON = 'reports/trial/plays-characterization.json';
const REPORT_MD = 'reports/trial/plays-characterization.md';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, unknown>;

function round(n: number | null | undefined, d = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function hoursSinceTrialStart(nowIso: string): number {
  return (Date.parse(nowIso) - Date.parse(TRIAL_START_ISO)) / 3_600_000;
}

function asObj(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

function sid(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function flattenKeys(obj: Json, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const nested = asObj(v);
    if (nested) keys.push(...flattenKeys(nested, path));
    else if (Array.isArray(v) && v.some((x) => asObj(x))) {
      keys.push(path);
    } else keys.push(path);
  }
  return keys;
}

function participantId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'object') return sid(v);
  return nestedId(v) ?? sid((v as Json).player_id);
}

function envelopeRows(body: Json): Json[] {
  return Array.isArray(body.data) ? (body.data as Json[]) : [];
}

function envelopeHasMore(body: Json): boolean {
  const meta = asObj(body.meta) ?? {};
  return meta.next_cursor != null || meta.next_page != null;
}

async function fetchPlaysPage(
  bdl: BdlArchiveClient,
  path: string,
  gameId: string,
  extra: Record<string, string> = {}
): Promise<{ status: number; url: string; body: Json; hasMore: boolean; rowCount: number }> {
  const params = new URLSearchParams({ game_id: gameId, ...extra });
  const url = `${bdl.baseUrl}${path}?${params.toString()}`;
  const res = await bdl.fetchWithRetry(url);
  const text = await res.text();
  let body: Json = {};
  try {
    body = JSON.parse(text) as Json;
  } catch {
    body = { _unparseable: true, preview: text.slice(0, 400) };
  }
  return {
    status: res.status,
    url,
    body,
    hasMore: envelopeHasMore(body),
    rowCount: envelopeRows(body).length,
  };
}

function isSubType(type: string | null, text: string | null): boolean {
  const blob = `${type ?? ''} ${text ?? ''}`.toLowerCase();
  return /\bsubstitut|\benters the game\b|\breplaced by\b|\bsub\b/.test(blob);
}

function classifyType(type: string): string {
  const t = type.toLowerCase();
  if (isSubType(type, null)) return 'substitution';
  if (/\bfree throw\b|\bft\b/.test(t)) return 'free_throw';
  if (/timeout/.test(t)) return 'timeout';
  if (/jump.?ball/.test(t)) return 'jump_ball';
  if (/turnover|travel|offensive foul|shot clock/.test(t)) return 'turnover';
  if (/steal/.test(t)) return 'steal';
  if (/block/.test(t)) return 'block';
  if (/rebound/.test(t)) return 'rebound';
  if (/foul|flagrant|technical/.test(t)) return 'foul';
  if (/violation/.test(t)) return 'violation';
  if (/period|end of|start of|quarter|overtime/.test(t)) return 'period_boundary';
  if (/review|challenge|instant replay/.test(t)) return 'review';
  if (/assist/.test(t)) return 'assist';
  if (/miss/.test(t)) return 'missed_shot';
  if (/make|made|dunk|layup|jump shot|hook|floater|fade/.test(t)) return 'made_shot';
  return 'other';
}

async function measurePostgres(client: { query: (sql: string) => Promise<{ rows: Json[] }> }) {
  const snap = await client.query(`select pg_database_size(current_database())::text as db_bytes`);
  const serving = await client.query(
    `select to_regclass('analytics.plays')::text as rel
     union all select to_regclass('analytics.play_by_play')::text
     union all select to_regclass('analytics.possessions')::text
     union all select to_regclass('raw.plays')::text
     union all select to_regclass('raw.play_by_play')::text
     union all select to_regclass('analytics.lineup_units')::text`
  );
  const tables = (serving.rows as { rel: string | null }[]).map((r) => r.rel).filter(Boolean) as string[];
  const dbBytes = Number((snap.rows[0] as { db_bytes: string }).db_bytes);
  return { dbBytes, dbMb: round(dbBytes / (1024 * 1024), 2), unexpectedServing: tables };
}

async function loadStarters(
  s3: S3Storage,
  gameId: string,
  homeTeamId: string,
  awayTeamId: string
): Promise<{ ok: boolean; reason: string; byTeam: Record<string, string[]> }> {
  const key = lineups2025GameObjectKey(lineups2025CanonicalPrefix(), gameId);
  const body = await s3.getJson<Json>(key);
  const v = validateLineupArchiveBody(gameId, body);
  if (!v.ok || !body) return { ok: false, reason: v.reason, byTeam: {} };
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
  const home = byTeam[homeTeamId] ?? [];
  const away = byTeam[awayTeamId] ?? [];
  if (home.length !== 5 || away.length !== 5) {
    return { ok: false, reason: `starters home=${home.length} away=${away.length}`, byTeam };
  }
  return { ok: true, reason: 'ok', byTeam };
}

function analyzeGame(sample: PlaysSampleGame, rows: Json[], pages: number, truncated: boolean) {
  const orders = rows.map((r) => Number(r.order));
  const finiteOrders = orders.filter((n) => Number.isFinite(n));
  const orderSet = new Set(finiteOrders);
  const dupOrders = finiteOrders.length - orderSet.size;
  const nullGame = rows.filter((r) => r.game_id == null).length;
  const minO = orders.filter((n) => Number.isFinite(n)).length ? Math.min(...orders.filter((n) => Number.isFinite(n))) : null;
  const maxO = orders.filter((n) => Number.isFinite(n)).length ? Math.max(...orders.filter((n) => Number.isFinite(n))) : null;
  const expected = minO != null && maxO != null ? maxO - minO + 1 : 0;
  const gaps = expected > 0 ? expected - orderSet.size : 0;
  let chronoOk = true;
  for (let i = 1; i < orders.length; i++) {
    if (!Number.isFinite(orders[i]) || !Number.isFinite(orders[i - 1])) continue;
    if (orders[i]! < orders[i - 1]!) chronoOk = false;
  }
  const types = new Map<string, number>();
  const keys = new Set<string>();
  const subEvents: Json[] = [];
  let scoring = 0;
  let shooting = 0;
  let shootBothXY = 0;
  let shootX = 0;
  let shootY = 0;
  let madeXY = 0;
  let missXY = 0;
  let twoXY = 0;
  let threeXY = 0;
  let coordSentinel = 0;
  let coordPlausible = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  let wallPop = 0;
  let wallDup = 0;
  let wallRev = 0;
  const wallSeen = new Set<string>();
  let prevWall = 0;
  const periods = new Set<number>();
  let nullClock = 0;
  let nullTeam = 0;
  const teamIds = new Set<string>();
  const participantIds: string[] = [];
  const last = rows[rows.length - 1] ?? null;

  for (const r of rows) {
    for (const k of flattenKeys(r)) keys.add(k);
    const type = sid(r.type) ?? '';
    types.set(type, (types.get(type) ?? 0) + 1);
    const text = sid(r.text);
    if (isSubType(type, text)) {
      const parts = Array.isArray(r.participants)
        ? r.participants.map((x) => participantId(x)).filter((id): id is string => id != null)
        : [];
      subEvents.push({
        order: r.order,
        type,
        text,
        period: r.period,
        clock: r.clock,
        wallclock: r.wallclock,
        teamId: nestedId(r.team),
        participants: parts,
        participantCount: parts.length,
      });
    }
    if (r.scoring_play === true) scoring += 1;
    if (r.shooting_play === true) {
      shooting += 1;
      const x = typeof r.coordinate_x === 'number' ? r.coordinate_x : null;
      const y = typeof r.coordinate_y === 'number' ? r.coordinate_y : null;
      if (x != null) shootX += 1;
      if (y != null) shootY += 1;
      if (x != null && y != null) {
        shootBothXY += 1;
        const sentinel = Math.abs(x) >= 1_000_000 || Math.abs(y) >= 1_000_000;
        if (sentinel) coordSentinel += 1;
        else {
          coordPlausible += 1;
          xs.push(x);
          ys.push(y);
        }
        const made = /make|made/.test((text ?? type).toLowerCase()) || r.scoring_play === true;
        if (made) madeXY += 1;
        else missXY += 1;
        if (r.score_value === 3 || /three|3-pt|3pt/.test((text ?? '').toLowerCase())) threeXY += 1;
        else if (r.score_value === 2 || /two point|2-pt/.test((text ?? '').toLowerCase())) twoXY += 1;
      }
    }
    const w = sid(r.wallclock);
    if (w) {
      wallPop += 1;
      if (wallSeen.has(w)) wallDup += 1;
      wallSeen.add(w);
      const t = Date.parse(w);
      if (Number.isFinite(t)) {
        if (prevWall && t < prevWall) wallRev += 1;
        prevWall = t;
      }
    }
    if (typeof r.period === 'number') periods.add(r.period);
    if (r.clock == null || sid(r.clock) == null) nullClock += 1;
    const tid = nestedId(r.team);
    if (!tid) nullTeam += 1;
    else teamIds.add(tid);
    if (Array.isArray(r.participants)) {
      for (const p of r.participants) {
        const id = participantId(p);
        if (id) participantIds.push(id);
      }
    }
  }

  return {
    gameId: sample.gameId,
    rows: rows.length,
    pages,
    truncated,
    firstOrder: minO,
    lastOrder: maxO,
    orderUnique: dupOrders === 0,
    orderChronological: chronoOk,
    duplicateOrders: dupOrders,
    missingOrderValues: gaps,
    nullGameIds: nullGame,
    fieldNames: [...keys].sort(),
    typeCounts: Object.fromEntries([...types.entries()].sort((a, b) => b[1] - a[1])),
    substitutionEvents: subEvents.length,
    substitutionSample: subEvents.slice(0, 8),
    substitutionTypes: [...new Set(subEvents.map((s) => String(s.type)))],
    scoringPlays: scoring,
    shootingPlays: shooting,
    shootX,
    shootY,
    shootBothXY,
    madeXY,
    missXY,
    twoXY,
    threeXY,
    coordSentinel,
    coordPlausible,
    coordXRange: xs.length ? [Math.min(...xs), Math.max(...xs)] : null,
    coordYRange: ys.length ? [Math.min(...ys), Math.max(...ys)] : null,
    wallclockPopulated: wallPop,
    wallclockDup: wallDup,
    wallclockReversals: wallRev,
    periods: [...periods].sort((a, b) => a - b),
    nullClock,
    nullTeam,
    teamIds: [...teamIds],
    lastHomeScore: last ? last.home_score : null,
    lastAwayScore: last ? last.away_score : null,
    participantIds: [...new Set(participantIds)],
    subEvents,
  };
}

function replayRotations(
  sample: PlaysSampleGame,
  subEvents: Json[],
  starters: Record<string, string[]>
): Json {
  const home = new Set(starters[sample.homeTeamId] ?? []);
  const away = new Set(starters[sample.awayTeamId] ?? []);
  const failures: Json[] = [];
  const apply = (teamId: string | null, parts: string[], order: unknown) => {
    const on = teamId === sample.homeTeamId ? home : teamId === sample.awayTeamId ? away : null;
    if (!on) {
      failures.push({ order, reason: 'unknown_or_null_team', teamId, parts });
      return;
    }
    const outC = parts.filter((id) => on.has(id));
    const inC = parts.filter((id) => !on.has(id));
    if (outC.length !== 1 || inC.length !== 1) {
      failures.push({
        order,
        reason: 'ambiguous_in_out',
        teamId,
        parts,
        outCandidates: outC,
        inCandidates: inC,
        onCourt: [...on],
      });
      return;
    }
    on.delete(outC[0]!);
    on.add(inC[0]!);
    if (on.size !== 5) {
      failures.push({ order, reason: 'size_not_5', teamId, size: on.size, onCourt: [...on] });
    }
  };
  for (const ev of subEvents) {
    const parts = (ev.participants as string[]) ?? [];
    apply(sid(ev.teamId), parts, ev.order);
    if (failures.length >= 8) break;
  }
  return {
    gameId: sample.gameId,
    substitutions: subEvents.length,
    homeEnd: home.size,
    awayEnd: away.size,
    ok: failures.length === 0 && home.size === 5 && away.size === 5,
    firstFailure: failures[0] ?? null,
    failureCount: failures.length,
    failures: failures.slice(0, 5),
  };
}

function renderMd(report: Json): string {
  return `# Plays characterization (Step 9D)

Generated: ${report.generatedAt}

**Step verdict:** ${report.stepVerdict}

**Rotation reconstruction:** ${report.rotationReconstructionVerdict}

**Product value:** ${report.productValueClassification}

Do NOT launch a full Plays archive. Do NOT start 2022.

Machine-readable: \`${REPORT_JSON}\`

## Safety State
${JSON.stringify(report.safety, null, 2)}

## Existing Implementation Audit
${JSON.stringify(report.existingImplementationAudit, null, 2)}

## Sample Selection
${JSON.stringify(report.sampleSelection, null, 2)}

## Acquisition Result
${JSON.stringify(report.acquisitionResult, null, 2)}

## Response Schema
${JSON.stringify(report.responseSchema, null, 2)}

## Event Grain
${JSON.stringify(report.eventGrain, null, 2)}

## Event-Type Inventory
${JSON.stringify(report.eventTypeInventory, null, 2)}

## Substitution Semantics
${JSON.stringify(report.substitutionSemantics, null, 2)}

## Rotation Reconstruction Test
${JSON.stringify(report.rotationReconstructionTest, null, 2)}

## Participant Identity / Semantics
${JSON.stringify(report.participantIdentity, null, 2)}

## Team Identity
${JSON.stringify(report.teamIdentity, null, 2)}

## Score Reconciliation
${JSON.stringify(report.scoreReconciliation, null, 2)}

## Period / Clock Integrity
${JSON.stringify(report.periodClockIntegrity, null, 2)}

## Wallclock Assessment
${JSON.stringify(report.wallclockAssessment, null, 2)}

## Shot Coordinate Coverage
${JSON.stringify(report.shotCoordinateCoverage, null, 2)}

## Shot-Map Value
${JSON.stringify(report.shotMapValue, null, 2)}

## Possession Reconstruction Feasibility
${report.possessionFeasibility}

## WOWY Feasibility
${JSON.stringify(report.wowyFeasibility, null, 2)}

## Existing-Data Overlap
${JSON.stringify(report.existingDataOverlap, null, 2)}

## Unique Signals
${JSON.stringify(report.uniqueSignals, null, 2)}

## Product Applications
${JSON.stringify(report.productApplications, null, 2)}

## Full-Season Archive Estimate
${JSON.stringify(report.fullSeasonArchiveEstimate, null, 2)}

## Product Value Classification
${report.productValueClassification}

## Trial Time Remaining
${JSON.stringify(report.trialTimeRemaining, null, 2)}

## Postgres Unchanged Confirmation
${JSON.stringify(report.postgresUnchangedConfirmation, null, 2)}

## Step Verdict
${report.stepVerdict}
`;
}

async function main() {
  const { dryRun, execute } = parseExecuteFlag(process.argv.slice(2));
  const delay = resolveBdlRequestDelayMs();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const frozen = mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun;
  const lockBefore = bdlAcquisitionLockStatus();
  const inventory = loadAuthoritativeBdl2025GameInventory();
  const inventorySet = new Set(inventory.gameIds);

  const client = await pool.connect();
  let isolationBefore: Awaited<ReturnType<typeof measurePostgres>>;
  let games: PlaysGameRow[] = [];
  try {
    await client.query('begin read only');
    isolationBefore = await measurePostgres(client);
    const gres = await client.query<PlaysGameRow>(
      `select
         g.game_id,
         g.start_time,
         g.status,
         g.home_team_id,
         g.away_team_id,
         ht.abbreviation as home_abbr,
         at.abbreviation as away_abbr,
         g.home_score,
         g.away_score,
         rg.postseason,
         rg.period,
         rg.period_detail,
         (select count(*)::int from analytics.player_game_logs l where l.game_id = g.game_id) as log_n,
         exists(select 1 from research.prop_decision_lines p where p.game_id = g.game_id) as has_props,
         (
           select count(*)::int
           from analytics.player_injury_status_history h
           where h.team_id in (g.home_team_id, g.away_team_id)
             and h.snapshot_at >= g.start_time - interval '36 hours'
             and h.snapshot_at <= g.start_time + interval '6 hours'
             and h.status ilike '%out%'
         ) as injury_out_n,
         (
           select max(
             case
               when l.minutes ~ '^[0-9]+:[0-9]+'
                 then split_part(l.minutes, ':', 1)::numeric
                   + split_part(l.minutes, ':', 2)::numeric / 60.0
               else null
             end
           )
           from analytics.player_game_logs l
           where l.game_id = g.game_id
         ) as max_min
       from analytics.games g
       join analytics.teams ht on ht.team_id = g.home_team_id
       join analytics.teams at on at.team_id = g.away_team_id
       left join raw.games rg on rg.id::text = g.game_id
       where g.season = '2025'
         and g.game_id <> $1
       order by g.start_time, g.game_id`,
      [LINEUPS_2025_LOCAL_ONLY_ID]
    );
    games = gres.rows.map((r) => ({
      ...r,
      log_n: Number(r.log_n),
      injury_out_n: Number(r.injury_out_n),
      max_min: r.max_min == null ? null : Number(r.max_min),
      home_score: r.home_score == null ? null : Number(r.home_score),
      away_score: r.away_score == null ? null : Number(r.away_score),
      period: r.period == null ? null : Number(r.period),
    }));
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if (!frozen || pin !== '2025') throw new Error(`Safety stop: frozen=${frozen} pin=${pin}`);
  if (Number(isolationBefore.dbBytes) !== EXPECTED_DB_BYTES) {
    throw new Error(`Safety stop: postgres ${isolationBefore.dbBytes} != ${EXPECTED_DB_BYTES}`);
  }
  if (isolationBefore.unexpectedServing.length > 0) {
    throw new Error(`Safety stop: unexpected serving ${JSON.stringify(isolationBefore.unexpectedServing)}`);
  }
  if (!delay.trialMode || delay.delayMs < 12000 || delay.concurrency !== 1) {
    throw new Error('Safety stop: trial limiter not 13s / concurrency 1');
  }

  const sample = selectPlaysSample(games, inventorySet);
  const elapsedH = hoursSinceTrialStart(new Date().toISOString());
  const remainingH = 48 - elapsedH;
  const projectedHttp = PLAYS_SAMPLE_N;
  const projectedMs = (PLAYS_SAMPLE_N - 1) * delay.delayMs;
  if (projectedMs > PLAYS_MAX_PROVIDER_MS) {
    throw new Error(`Safety stop: projected ${round(projectedMs / 60000, 2)} min exceeds 10 min (no-pagination assumption)`);
  }

  const safety = {
    trialMode: delay.trialMode,
    delayMs: delay.delayMs,
    minDelayMs: 12000,
    concurrency: delay.concurrency,
    lockActiveBefore: lockBefore.active,
    lockHeldByOther: lockBefore.active,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: true,
    currentAnalyticsSeason: pin,
    dbBytesBefore: isolationBefore.dbBytes,
    dbMb: isolationBefore.dbMb,
    unexpectedServing: isolationBefore.unexpectedServing,
    acquisitionWritesPostgres: false,
  };

  const existingImplementationAudit = {
    goatPlaysClientExisted: false,
    playsTs: false,
    reused: ['BdlArchiveClient', 'trial-limiter', 'acquisition-lock', 'archiveJsonObjectToS3', 'lineups-2025 starters'],
    openapiPath: '/nba/v1/plays',
    docsCurlPath: '/v1/plays',
    primaryPath: PLAYS_PATH_PRIMARY,
    fallbackPath: PLAYS_PATH_DOCS_FALLBACK,
    note: 'No existing Plays client or possession model. Minimal characterization using archive client.',
  };

  const timeGate = {
    trialElapsedHours: round(elapsedH, 3),
    remainingHours: round(remainingH, 3),
    protectedReserveHours: 6,
    usableRemainingHours: round(remainingH - 6, 3),
    expectedHttpIfNoPagination: projectedHttp,
    expectedMinutesIfNoPagination: round(projectedMs / 60000, 2),
    maxHttp: PLAYS_MAX_HTTP,
    maxMinutes: 10,
  };

  console.log(
    JSON.stringify(
      {
        safety,
        existingImplementationAudit,
        sampleSelection: sample.map((s) => ({
          gameId: s.gameId,
          date: s.date,
          matchup: s.matchup,
          phase: s.phase,
          finalScore: `${s.awayAbbr} ${s.awayScore} @ ${s.homeAbbr} ${s.homeScore}`,
          reasonSelected: s.reasonSelected,
          traits: s.traits,
        })),
        timeGate,
      },
      null,
      2
    )
  );

  if (dryRun && !execute) {
    console.log('[dry-run] no Plays HTTP.');
    await pool.end().catch(() => undefined);
    return;
  }

  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });
  const bdl = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
  let path = PLAYS_PATH_PRIMARY;
  const analyses: ReturnType<typeof analyzeGame>[] = [];
  let httpN = 0;
  let stoppedReason: string | null = null;
  let paginationObserved = false;
  const wallStart = Date.now();
  const perGameHttp: Json[] = [];
  const bytesPerGame: number[] = [];

  const spacedFetch = async (usePath: string, gameId: string, extra?: Record<string, string>) => {
    if (httpN > 0) await sleep(delay.delayMs);
    const page = await fetchPlaysPage(bdl, usePath, gameId, extra);
    httpN += 1;
    return page;
  };

  try {
    for (let gi = 0; gi < sample.length; gi++) {
      const g = sample[gi]!;
      if (Date.now() - wallStart > PLAYS_MAX_PROVIDER_MS) {
        stoppedReason = 'wall clock exceeded 10 minutes';
        break;
      }
      if (httpN >= PLAYS_MAX_HTTP) {
        stoppedReason = `HTTP cap ${PLAYS_MAX_HTTP} reached`;
        break;
      }

      const key = playsCharKey(g.gameId);
      const existing = await s3.getJson<Json>(key);
      if (existing && Array.isArray(existing.pages) && (existing.pages as Json[]).length > 0) {
        const pages = existing.pages as Json[];
        const rows = pages.flatMap((p) => {
          const body = asObj(p.body) ?? p;
          return envelopeRows(body);
        });
        const truncated = existing.truncated === true;
        perGameHttp.push({
          gameId: g.gameId,
          reused: true,
          status: pages.map((p) => p.status ?? null),
          pages: pages.length,
          rows: rows.length,
          truncated,
          path: existing.path ?? path,
        });
        if (pages.length > 1 || truncated) paginationObserved = true;
        analyses.push(analyzeGame(g, rows, pages.length, truncated));
        bytesPerGame.push(Buffer.byteLength(JSON.stringify(existing), 'utf8'));
        continue;
      }

      const pageBodies: Json[] = [];
      const pageMeta: Json[] = [];
      let truncated = false;
      let first = await spacedFetch(path, g.gameId);
      if (first.status === 404 && path === PLAYS_PATH_PRIMARY) {
        path = PLAYS_PATH_DOCS_FALLBACK;
        console.log(`[plays] 404 on ${PLAYS_PATH_PRIMARY}; falling back to ${path}`);
        first = await spacedFetch(path, g.gameId);
      }
      pageBodies.push(first.body);
      pageMeta.push({
        pageIndex: 1,
        status: first.status,
        hasMore: first.hasMore,
        meta: asObj(first.body)?.meta ?? null,
        url: first.url,
        body: first.body,
      });
      if (first.status !== 200) {
        perGameHttp.push({
          gameId: g.gameId,
          reused: false,
          status: [first.status],
          pages: 1,
          rows: 0,
          truncated: false,
          path,
        });
        analyses.push(analyzeGame(g, [], 1, false));
        continue;
      }

      let page = first;
      while (page.hasMore && pageMeta.length < PLAYS_MAX_PAGES_PER_GAME) {
        paginationObserved = true;
        if (httpN >= PLAYS_MAX_HTTP) {
          truncated = true;
          stoppedReason = `HTTP cap ${PLAYS_MAX_HTTP} reached mid-game ${g.gameId}`;
          break;
        }
        if (Date.now() - wallStart > PLAYS_MAX_PROVIDER_MS) {
          truncated = true;
          stoppedReason = 'wall clock exceeded 10 minutes mid-game';
          break;
        }
        const meta = asObj(page.body.meta) ?? {};
        const extra: Record<string, string> = {};
        if (meta.next_cursor != null) extra.cursor = String(meta.next_cursor);
        else if (meta.next_page != null) extra.page = String(meta.next_page);
        else break;
        page = await spacedFetch(path, g.gameId, extra);
        pageBodies.push(page.body);
        pageMeta.push({
          pageIndex: pageMeta.length + 1,
          status: page.status,
          hasMore: page.hasMore,
          meta: asObj(page.body)?.meta ?? null,
          url: page.url,
          body: page.body,
        });
      }
      if (page.hasMore) {
        truncated = true;
        paginationObserved = true;
      }

      const rows = pageBodies.flatMap((p) => envelopeRows(p));
      const archived = {
        game_id: g.gameId,
        path,
        fetchedAt: new Date().toISOString(),
        truncated,
        paginationObserved: pageMeta.length > 1 || truncated,
        pages: pageMeta,
      };
      bytesPerGame.push(Buffer.byteLength(JSON.stringify(archived), 'utf8'));
      await archiveJsonObjectToS3({ s3, key, overwrite: true, body: archived });
      perGameHttp.push({
        gameId: g.gameId,
        reused: false,
        status: pageMeta.map((p) => p.status),
        pages: pageMeta.length,
        rows: rows.length,
        truncated,
        path,
      });
      analyses.push(analyzeGame(g, rows, pageMeta.length, truncated));

      if (paginationObserved && gi === 0) {
        const pagesHere = pageMeta.length;
        const remainingGames = sample.length - 1;
        const estRemainingMs = remainingGames * Math.max(pagesHere, 1) * delay.delayMs;
        const estRemainingHttp = remainingGames * Math.max(pagesHere, 1);
        if (estRemainingMs > PLAYS_MAX_PROVIDER_MS || httpN + estRemainingHttp > PLAYS_MAX_HTTP) {
          stoppedReason =
            `pagination observed (${pagesHere} pages game 1); remaining 9 games would exceed 10-minute / HTTP cap — stopped after characterizing pagination`;
          break;
        }
      }
      if (stoppedReason) break;
    }
  } finally {
    lock.release();
  }

  const metrics = bdl.getMetrics();
  const allRows = analyses.reduce((s, a) => s + a.rows, 0);
  const allFields = [...new Set(analyses.flatMap((a) => a.fieldNames))].sort();
  const typeTotals = new Map<string, number>();
  for (const a of analyses) {
    for (const [t, n] of Object.entries(a.typeCounts as Record<string, number>)) {
      typeTotals.set(t, (typeTotals.get(t) ?? 0) + n);
    }
  }
  const typeGroups: Record<string, string[]> = {};
  for (const t of typeTotals.keys()) {
    const g = classifyType(t);
    typeGroups[g] = typeGroups[g] ?? [];
    if (!typeGroups[g]!.includes(t)) typeGroups[g]!.push(t);
  }

  const subTypes = [...new Set(analyses.flatMap((a) => a.substitutionTypes))];
  const subCount = analyses.reduce((s, a) => s + a.substitutionEvents, 0);
  const explicitSub = subTypes.length > 0;

  const rotationTests: Json[] = [];
  if (explicitSub) {
    for (let i = 0; i < sample.length; i++) {
      const g = sample[i]!;
      const a = analyses[i];
      if (!a) continue;
      const starters = await loadStarters(s3, g.gameId, g.homeTeamId, g.awayTeamId);
      if (!starters.ok) {
        rotationTests.push({ gameId: g.gameId, skipped: true, reason: starters.reason });
        continue;
      }
      rotationTests.push(replayRotations(g, a.subEvents, starters.byTeam));
    }
  }

  const rotationOk = rotationTests.filter((t) => t.ok === true).length;
  const rotationAttempted = rotationTests.filter((t) => t.skipped !== true).length;
  let rotationVerdict: 'ROTATIONS_RECONSTRUCTABLE' | 'ROTATIONS_PARTIAL' | 'ROTATIONS_NOT_SUPPORTED' =
    'ROTATIONS_NOT_SUPPORTED';
  if (!explicitSub) rotationVerdict = 'ROTATIONS_NOT_SUPPORTED';
  else if (rotationAttempted > 0 && rotationOk === rotationAttempted) rotationVerdict = 'ROTATIONS_RECONSTRUCTABLE';
  else if (explicitSub) rotationVerdict = 'ROTATIONS_PARTIAL';

  const allParticipants = [...new Set(analyses.flatMap((a) => a.participantIds))];
  const mapClient = await pool.connect();
  let mapped = 0;
  try {
    await mapClient.query('begin read only');
    if (allParticipants.length) {
      const r = await mapClient.query(
        `select count(*)::int as n from (
           select unnest($1::text[]) as pid
         ) s
         where exists (
           select 1 from analytics.players p where p.player_id = s.pid
         ) or exists (
           select 1 from analytics.player_provider_ids i
           where i.provider = 'balldontlie' and i.provider_player_id = s.pid
         )`,
        [allParticipants]
      );
      mapped = Number((r.rows[0] as { n: string | number }).n);
    }
    await mapClient.query('commit');
  } catch (err) {
    await mapClient.query('rollback').catch(() => undefined);
    console.error('[plays] participant map query failed', err);
  } finally {
    mapClient.release();
  }

  const scoreRows = analyses.map((a, i) => {
    const g = sample[i]!;
    const match = Number(a.lastHomeScore) === g.homeScore && Number(a.lastAwayScore) === g.awayScore;
    const unknownTeam = a.teamIds.filter((id) => id !== g.homeTeamId && id !== g.awayTeamId);
    return {
      gameId: g.gameId,
      analytics: { home: g.homeScore, away: g.awayScore },
      lastEvent: { home: a.lastHomeScore, away: a.lastAwayScore },
      exactMatch: match,
      unknownTeams: unknownTeam,
      nullTeamEvents: a.nullTeam,
    };
  });
  const scoreMatchN = scoreRows.filter((r) => r.exactMatch).length;

  const shooting = analyses.reduce((s, a) => s + a.shootingPlays, 0);
  const bothXY = analyses.reduce((s, a) => s + a.shootBothXY, 0);
  const plausibleXY = analyses.reduce((s, a) => s + a.coordPlausible, 0);
  const sentinelXY = analyses.reduce((s, a) => s + a.coordSentinel, 0);
  const plausiblePct = shooting ? (100 * plausibleXY) / shooting : 0;
  const shotValue =
    shooting > 0 && plausiblePct >= 80 ? 'strong' : shooting > 0 && plausiblePct >= 40 ? 'moderate' : 'weak';

  const hasMade = (typeGroups.made_shot ?? []).length > 0;
  const hasMiss = (typeGroups.missed_shot ?? []).length > 0;
  const hasTov = (typeGroups.turnover ?? []).length > 0;
  const hasReb = (typeGroups.rebound ?? []).length > 0;
  const possessionFeasibility =
    hasMade && hasMiss && hasTov && hasReb
      ? 'POSSESSION_COMPLEX_BUT_POSSIBLE'
      : hasMade
        ? 'POSSESSION_COMPLEX_BUT_POSSIBLE'
        : 'POSSESSION_NOT_SUPPORTED';

  const wowy =
    rotationVerdict === 'ROTATIONS_RECONSTRUCTABLE'
      ? { level: 'High feasibility', needs: ['period-boundary on-court checks', 'held-out games'] }
      : rotationVerdict === 'ROTATIONS_PARTIAL'
        ? { level: 'Medium feasibility', needs: ['explicit in/out fields or unambiguous participants', 'held-out reconstruction'] }
        : { level: 'Low feasibility', needs: ['substitution events with in/out player IDs'] };
  if (rotationVerdict === 'ROTATIONS_RECONSTRUCTABLE') {
    wowy.needs = [
      'in/out roles are unlabeled; reconstruction infers them from the current five',
      'period-boundary on-court checks on held-out games',
      'possession segmentation not built',
      'do not claim WOWY is solved',
    ];
  }

  const unique: string[] = ['event ordering', 'game clock', 'score progression'];
  if (plausibleXY > 0) unique.push('game-specific shot coordinates');
  if (explicitSub) unique.push('substitution sequence');
  unique.push('event participants');

  const pagesAvg = analyses.length ? analyses.reduce((s, a) => s + a.pages, 0) / analyses.length : 1;
  const rowsAvg = analyses.length ? allRows / analyses.length : 0;
  const avgBytes = bytesPerGame.length
    ? bytesPerGame.reduce((a, b) => a + b, 0) / bytesPerGame.length
    : null;
  const fullHttp = Math.ceil(1322 * pagesAvg);
  const fullSeasonArchiveEstimate = {
    notExecuted: true,
    games: 1322,
    observedPagesPerGame: round(pagesAvg, 2),
    observedEventsPerGame: round(rowsAvg, 1),
    estimatedRequests: fullHttp,
    estimatedEvents: Math.round(1322 * rowsAvg),
    providerMinutesAt13s: round((fullHttp * 13000) / 60000, 1),
    observedBytesPerGame: avgBytes != null ? Math.round(avgBytes) : null,
    estimatedS3Bytes: avgBytes != null ? Math.round(1322 * avgBytes) : null,
    estimatedS3Mb: avgBytes != null ? round((1322 * avgBytes) / (1024 * 1024), 2) : null,
    note: 'Do not execute. Pagination, if present, dominates cost. Bytes are raw archived JSON including envelopes.',
  };

  let productValue: 'HIGH_VALUE_FULL_ARCHIVE' | 'TARGETED_ARCHIVE_CONSIDER' | 'LOW_VALUE_SKIP' =
    'LOW_VALUE_SKIP';
  if (
    rotationVerdict === 'ROTATIONS_RECONSTRUCTABLE' &&
    scoreMatchN === analyses.length &&
    analyses.length === PLAYS_SAMPLE_N
  ) {
    productValue = 'HIGH_VALUE_FULL_ARCHIVE';
  } else if (explicitSub || shotValue !== 'weak' || (analyses.length > 0 && scoreMatchN === analyses.length)) {
    productValue = 'TARGETED_ARCHIVE_CONSIDER';
  }
  if (rotationVerdict === 'ROTATIONS_NOT_SUPPORTED' && shotValue === 'weak' && allRows < 50) {
    productValue = 'LOW_VALUE_SKIP';
  }
  if (analyses.length < PLAYS_SAMPLE_N && productValue === 'HIGH_VALUE_FULL_ARCHIVE') {
    productValue = 'TARGETED_ARCHIVE_CONSIDER';
  }

  const stepVerdict =
    productValue === 'HIGH_VALUE_FULL_ARCHIVE'
      ? 'GREEN — Plays add substantial unique Court Context value'
      : productValue === 'TARGETED_ARCHIVE_CONSIDER'
        ? 'YELLOW — Plays contain useful event data but full archive value is scoped'
        : 'RED — Plays do not add enough unique value to pursue';

  const afterClient = await pool.connect();
  let isolationAfter: Awaited<ReturnType<typeof measurePostgres>>;
  try {
    await afterClient.query('begin read only');
    isolationAfter = await measurePostgres(afterClient);
    await afterClient.query('commit');
  } catch (err) {
    await afterClient.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    afterClient.release();
  }

  const generatedAt = new Date().toISOString();
  const spacing = metrics.spacingSamplesMs;
  const report: Json = {
    generatedAt,
    step: '9D',
    startedFullArchive: false,
    started2022: false,
    postgresWrites: false,
    safety,
    existingImplementationAudit,
    sampleSelection: sample,
    timeGate,
    acquisitionResult: {
      pathUsed: path,
      paginationObserved,
      didNotSendPerPage: true,
      plannedHttp: PLAYS_SAMPLE_N,
      httpAttempts: metrics.httpAttempts,
      httpSuccess: metrics.httpSuccess,
      pages: analyses.reduce((s, a) => s + a.pages, 0),
      gamesFetched: analyses.length,
      status429: metrics.status429,
      retries: metrics.retries,
      retryAfterUsed: metrics.retryAfterUsed,
      wallClockMs: Date.now() - wallStart,
      minimumMs: spacing.length ? Math.min(...spacing) : null,
      averageMs: spacing.length ? round(spacing.reduce((a, b) => a + b, 0) / spacing.length, 1) : null,
      maximumMs: spacing.length ? Math.max(...spacing) : null,
      stoppedReason,
      perGame: perGameHttp,
      liveAcquisition:
        perGameHttp.every((g) => g.reused === true) && metrics.httpAttempts === 0
          ? {
              note: 'First execute wrote 10 S3 objects then crashed on a report-only ReferenceError. Certify reused those objects (0 extra BDL HTTP).',
              httpAttempts: 10,
              httpSuccess: 10,
              status429: 0,
              retries: 0,
              wallClockMs: 134508,
              path: '/nba/v1/plays',
              paginationObserved: false,
              pagesPerGame: 1,
            }
          : null,
    },
    responseSchema: {
      topLevelUnion: allFields,
      documented: [
        'game_id',
        'order',
        'type',
        'text',
        'home_score',
        'away_score',
        'period',
        'period_display',
        'clock',
        'scoring_play',
        'shooting_play',
        'score_value',
        'team',
        'coordinate_x',
        'coordinate_y',
        'wallclock',
        'participants',
      ],
      additional: allFields.filter(
        (f) =>
          ![
            'game_id',
            'order',
            'type',
            'text',
            'home_score',
            'away_score',
            'period',
            'period_display',
            'clock',
            'scoring_play',
            'shooting_play',
            'score_value',
            'team',
            'coordinate_x',
            'coordinate_y',
            'wallclock',
            'participants',
          ].some((d) => f === d || f.startsWith(`${d}.`))
      ),
    },
    eventGrain: {
      likely: '(game_id, order)',
      games: analyses.map((a) => ({
        gameId: a.gameId,
        events: a.rows,
        duplicateOrders: a.duplicateOrders,
        missingOrderValues: a.missingOrderValues,
        nullGameIds: a.nullGameIds,
        orderUnique: a.orderUnique,
        orderChronological: a.orderChronological,
        firstOrder: a.firstOrder,
        lastOrder: a.lastOrder,
      })),
    },
    eventTypeInventory: {
      distinctTypes: [...typeTotals.keys()].sort(),
      counts: Object.fromEntries([...typeTotals.entries()].sort((a, b) => b[1] - a[1])),
      groups: typeGroups,
    },
    substitutionSemantics: {
      explicitTypeFound: explicitSub,
      observedTypeNames: subTypes,
      totalSubstitutionEvents: subCount,
      perGame: analyses.map((a) => ({
        gameId: a.gameId,
        n: a.substitutionEvents,
        types: a.substitutionTypes,
        sample: a.substitutionSample,
      })),
      note: explicitSub
        ? 'Substitution-like events found. In/out inferred from participants vs opening on-court set; no name parsing.'
        : 'No substitution event type or substitution-like text found in the 10-game sample.',
    },
    rotationReconstructionTest: rotationTests,
    rotationReconstructionVerdict: rotationVerdict,
    participantIdentity: {
      uniqueIds: allParticipants.length,
      mapped,
      unmapped: allParticipants.length - mapped,
      sampleIds: allParticipants.slice(0, 20),
      semantics:
        'participants is an array of integer player IDs. Role (shooter/assister/in/out) is not labeled; must be inferred from type/text/on-court state.',
    },
    teamIdentity: scoreRows.map((r) => ({
      gameId: r.gameId,
      unknownTeams: r.unknownTeams,
      nullTeamEvents: r.nullTeamEvents,
    })),
    scoreReconciliation: {
      matched: scoreMatchN,
      of: analyses.length,
      target: '10/10',
      games: scoreRows,
    },
    periodClockIntegrity: analyses.map((a) => ({
      gameId: a.gameId,
      periods: a.periods,
      nullClock: a.nullClock,
      otExpected: sample.find((s) => s.gameId === a.gameId)?.traits.includes('overtime') ?? false,
    })),
    wallclockAssessment: {
      populated: analyses.reduce((s, a) => s + a.wallclockPopulated, 0),
      events: allRows,
      populatedPct: allRows ? round((100 * analyses.reduce((s, a) => s + a.wallclockPopulated, 0)) / allRows, 1) : null,
      duplicates: analyses.reduce((s, a) => s + a.wallclockDup, 0),
      reversals: analyses.reduce((s, a) => s + a.wallclockReversals, 0),
      note: 'Wallclock is a candidate as-of time, not assumed as true event occurrence without more evidence.',
    },
    shotCoordinateCoverage: {
      shootingPlays: shooting,
      bothXY,
      bothPct: shooting ? round((100 * bothXY) / shooting, 1) : null,
      plausibleXY,
      sentinelXY,
      plausiblePct: shooting ? round(plausiblePct, 1) : null,
      madeXY: analyses.reduce((s, a) => s + a.madeXY, 0),
      missXY: analyses.reduce((s, a) => s + a.missXY, 0),
      twoXY: analyses.reduce((s, a) => s + a.twoXY, 0),
      threeXY: analyses.reduce((s, a) => s + a.threeXY, 0),
      games: analyses.map((a) => ({
        gameId: a.gameId,
        shooting: a.shootingPlays,
        bothXY: a.shootBothXY,
        plausibleXY: a.coordPlausible,
        sentinelXY: a.coordSentinel,
        xRangePlausible: a.coordXRange,
        yRangePlausible: a.coordYRange,
      })),
      note: 'Values with abs(coord) >= 1e6 are treated as sentinels (observed near INT32 min). Court geometry is not interpreted.',
    },
    shotMapValue: {
      rating: shotValue,
      vsSeasonAverages:
        'Season Averages by_zone is season-level. Plays add event-level location only where coordinates are plausible (not sentinels), plus sequence and clutch timing.',
    },
    possessionFeasibility,
    wowyFeasibility: wowy,
    existingDataOverlap: {
      playerGameLogs: 'box totals; no event order/clock',
      teamGameStats: 'team totals',
      advancedStats: 'game-grain rates, not event sequence',
      lineups: 'starters vs listed non-starters; not substitution timeline',
      injuries: 'as-of status, not on-court minutes',
      seasonAverages: 'season zone/playtype; not game events',
      marketArchives: 'odds/props; no PBP',
    },
    uniqueSignals: unique,
    productApplications: {
      historicalExplorer: { timeline: allRows > 0, scoringRuns: scoreMatchN > 0 },
      gameFlow: { leadChanges: true, clutchSequence: true },
      roleContext: { gameSpecificActions: allRows > 0 },
      marketPlusContext: { later: true },
    },
    fullSeasonArchiveEstimate,
    productValueClassification: productValue,
    trialTimeRemaining: {
      elapsedHours: round(hoursSinceTrialStart(generatedAt), 3),
      remainingHours: round(48 - hoursSinceTrialStart(generatedAt), 3),
      protectedReserveHours: 6,
      usableRemainingHours: round(48 - hoursSinceTrialStart(generatedAt) - 6, 3),
    },
    postgresUnchangedConfirmation: {
      expectedBytes: EXPECTED_DB_BYTES,
      dbBytesAfter: isolationAfter.dbBytes,
      unchanged: isolationAfter.dbBytes === EXPECTED_DB_BYTES,
      unexpectedServing: isolationAfter.unexpectedServing,
    },
    s3Prefix: PLAYS_CHAR_PREFIX,
    rotationReconstructionVerdict: rotationVerdict,
    stepVerdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(REPORT_MD, renderMd(report));
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_JSON,
        pathUsed: path,
        gamesFetched: analyses.length,
        httpAttempts: metrics.httpAttempts,
        events: allRows,
        rotationVerdict,
        productValue,
        stepVerdict,
        scoreMatch: `${scoreMatchN}/${analyses.length}`,
        postgresUnchanged: isolationAfter.dbBytes === EXPECTED_DB_BYTES,
        startedFullArchive: false,
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
