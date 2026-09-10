/**
 * Read-only Step 9A collector. Lists S3 + fetches manifests.
 * Does not import BdlArchiveClient. No Postgres writes. No BDL HTTP.
 *
 *   npx tsx scripts/ops/goat-final-audit-collect.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const OUT = 'reports/trial/goat-final-audit-s3-snapshot.json';

type Json = Record<string, unknown>;

async function sumPrefix(s3: S3Storage, prefix: string): Promise<{
  prefix: string;
  objects: number;
  bytes: number;
  pageJson: number;
  gameJson: number;
  hasManifest: boolean;
  hasRun: boolean;
}> {
  let objects = 0;
  let bytes = 0;
  let pageJson = 0;
  let gameJson = 0;
  let hasManifest = false;
  let hasRun = false;
  const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
  for await (const o of s3.listByPrefix(p)) {
    objects += 1;
    bytes += o.size;
    if (o.key.endsWith('/_manifest.json')) hasManifest = true;
    if (o.key.endsWith('/_run.json')) hasRun = true;
    if (/\/page=\d+\.json$/.test(o.key)) pageJson += 1;
    if (/\/game_id=\d+\.json$/.test(o.key)) gameJson += 1;
  }
  return { prefix: prefix.replace(/\/$/, ''), objects, bytes, pageJson, gameJson, hasManifest, hasRun };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const lock = bdlAcquisitionLockStatus();
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });

  const prefixes = [
    'raw/source=balldontlie/league=nba/season=2023/entity=games',
    'raw/source=balldontlie/league=nba/season=2023/entity=player_stats',
    'raw/source=balldontlie/league=nba/season=2023/entity=advanced_stats_v2',
    'raw/source=balldontlie/league=nba/season=2024/entity=games',
    'raw/source=balldontlie/league=nba/season=2024/entity=player_stats',
    'raw/source=balldontlie/league=nba/season=2024/entity=advanced_stats_v2',
    'raw/source=balldontlie/league=nba/season=2025/entity=games',
    'raw/source=balldontlie/league=nba/season=2025/entity=player_stats',
    'raw/source=balldontlie/league=nba/season=2025/entity=advanced_stats_v2',
    'raw/source=balldontlie/league=nba/season=2025/entity=opening_player_props',
    'raw/source=balldontlie/league=nba/season=2025/entity=opening_game_odds',
    'raw/source=balldontlie/league=nba/season=2025/entity=lineups',
    'raw/source=balldontlie/league=nba/season=2022',
  ];

  const familyPrefixes = [
    { family: 'core_historical_bdl_2023', prefix: 'raw/source=balldontlie/league=nba/season=2023/' },
    { family: 'core_historical_bdl_2024', prefix: 'raw/source=balldontlie/league=nba/season=2024/' },
    { family: 'core_historical_bdl_2025', prefix: 'raw/source=balldontlie/league=nba/season=2025/' },
    { family: 'existing_odds', prefix: 'raw/existing_ingestion/' },
    { family: 'injuries', prefix: 'raw/' },
  ];

  const entitySums: Json[] = [];
  for (const prefix of prefixes) {
    entitySums.push(await sumPrefix(s3, prefix));
  }

  const manifestKeys = [
    'raw/source=balldontlie/league=nba/season=2023/entity=games/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2023/entity=player_stats/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2023/entity=advanced_stats_v2/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2024/entity=games/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2024/entity=player_stats/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2024/entity=advanced_stats_v2/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2025/entity=player_stats/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2025/entity=player_stats/_repair_remaining31_manifest.json',
    'raw/source=balldontlie/league=nba/season=2025/entity=advanced_stats_v2/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2025/entity=opening_player_props/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2025/entity=opening_game_odds/window=2026-03-09_to_2026-03-22/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2025/entity=lineups/_manifest.json',
    'raw/source=balldontlie/league=nba/season=2025/entity=lineups/_run.json',
  ];
  const manifests: Json[] = [];
  for (const key of manifestKeys) {
    const body = await s3.getJson<Json>(key);
    manifests.push({
      key,
      present: body != null,
      status: body?.status ?? null,
      pageCount: body?.pageCount ?? null,
      recordCount: body?.recordCount ?? body?.lineupRecords ?? null,
      targetGames: body?.targetGames ?? null,
      season: body?.season ?? null,
      entity: body?.entity ?? null,
      availabilityLimitation: body?.availabilityLimitation ?? null,
      scopeLimitation: body?.scopeLimitation ?? body?.window ?? null,
      notes: body?.notes ?? null,
      identityNotes: body?.identityNotes ?? body?.knownIdentityGaps ?? null,
      keys: body ? Object.keys(body) : [],
    });
  }

  // Full-bucket approximate inventory (ListObjectsV2 only).
  let totalBytes = 0;
  let objectCount = 0;
  const byTop: Record<string, { bytes: number; objects: number }> = {};
  const byEntity: Record<string, { bytes: number; objects: number }> = {};
  for await (const o of s3.listByPrefix('')) {
    totalBytes += o.size;
    objectCount += 1;
    const top = o.key.split('/')[0] ?? 'other';
    byTop[top] = byTop[top] ?? { bytes: 0, objects: 0 };
    byTop[top].bytes += o.size;
    byTop[top].objects += 1;
    const em = o.key.match(/entity=([^/]+)/);
    const season = o.key.match(/season=(\d{4})/);
    const family = em
      ? `entity=${em[1]}${season ? ` season=${season[1]}` : ''}`
      : o.key.includes('injur')
        ? 'injuries'
        : o.key.includes('odds')
          ? 'odds'
          : o.key.includes('prop')
            ? 'props'
            : top;
    byEntity[family] = byEntity[family] ?? { bytes: 0, objects: 0 };
    byEntity[family].bytes += o.size;
    byEntity[family].objects += 1;
  }

  const snapshot = {
    generatedAt,
    bdlHttp: 0,
    safety: {
      dataMode: mode.dataMode,
      offseasonMode: mode.offseason,
      cronDryRun: mode.cronDryRun,
      frozen: mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun,
      currentAnalyticsSeason: getAnalyticsSeason(),
      lockActive: lock.active,
      lockPid: lock.pid,
    },
    entitySums,
    familyPrefixes,
    manifests,
    bucket: {
      totalBytes,
      objectCount,
      totalMb: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
      byTop,
      byEntity,
    },
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(JSON.stringify({ out: OUT, objectCount, totalMb: snapshot.bucket.totalMb, lockActive: lock.active }, null, 2));
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
