/**
 * Read-only check for one prop archive object.
 *
 *   npx tsx scripts/ops/prop-archive-check.ts --pull-run-id 1 --game-id 123 --season 2026 --game-date 2026-10-20 --snapshot-at 2026-10-20T22:00:00Z
 *
 * Prints OBJECT_FOUND, OBJECT_MISSING, or KEY_UNKNOWN.
 * Prints a proposed UPDATE and does not execute it.
 */
import { buildPlayerPropSnapshotArchiveKey } from '../../lambda/player-props-snapshot/src/player-prop-snapshot-archive';

export type ArchiveCheckStatus = 'OBJECT_FOUND' | 'OBJECT_MISSING' | 'KEY_UNKNOWN';

export function deriveArchiveKey(input: {
  storedKey?: string | null;
  season?: number | null;
  gameDate?: string | null;
  gameId?: string | null;
  pullRunId?: number | null;
  snapshotAt?: string | null;
  rawPrefix?: string;
}): string | null {
  if (input.storedKey && input.storedKey.trim()) return input.storedKey.trim();
  if (
    input.season == null ||
    !input.gameDate ||
    !input.gameId ||
    input.pullRunId == null ||
    !input.snapshotAt
  ) {
    return null;
  }
  const snapshotAt = new Date(input.snapshotAt);
  if (Number.isNaN(snapshotAt.getTime())) return null;
  return buildPlayerPropSnapshotArchiveKey({
    rawPrefix: input.rawPrefix ?? 'raw',
    season: input.season,
    gameDate: input.gameDate,
    gameId: input.gameId,
    pullRunId: input.pullRunId,
    snapshotAt,
  });
}

export function classifyArchiveHead(input: {
  key: string | null;
  headExists: boolean | null;
}): ArchiveCheckStatus {
  if (!input.key) return 'KEY_UNKNOWN';
  if (input.headExists == null) return 'KEY_UNKNOWN';
  return input.headExists ? 'OBJECT_FOUND' : 'OBJECT_MISSING';
}

export function proposeArchiveStatusRepair(input: {
  status: ArchiveCheckStatus;
  pullRunId: number;
  gameId: string;
  key: string | null;
}): { sql: string; params: unknown[] } | null {
  if (input.status !== 'OBJECT_FOUND' || !input.key) return null;
  return {
    sql: `UPDATE raw.player_prop_game_runs
             SET archive_status = 'archived',
                 archive_key = $3,
                 archive_completed_at = coalesce(archive_completed_at, now())
           WHERE pull_run_id = $1
             AND game_id = $2
             AND archive_status IS DISTINCT FROM 'archived'`,
    params: [input.pullRunId, input.gameId, input.key],
  };
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

export async function inspectArchiveObject(input: {
  key: string | null;
  head: (key: string) => Promise<boolean>;
}): Promise<ArchiveCheckStatus> {
  if (!input.key) return 'KEY_UNKNOWN';
  const headExists = await input.head(input.key);
  return classifyArchiveHead({ key: input.key, headExists });
}

async function headObject(bucket: string, key: string): Promise<boolean> {
  const { HeadObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return false;
    throw error;
  }
}

async function main() {
  const pullRaw = arg('--pull-run-id');
  const gameId = arg('--game-id') ?? '';
  const seasonRaw = arg('--season');
  const key = deriveArchiveKey({
    storedKey: arg('--key'),
    season: seasonRaw ? Number(seasonRaw) : null,
    gameDate: arg('--game-date'),
    gameId,
    pullRunId: pullRaw ? Number(pullRaw) : null,
    snapshotAt: arg('--snapshot-at'),
    rawPrefix: arg('--prefix') ?? 'raw',
  });
  const bucket = process.env.NBA_DATA_BUCKET?.trim() || '';
  const status = !key
    ? 'KEY_UNKNOWN'
    : bucket
      ? await inspectArchiveObject({ key, head: (objectKey) => headObject(bucket, objectKey) })
      : 'KEY_UNKNOWN';
  const repair =
    status === 'OBJECT_FOUND' && pullRaw
      ? proposeArchiveStatusRepair({
          status,
          pullRunId: Number(pullRaw),
          gameId,
          key,
        })
      : null;
  console.log(
    JSON.stringify(
      {
        status,
        key,
        headPerformed: Boolean(key && bucket),
        repair,
        note: 'Read-only. Repair SQL is printed and not executed.',
      },
      null,
      2
    )
  );
}

if (process.argv[1] && process.argv[1].endsWith('prop-archive-check.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'archive check failed');
    process.exit(1);
  });
}
