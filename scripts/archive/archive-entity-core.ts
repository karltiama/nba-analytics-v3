/**
 * Core archive-entity logic for Postgres → S3 JSONL exports.
 * Extracted so skip-existing / manifest behavior can be unit-tested.
 */

import type { Pool } from 'pg';
import type { S3Storage } from '@/lib/aws/s3';
import type { EntityDef, SeasonContext } from './entity-registry';

export type ArchiveCliFlags = {
  season: number;
  dryRun: boolean;
  overwrite: boolean;
  batchSize: number;
};

export type EntityManifest = {
  schemaVersion: 1;
  s3Prefix: string;
  exportMode: 'full';
  source: 'existing_ingestion';
  league: 'nba';
  season: number;
  entity: string;
  sourceTable: string;
  exportedAt: string;
  recordCount: number;
  dateRange: { from: string; to: string } | null;
  partitions: string[];
  status: 'success' | 'partial' | 'empty' | 'skipped' | 'error';
  notes: string | null;
};

export type EntitySummary = {
  entity: string;
  status: EntityManifest['status'];
  recordCount: number;
  partitions: number;
  written: number;
  skipped: number;
  empty: number;
  durationMs: number;
  error?: string;
  /** True when an existing successful manifest was left untouched. */
  preservedManifest?: boolean;
};

export type ArchiveS3 = Pick<S3Storage, 'objectExists' | 'getText' | 'getJson' | 'putJson' | 'putJsonLines'>;

export function buildEntityPrefix(rawPrefix: string, season: number, entity: string): string {
  return `${rawPrefix}/source=existing_ingestion/league=nba/season=${season}/entity=${entity}`;
}

export function buildPartitionKey(entityPrefix: string, partition: string | null): string {
  return partition === null
    ? `${entityPrefix}/data.jsonl`
    : `${entityPrefix}/dt=${partition}/data.jsonl`;
}

/** Count NDJSON records (one JSON object per non-empty line). */
export function countJsonLines(text: string | null | undefined): number {
  if (text == null || text.length === 0) return 0;
  let count = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10 /* \n */) {
      if (i > start) count += 1;
      start = i + 1;
    }
  }
  return count;
}

export function isSuccessfulCompleteManifest(m: EntityManifest | null | undefined): boolean {
  if (!m) return false;
  if (m.status !== 'success') return false;
  if (!Number.isFinite(m.recordCount) || m.recordCount <= 0) return false;
  return true;
}

/**
 * Never replace a successful complete manifest with an empty/skipped/zero-count one.
 */
export function shouldPreserveExistingManifest(
  existing: EntityManifest | null | undefined,
  next: EntityManifest
): boolean {
  if (!isSuccessfulCompleteManifest(existing)) return false;
  if (next.status === 'skipped') return true;
  if (next.status === 'empty') return true;
  if (next.recordCount <= 0) return true;
  if (
    existing!.partitions.length > 0 &&
    next.partitions.length === 0 &&
    next.status !== 'success'
  ) {
    return true;
  }
  return false;
}

export function resolveEntityStatus(args: {
  includedPartitions: number;
  written: number;
  skippedVerified: number;
  empty: number;
  discovered: number;
}): EntityManifest['status'] {
  const { includedPartitions, written, skippedVerified, empty, discovered } = args;
  if (includedPartitions > 0) return 'success';
  if (discovered === 0 || empty === discovered) return 'empty';
  if (written === 0 && skippedVerified === 0) return 'empty';
  return 'empty';
}

export async function verifyExistingPartitionObject(opts: {
  s3: ArchiveS3;
  key: string;
  expectedCount: number;
}): Promise<{ ok: true; actualCount: number } | { ok: false; reason: string; actualCount: number | null }> {
  const { s3, key, expectedCount } = opts;
  const text = await s3.getText(key);
  if (text == null) {
    return { ok: false, reason: `object missing or unreadable: ${key}`, actualCount: null };
  }
  const actualCount = countJsonLines(text);
  if (actualCount !== expectedCount) {
    return {
      ok: false,
      reason: `row-count mismatch for ${key}: expected ${expectedCount}, found ${actualCount}`,
      actualCount,
    };
  }
  return { ok: true, actualCount };
}

