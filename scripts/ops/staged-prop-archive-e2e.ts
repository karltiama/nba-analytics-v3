/**
 * Staged archive E2E against real Postgres + S3.
 * Does not enable schedulers, does not write existing_ingestion,
 * does not upsert analytics current tables.
 *
 *   npx tsx scripts/ops/staged-prop-archive-e2e.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { archiveGameSnapshot } from '../../lambda/player-props-snapshot/src/archive-game';
import {
  bulkInsertRawV2,
  completeGameRun,
  createGameRun,
  createPullRun,
} from '../../lambda/player-props-snapshot/src/bulk-writers';
import type { LambdaEnv } from '../../lambda/player-props-snapshot/src/env';
import type { NormalizedPropRow } from '../../lambda/player-props-snapshot/src/types';
import { PlayerPropArchiveS3 } from '@/lib/archive/player-prop-snapshot-s3';
import {
  checksumCanonical,
  gunzipEnvelope,
  isProtectedHistoricalKey,
  mayPruneRawSnapshot,
} from '@/lib/archive/player-prop-snapshot-archive';
import {
  formatPropArchiveReconcileReport,
  summarizePropArchiveReconciliation,
  type ReconcileGameRun,
} from '@/lib/archive/reconcile-prop-archive';

export const SENTINEL_GAME_ID = '999000001';
export const SENTINEL_DATE = '2026-09-14';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function fixtureRows(): NormalizedPropRow[] {
  return [
    {
      game_id: Number(SENTINEL_GAME_ID),
      player_id: 77,
      player_name: 'Archive E2E',
      team_id: 14,
      sportsbook: 'draftkings',
      prop_type: 'points',
      market_type: 'over_under',
      side: 'over',
      line_value: 27.5,
      odds_american: -110,
      odds_decimal: 1.91,
      implied_probability: 0.524,
      raw_json: { vendor: 'DraftKings', staged_e2e: true, market_id: 'pts-ou' },
      provider_updated_at: new Date('2026-09-14T16:00:00.000Z'),
    },
    {
      game_id: Number(SENTINEL_GAME_ID),
      player_id: 77,
      player_name: 'Archive E2E',
      team_id: 14,
      sportsbook: 'draftkings',
      prop_type: 'points',
      market_type: 'over_under',
      side: 'under',
      line_value: 27.5,
      odds_american: -110,
      odds_decimal: 1.91,
      implied_probability: 0.524,
      raw_json: { vendor: 'DraftKings', staged_e2e: true, market_id: 'pts-ou' },
      provider_updated_at: new Date('2026-09-14T16:00:00.000Z'),
    },
  ];
}

async function main() {
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const dbUrl = requireEnv('SUPABASE_DB_URL');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com')
      ? { rejectUnauthorized: false }
      : undefined,
    max: 1,
  });
  const env: LambdaEnv = {
    dbUrl,
    apiKey: 'staged-e2e',
    preferredVendor: 'draftkings',
    storePropRawJson: false,
    propRawJsonSampleRate: 0,
    s3ArchiveEnabled: true,
    nbaDataBucket: bucket,
    nbaRawPrefix: (process.env.NBA_RAW_PREFIX || 'raw').trim(),
    awsRegion: process.env.AWS_REGION?.trim() || 'us-east-1',
  };
  const snapshotAt = new Date('2026-09-14T18:00:00.000Z');
  const gameStart = new Date('2026-09-14T23:30:00.000Z');
  const rows = fixtureRows();

  try {
    const pullRunId = await createPullRun(pool, [SENTINEL_GAME_ID]);
    await createGameRun(pool, pullRunId, SENTINEL_GAME_ID);
    await pool.query(
      `UPDATE raw.player_prop_game_runs
       SET started_at = $3
       WHERE pull_run_id = $1 AND game_id = $2`,
      [pullRunId, SENTINEL_GAME_ID, snapshotAt]
    );
    const stored = await bulkInsertRawV2(
      pool,
      rows,
      snapshotAt,
      { enabled: false, sampleRate: 0 },
      pullRunId
    );
    const archive = await archiveGameSnapshot({
      env,
      pullRunId,
      gameId: SENTINEL_GAME_ID,
      bdlGameId: Number(SENTINEL_GAME_ID),
      gameDate: SENTINEL_DATE,
      snapshotAt,
      gameStartTime: gameStart,
      season: '2026',
      opponentId: null,
      normalized: rows,
      rowsStored: stored,
    });
    await completeGameRun(pool, pullRunId, SENTINEL_GAME_ID, 'success', rows.length, stored, undefined, {
      rowsArchived: archive.rowsArchived,
      archiveObjectCount: archive.archiveObjectCount,
      archiveStatus: archive.archiveStatus,
      archiveError: archive.archiveError,
      archiveKey: archive.archiveKey,
    });

    const retry = await archiveGameSnapshot({
      env,
      pullRunId,
      gameId: SENTINEL_GAME_ID,
      bdlGameId: Number(SENTINEL_GAME_ID),
      gameDate: SENTINEL_DATE,
      snapshotAt,
      gameStartTime: gameStart,
      season: '2026',
      opponentId: null,
      normalized: rows,
      rowsStored: stored,
    });

    const failing = await archiveGameSnapshot({
      env,
      pullRunId: pullRunId + 1,
      gameId: SENTINEL_GAME_ID,
      bdlGameId: Number(SENTINEL_GAME_ID),
      gameDate: SENTINEL_DATE,
      snapshotAt: new Date('2026-09-14T19:00:00.000Z'),
      gameStartTime: gameStart,
      season: '2026',
      opponentId: null,
      normalized: rows,
      rowsStored: 2,
      store: {
        async head() {
          return null;
        },
        async get() {
          return null;
        },
        async put() {
          throw new Error('AccessDenied staged-e2e');
        },
      },
    });

    const s3 = new PlayerPropArchiveS3(bucket);
    const key = archive.archiveKey;
    if (!key) throw new Error('archive key missing');
    if (isProtectedHistoricalKey(key)) throw new Error('refused: protected prefix');
    const obj = await s3.get(key);
    if (!obj) throw new Error(`S3 object missing: ${key}`);
    const envelope = gunzipEnvelope(obj.body);
    const expectedChecksum = checksumCanonical({
      pull_run_id: envelope.pull_run_id,
      game_id: envelope.game_id,
      rows: envelope.rows,
    });

    const run = await pool.query(
      `SELECT pull_run_id, game_id, status, rows_fetched, rows_stored, rows_archived,
              archive_object_count, archive_status, archive_key, archive_error, started_at
       FROM raw.player_prop_game_runs
       WHERE pull_run_id = $1 AND game_id = $2`,
      [pullRunId, SENTINEL_GAME_ID]
    );

    const reconRows: ReconcileGameRun[] = [
      {
        pullRunId,
        gameId: SENTINEL_GAME_ID,
        startedAt: snapshotAt.toISOString(),
        rowsStored: stored,
        rowsArchived: archive.rowsArchived,
        archiveObjectCount: archive.archiveObjectCount,
        archiveStatus: archive.archiveStatus,
        archiveKey: key,
        s3ObjectFound: true,
      },
    ];
    const recon = summarizePropArchiveReconciliation(reconRows, {
      from: SENTINEL_DATE,
      to: SENTINEL_DATE,
    });

    const report = {
      pullRunId,
      gameRunId: `${pullRunId}:${SENTINEL_GAME_ID}`,
      gameId: SENTINEL_GAME_ID,
      snapshotAt: snapshotAt.toISOString(),
      rowsFetched: rows.length,
      rowsStored: stored,
      rowsArchived: archive.rowsArchived,
      archiveStatus: archive.archiveStatus,
      archiveKey: key,
      archiveObjectCount: archive.archiveObjectCount,
      retry: {
        status: retry.archiveStatus,
        result: retry.outcome && retry.outcome.ok ? retry.outcome.result : retry.archiveError,
      },
      failureSimulation: {
        archiveStatus: failing.archiveStatus,
        rowsArchived: failing.rowsArchived,
        error: failing.archiveError,
        looksFullySuccessful: failing.archiveStatus === 'archived',
      },
      s3: {
        key,
        protectedPrefix: isProtectedHistoricalKey(key),
        gzipReadable: true,
        archiveVersion: envelope.archiveVersion,
        timing: envelope.timing,
        rowCount: envelope.row_count,
        checksum: envelope.checksum,
        checksumMatches: envelope.checksum === expectedChecksum,
        rawJsonPreserved: envelope.rows.every((r) => r.raw_json != null),
      },
      prune: {
        missingBlocked: !mayPruneRawSnapshot({
          requireArchive: true,
          requiredAfter: new Date('2026-09-01T00:00:00.000Z'),
          snapshotFetchedAt: snapshotAt,
          snapshotPullRunId: pullRunId,
          gameRunStartedAt: snapshotAt,
          archiveStatus: 'failed',
        }).eligible,
        verifiedAllowed: mayPruneRawSnapshot({
          requireArchive: true,
          requiredAfter: new Date('2026-09-01T00:00:00.000Z'),
          snapshotFetchedAt: snapshotAt,
          snapshotPullRunId: pullRunId,
          gameRunStartedAt: snapshotAt,
          archiveStatus: 'archived',
        }).eligible,
        legacyNullPullRun: mayPruneRawSnapshot({
          requireArchive: true,
          requiredAfter: new Date('2026-09-01T00:00:00.000Z'),
          snapshotFetchedAt: '2026-04-02T00:00:00.000Z',
          snapshotPullRunId: null,
          gameRunStartedAt: null,
          archiveStatus: null,
        }).eligible,
      },
      reconcile: recon,
      reconcileText: formatPropArchiveReconcileReport(recon),
      dbRow: run.rows[0] ?? null,
    };
    console.log(JSON.stringify(report, null, 2));
    if (archive.archiveStatus !== 'archived' || failing.archiveStatus !== 'failed') {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

void main();
