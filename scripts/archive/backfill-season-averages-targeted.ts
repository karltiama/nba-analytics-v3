/**
 * Step 9C: targeted high-value Season Averages archive for 2023/2024/2025.
 * Canonical S3 only. Allowlist from Step 9B characterized unique signals.
 * No Plays. No 2022. No Postgres serving table.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-season-averages-targeted.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-season-averages-targeted.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import {
  PLAYER_SEASON_AVERAGES_CANONICAL_PREFIX,
  PLAYER_SEASON_AVERAGES_PATH,
  SEASON_AVERAGES_MAX_PAGES_PER_BATCH,
  SEASON_AVERAGES_MAX_PROVIDER_MS,
  SEASON_AVERAGES_PLAYER_BATCH_SIZE,
  SEASON_AVERAGES_SEASON_TYPE,
  SEASON_AVERAGES_TARGET_SEASONS,
  TARGETED_PLAYER_ALLOWLIST,
  TARGETED_SEASON_AVERAGES_EXCLUSIONS,
  TARGETED_TEAM_ALLOWLIST,
  TEAM_SEASON_AVERAGES_CANONICAL_PREFIX,
  TEAM_SEASON_AVERAGES_PATH,
  chunkIds,
  seasonAveragesCanonicalPageKey,
  seasonAveragesComboPrefix,
  sortProviderIds,
  type SeasonAveragesKind,
  type TargetedSeason,
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
const REPORT_JSON = 'reports/trial/season-averages-targeted-archive-report.json';
const REPORT_MD = 'reports/trial/season-averages-targeted-archive-report.md';
const PROGRESS_JSON = 'reports/trial/season-averages-targeted-archive-progress.json';
const MAX_CONSECUTIVE_FAILURES = 5;
const EXPECTED_TEAMS = 30;
const STEP9B_HTTP_ESTIMATE = 189;
const STEP9B_MINUTES_ESTIMATE = 41;
const STEP9B_MB_ESTIMATE = 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, unknown>;

type ArchiveJob = {
  id: string;
  kind: SeasonAveragesKind;
  season: TargetedSeason;
  category: string;
  type: string;
  batchIndex: number;
  entityIds: string[];
  path: string;
  s3Prefix: string;
};

type PageArchive = {
  jobId: string;
  key: string;
  pageIndex: number;
  rows: number;
  hasMore: boolean;
  skipped: boolean;
  written: boolean;
};

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

function rowEntityId(kind: SeasonAveragesKind, row: Json): string | null {
  return kind === 'player'
    ? nestedId(row.player) ?? (row.player_id != null ? String(row.player_id) : null)
    : nestedId(row.team) ?? (row.team_id != null ? String(row.team_id) : null);
}

function statsObject(row: Json): Json | null {
  return asObj(row.stats);
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

function writeJson(path: string, body: unknown) {
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(path, JSON.stringify(body, null, 2) + '\n');
}

async function measurePostgres(client: { query: (sql: string) => Promise<{ rows: Json[] }> }) {
  const snap = await client.query(`select pg_database_size(current_database())::text as db_bytes`);
  const serving = await client.query(
    `select to_regclass('analytics.bdl_season_averages')::text as rel
     union all select to_regclass('analytics.player_season_averages_goat')::text
     union all select to_regclass('analytics.team_season_averages_goat')::text
     union all select to_regclass('analytics.lineups')::text
     union all select to_regclass('analytics.game_starters')::text
     union all select to_regclass('analytics.player_advanced_stats')::text`
  );
  const tables = (serving.rows as { rel: string | null }[]).map((r) => r.rel).filter(Boolean) as string[];
  const dbBytes = Number((snap.rows[0] as { db_bytes: string }).db_bytes);
  return { dbBytes, dbMb: round(dbBytes / (1024 * 1024), 2), unexpectedServing: tables };
}

async function loadSeasonTargets(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Json[] }> },
  season: TargetedSeason
): Promise<{ playerIds: string[]; teamIds: string[] }> {
  const players = await client.query(
    `select distinct player_id::text as id
     from analytics.player_game_logs
     where season = $1 and player_id is not null and btrim(player_id::text) <> ''
     order by 1`,
    [String(season)]
  );
  const teams = await client.query(
    `select distinct team_id::text as id from (
       select home_team_id as team_id from analytics.games where season = $1
       union
       select away_team_id from analytics.games where season = $1
     ) t
     where team_id is not null and btrim(team_id::text) <> ''
     order by 1`,
    [String(season)]
  );
  return {
    playerIds: sortProviderIds(players.rows.map((r) => String(r.id))),
    teamIds: sortProviderIds(teams.rows.map((r) => String(r.id))),
  };
}

async function missingPlayerActivity(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Json[] }> },
  season: TargetedSeason,
  missingIds: string[]
): Promise<{ n: number; medianGp: number | null; sample: Json[] }> {
  if (missingIds.length === 0) return { n: 0, medianGp: null, sample: [] };
  const rows = await client.query(
    `select player_id::text as player_id,
            count(*)::int as gp,
            coalesce(sum(points), 0)::int as pts
     from analytics.player_game_logs
     where season = $1 and player_id = any($2::text[])
     group by 1
     order by count(*) asc, coalesce(sum(points), 0) asc
     limit 25`,
    [String(season), missingIds]
  );
  const gps = rows.rows.map((r) => Number(r.gp)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const mid = gps.length ? gps[Math.floor(gps.length / 2)]! : null;
  return { n: missingIds.length, medianGp: mid, sample: rows.rows };
}

function buildJobs(targets: Record<TargetedSeason, { playerIds: string[]; teamIds: string[] }>): ArchiveJob[] {
  const jobs: ArchiveJob[] = [];
  for (const season of SEASON_AVERAGES_TARGET_SEASONS) {
    const playerBatches = chunkIds(targets[season].playerIds, SEASON_AVERAGES_PLAYER_BATCH_SIZE);
    for (const combo of TARGETED_PLAYER_ALLOWLIST) {
      playerBatches.forEach((entityIds, batchIndex) => {
        jobs.push({
          id: `P-${season}-${combo.category}-${combo.type}-b${String(batchIndex).padStart(2, '0')}`,
          kind: 'player',
          season,
          category: combo.category,
          type: combo.type,
          batchIndex,
          entityIds,
          path: `${PLAYER_SEASON_AVERAGES_PATH}/${combo.category}`,
          s3Prefix: seasonAveragesComboPrefix({
            kind: 'player',
            season,
            category: combo.category,
            type: combo.type,
          }),
        });
      });
    }
    for (const combo of TARGETED_TEAM_ALLOWLIST) {
      jobs.push({
        id: `T-${season}-${combo.category}-${combo.type}-b00`,
        kind: 'team',
        season,
        category: combo.category,
        type: combo.type,
        batchIndex: 0,
        entityIds: targets[season].teamIds,
        path: `${TEAM_SEASON_AVERAGES_PATH}/${combo.category}`,
        s3Prefix: seasonAveragesComboPrefix({
          kind: 'team',
          season,
          category: combo.category,
          type: combo.type,
        }),
      });
    }
  }
  return jobs;
}

function comboKey(kind: string, season: number, category: string, type: string): string {
  return `${kind}|${season}|${category}|${type}`;
}

type ComboCert = {
  kind: SeasonAveragesKind;
  season: TargetedSeason;
  category: string;
  type: string;
  rows: number;
  uniqueEntities: number;
  duplicates: number;
  nullIdentity: number;
  nullStats: number;
  fieldNames: string[];
  pages: number;
  paginationComplete: boolean;
  targeted: number;
  returnedIds: string[];
  missingIds: string[];
  coveragePct: number | null;
  alwaysZeroFields: string[];
};

function certifyCombo(
  kind: SeasonAveragesKind,
  season: TargetedSeason,
  category: string,
  type: string,
  targeted: string[],
  rows: Json[],
  pages: number,
  paginationComplete: boolean
): ComboCert {
  const grain = new Map<string, number>();
  const returned: string[] = [];
  let nullIdentity = 0;
  let nullStats = 0;
  const fieldSet = new Set<string>();
  const zeroCounts = new Map<string, number>();
  const presentCounts = new Map<string, number>();
  for (const row of rows) {
    const id = rowEntityId(kind, row);
    if (!id) nullIdentity += 1;
    else returned.push(id);
    const stats = statsObject(row);
    if (!stats) {
      nullStats += 1;
      continue;
    }
    const keys = flattenKeys(stats);
    for (const k of keys) {
      fieldSet.add(k);
      presentCounts.set(k, (presentCounts.get(k) ?? 0) + 1);
      const parts = k.split('.');
      let cur: unknown = stats;
      for (const p of parts) cur = asObj(cur as Json)?.[p] ?? (cur as Json)?.[p];
      if (cur === 0 || cur === 0.0) zeroCounts.set(k, (zeroCounts.get(k) ?? 0) + 1);
    }
    const gk = `${season}|${SEASON_AVERAGES_SEASON_TYPE}|${id ?? 'null'}|${category}|${type}`;
    grain.set(gk, (grain.get(gk) ?? 0) + 1);
  }
  const unique = [...new Set(returned)];
  const targetedSet = new Set(targeted);
  const missingIds = targeted.filter((id) => !unique.includes(id));
  const extraOk = unique.filter((id) => !targetedSet.has(id));
  void extraOk;
  const alwaysZeroFields = [...fieldSet].filter((k) => (zeroCounts.get(k) ?? 0) === (presentCounts.get(k) ?? 0) && (presentCounts.get(k) ?? 0) > 0);
  return {
    kind,
    season,
    category,
    type,
    rows: rows.length,
    uniqueEntities: unique.length,
    duplicates: [...grain.values()].filter((n) => n > 1).length,
    nullIdentity,
    nullStats,
    fieldNames: [...fieldSet].sort(),
    pages,
    paginationComplete,
    targeted: targeted.length,
    returnedIds: unique,
    missingIds,
    coveragePct: targeted.length ? round((100 * unique.filter((id) => targetedSet.has(id)).length) / targeted.length, 1) : null,
    alwaysZeroFields,
  };
}

function fieldDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    added: b.filter((k) => !sa.has(k)),
    removed: a.filter((k) => !sb.has(k)),
  };
}

function playtypeFieldSummary(certs: ComboCert[]): Json {
  const need = ['poss', 'poss_pct', 'ppp', 'pts', 'percentile', 'score_poss_pct', 'fg_pct', 'gp'];
  return certs
    .filter((c) => c.category === 'playtype')
    .map((c) => ({
      key: comboKey(c.kind, c.season, c.category, c.type),
      present: need.filter((f) => c.fieldNames.includes(f)),
      missing: need.filter((f) => !c.fieldNames.includes(f)),
      alwaysZeroFields: c.alwaysZeroFields,
      coveragePct: c.coveragePct,
    }));
}

function zoneFieldSummary(certs: ComboCert[]): Json {
  const playerNeed = [
    'restricted_area_fga',
    'in_the_paint_(non-ra)_fga',
    'mid-range_fga',
    'corner_3_fga',
    'above_the_break_3_fga',
  ];
  const teamNeed = [
    'restricted_area_opp_fga',
    'in_the_paint_(non-ra)_opp_fga',
    'mid-range_opp_fga',
    'corner_3_opp_fga',
    'above_the_break_3_opp_fga',
  ];
  return certs
    .filter((c) => c.category === 'shooting')
    .map((c) => {
      const need = c.kind === 'player' ? playerNeed : teamNeed;
      return {
        key: comboKey(c.kind, c.season, c.category, c.type),
        present: need.filter((f) => c.fieldNames.includes(f)),
        missing: need.filter((f) => !c.fieldNames.includes(f)),
        coveragePct: c.coveragePct,
      };
    });
}

async function listCanonicalSize(s3: S3Storage, prefix: string): Promise<{ objects: number; bytes: number }> {
  const root = prefix.endsWith('/') ? prefix : `${prefix}/`;
  let objects = 0;
  let bytes = 0;
  for await (const o of s3.listByPrefix(root)) {
    if (o.key.includes('/_characterization')) continue;
    if (o.key.endsWith('/_manifest.json')) continue;
    if (!o.key.endsWith('.json')) continue;
    objects += 1;
    bytes += o.size;
  }
  return { objects, bytes };
}

function renderMd(report: Json): string {
  return `# Targeted Season Averages archive (Step 9C)

Generated: ${report.generatedAt}

**Archive verdict:** ${report.archiveVerdict}

**Step verdict:** ${report.stepVerdict}

Do NOT start Plays. Do NOT start 2022.

Machine-readable: \`${REPORT_JSON}\`

## Safety State
${JSON.stringify(report.safety, null, 2)}

## Archive Allowlist
${JSON.stringify(report.archiveAllowlist, null, 2)}

## Player / Team Targets
Counts: ${JSON.stringify(report.playerTeamTargetCounts)}

Full IDs are in the JSON report (\`targets\`).

## Dry-Run Estimate
${JSON.stringify(report.dryRunEstimate, null, 2)}

## Acquisition Result
${JSON.stringify(report.acquisitionResult, null, 2)}

## Record Grain
${JSON.stringify(report.recordGrain, null, 2)}

## Player Coverage
${JSON.stringify(report.playerCoverage, null, 2)}

## Team Coverage
${JSON.stringify(report.teamCoverage, null, 2)}

## Historical Schema Consistency
${JSON.stringify(report.historicalSchemaConsistency, null, 2)}

## Play-Type Certification
${JSON.stringify(report.playTypeCertification, null, 2)}

## Tracking Certification
${JSON.stringify(report.trackingCertification, null, 2)}

## Zone-Shooting Certification
${JSON.stringify(report.zoneShootingCertification, null, 2)}

## S3 Certification
${JSON.stringify(report.s3Certification, null, 2)}

## Product Limitations
${JSON.stringify(report.productLimitations, null, 2)}

## Product-Readiness Assessment
${JSON.stringify(report.productReadiness, null, 2)}

## S3 Size
${JSON.stringify(report.s3Size, null, 2)}

## Trial Time Remaining
${JSON.stringify(report.trialTimeRemaining, null, 2)}

## Postgres Unchanged Confirmation
${JSON.stringify(report.postgresUnchangedConfirmation, null, 2)}

## Archive Verdict
${report.archiveVerdict}

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

  const client = await pool.connect();
  let isolationBefore: Awaited<ReturnType<typeof measurePostgres>>;
  const targets = {} as Record<TargetedSeason, { playerIds: string[]; teamIds: string[] }>;
  try {
    await client.query('begin read only');
    isolationBefore = await measurePostgres(client);
    for (const season of SEASON_AVERAGES_TARGET_SEASONS) {
      targets[season] = await loadSeasonTargets(client, season);
    }
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
  if (isolationBefore.unexpectedServing.length > 0) {
    throw new Error(`Safety stop: unexpected serving ${JSON.stringify(isolationBefore.unexpectedServing)}`);
  }
  if (!delay.trialMode || delay.delayMs < 12000 || delay.concurrency !== 1) {
    throw new Error('Safety stop: trial limiter not 13s / concurrency 1');
  }
  for (const season of SEASON_AVERAGES_TARGET_SEASONS) {
    if (targets[season].playerIds.length === 0) {
      throw new Error(`Safety stop: no player IDs for season ${season}`);
    }
    if (targets[season].teamIds.length !== EXPECTED_TEAMS) {
      throw new Error(
        `Safety stop: season ${season} teams=${targets[season].teamIds.length} expected ${EXPECTED_TEAMS}`
      );
    }
  }

  const jobs = buildJobs(targets);
  const projectedHttp = jobs.length;
  const projectedMs = projectedHttp * delay.delayMs;
  const projectedMinutes = round(projectedMs / 60000, 2);
  if ((projectedMs ?? 0) > SEASON_AVERAGES_MAX_PROVIDER_MS) {
    throw new Error(
      `Safety stop: projected ${projectedMinutes} min exceeds 90 min cap (jobs=${jobs.length})`
    );
  }

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
    seasonAveragesServingTables: isolationBefore.unexpectedServing,
    acquisitionWritesPostgres: false,
  };

  const archiveAllowlist = {
    source: 'reports/trial/season-averages-characterization.json',
    rule: 'Only category/type pairs Step 9B characterized and rated uniquely useful. Untested estimate types excluded.',
    player: TARGETED_PLAYER_ALLOWLIST,
    team: TARGETED_TEAM_ALLOWLIST,
    exclusions: TARGETED_SEASON_AVERAGES_EXCLUSIONS,
    seasons: SEASON_AVERAGES_TARGET_SEASONS,
    seasonType: SEASON_AVERAGES_SEASON_TYPE,
    playerBatchSize: SEASON_AVERAGES_PLAYER_BATCH_SIZE,
  };

  const playerTeamTargetCounts = Object.fromEntries(
    SEASON_AVERAGES_TARGET_SEASONS.map((s) => [
      s,
      { players: targets[s].playerIds.length, teams: targets[s].teamIds.length },
    ])
  );

  const dryRunEstimate = {
    jobs: jobs.length,
    projectedHttp,
    projectedPages: projectedHttp,
    projectedMs,
    projectedMinutes,
    step9bEstimate: { http: STEP9B_HTTP_ESTIMATE, minutes: STEP9B_MINUTES_ESTIMATE, s3Mb: STEP9B_MB_ESTIMATE },
    deviationNote:
      'Below the 189 HTTP estimate because untested 9B estimate types (spotup/transition/catchshoot/pullups/by_zone_base/extra team playtypes) are excluded. 100-player batches should be 1 page each.',
    maxProviderMinutes: 90,
    requests: jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      season: j.season,
      category: j.category,
      type: j.type,
      batchIndex: j.batchIndex,
      entityCount: j.entityIds.length,
      path: j.path,
      expectedPages: 1,
      s3Prefix: j.s3Prefix,
    })),
  };

  console.log(
    JSON.stringify(
      {
        safety,
        archiveAllowlist,
        playerTeamTargetCounts,
        targets: {
          2023: targets[2023],
          2024: targets[2024],
          2025: targets[2025],
        },
        dryRunEstimate: { ...dryRunEstimate, requests: `[${jobs.length} jobs printed below]` },
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ completeArchivePlan: dryRunEstimate.requests }, null, 2));

  if (dryRun && !execute) {
    console.log('[dry-run] no season-averages archive HTTP.');
    await pool.end().catch(() => undefined);
    return;
  }

  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });
  const bdl = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });

  const pagesOut: PageArchive[] = [];
  const comboRows = new Map<string, Json[]>();
  const comboPages = new Map<string, number>();
  const comboComplete = new Map<string, boolean>();
  let consecutiveFailures = 0;
  let stoppedReason: string | null = null;
  const wallStart = Date.now();
  let httpN = 0;

  try {
    for (const job of jobs) {
      if (Date.now() - wallStart > SEASON_AVERAGES_MAX_PROVIDER_MS) {
        stoppedReason = 'wall clock exceeded 90 minutes';
        break;
      }
      const ck = comboKey(job.kind, job.season, job.category, job.type);
      if (!comboRows.has(ck)) comboRows.set(ck, []);
      if (!comboComplete.has(ck)) comboComplete.set(ck, true);

      const firstKey = seasonAveragesCanonicalPageKey({
        kind: job.kind,
        season: job.season,
        category: job.category,
        type: job.type,
        batchIndex: job.batchIndex,
        pageIndex: 1,
      });
      if (await s3.objectExists(firstKey)) {
        for (let pageIndex = 1; pageIndex <= SEASON_AVERAGES_MAX_PAGES_PER_BATCH; pageIndex += 1) {
          const key = seasonAveragesCanonicalPageKey({
            kind: job.kind,
            season: job.season,
            category: job.category,
            type: job.type,
            batchIndex: job.batchIndex,
            pageIndex,
          });
          if (!(await s3.objectExists(key))) break;
          const existing = await s3.getJson<Json>(key);
          const body = asObj(existing?.body) as BdlEnvelope | null;
          const data = Array.isArray(body?.data) ? (body!.data as Json[]) : [];
          const hasMore = existing?.hasMore === true;
          comboRows.get(ck)!.push(...data);
          comboPages.set(ck, (comboPages.get(ck) ?? 0) + 1);
          pagesOut.push({
            jobId: job.id,
            key,
            pageIndex,
            rows: data.length,
            hasMore,
            skipped: true,
            written: false,
          });
          if (!hasMore) break;
        }
        continue;
      }

      if (httpN > 0) await sleep(delay.delayMs);
      const params: Record<string, string | number | string[]> = {
        season: job.season,
        season_type: SEASON_AVERAGES_SEASON_TYPE,
        type: job.type,
      };
      if (job.kind === 'player') params['player_ids[]'] = job.entityIds;
      else params['team_ids[]'] = job.entityIds;

      try {
        let pageCount = 0;
        for await (const page of bdl.paginate({
          path: job.path,
          params,
          paginationStyle: 'cursor',
          perPage: 100,
        })) {
          pageCount += 1;
          httpN += 1;
          if (pageCount > SEASON_AVERAGES_MAX_PAGES_PER_BATCH) {
            stoppedReason = `job ${job.id} exceeded ${SEASON_AVERAGES_MAX_PAGES_PER_BATCH} pages (possible unfiltered crawl)`;
            comboComplete.set(ck, false);
            break;
          }
          const key = seasonAveragesCanonicalPageKey({
            kind: job.kind,
            season: job.season,
            category: job.category,
            type: job.type,
            batchIndex: job.batchIndex,
            pageIndex: page.pageIndex,
          });
          const data = Array.isArray(page.body.data) ? (page.body.data as Json[]) : [];
          comboRows.get(ck)!.push(...data);
          comboPages.set(ck, (comboPages.get(ck) ?? 0) + 1);
          if (page.hasMore && pageCount >= SEASON_AVERAGES_MAX_PAGES_PER_BATCH) {
            comboComplete.set(ck, false);
          }
          await archiveJsonObjectToS3({
            s3,
            key,
            overwrite: true,
            body: {
              request: {
                path: job.path,
                url: page.url,
                season: job.season,
                season_type: SEASON_AVERAGES_SEASON_TYPE,
                category: job.category,
                type: job.type,
                entityIds: job.entityIds,
                batchIndex: job.batchIndex,
                pageIndex: page.pageIndex,
              },
              fetchedAt: new Date().toISOString(),
              hasMore: page.hasMore,
              body: page.body,
            },
          });
          pagesOut.push({
            jobId: job.id,
            key,
            pageIndex: page.pageIndex,
            rows: data.length,
            hasMore: page.hasMore,
            skipped: false,
            written: true,
          });
        }
        consecutiveFailures = 0;
        writeJson(PROGRESS_JSON, {
          updatedAt: new Date().toISOString(),
          lastJobId: job.id,
          httpN,
          pages: pagesOut.length,
          stoppedReason,
        });
        if (stoppedReason) break;
      } catch (err) {
        consecutiveFailures += 1;
        console.error(`[season-averages-9c] FAIL ${job.id} ${err instanceof Error ? err.message : String(err)}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stoppedReason = `${MAX_CONSECUTIVE_FAILURES} consecutive failures`;
          break;
        }
      }
    }
  } finally {
    lock.release();
  }

  const metrics = bdl.getMetrics();
  const spacing = metrics.spacingSamplesMs;
  const certs: ComboCert[] = [];
  for (const season of SEASON_AVERAGES_TARGET_SEASONS) {
    for (const combo of TARGETED_PLAYER_ALLOWLIST) {
      const ck = comboKey('player', season, combo.category, combo.type);
      certs.push(
        certifyCombo(
          'player',
          season,
          combo.category,
          combo.type,
          targets[season].playerIds,
          comboRows.get(ck) ?? [],
          comboPages.get(ck) ?? 0,
          comboComplete.get(ck) ?? false
        )
      );
    }
    for (const combo of TARGETED_TEAM_ALLOWLIST) {
      const ck = comboKey('team', season, combo.category, combo.type);
      certs.push(
        certifyCombo(
          'team',
          season,
          combo.category,
          combo.type,
          targets[season].teamIds,
          comboRows.get(ck) ?? [],
          comboPages.get(ck) ?? 0,
          comboComplete.get(ck) ?? true
        )
      );
    }
  }

  const coverageClient = await pool.connect();
  const missingNotes: Json[] = [];
  try {
    await coverageClient.query('begin read only');
    const bySeasonMissing = new Map<TargetedSeason, Set<string>>();
    for (const c of certs.filter((x) => x.kind === 'player' && x.missingIds.length > 0)) {
      const set = bySeasonMissing.get(c.season) ?? new Set<string>();
      for (const id of c.missingIds) set.add(id);
      bySeasonMissing.set(c.season, set);
    }
    for (const [season, idSet] of bySeasonMissing) {
      const ids = [...idSet].slice(0, 80);
      const activity = await missingPlayerActivity(coverageClient, season, ids);
      missingNotes.push({
        season,
        missingDistinctAcrossCombos: idSet.size,
        sampledForGp: ids.length,
        medianLogGp: activity.medianGp,
        lowUsageHint: activity.medianGp != null && activity.medianGp <= 15,
        sample: activity.sample.slice(0, 8),
      });
    }
    await coverageClient.query('commit');
  } catch (err) {
    await coverageClient.query('rollback').catch(() => undefined);
    console.error('[season-averages-9c] missing-player notes failed', err);
  } finally {
    coverageClient.release();
  }

  const schemaPairs: Json[] = [];
  for (const kind of ['player', 'team'] as const) {
    const combos = kind === 'player' ? TARGETED_PLAYER_ALLOWLIST : TARGETED_TEAM_ALLOWLIST;
    for (const combo of combos) {
      const y23 = certs.find((c) => c.kind === kind && c.season === 2023 && c.category === combo.category && c.type === combo.type);
      const y24 = certs.find((c) => c.kind === kind && c.season === 2024 && c.category === combo.category && c.type === combo.type);
      const y25 = certs.find((c) => c.kind === kind && c.season === 2025 && c.category === combo.category && c.type === combo.type);
      if (!y23 || !y24 || !y25) continue;
      const d2324 = fieldDiff(y23.fieldNames, y24.fieldNames);
      const d2425 = fieldDiff(y24.fieldNames, y25.fieldNames);
      schemaPairs.push({
        kind,
        category: combo.category,
        type: combo.type,
        identical232425:
          d2324.added.length === 0 &&
          d2324.removed.length === 0 &&
          d2425.added.length === 0 &&
          d2425.removed.length === 0,
        vs2023_2024: d2324,
        vs2024_2025: d2425,
        coverage: { 2023: y23.coveragePct, 2024: y24.coveragePct, 2025: y25.coveragePct },
        fieldCounts: { 2023: y23.fieldNames.length, 2024: y24.fieldNames.length, 2025: y25.fieldNames.length },
      });
    }
  }

  const playerSize = await listCanonicalSize(s3, PLAYER_SEASON_AVERAGES_CANONICAL_PREFIX);
  const teamSize = await listCanonicalSize(s3, TEAM_SEASON_AVERAGES_CANONICAL_PREFIX);
  const totalRecords = certs.reduce((s, c) => s + c.rows, 0);
  const totalBytes = playerSize.bytes + teamSize.bytes;
  const totalMb = round(totalBytes / (1024 * 1024), 2);

  const generatedAt = new Date().toISOString();
  const elapsedHours = round(hoursSinceTrialStart(generatedAt), 3);
  const remainingHours = round(48 - (elapsedHours ?? 0), 3);

  const grainDuplicates = certs.reduce((s, c) => s + c.duplicates, 0);
  const teamCoverageMin = Math.min(
    ...certs.filter((c) => c.kind === 'team').map((c) => c.coveragePct ?? 0)
  );
  const playerPlaytypeCoverage = certs
    .filter((c) => c.kind === 'player' && c.category === 'playtype')
    .map((c) => c.coveragePct ?? 0);
  const schemaOk = schemaPairs.every((p) => p.identical232425 === true);
  const paginationOk = certs.every((c) => c.paginationComplete && c.pages > 0);
  const nullIds = certs.reduce((s, c) => s + c.nullIdentity, 0);

  let archiveVerdict: 'HIGH_VALUE_TARGET_ARCHIVE_COMPLETE' | 'ARCHIVE_COMPLETE_WITH_LIMITATIONS' | 'TARGET_ARCHIVE_LOW_VALUE' =
    'HIGH_VALUE_TARGET_ARCHIVE_COMPLETE';
  if (stoppedReason || !paginationOk || grainDuplicates > 0 || nullIds > 0 || teamCoverageMin < 100) {
    archiveVerdict = 'ARCHIVE_COMPLETE_WITH_LIMITATIONS';
  }
  if (certs.every((c) => c.rows === 0) || (playerPlaytypeCoverage.length && Math.max(...playerPlaytypeCoverage) < 20)) {
    archiveVerdict = 'TARGET_ARCHIVE_LOW_VALUE';
  }
  if (!schemaOk && archiveVerdict === 'HIGH_VALUE_TARGET_ARCHIVE_COMPLETE') {
    archiveVerdict = 'ARCHIVE_COMPLETE_WITH_LIMITATIONS';
  }

  const stepVerdict =
    archiveVerdict === 'HIGH_VALUE_TARGET_ARCHIVE_COMPLETE'
      ? 'GREEN — targeted Season Averages archive complete and product-useful'
      : archiveVerdict === 'ARCHIVE_COMPLETE_WITH_LIMITATIONS'
        ? 'YELLOW — archive complete but useful scope remains narrow'
        : 'RED — targeted archive did not justify its acquisition';

  const isolationAfterClient = await pool.connect();
  let isolationAfter: Awaited<ReturnType<typeof measurePostgres>>;
  try {
    await isolationAfterClient.query('begin read only');
    isolationAfter = await measurePostgres(isolationAfterClient);
    await isolationAfterClient.query('commit');
  } catch (err) {
    await isolationAfterClient.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    isolationAfterClient.release();
  }

  const playerCoverage = certs
    .filter((c) => c.kind === 'player')
    .map((c) => ({
      season: c.season,
      category: c.category,
      type: c.type,
      targeted: c.targeted,
      returned: c.uniqueEntities,
      missing: c.missingIds.length,
      coveragePct: c.coveragePct,
      missingIdsSample: c.missingIds.slice(0, 25),
    }));
  const teamCoverage = certs
    .filter((c) => c.kind === 'team')
    .map((c) => ({
      season: c.season,
      category: c.category,
      type: c.type,
      targeted: c.targeted,
      returned: c.uniqueEntities,
      missing: c.missingIds.length,
      coveragePct: c.coveragePct,
      missingIds: c.missingIds,
    }));

  const manifest = {
    schemaVersion: 1,
    archiveKind: 'targeted_high_value',
    notCompleteBdlDump: true,
    seasons: SEASON_AVERAGES_TARGET_SEASONS,
    seasonType: SEASON_AVERAGES_SEASON_TYPE,
    allowlist: { player: TARGETED_PLAYER_ALLOWLIST, team: TARGETED_TEAM_ALLOWLIST },
    exclusions: TARGETED_SEASON_AVERAGES_EXCLUSIONS,
    playerTargetMethodology:
      'Distinct analytics.player_game_logs.player_id per season (BDL provider IDs). Batched player_ids[] <= 100. Never unfiltered.',
    teamTargetMethodology: 'Distinct home/away analytics.games.team_id per season. Expected 30 teams.',
    grain: {
      player: '(season, season_type, player_id, category, type)',
      team: '(season, season_type, team_id, category, type)',
      seasonGrainAggregates: true,
    },
    limitations: [
      'Season grain cannot describe a player role on a specific game/date.',
      'Cannot alone identify post-injury role change.',
      'Play-type gp is qualifying games for that type, not season GP.',
      'general/advanced and shot dashboards intentionally absent.',
    ],
    requestPageCounts: { jobs: jobs.length, pages: pagesOut.length, httpAttempts: metrics.httpAttempts },
    recordCounts: { total: totalRecords, byCombo: certs.map((c) => ({ key: comboKey(c.kind, c.season, c.category, c.type), rows: c.rows })) },
    generatedAt,
  };

  await archiveJsonObjectToS3({
    s3,
    key: 'raw/source=balldontlie/league=nba/entity=season_averages/_manifest.json',
    overwrite: true,
    body: { ...manifest, entity: 'season_averages' },
  });
  await archiveJsonObjectToS3({
    s3,
    key: 'raw/source=balldontlie/league=nba/entity=team_season_averages/_manifest.json',
    overwrite: true,
    body: { ...manifest, entity: 'team_season_averages' },
  });

  const report: Json = {
    generatedAt,
    step: '9C',
    startedPlays: false,
    started2022: false,
    postgresWrites: false,
    safety,
    archiveAllowlist,
    playerTeamTargetCounts,
    targets: { 2023: targets[2023], 2024: targets[2024], 2025: targets[2025] },
    dryRunEstimate: {
      jobs: jobs.length,
      projectedHttp,
      projectedPages: projectedHttp,
      projectedMinutes,
      step9bEstimate: dryRunEstimate.step9bEstimate,
      deviationNote: dryRunEstimate.deviationNote,
    },
    acquisitionResult: {
      plannedHttp: projectedHttp,
      httpAttempts: metrics.httpAttempts,
      httpSuccess: metrics.httpSuccess,
      pages: pagesOut.length,
      skippedExisting: pagesOut.filter((p) => p.skipped).length,
      status429: metrics.status429,
      retries: metrics.retries,
      retryAfterUsed: metrics.retryAfterUsed,
      wallClockMs: Date.now() - wallStart,
      minimumMs: spacing.length ? Math.min(...spacing) : null,
      averageMs: spacing.length ? round(spacing.reduce((a, b) => a + b, 0) / spacing.length, 1) : null,
      maximumMs: spacing.length ? Math.max(...spacing) : null,
      stoppedReason,
      consecutiveFailuresAtEnd: consecutiveFailures,
    },
    recordGrain: {
      player: '(season, season_type, player_id, category, type)',
      team: '(season, season_type, team_id, category, type)',
      duplicates: grainDuplicates,
      nullIdentity: nullIds,
      nullStats: certs.reduce((s, c) => s + c.nullStats, 0),
      verifiedFromResponses: true,
    },
    playerCoverage,
    playerCoverageMissingNotes: missingNotes,
    teamCoverage,
    historicalSchemaConsistency: schemaPairs,
    playTypeCertification: playtypeFieldSummary(certs),
    trackingCertification: certs
      .filter((c) => c.category === 'tracking')
      .map((c) => ({
        key: comboKey(c.kind, c.season, c.category, c.type),
        fieldNames: c.fieldNames,
        alwaysZeroFields: c.alwaysZeroFields,
        coveragePct: c.coveragePct,
        rows: c.rows,
      })),
    zoneShootingCertification: zoneFieldSummary(certs),
    comboCertification: certs.map((c) => ({
      kind: c.kind,
      season: c.season,
      category: c.category,
      type: c.type,
      rows: c.rows,
      uniqueEntities: c.uniqueEntities,
      duplicates: c.duplicates,
      nullIdentity: c.nullIdentity,
      nullStats: c.nullStats,
      fieldNames: c.fieldNames,
      pages: c.pages,
      paginationComplete: c.paginationComplete,
      targeted: c.targeted,
      returned: c.uniqueEntities,
      missing: c.missingIds.length,
      coveragePct: c.coveragePct,
      alwaysZeroFields: c.alwaysZeroFields,
      missingIdsSample: c.missingIds.slice(0, 25),
    })),
    s3Certification: {
      playerPrefix: 'raw/source=balldontlie/league=nba/entity=season_averages/',
      teamPrefix: 'raw/source=balldontlie/league=nba/entity=team_season_averages/',
      characterizationExcluded: true,
      manifests: [
        'raw/source=balldontlie/league=nba/entity=season_averages/_manifest.json',
        'raw/source=balldontlie/league=nba/entity=team_season_averages/_manifest.json',
      ],
    },
    productLimitations: {
      seasonGrain: 'Cannot describe role on one game/date.',
      opportunityCheck: 'Cannot alone identify post-injury role change.',
      generalAdvanced: 'Intentionally excluded as redundant.',
      shotDashboards: 'Untested types remain absent.',
      playTypeGp: 'gp is qualifying games for that play type, not season GP.',
    },
    productReadiness: {
      roleProfile: {
        readiness: 'strong_season_level',
        note: 'Play types + drives/passing + by_zone across 2023–2025.',
      },
      matchupProfile: {
        readiness: 'useful',
        note: 'Team isolation + possessions + by_zone_opponent. No matchup score built.',
      },
      historicalExplorer: { readiness: 'useful', note: 'Season profiles for archived allowlist only.' },
      opportunityCheck: { readiness: 'limited', note: 'Season grain only.' },
      marketPlusContext: { readiness: 'later', note: 'Not combined with props in this step.' },
    },
    s3Size: {
      playerObjects: playerSize.objects,
      playerBytes: playerSize.bytes,
      teamObjects: teamSize.objects,
      teamBytes: teamSize.bytes,
      totalRecords,
      totalBytes,
      totalMb,
      step9bEstimateMb: STEP9B_MB_ESTIMATE,
      varianceNote:
        totalMb != null && totalMb > STEP9B_MB_ESTIMATE * 2
          ? 'Larger than 12 MB estimate because full-season player universes replace the 5-player characterization sample.'
          : 'Near or below the 12 MB characterization-based estimate; full-season objects remain small.',
    },
    trialTimeRemaining: {
      elapsedHours,
      remainingHours,
      protectedReserveHours: 6,
      usableRemainingHours: round((remainingHours ?? 0) - 6, 3),
    },
    postgresUnchangedConfirmation: {
      expectedBytes: EXPECTED_DB_BYTES,
      dbBytesAfter: isolationAfter.dbBytes,
      unchanged: isolationAfter.dbBytes === EXPECTED_DB_BYTES,
      unexpectedServing: isolationAfter.unexpectedServing,
    },
    archiveVerdict,
    stepVerdict,
  };

  writeJson(REPORT_JSON, report);
  writeFileSync(REPORT_MD, renderMd(report));
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_JSON,
        archiveVerdict,
        stepVerdict,
        httpAttempts: metrics.httpAttempts,
        pages: pagesOut.length,
        totalRecords,
        totalMb,
        postgresUnchanged: isolationAfter.dbBytes === EXPECTED_DB_BYTES,
        startedPlays: false,
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