export async function archiveEntity(opts: {
  entity: EntityDef;
  db: Pool;
  s3: ArchiveS3;
  rawPrefix: string;
  args: ArchiveCliFlags;
  ctx: SeasonContext;
  nowIso?: string;
}): Promise<EntitySummary> {
  const { entity, db, s3, rawPrefix, args, ctx } = opts;
  const start = Date.now();
  const entityPrefix = buildEntityPrefix(rawPrefix, args.season, entity.entity);
  const manifestKey = `${entityPrefix}/_manifest.json`;

  console.log(`\n[entity] ${entity.entity}  (${entity.sourceTable})`);
  console.log(`         partition=${entity.partitionStrategy}  paginationKey=${entity.paginationKey}`);

  let partitions: (string | null)[];
  if (entity.partitionStrategy === 'date') {
    if (!entity.listPartitions) {
      throw new Error(`Entity ${entity.entity} declares date partition but no listPartitions`);
    }
    const parts = await entity.listPartitions(db, ctx);
    partitions = parts;
    console.log(`         discovered ${parts.length} partition(s)`);
  } else {
    partitions = [null];
  }

  let totalRecords = 0;
  let written = 0;
  let skipped = 0;
  let empty = 0;
  const includedPartitions: string[] = [];

  for (const partition of partitions) {
    const key = buildPartitionKey(entityPrefix, partition);
    const tag = partition === null ? '<single>' : partition;

    // Resume path: existing object → verify against DB count → include in manifest (no re-upload).
    if (!args.dryRun && !args.overwrite && (await s3.objectExists(key))) {
      const expectedCount = await entity.countRows(db, ctx, partition);
      if (expectedCount === 0) {
        // Stale object for an empty partition — leave object, do not include.
        console.log(`  [skip-existing-empty-source] ${key}`);
        empty += 1;
        continue;
      }
      const verified = await verifyExistingPartitionObject({ s3, key, expectedCount });
      if (!verified.ok) {
        throw new Error(
          `Existing archive object failed verification (${verified.reason}). ` +
            `Re-run with --overwrite to replace, or repair the object.`
        );
      }
      console.log(`  [skip-existing-verified] ${key}  (${verified.actualCount} rows)`);
      totalRecords += verified.actualCount;
      skipped += 1;
      includedPartitions.push(tag);
      continue;
    }

    const count = await entity.countRows(db, ctx, partition);
    if (count === 0) {
      console.log(`  [skip-empty]    ${key}`);
      empty += 1;
      continue;
    }

    if (args.dryRun) {
      console.log(`  [dry-run]       would write ${key}  (${count} rows)`);
      totalRecords += count;
      written += 1;
      includedPartitions.push(tag);
      continue;
    }

    let cursor: unknown | null = null;
    let fetched = 0;
    const collected: unknown[] = [];
    while (true) {
      const { rows, nextCursor } = await entity.fetchBatch(
        db,
        ctx,
        partition,
        cursor,
        args.batchSize
      );
      if (rows.length === 0) break;
      collected.push(...rows);
      fetched += rows.length;
      cursor = nextCursor;
      if (cursor === null) break;
    }

    if (fetched !== count) {
      console.warn(
        `  [warn] count mismatch on ${key}: expected ${count}, fetched ${fetched} (table may have changed mid-run)`
      );
    }

    const result = await s3.putJsonLines(key, collected, { overwrite: true });
    totalRecords += result.count ?? fetched;
    written += 1;
    includedPartitions.push(tag);
    console.log(`  [wrote]         ${key}  (${result.count ?? fetched} rows)`);
  }

  const status = resolveEntityStatus({
    includedPartitions: includedPartitions.length,
    written,
    skippedVerified: skipped,
    empty,
    discovered: partitions.length,
  });

  const dateRange =
    entity.partitionStrategy === 'date' && includedPartitions.length > 0
      ? {
          from: includedPartitions[0],
          to: includedPartitions[includedPartitions.length - 1],
        }
      : null;

  const manifest: EntityManifest = {
    schemaVersion: 1,
    s3Prefix: entityPrefix,
    exportMode: 'full',
    source: 'existing_ingestion',
    league: 'nba',
    season: args.season,
    entity: entity.entity,
    sourceTable: entity.sourceTable,
    exportedAt: opts.nowIso ?? new Date().toISOString(),
    recordCount: totalRecords,
    dateRange,
    partitions: entity.partitionStrategy === 'date' ? includedPartitions : [],
    status,
    notes: entity.notes ?? null,
  };

  if (args.dryRun) {
    console.log(`  [dry-run]       would write ${manifestKey}`);
    console.log(`  [dry-run]       manifest preview:`);
    console.log(indent(JSON.stringify(manifest, null, 2), '                  '));
    return {
      entity: entity.entity,
      status,
      recordCount: totalRecords,
      partitions: includedPartitions.length,
      written,
      skipped,
      empty,
      durationMs: Date.now() - start,
    };
  }

  const existing = await s3.getJson<EntityManifest>(manifestKey);
  if (shouldPreserveExistingManifest(existing, manifest)) {
    console.log(
      `  [manifest-preserved] ${manifestKey}  (refusing to overwrite successful complete manifest ` +
        `recordCount=${existing!.recordCount} with status=${manifest.status} recordCount=${manifest.recordCount})`
    );
    return {
      entity: entity.entity,
      status: existing!.status,
      recordCount: existing!.recordCount,
      partitions: existing!.partitions?.length ?? includedPartitions.length,
      written,
      skipped,
      empty,
      durationMs: Date.now() - start,
      preservedManifest: true,
    };
  }

  await s3.putJson(manifestKey, manifest, { overwrite: true });
  console.log(`  [manifest]      ${manifestKey}`);

  return {
    entity: entity.entity,
    status,
    recordCount: totalRecords,
    partitions: includedPartitions.length,
    written,
    skipped,
    empty,
    durationMs: Date.now() - start,
  };
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}
