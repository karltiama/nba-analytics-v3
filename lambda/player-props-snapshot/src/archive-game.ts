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
  if (!args.env.nbaDataBucket && !args.store) {
    const message = 'PLAYER_PROP_S3_ARCHIVE_ENABLED=true but NBA_DATA_BUCKET is missing';
    return {
      outcome: { ok: false, error: 'write_failed', message, key: '' },
      rowsArchived: 0,
      archiveObjectCount: 0,
      archiveStatus: 'failed',
      archiveError: message,
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
  });
  const store =
    args.store ??
    new PlayerPropArchiveS3Store({
      bucket: args.env.nbaDataBucket,
      region: args.env.awsRegion,
    });
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
