/**
 * Reusable WP4C storage/health snapshot.
 *
 * Always prints DB + ingestion + coverage + manifest-derived archive counts.
 * Optional --s3-bytes lists approximate prefix sizes (entity prefixes only, not
 * a full-bucket recursive scan). Bucket names are not printed.
 *
 * Usage:
 *   npx tsx scripts/ops/platform-health-snapshot.ts
 *   npx tsx scripts/ops/platform-health-snapshot.ts --s3-bytes
 */

import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';
import {
  RAW_INJURIES_ARCHIVE_SPEC,
  RAW_ODDS_ARCHIVE_SPEC,
  RAW_PROPS_ARCHIVE_SPEC,
} from '@/lib/prune/archive-gate';
import { buildEntityPrefix } from '@/scripts/archive/archive-entity-core';
import { getAnalyticsSeason } from '@/lib/season';

const ENTITY_LABELS: Record<string, string> = {
  player_props_raw_v2: 'props',
  raw_odds_snapshots: 'odds',
  raw_player_injuries: 'injuries',
};

async function sumPrefixBytes(storage: S3Storage, prefix: string): Promise<{
  bytes: number;
  objects: number;
}> {
  let bytes = 0;
  let objects = 0;
  for await (const obj of storage.listByPrefix(prefix)) {
    bytes += obj.size;
    objects += 1;
  }
  return { bytes, objects };
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function readSeasonFlag(argv: string[]): number | null {
  const arg = argv.find((a) => a.startsWith('--season='));
  if (!arg) return null;
  const n = Number(arg.slice('--season='.length));
  return Number.isInteger(n) && n >= 2000 ? n : null;
}

async function main(): Promise<void> {
  const wantS3Bytes = process.argv.includes('--s3-bytes');
  const seasonFlag = readSeasonFlag(process.argv);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (seasonFlag != null) {
    env.CURRENT_ANALYTICS_SEASON = String(seasonFlag);
  }
  const { collectPlatformHealth } = await import('@/lib/ops/platform-health');
  const report = await collectPlatformHealth({ env });

  const snapshot: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    season: Number(getAnalyticsSeason(env)),
    overall: report.overall,
    freeze: report.freeze,
    database: {
      sizePretty: report.database.sizePretty,
      sizeBytes: report.database.sizeBytes,
      largest: report.database.largest,
      rowCounts: report.database.rowCounts,
    },
    ingestion: report.ingestion.map((row) => ({
      source: row.source,
      status: row.status,
      latestStatus: row.latestStatus,
      lastSuccessAt: row.lastSuccessAt,
    })),
    injuryServing: {
      status: report.injuryServing.status,
      authoritative: report.injuryServing.authoritative,
      latestSnapshotAt: report.injuryServing.latestSnapshotAt,
      ageHours: report.injuryServing.ageHours,
    },
    archives: report.archives.map((row) => ({
      label: ENTITY_LABELS[row.entity] ?? row.entity,
      entity: row.entity,
      status: row.status,
      recordCount: row.recordCount,
      partitionCount: row.partitionCount,
      exportedAt: row.exportedAt,
    })),
    coverage: report.coverage,
    prune: { status: report.prune.status, reason: report.prune.reason },
  };

  if (wantS3Bytes) {
    const bucket = process.env.NBA_DATA_BUCKET?.trim();
    if (!bucket) {
      snapshot.s3Bytes = { status: 'UNKNOWN', reason: 'NBA_DATA_BUCKET not set' };
    } else {
      const season = Number(getAnalyticsSeason(env));
      const rawPrefix = (process.env.NBA_RAW_PREFIX?.trim() || 'raw').replace(/\/+$/, '');
      const storage = new S3Storage({
        bucket,
        region: process.env.AWS_REGION?.trim() || 'us-east-1',
      });
      const specs = [RAW_PROPS_ARCHIVE_SPEC, RAW_ODDS_ARCHIVE_SPEC, RAW_INJURIES_ARCHIVE_SPEC];
      const byEntity: Array<{ label: string; bytes: number; pretty: string; objects: number }> = [];
      let total = 0;
      for (const spec of specs) {
        const prefix = buildEntityPrefix(rawPrefix, season, spec.entity);
        const summed = await sumPrefixBytes(storage, prefix);
        total += summed.bytes;
        byEntity.push({
          label: ENTITY_LABELS[spec.entity] ?? spec.entity,
          bytes: summed.bytes,
          pretty: prettyBytes(summed.bytes),
          objects: summed.objects,
        });
      }
      snapshot.s3Bytes = {
        season,
        approximate: true,
        totalPretty: prettyBytes(total),
        totalBytes: total,
        byEntity,
        note: 'Entity prefixes only for the current analytics season. Not a full-bucket scan.',
      };
    }
  }

  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
