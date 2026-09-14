/**
 * Remove ONLY the staged archive proof sentinel:
 *   game_id = 999000001
 *   pull_run_id = 575
 *
 * Does not touch existing_ingestion, opening_player_props, or real NBA games.
 *
 *   npx tsx scripts/ops/cleanup-sentinel-prop-archive.ts
 *   npx tsx scripts/ops/cleanup-sentinel-prop-archive.ts --execute
 */
import 'dotenv/config';
import {
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Pool } from 'pg';

export const SENTINEL_GAME_ID = '999000001';
export const SENTINEL_PULL_RUN_ID = 575;
export const SENTINEL_KEY =
  'raw/source=balldontlie/league=nba/season=2026/entity=player_prop_snapshots/game_date=2026-09-14/game_id=999000001/snapshot_at=2026-09-14T18-00-00Z__pull=575.json.gz';
export const SENTINEL_PREFIX =
  'raw/source=balldontlie/league=nba/season=2026/entity=player_prop_snapshots/game_date=2026-09-14/game_id=999000001/';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function isExecute(argv: string[]): boolean {
  return argv.includes('--execute');
}

export async function listSentinelVersions(
  client: S3Client,
  bucket: string
): Promise<{ key: string; versionId: string; isDeleteMarker: boolean }[]> {
  const out: { key: string; versionId: string; isDeleteMarker: boolean }[] = [];
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  do {
    const page = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: SENTINEL_PREFIX,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
      })
    );
    for (const v of page.Versions ?? []) {
      if (!v.Key || !v.VersionId) continue;
      if (v.Key !== SENTINEL_KEY && !v.Key.startsWith(SENTINEL_PREFIX)) continue;
      if (!v.Key.startsWith(SENTINEL_PREFIX)) continue;
      out.push({ key: v.Key, versionId: v.VersionId, isDeleteMarker: false });
    }
    for (const m of page.DeleteMarkers ?? []) {
      if (!m.Key || !m.VersionId) continue;
      if (!m.Key.startsWith(SENTINEL_PREFIX)) continue;
      out.push({ key: m.Key, versionId: m.VersionId, isDeleteMarker: true });
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);
  const unexpected = out.filter((row) => row.key !== SENTINEL_KEY);
  if (unexpected.length > 0) {
    throw new Error(
      `Refusing: versions under sentinel prefix are not the proof key: ${unexpected
        .map((r) => r.key)
        .join(', ')}`
    );
  }
  return out;
}

async function inventoryDb(pool: Pool) {
  const snapshots = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM raw.player_prop_snapshots_v2
     WHERE game_id = $1 AND pull_run_id = $2`,
    [Number(SENTINEL_GAME_ID), SENTINEL_PULL_RUN_ID]
  );
  const otherSnap = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM raw.player_prop_snapshots_v2
     WHERE (game_id = $1 OR pull_run_id = $2)
       AND NOT (game_id = $1 AND pull_run_id = $2)`,
    [Number(SENTINEL_GAME_ID), SENTINEL_PULL_RUN_ID]
  );
  const gameRuns = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM raw.player_prop_game_runs
     WHERE game_id = $1 AND pull_run_id = $2`,
    [SENTINEL_GAME_ID, SENTINEL_PULL_RUN_ID]
  );
  const otherRuns = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM raw.player_prop_game_runs
     WHERE pull_run_id = $1 AND game_id <> $2`,
    [SENTINEL_PULL_RUN_ID, SENTINEL_GAME_ID]
  );
  const pullRuns = await pool.query<{ n: string; game_ids_queried: string[] | null }>(
    `SELECT COUNT(*)::text AS n, game_ids_queried
     FROM raw.player_prop_pull_runs
     WHERE pull_run_id = $1
     GROUP BY game_ids_queried`,
    [SENTINEL_PULL_RUN_ID]
  );
  const current = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM analytics.player_props_current WHERE game_id::text = $1`,
    [SENTINEL_GAME_ID]
  );
  const history = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM analytics.player_prop_history WHERE game_id::text = $1`,
    [SENTINEL_GAME_ID]
  );
  return {
    snapshots: Number(snapshots.rows[0]?.n ?? 0),
    otherSnapshots: Number(otherSnap.rows[0]?.n ?? 0),
    gameRuns: Number(gameRuns.rows[0]?.n ?? 0),
    otherGameRunsOnPull: Number(otherRuns.rows[0]?.n ?? 0),
    pullRuns: pullRuns.rows.length === 0 ? 0 : Number(pullRuns.rows[0]?.n ?? 0),
    pullGameIds: pullRuns.rows[0]?.game_ids_queried ?? [],
    current: Number(current.rows[0]?.n ?? 0),
    history: Number(history.rows[0]?.n ?? 0),
  };
}

