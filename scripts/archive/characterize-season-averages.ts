/**
 * Step 9B: characterize BALLDONTLIE GOAT player/team season averages.
 * Frozen 16-probe list. Characterization S3 only. No canonical archive.
 * No Plays. No 2022. No Postgres serving table.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/characterize-season-averages.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/characterize-season-averages.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import {
  ADVANCED_STATS_KNOWN_FIELDS,
  FROZEN_SEASON_AVERAGES_PROBES,
  SAMPLE_PLAYERS,
  SAMPLE_TEAMS,
  SEASON_AVERAGES_MAX_MS,
  SEASON_AVERAGES_MAX_PAGES_PER_PROBE,
  SEASON_AVERAGES_MAX_PROBES,
  seasonAveragesCharKey,
  seasonAveragesPath,
  type SeasonAveragesProbe,
} from '@/lib/archive/season-averages';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey, type BdlEnvelope } from '@/lib/balldontlie/archive-client';
import { assertTrialExecuteAllowed, resolveBdlRequestDelayMs } from '@/lib/balldontlie/trial-limiter';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const EXPECTED_DB_BYTES = 342_846_611;
const TRIAL_START_ISO = '2026-09-08T12:10:59.422Z';
const REPORT_JSON = 'reports/trial/season-averages-characterization.json';
const REPORT_MD = 'reports/trial/season-averages-characterization.md';
const MAX_CONSECUTIVE_FAILURES = 5;
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

function nestedId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'object') {
    const s = String(v).trim();
    return s.length ? s : null;
  }
  const id = (v as Json).id;
  if (id == null) return null;
  const s = String(id).trim();
  return s.length ? s : null;
}

function statsObject(row: Json): Json {
  const stats = asObj(row.stats);
  if (stats) return stats;
  const skip = new Set([
    'player',
    'team',
    'season',
    'season_type',
    'id',
    'player_id',
    'team_id',
    'category',
    'type',
  ]);
  const out: Json = {};
  for (const [k, v] of Object.entries(row)) {
    if (!skip.has(k) && (typeof v !== 'object' || v == null)) out[k] = v;
  }
  return out;
}

function flattenKeys(obj: Json, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const nested = asObj(v);
    if (nested) keys.push(...flattenKeys(nested, path));
    else keys.push(path);
  }
  return keys;
}

function classifyValues(stats: Json): { nulls: string[]; zeros: string[]; sentinels: string[] } {
  const nulls: string[] = [];
  const zeros: string[] = [];
  const sentinels: string[] = [];
  const walk = (obj: Json, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      const nested = asObj(v);
      if (nested) {
        walk(nested, path);
        continue;
      }
      if (v == null) nulls.push(path);
      else if (v === 0 || v === 0.0) zeros.push(path);
      else if (v === '' || v === '-' || v === 'N/A' || v === -1) sentinels.push(`${path}=${String(v)}`);
    }
  };
  walk(stats, '');
  return { nulls, zeros, sentinels };
}

async function measurePostgres(client: { query: (sql: string) => Promise<{ rows: Json[] }> }) {
  const snap = await client.query(
    `select pg_database_size(current_database())::text as db_bytes`
  );
  const serving = await client.query(
    `select to_regclass('analytics.bdl_season_averages')::text as rel
     union all select to_regclass('analytics.player_season_averages_goat')::text
     union all select to_regclass('analytics.team_season_averages_goat')::text
     union all select to_regclass('analytics.lineups')::text
     union all select to_regclass('analytics.game_starters')::text
     union all select to_regclass('analytics.player_advanced_stats')::text
     union all select to_regclass('analytics.opening_player_props')::text
     union all select to_regclass('analytics.opening_game_odds')::text`
  );
  const tables = (serving.rows as { rel: string | null }[]).map((r) => r.rel).filter(Boolean) as string[];
  const dbBytes = Number((snap.rows[0] as { db_bytes: string }).db_bytes);
  return {
    dbBytes,
    dbMb: round(dbBytes / (1024 * 1024), 2),
    unexpectedServing: tables,
  };
}

function plannedRequest(probe: SeasonAveragesProbe): Json {
  const path = seasonAveragesPath(probe);
  const params: Json = {
    season: probe.season,
    season_type: probe.seasonType,
  };
  if (probe.type) params.type = probe.type;
  if (probe.kind === 'player') params['player_ids[]'] = SAMPLE_PLAYERS.map((p) => p.playerId);
  else params['team_ids[]'] = SAMPLE_TEAMS.map((t) => t.teamId);
  return {
    id: probe.id,
    kind: probe.kind,
    path,
    query: params,
    purpose: probe.purpose,
    s3Key: seasonAveragesCharKey(probe),
  };
}

type ProbeResult = {
  id: string;
  kind: string;
  season: number;
  seasonType: string;
  category: string;
  type: string | null;
  path: string;
  httpOk: boolean;
  error: string | null;
  pages: number;
  stoppedEarly: boolean;
  rows: number;
  requestedEntities: number;
  returnedIds: string[];
  coveragePct: number | null;
  identityFields: string[];
  seasonField: unknown;
  seasonTypeField: unknown;
  statsFieldNames: string[];
  nullFields: string[];
  zeroFields: string[];
  sentinels: string[];
  gpPresent: boolean;
  gpValues: unknown[];
  grainKeys: string[];
  duplicateGrain: number;
  s3Key: string;
};

function analyzeEnvelope(probe: SeasonAveragesProbe, pages: BdlEnvelope[]): ProbeResult {
  const rows: Json[] = [];
  for (const p of pages) {
    if (Array.isArray(p.data)) rows.push(...(p.data as Json[]));
  }
  const requested =
    probe.kind === 'player' ? SAMPLE_PLAYERS.map((p) => p.playerId) : SAMPLE_TEAMS.map((t) => t.teamId);
  const returnedIds: string[] = [];
  const grain = new Map<string, number>();
  let identityFields: string[] = [];
  const allStatsKeys = new Set<string>();
  const nullSet = new Set<string>();
  const zeroSet = new Set<string>();
  const sentSet = new Set<string>();
  const gpValues: unknown[] = [];
  let seasonField: unknown = null;
  let seasonTypeField: unknown = null;
  let gpPresent = false;

  for (const row of rows) {
    const id = probe.kind === 'player' ? nestedId(row.player) ?? String(row.player_id ?? '') : nestedId(row.team) ?? String(row.team_id ?? '');
    if (id) returnedIds.push(id);
    identityFields = Object.keys(row).slice(0, 20);
    seasonField = row.season ?? seasonField;
    seasonTypeField = row.season_type ?? seasonTypeField;
    const stats = statsObject(row);
    for (const k of flattenKeys(stats)) allStatsKeys.add(k);
    const cls = classifyValues(stats);
    cls.nulls.forEach((k) => nullSet.add(k));
    cls.zeros.forEach((k) => zeroSet.add(k));
    cls.sentinels.forEach((k) => sentSet.add(k));
    const gp = stats.games_played ?? stats.gp ?? row.games_played ?? row.gp;
    if (gp != null) {
      gpPresent = true;
      gpValues.push(gp);
    }
    const gk = `${probe.season}|${probe.seasonType}|${id}|${probe.category}|${probe.type ?? 'none'}`;
    grain.set(gk, (grain.get(gk) ?? 0) + 1);
  }
  const uniqueReturned = [...new Set(returnedIds)];
  const coveragePct =
    requested.length > 0 ? round((100 * uniqueReturned.filter((id) => requested.includes(id)).length) / requested.length, 1) : null;
  return {
    id: probe.id,
    kind: probe.kind,
    season: probe.season,
    seasonType: probe.seasonType,
    category: probe.category,
    type: probe.type,
    path: seasonAveragesPath(probe),
    httpOk: true,
    error: null,
    pages: pages.length,
    stoppedEarly: false,
    rows: rows.length,
    requestedEntities: requested.length,
    returnedIds: uniqueReturned,
    coveragePct,
    identityFields,
    seasonField,
    seasonTypeField,
    statsFieldNames: [...allStatsKeys].sort(),
    nullFields: [...nullSet].sort(),
    zeroFields: [...zeroSet].sort(),
    sentinels: [...sentSet].sort(),
    gpPresent,
    gpValues: gpValues.slice(0, 8),
    grainKeys: [...grain.keys()],
    duplicateGrain: [...grain.values()].filter((n) => n > 1).length,
    s3Key: seasonAveragesCharKey(probe),
  };
}

function overlapClass(fields: string[]): { A: string[]; B: string[]; C: string[] } {
  const lower = fields.map((f) => f.toLowerCase());
  const A: string[] = [];
  const B: string[] = [];
  const C: string[] = [];
  const boxish = [
    'pts',
    'points',
    'reb',
    'rebounds',
    'ast',
    'assists',
    'stl',
    'blk',
    'tov',
    'min',
    'gp',
    'games_played',
    'fgm',
    'fga',
    'fg3m',
    'fg_pct',
  ];
  const adv = ADVANCED_STATS_KNOWN_FIELDS.map((f) => f.toLowerCase());
  for (const f of fields) {
    const l = f.toLowerCase();
    const leaf = l.split('.').pop() ?? l;
    if (boxish.some((b) => leaf === b || leaf.startsWith(`${b}_`))) A.push(f);
    else if (adv.some((a) => leaf === a || leaf.includes(a))) B.push(f);
    else C.push(f);
  }
  void lower;
  return { A, B, C };
}

function renderMd(report: Json): string {
  return `# Season Averages characterization (Step 9B)

Generated: ${report.generatedAt}

**Verdict:** ${report.stepVerdict}

- BDL HTTP this step: see acquisition
- Plays started: false
- 2022 started: false
- Postgres writes: false

## Safety State
${JSON.stringify(report.safety, null, 2)}

## Existing Implementation Audit
${JSON.stringify(report.existingImplementationAudit, null, 2)}

## Characterization Plan
${JSON.stringify(report.characterizationPlan, null, 2)}

## Acquisition Result
${JSON.stringify(report.acquisitionResult, null, 2)}

## Player Category Results
${JSON.stringify(report.playerCategoryResults, null, 2)}

## Team Category Results
${JSON.stringify(report.teamCategoryResults, null, 2)}

## Response Grain / Schema
${JSON.stringify(report.responseGrain, null, 2)}

## Historical Consistency
${JSON.stringify(report.historicalConsistency, null, 2)}

## Coverage / Field Quality
${JSON.stringify(report.coverageQuality, null, 2)}

## Advanced-Stats Overlap
${JSON.stringify(report.advancedStatsOverlap, null, 2)}

## Unique Player Signals
${JSON.stringify(report.uniquePlayerSignals, null, 2)}

## Unique Team Signals
${JSON.stringify(report.uniqueTeamSignals, null, 2)}

## Play-Type Assessment
${JSON.stringify(report.playTypeAssessment, null, 2)}

## Tracking Assessment
${JSON.stringify(report.trackingAssessment, null, 2)}

## Shooting / Shot-Dashboard Assessment
${JSON.stringify(report.shootingAssessment, null, 2)}

## Product Applications
${JSON.stringify(report.productApplications, null, 2)}

## Targeted Archive Estimate
${JSON.stringify(report.targetedArchiveEstimate, null, 2)}

## Trial Time Remaining
${JSON.stringify(report.trialTimeRemaining, null, 2)}

## Postgres Unchanged Confirmation
${JSON.stringify(report.postgresUnchangedConfirmation, null, 2)}

## Archive Recommendation
${report.archiveRecommendation}

## Step Verdict
${report.stepVerdict}

Do NOT start a full Season Averages archive. Do NOT start Plays. Do NOT start 2022.
`;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const argv = process.argv.slice(2);
  const { dryRun, execute } = parseExecuteFlag(argv);
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockBefore = bdlAcquisitionLockStatus();
  const frozen = mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun;

  if (FROZEN_SEASON_AVERAGES_PROBES.length > SEASON_AVERAGES_MAX_PROBES) {
    throw new Error('Safety stop: probe list exceeds max');
  }
  const projectedMs = FROZEN_SEASON_AVERAGES_PROBES.length * delay.delayMs;
  if (projectedMs > SEASON_AVERAGES_MAX_MS) {
    throw new Error(`Safety stop: projected ${projectedMs}ms exceeds 10 minutes`);
  }

  const client = await pool.connect();
  let isolationBefore: Json = {};
  try {
    await client.query('begin read only');
    isolationBefore = await measurePostgres(client);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if (!frozen || pin !== '2025') {
    throw new Error(`Safety stop: frozen=${frozen} pin=${pin}`);
  }
  if (Number(isolationBefore.dbBytes) !== EXPECTED_DB_BYTES) {
    throw new Error(`Safety stop: postgres ${isolationBefore.dbBytes} != ${EXPECTED_DB_BYTES}`);
  }
  if ((isolationBefore.unexpectedServing as string[]).length > 0) {
    throw new Error(`Safety stop: unexpected serving ${JSON.stringify(isolationBefore.unexpectedServing)}`);
  }
  if (!delay.trialMode || delay.delayMs < 12000 || delay.concurrency !== 1) {
    throw new Error('Safety stop: trial limiter not 13s / concurrency 1');
  }

  const planned = FROZEN_SEASON_AVERAGES_PROBES.map(plannedRequest);
  const safety = {
    trialMode: delay.trialMode,
    delayMs: delay.delayMs,
    minDelayMs: 12000,
    concurrency: delay.concurrency,
    lockActiveBefore: lockBefore.active,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen,
    currentAnalyticsSeason: pin,
    dbBytesBefore: isolationBefore.dbBytes,
    dbMb: isolationBefore.dbMb,
    seasonAveragesServingTables: isolationBefore.unexpectedServing,
    acquisitionWritesPostgres: false,
  };
  const plan = {
    probeCount: FROZEN_SEASON_AVERAGES_PROBES.length,
    projectedHttp: FROZEN_SEASON_AVERAGES_PROBES.length,
    projectedMs,
    projectedMinutes: round(projectedMs / 60000, 2),
    maxPagesPerProbe: SEASON_AVERAGES_MAX_PAGES_PER_PROBE,
    samplePlayers: SAMPLE_PLAYERS,
    sampleTeams: SAMPLE_TEAMS,
    requests: planned,
    doNotExpand: true,
    clutchDefenseIncluded: false,
    playsIncluded: false,
    season2022Included: false,
  };

  console.log(JSON.stringify({ safety, characterizationPlan: plan }, null, 2));

  if (dryRun && !execute) {
    console.log('[dry-run] no season-averages HTTP.');
    await pool.end().catch(() => undefined);
    return;
  }

  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });
  const bdl = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
  const results: ProbeResult[] = [];
  let consecutiveFailures = 0;
  const wallStart = Date.now();
  let httpN = 0;

  try {
    for (const probe of FROZEN_SEASON_AVERAGES_PROBES) {
      if (httpN > 0) await sleep(delay.delayMs);
      const path = seasonAveragesPath(probe);
      const params: Record<string, string | number | string[]> = {
        season: probe.season,
        season_type: probe.seasonType,
      };
      if (probe.type) params.type = probe.type;
      if (probe.kind === 'player') params['player_ids[]'] = SAMPLE_PLAYERS.map((p) => p.playerId);
      else params['team_ids[]'] = SAMPLE_TEAMS.map((t) => t.teamId);

      const pages: BdlEnvelope[] = [];
      let stoppedEarly = false;
      try {
        for await (const page of bdl.paginate({
          path,
          params,
          paginationStyle: 'cursor',
          perPage: 100,
        })) {
          pages.push(page.body);
          httpN += 1;
          if (pages.length >= SEASON_AVERAGES_MAX_PAGES_PER_PROBE && page.hasMore) {
            stoppedEarly = true;
            console.error(`[season-averages] STOP probe ${probe.id}: more than ${SEASON_AVERAGES_MAX_PAGES_PER_PROBE} pages`);
            break;
          }
        }
        const analyzed = analyzeEnvelope(probe, pages);
        analyzed.stoppedEarly = stoppedEarly;
        results.push(analyzed);
        await archiveJsonObjectToS3({
          s3,
          key: seasonAveragesCharKey(probe),
          body: {
            probe,
            fetchedAt: new Date().toISOString(),
            pages,
            stoppedEarly,
          },
          overwrite: true,
        });
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures += 1;
        results.push({
          id: probe.id,
          kind: probe.kind,
          season: probe.season,
          seasonType: probe.seasonType,
          category: probe.category,
          type: probe.type,
          path,
          httpOk: false,
          error: err instanceof Error ? err.message : String(err),
          pages: pages.length,
          stoppedEarly,
          rows: 0,
          requestedEntities: probe.kind === 'player' ? SAMPLE_PLAYERS.length : SAMPLE_TEAMS.length,
          returnedIds: [],
          coveragePct: 0,
          identityFields: [],
          seasonField: null,
          seasonTypeField: null,
          statsFieldNames: [],
          nullFields: [],
          zeroFields: [],
          sentinels: [],
          gpPresent: false,
          gpValues: [],
          grainKeys: [],
          duplicateGrain: 0,
          s3Key: seasonAveragesCharKey(probe),
        });
        console.error(`[season-averages] FAIL ${probe.id} ${err instanceof Error ? err.message : String(err)}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(`Stopping: ${MAX_CONSECUTIVE_FAILURES} consecutive season-averages failures`);
        }
      }
    }
  } finally {
    lock.release();
  }

  const metrics = bdl.getMetrics();
  const spacing = metrics.spacingSamplesMs;
  const playerResults = results.filter((r) => r.kind === 'player');
  const teamResults = results.filter((r) => r.kind === 'team');
  const okPlayer = playerResults.filter((r) => r.httpOk);
  const okTeam = teamResults.filter((r) => r.httpOk);

  const pair = (a: ProbeResult | undefined, b: ProbeResult | undefined) => {
    if (!a || !b || !a.httpOk || !b.httpOk) return { compared: false, reason: 'missing_or_failed' };
    const sa = new Set(a.statsFieldNames);
    const sb = new Set(b.statsFieldNames);
    const onlyA = a.statsFieldNames.filter((k) => !sb.has(k));
    const onlyB = b.statsFieldNames.filter((k) => !sa.has(k));
    const both = a.statsFieldNames.filter((k) => sb.has(k));
    return {
      compared: true,
      pair: `${a.category}/${a.type ?? 'none'} ${a.season} vs ${b.season}`,
      sameFieldNames: onlyA.length === 0 && onlyB.length === 0,
      sharedFields: both.length,
      addedIn2025: onlyA,
      droppedIn2025: onlyB,
      coverage2025: a.coveragePct,
      coverage2024: b.coveragePct,
      identityCompatible: a.returnedIds.sort().join() === b.returnedIds.sort().join() || b.returnedIds.every((id) => a.returnedIds.includes(id)),
    };
  };

  const pIso25 = results.find((r) => r.id === 'P01');
  const pIso24 = results.find((r) => r.id === 'P10');
  const pDrv25 = results.find((r) => r.id === 'P04');
  const pDrv24 = results.find((r) => r.id === 'P11');
  const pZn25 = results.find((r) => r.id === 'P06');
  const pZn24 = results.find((r) => r.id === 'P12');
  const pGen = results.find((r) => r.id === 'P09');

  const genOverlap = pGen ? overlapClass(pGen.statsFieldNames) : { A: [], B: [], C: [] };
  const playOverlap = pIso25 ? overlapClass(pIso25.statsFieldNames) : { A: [], B: [], C: [] };
  const trackOverlap = pDrv25 ? overlapClass(pDrv25.statsFieldNames) : { A: [], B: [], C: [] };
  const zoneOverlap = pZn25 ? overlapClass(pZn25.statsFieldNames) : { A: [], B: [], C: [] };
  const tOpp = results.find((r) => r.id === 'T03');
  const tPlay = results.find((r) => r.id === 'T01');
  const tGen = results.find((r) => r.id === 'T04');

  const playFields = new Set((pIso25?.statsFieldNames ?? []).map((s) => s.toLowerCase()));
  const playHas = (...needles: string[]) => needles.some((n) => [...playFields].some((f) => f.includes(n)));
  const playValue =
    playHas('poss', 'frequency', 'ppp', 'percentile', 'points', 'fg')
      ? playHas('frequency', 'ppp') || playHas('poss')
        ? 'HIGH_VALUE'
        : 'MEDIUM_VALUE'
      : okPlayer.some((r) => r.category === 'playtype' && r.rows > 0)
        ? 'MEDIUM_VALUE'
        : 'LOW_VALUE';

  const uniquePlayerC = [...new Set([...playOverlap.C, ...trackOverlap.C, ...zoneOverlap.C])];
  const uniqueEnough = uniquePlayerC.length >= 8 && playValue !== 'LOW_VALUE';
  const archiveRec = !okPlayer.length
    ? 'LOW_VALUE_SKIP'
    : uniqueEnough
      ? 'TARGETED_ARCHIVE_CONSIDER'
      : playValue === 'HIGH_VALUE'
        ? 'TARGETED_ARCHIVE_CONSIDER'
        : 'LOW_VALUE_SKIP';
  const verdict =
    archiveRec === 'HIGH_VALUE_ARCHIVE_RECOMMENDED'
      ? 'GREEN — Season Averages add unique Court Context value'
      : archiveRec === 'TARGETED_ARCHIVE_CONSIDER'
        ? 'YELLOW — useful subset exists but broad archive is unnecessary'
        : 'RED — Season Averages are too redundant to pursue';

  const db = await pool.connect();
  let isolationAfter: Json = {};
  try {
    await db.query('begin read only');
    isolationAfter = await measurePostgres(db);
    await db.query('commit');
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    db.release();
  }

  const elapsedH = hoursSinceTrialStart(new Date().toISOString());
  const remainingH = 48 - elapsedH;
  const metricsJson = {
    httpAttempts: metrics.httpAttempts,
    httpSuccess: metrics.httpSuccess,
    status429: metrics.status429,
    retries: metrics.retries,
    retryAfterUsed: metrics.retryAfterUsed,
    pages: results.reduce((s, r) => s + r.pages, 0),
    wallClockMs: Date.now() - wallStart,
    averageMs: spacing.length ? round(spacing.reduce((a, b) => a + b, 0) / spacing.length, 1) : null,
    minimumMs: spacing.length ? Math.min(...spacing) : null,
    maximumMs: spacing.length ? Math.max(...spacing) : null,
  };

  const report = {
    generatedAt,
    step: '9B',
    bdlHttp: metrics.httpAttempts,
    startedPlays: false,
    started2022: false,
    postgresWrites: false,
    safety,
    existingImplementationAudit: {
      goatCategoryClientExisted: false,
      legacyBoxScoreSeasonAverages: 'scripts/seed-raw-balldontlie.ts uses /v1/season_averages?player_id=&season= (not this endpoint)',
      reused: ['BdlArchiveClient', 'trial-limiter', 'acquisition-lock', 'archiveJsonObjectToS3'],
      openapi: 'docs/api/balldontlie-openapi.yaml is stale ({type} path / limited enum). Live docs use /nba/v1/season_averages/{category} and team_season_averages/{category}.',
      generatedTypes: false,
    },
    characterizationPlan: plan,
    acquisitionResult: {
      plannedRequests: FROZEN_SEASON_AVERAGES_PROBES.length,
      ...metricsJson,
      failed: results.filter((r) => !r.httpOk).map((r) => ({ id: r.id, error: r.error })),
      stoppedEarly: results.filter((r) => r.stoppedEarly).map((r) => r.id),
    },
    playerCategoryResults: playerResults,
    teamCategoryResults: teamResults,
    responseGrain: {
      playerLikely: '(season, season_type, player_id, category, type)',
      teamLikely: '(season, season_type, team_id, category, type)',
      duplicates: results.map((r) => ({ id: r.id, duplicateGrain: r.duplicateGrain })),
      verifiedFromResponses: true,
    },
    historicalConsistency: [
      pair(pIso25, pIso24),
      pair(pDrv25, pDrv24),
      pair(pZn25, pZn24),
    ],
    coverageQuality: results.map((r) => ({
      id: r.id,
      requested: r.requestedEntities,
      returned: r.returnedIds.length,
      coveragePct: r.coveragePct,
      gpPresent: r.gpPresent,
      nullFieldCount: r.nullFields.length,
      zeroFieldCount: r.zeroFields.length,
      sentinels: r.sentinels,
    })),
    advancedStatsOverlap: {
      generalAdvanced: genOverlap,
      playtypeIsolation: playOverlap,
      trackingDrives: trackOverlap,
      shootingByZone: zoneOverlap,
      note: 'A = box-like / already in serving averages or logs. B = named like Advanced Stats V2 (season-grain vs game-grain). C = not in our Advanced field set.',
    },
    uniquePlayerSignals: {
      classCFields: uniquePlayerC.slice(0, 80),
      count: uniquePlayerC.length,
    },
    uniqueTeamSignals: {
      opponentZoneFields: tOpp?.statsFieldNames.slice(0, 80) ?? [],
      teamPlaytypeFields: tPlay?.statsFieldNames.slice(0, 80) ?? [],
      teamGeneralOverlap: tGen ? overlapClass(tGen.statsFieldNames) : null,
    },
    playTypeAssessment: {
      classification: playValue,
      actualFields: pIso25?.statsFieldNames ?? [],
      alsoSampled: ['prballhandler', 'prrollman'],
    },
    trackingAssessment: {
      drivesFields: pDrv25?.statsFieldNames ?? [],
      passingFields: results.find((r) => r.id === 'P05')?.statsFieldNames ?? [],
      teamPossessionsFields: results.find((r) => r.id === 'T02')?.statsFieldNames ?? [],
    },
    shootingAssessment: {
      byZoneFields: pZn25?.statsFieldNames ?? [],
      shotDashboardFields: results.find((r) => r.id === 'P07')?.statsFieldNames ?? [],
      teamOpponentZoneFields: tOpp?.statsFieldNames ?? [],
    },
    productApplications: {
      roleProfile: {
        readiness: playValue === 'HIGH_VALUE' ? 'promising' : playValue === 'MEDIUM_VALUE' ? 'partial' : 'not_ready',
        uniqueValue: 'Season play-type/tracking if class C fields populate',
        majorLimitation: 'Season grain, not game-level role; hustle/clutch not fully probed',
        priority: playValue === 'LOW_VALUE' ? 'later' : 'P2',
      },
      matchupProfile: {
        readiness: tOpp && tOpp.httpOk && tOpp.rows > 0 ? 'promising' : 'unknown',
        uniqueValue: 'Opponent shooting-zone if by_zone_opponent is populated',
        majorLimitation: 'Four teams only; not a league archive',
        priority: 'P2',
      },
      opportunityCheck: {
        readiness: 'not_ready',
        uniqueValue: 'Season style context only',
        majorLimitation: 'No in-season role shift without game grain',
        priority: 'later',
      },
      historicalExplorer: {
        readiness: okPlayer.length ? 'partial' : 'not_ready',
        uniqueValue: 'Season profiles if schema is stable 2024–2025',
        majorLimitation: 'Sampled players/teams only',
        priority: 'P2',
      },
      marketPlusContext: {
        readiness: 'later',
        uniqueValue: 'Combine with 3-Hour Pre-Tip later',
        majorLimitation: 'Not characterized against props in this step',
        priority: 'later',
      },
    },
    targetedArchiveEstimate: {
      notExecuted: true,
      proposedPlayer: [
        'playtype: isolation, prballhandler, prrollman, spotup, transition',
        'tracking: drives, passing, possessions, catchshoot, pullupshot',
        'shooting: by_zone',
        'shotdashboard: overall, pullups, catch_and_shoot',
        'general: advanced',
      ],
      proposedTeam: [
        'playtype: isolation, spotup, prballhandler',
        'tracking: drives, possessions, passing',
        'shooting: by_zone_base, by_zone_opponent',
        'general: advanced, opponent',
      ],
      combinationsPerSeasonApprox: 16 + 11,
      seasons: [2023, 2024, 2025],
      requestsIfOnePageEach: (16 + 11) * 3,
      providerHoursAt13s: round(((16 + 11) * 3 * 13) / 3600, 2),
      estimatedS3Mb: 'unknown until row sizes observed; characterization objects are the size sample',
      note: 'Estimate assumes one unfiltered page is NOT used. Filter-all-players without player_ids[] would paginate into a crawl — do not do that.',
    },
    trialTimeRemaining: {
      elapsedHours: round(elapsedH, 3),
      remainingHours: round(remainingH, 3),
      protectedReserveHours: 6,
      usableRemainingHours: round(remainingH - 6, 3),
    },
    postgresUnchangedConfirmation: {
      expectedBytes: EXPECTED_DB_BYTES,
      dbBytesAfter: isolationAfter.dbBytes,
      unchanged: isolationAfter.dbBytes === EXPECTED_DB_BYTES,
      unexpectedServing: isolationAfter.unexpectedServing,
    },
    archiveRecommendation: archiveRec,
    stepVerdict: verdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(REPORT_MD, renderMd(report));
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_JSON,
        archiveRecommendation: archiveRec,
        stepVerdict: verdict,
        httpAttempts: metrics.httpAttempts,
        postgresUnchanged: isolationAfter.dbBytes === EXPECTED_DB_BYTES,
        startedPlays: false,
        started2022: false,
      },
      null,
      2
    )
  );
  await pool.end().catch(() => undefined);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
