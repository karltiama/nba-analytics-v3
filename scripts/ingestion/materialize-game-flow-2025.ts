/**
 * Step 12G: certified 2025 Plays archive → analytics.game_flow.
 * Read-only S3. No BDL HTTP. One compact row/game. No raw event JSON.
 *
 *   npx tsx scripts/ingestion/materialize-game-flow-2025.ts --dry-run
 *   npx tsx scripts/ingestion/materialize-game-flow-2025.ts --execute --i-understand-production-write
 *   npx tsx scripts/ingestion/materialize-game-flow-2025.ts --certify-only
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { S3Storage } from '@/lib/aws/s3';
import { plays2025CanonicalPrefix } from '@/lib/archive/plays';
import {
  gameIdFromCanonicalPlaysKey,
  readCanonicalPlaysObject,
} from '@/lib/archive/plays-2025-read';
import {
  PLAYS_2025_SCORE_MISMATCH_IDS,
  PLAYS_2025_STARTER_ANOMALY_IDS,
  buildGameFlowSummary,
  classifyScoreMismatchStream,
  HISTORICAL_TIMELINE_SEASON,
  HISTORICAL_TIMELINE_SOURCE,
  normalizePlayEvents,
  type GameFlowSummary,
} from '@/lib/betting/historical-timeline';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';

const EXPECTED_GAMES = 1322;
const OUT_JSON = 'reports/trial/game-flow-2025-materialize.json';
const CONCURRENCY = 8;
const VERIFY_GAME_IDS = [
  '18447937', // normal regulation Final
  '18446819', // overtime
  '18446930', // rotation failure, score likely exact
  '18447931', // starter anomaly
  '18447390', // truncated score mismatch
  '18446874', // small score mismatch
] as const;

function parseFlags(argv: string[]) {
  const execute = argv.includes('--execute');
  const certifyOnly = argv.includes('--certify-only');
  const confirm = argv.includes('--i-understand-production-write');
  const dryRun = argv.includes('--dry-run') || (!execute && !certifyOnly);
  return { execute, certifyOnly, confirm, dryRun };
}

async function dbBytes(): Promise<number> {
  const r = await pool.query<{ n: string }>(`select pg_database_size(current_database())::text as n`);
  return Number(r.rows[0]?.n ?? 0);
}

async function tableBytes(): Promise<{ heap: number; indexes: number; total: number }> {
  const r = await pool.query<{ heap: string; indexes: string; total: string }>(
    `select
       coalesce(pg_table_size('analytics.game_flow'), 0)::text as heap,
       coalesce(pg_indexes_size('analytics.game_flow'), 0)::text as indexes,
       coalesce(pg_total_relation_size('analytics.game_flow'), 0)::text as total`
  );
  return {
    heap: Number(r.rows[0]?.heap ?? 0),
    indexes: Number(r.rows[0]?.indexes ?? 0),
    total: Number(r.rows[0]?.total ?? 0),
  };
}

async function upsertFlow(row: GameFlowSummary): Promise<number> {
  const result = await pool.query(
    `insert into analytics.game_flow (
       game_id, season, source,
       timeline_available, score_reconciled, stream_complete, stream_class, quality_code,
       plays_final_home, plays_final_away,
       event_count, period_count, overtime_count,
       lead_changes, ties, largest_home_lead, largest_away_lead,
       largest_home_run, largest_away_run,
       home_points_by_period, away_points_by_period,
       rotation_available, rotation_failure_class
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
     )
     on conflict on constraint game_flow_pk do update set
       season = excluded.season,
       source = excluded.source,
       timeline_available = excluded.timeline_available,
       score_reconciled = excluded.score_reconciled,
       stream_complete = excluded.stream_complete,
       stream_class = excluded.stream_class,
       quality_code = excluded.quality_code,
       plays_final_home = excluded.plays_final_home,
       plays_final_away = excluded.plays_final_away,
       event_count = excluded.event_count,
       period_count = excluded.period_count,
       overtime_count = excluded.overtime_count,
       lead_changes = excluded.lead_changes,
       ties = excluded.ties,
       largest_home_lead = excluded.largest_home_lead,
       largest_away_lead = excluded.largest_away_lead,
       largest_home_run = excluded.largest_home_run,
       largest_away_run = excluded.largest_away_run,
       home_points_by_period = excluded.home_points_by_period,
       away_points_by_period = excluded.away_points_by_period,
       rotation_available = excluded.rotation_available,
       rotation_failure_class = excluded.rotation_failure_class,
       updated_at = now()
     where analytics.game_flow.season is distinct from excluded.season
        or analytics.game_flow.source is distinct from excluded.source
        or analytics.game_flow.timeline_available is distinct from excluded.timeline_available
        or analytics.game_flow.score_reconciled is distinct from excluded.score_reconciled
        or analytics.game_flow.stream_complete is distinct from excluded.stream_complete
        or analytics.game_flow.stream_class is distinct from excluded.stream_class
        or analytics.game_flow.quality_code is distinct from excluded.quality_code
        or analytics.game_flow.plays_final_home is distinct from excluded.plays_final_home
        or analytics.game_flow.plays_final_away is distinct from excluded.plays_final_away
        or analytics.game_flow.event_count is distinct from excluded.event_count
        or analytics.game_flow.period_count is distinct from excluded.period_count
        or analytics.game_flow.overtime_count is distinct from excluded.overtime_count
        or analytics.game_flow.lead_changes is distinct from excluded.lead_changes
        or analytics.game_flow.ties is distinct from excluded.ties
        or analytics.game_flow.largest_home_lead is distinct from excluded.largest_home_lead
        or analytics.game_flow.largest_away_lead is distinct from excluded.largest_away_lead
        or analytics.game_flow.largest_home_run is distinct from excluded.largest_home_run
        or analytics.game_flow.largest_away_run is distinct from excluded.largest_away_run
        or analytics.game_flow.home_points_by_period is distinct from excluded.home_points_by_period
        or analytics.game_flow.away_points_by_period is distinct from excluded.away_points_by_period
        or analytics.game_flow.rotation_available is distinct from excluded.rotation_available
        or analytics.game_flow.rotation_failure_class is distinct from excluded.rotation_failure_class`,
    [
      row.gameId,
      row.season,
      row.source,
      row.timelineAvailable,
      row.scoreReconciled,
      row.streamComplete,
      row.streamClass,
      row.qualityCode,
      row.playsFinalHome,
      row.playsFinalAway,
      row.eventCount,
      row.periodCount,
      row.overtimeCount,
      row.leadChanges,
      row.ties,
      row.largestHomeLead,
      row.largestAwayLead,
      row.largestHomeRun,
      row.largestAwayRun,
      row.homePointsByPeriod,
      row.awayPointsByPeriod,
      row.rotationAvailable,
      row.rotationFailureClass,
    ]
  );
  return result.rowCount ?? 0;
}

async function loadOfficialScores(gameIds: string[]) {
  const r = await pool.query<{
    game_id: string;
    season: string | null;
    home_score: number | null;
    away_score: number | null;
  }>(
    `select game_id, season::text as season, home_score, away_score
     from analytics.games
     where game_id = any($1::text[])`,
    [gameIds]
  );
  return new Map(r.rows.map((row) => [row.game_id, row]));
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]!);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function listCanonicalGameIds(s3: S3Storage): Promise<string[]> {
  const prefix = plays2025CanonicalPrefix();
  const ids: string[] = [];
  for await (const obj of s3.listByPrefix(prefix)) {
    const id = gameIdFromCanonicalPlaysKey(obj.key);
    if (id) ids.push(id);
  }
  ids.sort();
  return ids;
}

function flowFromRead(input: {
  gameId: string;
  rows: Record<string, unknown>[];
  officialHome: number | null;
  officialAway: number | null;
  season: string;
}): GameFlowSummary {
  const { events, orderMalformed } = normalizePlayEvents(input.rows, input.gameId);
  return buildGameFlowSummary({
    gameId: input.gameId,
    season: input.season,
    events,
    orderMalformed,
    officialHome: input.officialHome,
    officialAway: input.officialAway,
  });
}

async function loadServingCertification() {
  const totals = await pool.query<{
    n: string;
    timeline: string;
    score: string;
    rotation: string;
    truncated: string;
    mismatch: string;
  }>(
    `select
       count(*)::text as n,
       count(*) filter (where timeline_available)::text as timeline,
       count(*) filter (where score_reconciled)::text as score,
       count(*) filter (where rotation_available)::text as rotation,
       count(*) filter (where stream_class = 'truncated')::text as truncated,
       count(*) filter (where quality_code = 'SCORE_MISMATCH')::text as mismatch
     from analytics.game_flow`
  );
  const mismatchRows = await pool.query<{
    game_id: string;
    stream_class: string;
    quality_code: string;
    timeline_available: boolean;
    plays_final_home: number | null;
    plays_final_away: number | null;
    event_count: number;
  }>(
    `select game_id, stream_class, quality_code, timeline_available,
            plays_final_home, plays_final_away, event_count
     from analytics.game_flow
     where game_id = any($1::text[])
     order by game_id`,
    [[...PLAYS_2025_SCORE_MISMATCH_IDS]]
  );
  const samples = await pool.query(
    `select game_id, timeline_available, score_reconciled, rotation_available,
            stream_class, quality_code, event_count, period_count, overtime_count,
            lead_changes, ties, largest_home_lead, largest_away_lead
     from analytics.game_flow
     where game_id = any($1::text[])
     order by game_id`,
    [[...VERIFY_GAME_IDS]]
  );
  const row = totals.rows[0];
  return {
    totalRows: Number(row?.n ?? 0),
    timelineAvailable: Number(row?.timeline ?? 0),
    scoreReconciled: Number(row?.score ?? 0),
    rotationAvailable: Number(row?.rotation ?? 0),
    truncated: Number(row?.truncated ?? 0),
    scoreMismatchQuality: Number(row?.mismatch ?? 0),
    certifiedMismatchIds: [...PLAYS_2025_SCORE_MISMATCH_IDS],
    mismatchServing: mismatchRows.rows,
    verifySamples: samples.rows,
  };
}

async function certifyOnly() {
  const serving = await loadServingCertification();
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'certify-only',
    source: HISTORICAL_TIMELINE_SOURCE,
    serving,
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const mode = readIngestionMode();
  const generatedAt = new Date().toISOString();
  const bytesBefore = await dbBytes();
  const tableBefore = await tableBytes();

  if (mode.dataMode !== 'replay') {
    throw new Error(`Safety stop: DATA_MODE=${mode.dataMode || '(empty)'} (require replay)`);
  }
  if (flags.execute && flags.certifyOnly) {
    throw new Error('Safety stop: use either --execute or --certify-only');
  }
  if (flags.execute && !flags.confirm) {
    throw new Error('Safety stop: --execute requires --i-understand-production-write');
  }
  if (flags.certifyOnly) {
    await certifyOnly();
    return;
  }

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });

  const gameIds = await listCanonicalGameIds(s3);
  const official = await loadOfficialScores(gameIds);
  const missingOfficial: string[] = [];
  const candidates: GameFlowSummary[] = [];
  let readErrors = 0;
  let perfMs: number | null = null;

  const t0 = performance.now();
  await mapPool(gameIds, CONCURRENCY, async (gameId) => {
    const game = official.get(gameId);
    if (!game) {
      missingOfficial.push(gameId);
      return;
    }
    const started = gameId === '18447937' ? performance.now() : null;
    const read = await readCanonicalPlaysObject(s3, gameId);
    if (started != null) perfMs = Math.round(performance.now() - started);
    if (!read.ok) {
      readErrors += 1;
      return;
    }
    candidates.push(
      flowFromRead({
        gameId,
        rows: read.rows,
        officialHome: game.home_score,
        officialAway: game.away_score,
        season: game.season || HISTORICAL_TIMELINE_SEASON,
      })
    );
  });
  const scanMs = Math.round(performance.now() - t0);

  candidates.sort((a, b) => a.gameId.localeCompare(b.gameId));

  let written = 0;
  if (flags.execute) {
    for (const row of candidates) written += await upsertFlow(row);
  }

  const bytesAfter = await dbBytes();
  const tableAfter = await tableBytes();
  const serving = flags.execute ? await loadServingCertification() : null;

    const mismatchClass = candidates
    .filter((row) => (PLAYS_2025_SCORE_MISMATCH_IDS as readonly string[]).includes(row.gameId))
    .map((row) => ({
      gameId: row.gameId,
      classification: classifyScoreMismatchStream(row.streamClass),
      streamClass: row.streamClass,
      timelineAvailable: row.timelineAvailable,
      scoreReconciled: row.scoreReconciled,
      playsFinalHome: row.playsFinalHome,
      playsFinalAway: row.playsFinalAway,
      eventCount: row.eventCount,
      officialHome: official.get(row.gameId)?.home_score ?? null,
      officialAway: official.get(row.gameId)?.away_score ?? null,
    }));

  const report = {
    generatedAt,
    mode: flags.execute ? 'execute' : 'dry-run',
    source: HISTORICAL_TIMELINE_SOURCE,
    safety: {
      dataMode: mode.dataMode,
      offseasonMode: mode.offseason ? '1' : '0',
      cronDryRun: mode.cronDryRun ? '1' : '0',
      bdlHttp: 0,
    },
    archiveObjects: gameIds.length,
    expectedGames: EXPECTED_GAMES,
    candidateRows: candidates.length,
    missingOfficial,
    readErrors,
    written,
    coverage: {
      timelineAvailable: candidates.filter((r) => r.timelineAvailable).length,
      scoreReconciled: candidates.filter((r) => r.scoreReconciled).length,
      rotationAvailable: candidates.filter((r) => r.rotationAvailable).length,
      truncated: candidates.filter((r) => r.streamClass === 'truncated').length,
      uncertain: candidates.filter((r) => r.streamClass === 'uncertain').length,
      starterAnomalies: PLAYS_2025_STARTER_ANOMALY_IDS.length,
    },
    mismatchClass,
    verify: VERIFY_GAME_IDS.map((id) => candidates.find((r) => r.gameId === id) ?? { gameId: id, missing: true }),
    performance: {
      scanMs,
      oneGameGetObjectNormalizeMs: perfMs,
      concurrency: CONCURRENCY,
    },
    storage: {
      dbBytesBefore: bytesBefore,
      dbBytesAfter: bytesAfter,
      dbDelta: bytesAfter - bytesBefore,
      tableBefore,
      tableAfter,
    },
    serving,
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
