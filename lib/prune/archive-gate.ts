/**
 * Verify S3 archive readiness before deleting raw.player_prop_snapshots_v2 rows.
 */

import {
  buildEntityPrefix,
  buildPartitionKey,
  isSuccessfulCompleteManifest,
  type EntityManifest,
} from '@/scripts/archive/archive-entity-core';

export const RAW_PROPS_ARCHIVE_ENTITY = 'player_props_raw_v2';
export const RAW_PROPS_SOURCE_TABLE = 'raw.player_prop_snapshots_v2';

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
  season: number
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
  if (manifest.entity !== RAW_PROPS_ARCHIVE_ENTITY) {
    return {
      ok: false,
      reason: `manifest entity mismatch (expected ${RAW_PROPS_ARCHIVE_ENTITY}, got ${manifest.entity})`,
    };
  }
  if (manifest.season !== season) {
    return {
      ok: false,
      reason: `manifest season mismatch (expected ${season}, got ${manifest.season})`,
    };
  }
  if (manifest.sourceTable !== RAW_PROPS_SOURCE_TABLE) {
    return {
      ok: false,
      reason: `manifest sourceTable mismatch (expected ${RAW_PROPS_SOURCE_TABLE}, got ${manifest.sourceTable})`,
    };
  }
  if (!Array.isArray(manifest.partitions) || manifest.partitions.length === 0) {
    return { ok: false, reason: 'manifest has no partitions' };
  }
  return { ok: true };
}

export async function verifySeasonRawPropsArchive(opts: {
  s3: ArchiveS3Reader;
  rawPrefix: string;
  season: number;
}): Promise<SeasonArchiveCheck> {
  const { s3, rawPrefix, season } = opts;
  const entityPrefix = buildEntityPrefix(rawPrefix, season, RAW_PROPS_ARCHIVE_ENTITY);
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

  const meta = validateManifestMetadata(manifest, season);
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

/**
 * Verify archive for every season that has prune-eligible raw rows.
 * If seasons is empty, returns ok (nothing to delete for raw).
 */
export async function verifyRawPropsArchiveGate(opts: {
  s3: ArchiveS3Reader | null;
  rawPrefix: string;
  seasons: number[];
}): Promise<ArchiveGateResult> {
  const { s3, rawPrefix, seasons } = opts;
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
    checks.push(await verifySeasonRawPropsArchive({ s3, rawPrefix, season }));
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
