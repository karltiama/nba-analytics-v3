import type { LambdaEnv } from './env';
import {
  archiveSuccessInvariant,
  buildArchiveEnvelope,
  buildPlayerPropSnapshotArchiveKey,
  nbaSeasonStartYearFromGameDate,
  rowsFromNormalized,
  verifyStoredArchive,
  writeArchiveObject,
  type ArchiveObjectIdentity,
  type ArchivePutStore,
  type ArchiveWriteOutcome,
  type PlayerPropArchiveRow,
} from './player-prop-snapshot-archive';
import { PlayerPropArchiveS3Store } from './s3-archive';
import type { MarketType, NormalizedPropRow, OutcomeSide } from './types';

export type ArchiveObjectStore = ArchivePutStore;

export class PropsArchiveRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PropsArchiveRefusal';
  }
}

export function currentOnlySeason(seasonText: string | null | undefined, gameDate: string): number {
  if (seasonText != null && /^\d+$/.test(String(seasonText).trim())) return Number(seasonText);
  return nbaSeasonStartYearFromGameDate(gameDate);
}

export function currentOnlyArchiveKey(args: ArchiveObjectIdentity & { seasonText?: string | null }): string {
  return buildPlayerPropSnapshotArchiveKey({
    ...args,
    season: currentOnlySeason(args.seasonText, args.gameDate),
  });
}

export function openCurrentOnlyArchiveStore(env: LambdaEnv, store?: ArchiveObjectStore): ArchiveObjectStore | null {
  if (store) return store;
  if (!env.s3ArchiveEnabled || !env.nbaDataBucket) return null;
  return new PlayerPropArchiveS3Store({ bucket: env.nbaDataBucket, region: env.awsRegion });
}

export function normalizedRowsFromArchive(rows: PlayerPropArchiveRow[]): NormalizedPropRow[] {
  return rows.map((row) => {
    if (row.odds_american == null || row.odds_decimal == null || row.implied_probability == null) {
      throw new PropsArchiveRefusal('archived row is missing price fields');
    }
    const marketType = row.market_type;
    const side = row.side;
    if (marketType !== 'over_under' && marketType !== 'milestone') {
      throw new PropsArchiveRefusal('archived row has an unknown market type');
    }
    if (side !== 'over' && side !== 'under' && side !== 'milestone') {
      throw new PropsArchiveRefusal('archived row has an unknown side');
    }
    const raw = row.raw_json;
    return {
      game_id: row.source_game_id ?? Number(row.game_id),
      player_id: row.source_player_id ?? Number(row.player_id),
      player_name: row.player_name,
      team_id: row.team_id != null ? Number(row.team_id) : null,
      sportsbook: row.sportsbook,
      prop_type: row.prop_type,
      market_type: marketType as MarketType,
      side: side as OutcomeSide,
      line_value: row.line_value,
      odds_american: row.odds_american,
      odds_decimal: row.odds_decimal,
      implied_probability: row.implied_probability,
      raw_json: raw != null && typeof raw === 'object' ? (raw as object) : {},
      provider_updated_at: row.provider_updated_at ? new Date(row.provider_updated_at) : null,
    };
  });
}

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
  requireDurable?: boolean;
}): Promise<{
  outcome: ArchiveWriteOutcome | null;
  rowsArchived: number;
  archiveObjectCount: number;
  archiveStatus: 'pending' | 'archived' | 'failed';
  archiveError: string | null;
  archiveKey: string | null;
  skipped: boolean;
  verified: boolean;
}> {
  if (!args.env.s3ArchiveEnabled) {
    return {
      outcome: null,
      rowsArchived: 0,
      archiveObjectCount: 0,
      archiveStatus: args.requireDurable ? 'failed' : 'pending',
      archiveError: args.requireDurable ? 'current-only archive is disabled' : null,
      archiveKey: null,
      skipped: !args.requireDurable,
      verified: false,
    };
  }
  if (!args.requireDurable && args.normalized.length === 0) {
    return {
      outcome: null,
      rowsArchived: 0,
      archiveObjectCount: 0,
      archiveStatus: 'archived',
      archiveError: null,
      archiveKey: null,
      skipped: false,
      verified: false,
    };
  }
  if (args.requireDurable && (!args.observation?.observedAt || !args.observation.controllerEnqueuedAt)) {
    return {
      outcome: null,
      rowsArchived: 0,
      archiveObjectCount: 0,
      archiveStatus: 'failed',
      archiveError: 'current-only archive is missing observation timestamps',
      archiveKey: null,
      skipped: false,
      verified: false,
    };
  }
  const seasonNum = currentOnlySeason(args.season, args.gameDate);
  const key = currentOnlyArchiveKey({
    rawPrefix: args.env.nbaRawPrefix,
    season: seasonNum,
    seasonText: args.season,
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
      verified: false,
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
      verified: false,
    };
  }
  if (args.requireDurable) {
    const verified = await verifyStoredArchive({ store, key, expectedChecksum: outcome.checksum });
    if (!verified.ok) {
      return {
        outcome,
        rowsArchived: 0,
        archiveObjectCount: 0,
        archiveStatus: 'failed',
        archiveError: verified.message,
        archiveKey: key,
        skipped: false,
        verified: false,
      };
    }
  }
  return {
    outcome,
    rowsArchived,
    archiveObjectCount: 1,
    archiveStatus: 'archived',
    archiveError: null,
    archiveKey: key,
    skipped: false,
    verified: args.requireDurable === true,
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
        verified: false,
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