async function main() {
  const execute = isExecute(process.argv);
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const dbUrl = requireEnv('SUPABASE_DB_URL');
  const client = new S3Client({ region: process.env.AWS_REGION?.trim() || 'us-east-1' });
  const pool = new Pool({ connectionString: dbUrl, max: 1 });
  try {
    const db = await inventoryDb(pool);
    const versions = await listSentinelVersions(client, bucket);
    const plan = {
      execute,
      versioningNote:
        'Bucket versioning is Enabled. A plain delete creates a delete marker and keeps the version. This script deletes every version + delete marker for the sentinel key only.',
      s3: { key: SENTINEL_KEY, versions },
      db,
    };
    if (db.otherSnapshots > 0 || db.otherGameRunsOnPull > 0) {
      throw new Error('Ambiguous sentinel identity; refusing cleanup.');
    }
    if (db.pullRuns > 0) {
      const ids = db.pullGameIds.map(String);
      if (ids.length !== 1 || ids[0] !== SENTINEL_GAME_ID) {
        throw new Error(
          `pull_run ${SENTINEL_PULL_RUN_ID} is not uniquely the sentinel (game_ids_queried=${ids.join(',')})`
        );
      }
    }
    if (db.current > 0 || db.history > 0) {
      throw new Error('Sentinel unexpectedly present in analytics current/history; refusing cleanup.');
    }
    console.log(JSON.stringify(plan, null, 2));
    if (!execute) {
      console.log('Dry-run only. Re-run with --execute to delete.');
      return;
    }

    for (const v of versions) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: v.key,
          VersionId: v.versionId,
        })
      );
    }
    const remaining = await listSentinelVersions(client, bucket);
    if (remaining.length > 0) {
      throw new Error(`S3 sentinel versions remain: ${remaining.length}`);
    }

    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      const snap = await cx.query(
        `DELETE FROM raw.player_prop_snapshots_v2
         WHERE game_id = $1 AND pull_run_id = $2
         RETURNING id`,
        [Number(SENTINEL_GAME_ID), SENTINEL_PULL_RUN_ID]
      );
      const gr = await cx.query(
        `DELETE FROM raw.player_prop_game_runs
         WHERE game_id = $1 AND pull_run_id = $2
         RETURNING game_id`,
        [SENTINEL_GAME_ID, SENTINEL_PULL_RUN_ID]
      );
      const pr = await cx.query(
        `DELETE FROM raw.player_prop_pull_runs
         WHERE pull_run_id = $1
           AND cardinality(game_ids_queried) = 1
           AND game_ids_queried = ARRAY[$2]::text[]
         RETURNING pull_run_id`,
        [SENTINEL_PULL_RUN_ID, SENTINEL_GAME_ID]
      );
      if (snap.rowCount !== db.snapshots) {
        throw new Error(`snapshot delete count ${snap.rowCount} != inventory ${db.snapshots}`);
      }
      if (gr.rowCount !== db.gameRuns) {
        throw new Error(`game_run delete count ${gr.rowCount} != inventory ${db.gameRuns}`);
      }
      if (pr.rowCount !== db.pullRuns) {
        throw new Error(`pull_run delete count ${pr.rowCount} != inventory ${db.pullRuns}`);
      }
      await cx.query('COMMIT');
    } catch (err) {
      await cx.query('ROLLBACK');
      throw err;
    } finally {
      cx.release();
    }

    const after = await inventoryDb(pool);
    console.log(JSON.stringify({ ok: true, after, s3Remaining: remaining.length }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
