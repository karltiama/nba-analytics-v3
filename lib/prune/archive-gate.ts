/**
 * Verify S3 archive readiness before deleting raw snapshot rows.
 * Entity/source-table are passed in so props and odds share one gate.
 */

import {
  buildEntityPrefix,
  buildPartitionKey,
  isSuccessfulCompleteManifest,
  type EntityManifest,
} from '@/scripts/archive/archive-entity-core';

export type ArchiveEntitySpec = {
  entity: string;
  sourceTable: string;
};

export const RAW_PROPS_ARCHIVE_ENTITY = 'player_props_raw_v2';
export const RAW_PROPS_SOURCE_TABLE = 'raw.player_prop_snapshots_v2';
export const RAW_PROPS_ARCHIVE_SPEC: ArchiveEntitySpec = {
  entity: RAW_PROPS_ARCHIVE_ENTITY,
  sourceTable: RAW_PROPS_SOURCE_TABLE,
};

export const RAW_ODDS_ARCHIVE_ENTITY = 'raw_odds_snapshots';
export const RAW_ODDS_SOURCE_TABLE = 'raw.odds_snapshots';
export const RAW_ODDS_ARCHIVE_SPEC: ArchiveEntitySpec = {
  entity: RAW_ODDS_ARCHIVE_ENTITY,
  sourceTable: RAW_ODDS_SOURCE_TABLE,
};

export const RAW_INJURIES_ARCHIVE_ENTITY = 'raw_player_injuries';
export const RAW_INJURIES_SOURCE_TABLE = 'raw.player_injuries';
export const RAW_INJURIES_ARCHIVE_SPEC: ArchiveEntitySpec = {
  entity: RAW_INJURIES_ARCHIVE_ENTITY,
  sourceTable: RAW_INJURIES_SOURCE_TABLE,
};

export type ArchiveS3Reader = {
  objectExists: (key: string) => Promise<boolean>;
  getJson: <T>(key: string) => Promise<T | null>;
};

export type SeasonArchiveCheck = {
  season: number;
  ok: boolean;
  reason: string;
  manifestKey: string;
  recordCount: number | null;
  partitionsChecked: number;
  partitionsMissing: string[];
};

export type ArchiveGateResult = {
  ok: boolean;
  reason: string;
  seasons: SeasonArchiveCheck[];
};

export function buildManifestKey(entityPrefix: string): string {
  return `${entityPrefix}/_manifest.json`;
}

export function validateManifestMetadata(
  manifest: EntityManifest | null,
  season: number,
  spec: ArchiveEntitySpec = RAW_PROPS_ARCHIVE_SPEC
): { ok: true } | { ok: false; reason: string } {
  if (!manifest) {
    return { ok: false, reason: 'manifest missing' };
  }
  if (!isSuccessfulCompleteManifest(manifest)) {
    return {
      ok: false,
      reason: `manifest not successful/complete (status=${manifest.status}, recordCount=${manifest.recordCount})`,
    };
  }
  if (manifest.entity !== spec.entity) {
    return {
      ok: false,
      reason: `manifest entity mismatch (expected ${spec.entity}, got ${manifest.entity})`,
    };
  }
  if (manifest.season !== season) {
    return {
      ok: false,
      reason: `manifest season mismatch (expected ${season}, got ${manifest.season})`,
    };
  }
  if (manifest.sourceTable !== spec.sourceTable) {
    return {
      ok: false,
      reason: `manifest sourceTable mismatch (expected ${spec.sourceTable}, got ${manifest.sourceTable})`,
    };
  }
  if (!Array.isArray(manifest.partitions) || manifest.partitions.length === 0) {
    return { ok: false, reason: 'manifest has no partitions' };
  }
  return { ok: true };
}

