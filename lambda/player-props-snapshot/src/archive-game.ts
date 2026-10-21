import type { LambdaEnv } from './env';
import type { NormalizedPropRow } from './types';
import {
  archiveSuccessInvariant,
  buildArchiveEnvelope,
  buildPlayerPropSnapshotArchiveKey,
  nbaSeasonStartYearFromGameDate,
  rowsFromNormalized,
  writeArchiveObject,
  type ArchiveWriteOutcome,
  type InMemoryS3Object,
} from './player-prop-snapshot-archive';
import { PlayerPropArchiveS3Store } from './s3-archive';

export type ArchiveObjectStore = {
  head(key: string): Promise<{ metadata: Record<string, string> } | null>;
  get(key: string): Promise<InMemoryS3Object | null>;
  put(key: string, body: Buffer, metadata: Record<string, string>): Promise<void>;
};

export async function archiveGameSnapshot(args: {
  env: LambdaEnv;
  pullRunId: number;
  gameId: string;
  bdlGameId: number;
  gameDate: string;
  snapshotAt: Date;
  observation?: { observedAt: Date; controllerEnqueuedAt: Date | null };
  gameStartTime: Date | null;
  season: string | null;
  opponentId: string | null;
  normalized: NormalizedPropRow[];
  rowsStored: number;
  store?: ArchiveObjectStore;
}): Promise<{
  outcome: ArchiveWriteOutcome | null;
  rowsArchived: number;
  archiveObjectCount: number;
  archiveStatus: 'pending' | 'archived' | 'failed';
  archiveError: string | null;
  archiveKey: string | null;
  skipped: boolean;
}> {
  if (!args.env.s3ArchiveEnabled) {
    return {
      outcome: null,
      rowsArchived: 0,
      archiveObjectCount: 0,
      archiveStatus: 'pending',
      archiveError: null,
      archiveKey: null,
      skipped: true,
    };
  }
  if (args.normalized.length === 0) {
    return {
      outcome: null,
      rowsArchived: 0,
      archiveObjectCount: 0,
      archiveStatus: 'archived',
      archiveError: null,
      archiveKey: null,
      skipped: false,
    };
  }
  const seasonNum =
    args.season != null && /^\d+$/.test(String(args.season).trim())
      ? Number(args.season)
      : nbaSeasonStartYearFromGameDate(args.gameDate);
  const key = buildPlayerPropSnapshotArchiveKey({
    rawPrefix: args.env.nbaRawPrefix,
    season: seasonNum,
    gameDate: args.gameDate,
    gameId: args.gameId,
    pullRunId: args.pullRunId,
    snapshotAt: args.snapshotAt,
  });
  const rows = rowsFromNormalized({
    normalized: args.normalized,
    analyticsGameId: args.gameId,
    pullRunId: args.pullRunId,
    snapshotAt: args.snapshotAt,
    gameStartTime: args.gameStartTime,
    opponentId: args.opponentId,
  });
  const envelope = buildArchiveEnvelope({
    season: seasonNum,
    pullRunId: args.pullRunId,
    gameId: args.gameId,
    sourceGameId: args.bdlGameId,
    gameDate: args.gameDate,
    snapshotAt: args.snapshotAt,
    gameStartTime: args.gameStartTime,
    rows,
    observation: args.observation,
  });
  const resolved = resolveArchiveStore(args);
  if (!resolved.ok) return resolved.result;
  const store = resolved.store;
  const outcome = await writeArchiveObject({ store, key, envelope });
  if (!outcome.ok) {
    return {
      outcome,
      rowsArchived: 0,
      archiveObjectCount: 0,
      archiveStatus: 'failed',
      archiveError: outcome.message,
      archiveKey: key,
      skipped: false,
    };
  }
  const rowsArchived = outcome.rowCount;
  if (!archiveSuccessInvariant(args.rowsStored, rowsArchived, 'archived') && args.rowsStored > 0 && rowsArchived === 0) {
    return {
      outcome,
      rowsArchived,
      archiveObjectCount: 1,
      archiveStatus: 'failed',
      archiveError: 'rows_stored > 0 but rows_archived == 0',
      archiveKey: key,
      skipped: false,
    };
  }
  return {
    outcome,
    rowsArchived,
    archiveObjectCount: 1,
    archiveStatus: 'archived',
    archiveError: null,
    archiveKey: key,
    skipped: false,
  };
}

type ArchiveResult = Awaited<ReturnType<typeof archiveGameSnapshot>>;

/**
 * Archive stays optional. A missing bucket fails this call and does not
 * construct an S3 client. The bucket is narrowed here so the store never
 * receives string | null.
 */
function resolveArchiveStore(args: {
  env: LambdaEnv;
  store?: ArchiveObjectStore;
}): { ok: true; store: ArchiveObjectStore } | { ok: false; result: ArchiveResult } {
  if (args.store) return { ok: true, store: args.store };
  const bucket = args.env.nbaDataBucket;
  if (!bucket) {
    const message = 'PLAYER_PROP_S3_ARCHIVE_ENABLED=true but NBA_DATA_BUCKET is missing';
    return {
      ok: false,
      result: {
        outcome: { ok: false, error: 'write_failed', message, key: '' },
        rowsArchived: 0,
        archiveObjectCount: 0,
        archiveStatus: 'failed',
        archiveError: message,
        archiveKey: null,
        skipped: false,
      },
    };
  }
  return {
    ok: true,
    store: new PlayerPropArchiveS3Store({
      bucket,
      region: args.env.awsRegion,
    }),
  };
}