export async function verifySeasonArchive(opts: {
  s3: ArchiveS3Reader;
  rawPrefix: string;
  season: number;
  spec: ArchiveEntitySpec;
}): Promise<SeasonArchiveCheck> {
  const { s3, rawPrefix, season, spec } = opts;
  const entityPrefix = buildEntityPrefix(rawPrefix, season, spec.entity);
  const manifestKey = buildManifestKey(entityPrefix);

  let manifest: EntityManifest | null;
  try {
    manifest = await s3.getJson<EntityManifest>(manifestKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return {
      season,
      ok: false,
      reason: `failed to read manifest: ${message}`,
      manifestKey,
      recordCount: null,
      partitionsChecked: 0,
      partitionsMissing: [],
    };
  }

  const meta = validateManifestMetadata(manifest, season, spec);
  if (!meta.ok) {
    return {
      season,
      ok: false,
      reason: meta.reason,
      manifestKey,
      recordCount: manifest?.recordCount ?? null,
      partitionsChecked: 0,
      partitionsMissing: [],
    };
  }

  const partitions = manifest!.partitions;
  const missing: string[] = [];
  for (const partition of partitions) {
    const key = buildPartitionKey(entityPrefix, partition);
    const exists = await s3.objectExists(key);
    if (!exists) missing.push(partition);
  }

  if (missing.length > 0) {
    return {
      season,
      ok: false,
      reason: `missing ${missing.length} archived partition object(s)`,
      manifestKey,
      recordCount: manifest!.recordCount,
      partitionsChecked: partitions.length,
      partitionsMissing: missing.slice(0, 20),
    };
  }

  return {
    season,
    ok: true,
    reason: 'archive verified',
    manifestKey,
    recordCount: manifest!.recordCount,
    partitionsChecked: partitions.length,
    partitionsMissing: [],
  };
}

export async function verifySeasonRawPropsArchive(opts: {
  s3: ArchiveS3Reader;
  rawPrefix: string;
  season: number;
}): Promise<SeasonArchiveCheck> {
  return verifySeasonArchive({ ...opts, spec: RAW_PROPS_ARCHIVE_SPEC });
}

/**
 * Verify archive for every season that has prune-eligible raw rows.
 * If seasons is empty, returns ok (nothing to delete for raw).
 */
export async function verifyRawArchiveGate(opts: {
  s3: ArchiveS3Reader | null;
  rawPrefix: string;
  seasons: number[];
  spec: ArchiveEntitySpec;
}): Promise<ArchiveGateResult> {
  const { s3, rawPrefix, seasons, spec } = opts;
  if (seasons.length === 0) {
    return { ok: true, reason: 'no seasons with eligible raw rows', seasons: [] };
  }
  if (!s3) {
    return {
      ok: false,
      reason:
        'S3 archive client unavailable (set NBA_DATA_BUCKET and AWS credentials before raw prune)',
      seasons: seasons.map((season) => ({
        season,
        ok: false,
        reason: 'S3 unavailable',
        manifestKey: '',
        recordCount: null,
        partitionsChecked: 0,
        partitionsMissing: [],
      })),
    };
  }

  const checks: SeasonArchiveCheck[] = [];
  for (const season of seasons) {
    checks.push(await verifySeasonArchive({ s3, rawPrefix, season, spec }));
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      reason: failed.map((f) => `season ${f.season}: ${f.reason}`).join('; '),
      seasons: checks,
    };
  }

  return { ok: true, reason: 'all season archives verified', seasons: checks };
}

export async function verifyRawPropsArchiveGate(opts: {
  s3: ArchiveS3Reader | null;
  rawPrefix: string;
  seasons: number[];
}): Promise<ArchiveGateResult> {
  return verifyRawArchiveGate({ ...opts, spec: RAW_PROPS_ARCHIVE_SPEC });
}

export async function verifyRawOddsArchiveGate(opts: {
  s3: ArchiveS3Reader | null;
  rawPrefix: string;
  seasons: number[];
}): Promise<ArchiveGateResult> {
  return verifyRawArchiveGate({ ...opts, spec: RAW_ODDS_ARCHIVE_SPEC });
}

export async function verifyRawInjuriesArchiveGate(opts: {
  s3: ArchiveS3Reader | null;
  rawPrefix: string;
  seasons: number[];
}): Promise<ArchiveGateResult> {
  return verifyRawArchiveGate({ ...opts, spec: RAW_INJURIES_ARCHIVE_SPEC });
}
