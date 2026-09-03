import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { EntityDef, SeasonContext } from '../entity-registry';
import {
  archiveEntity,
  countJsonLines,
  isSuccessfulCompleteManifest,
  shouldPreserveExistingManifest,
  verifyExistingPartitionObject,
  type ArchiveS3,
  type EntityManifest,
} from '../archive-entity-core';

function ndjson(rows: unknown[]): string {
  if (rows.length === 0) return '';
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function makeEntity(over: Partial<EntityDef> & Pick<EntityDef, 'listPartitions' | 'countRows' | 'fetchBatch'>): EntityDef {
  return {
    entity: 'player_props_raw_v2',
    sourceTable: 'raw.player_prop_snapshots_v2',
    partitionStrategy: 'date',
    paginationKey: 'id',
    seasonScoped: true,
    notes: 'test entity',
    ...over,
  };
}

function makeS3(initial: {
  objects?: Record<string, string>;
  manifests?: Record<string, EntityManifest>;
}): ArchiveS3 & {
  putJsonCalls: Array<{ key: string; obj: unknown }>;
  putJsonLinesCalls: Array<{ key: string; rows: unknown[] }>;
} {
  const objects = { ...(initial.objects ?? {}) };
  const manifests = { ...(initial.manifests ?? {}) };
  const putJsonCalls: Array<{ key: string; obj: unknown }> = [];
  const putJsonLinesCalls: Array<{ key: string; rows: unknown[] }> = [];

  return {
    putJsonCalls,
    putJsonLinesCalls,
    objectExists: async (key: string) => key in objects || key in manifests,
    getText: async (key: string) => (key in objects ? objects[key] : null),
    getJson: async <T>(key: string) => {
      if (key in manifests) return manifests[key] as T;
      if (key in objects) {
        try {
          return JSON.parse(objects[key]) as T;
        } catch {
          return null;
        }
      }
      return null;
    },
    putJson: async (key, obj) => {
      putJsonCalls.push({ key, obj });
      manifests[key] = obj as EntityManifest;
      objects[key] = JSON.stringify(obj, null, 2) + '\n';
      return { written: true, reason: 'written' as const };
    },
    putJsonLines: async (key, rows) => {
      putJsonLinesCalls.push({ key, rows: [...rows] });
      objects[key] = ndjson(rows);
      return { written: true, reason: 'written' as const, count: rows.length };
    },
  };
}

const ctx: SeasonContext = {
  season: 2025,
  seasonStart: '2025-10-21',
  seasonEnd: '2026-05-12',
};

const db = {} as Pool;

const successManifest = (over: Partial<EntityManifest> = {}): EntityManifest => ({
  schemaVersion: 1,
  s3Prefix: 'raw/source=existing_ingestion/league=nba/season=2025/entity=player_props_raw_v2',
  exportMode: 'full',
  source: 'existing_ingestion',
  league: 'nba',
  season: 2025,
  entity: 'player_props_raw_v2',
  sourceTable: 'raw.player_prop_snapshots_v2',
  exportedAt: '2026-08-31T23:40:29.000Z',
  recordCount: 5,
  dateRange: { from: '2026-04-02', to: '2026-04-03' },
  partitions: ['2026-04-02', '2026-04-03'],
  status: 'success',
  notes: 'test',
  ...over,
});

describe('countJsonLines', () => {
  it('counts NDJSON rows with trailing newline', () => {
    expect(countJsonLines('{"a":1}\n{"a":2}\n')).toBe(2);
  });

  it('treats empty / null as zero', () => {
    expect(countJsonLines(null)).toBe(0);
    expect(countJsonLines('')).toBe(0);
  });
});

describe('shouldPreserveExistingManifest', () => {
  it('preserves successful complete when next is skipped/empty/zero', () => {
    const existing = successManifest({ recordCount: 948233, partitions: ['2026-04-02'] });
    expect(
      shouldPreserveExistingManifest(existing, successManifest({ status: 'skipped', recordCount: 0, partitions: [] }))
    ).toBe(true);
    expect(
      shouldPreserveExistingManifest(existing, successManifest({ status: 'empty', recordCount: 0, partitions: [] }))
    ).toBe(true);
  });

  it('allows overwrite with a new successful complete manifest', () => {
    const existing = successManifest({ recordCount: 5 });
    expect(
      shouldPreserveExistingManifest(
        existing,
        successManifest({ recordCount: 948233, partitions: ['2026-04-02', '2026-04-03'] })
      )
    ).toBe(false);
  });

  it('isSuccessfulCompleteManifest requires success + positive count', () => {
    expect(isSuccessfulCompleteManifest(successManifest())).toBe(true);
    expect(isSuccessfulCompleteManifest(successManifest({ status: 'skipped', recordCount: 0 }))).toBe(false);
  });
});

describe('verifyExistingPartitionObject', () => {
  it('passes when line count matches', async () => {
    const s3 = makeS3({ objects: { 'k/data.jsonl': ndjson([{ id: 1 }, { id: 2 }]) } });
    const r = await verifyExistingPartitionObject({ s3, key: 'k/data.jsonl', expectedCount: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.actualCount).toBe(2);
  });

  it('fails when missing', async () => {
    const s3 = makeS3({});
    const r = await verifyExistingPartitionObject({ s3, key: 'missing.jsonl', expectedCount: 1 });
    expect(r.ok).toBe(false);
  });

  it('fails on corrupt count mismatch', async () => {
    const s3 = makeS3({ objects: { 'k/data.jsonl': ndjson([{ id: 1 }]) } });
    const r = await verifyExistingPartitionObject({ s3, key: 'k/data.jsonl', expectedCount: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.actualCount).toBe(1);
  });
});

describe('archiveEntity', () => {
  const prefix = 'raw/source=existing_ingestion/league=nba/season=2025/entity=player_props_raw_v2';
  const d1 = `${prefix}/dt=2026-04-02/data.jsonl`;
  const d2 = `${prefix}/dt=2026-04-03/data.jsonl`;
  const manifestKey = `${prefix}/_manifest.json`;

  function entityWithPartitions(
    parts: string[],
    counts: Record<string, number>,
    rows: Record<string, unknown[]>
  ): EntityDef {
    return makeEntity({
      listPartitions: async () => parts,
      countRows: async (_db, _ctx, partition) => counts[partition ?? ''] ?? 0,
      fetchBatch: async (_db, _ctx, partition) => ({
        rows: rows[partition ?? ''] ?? [],
        nextCursor: null,
      }),
    });
  }

  it('entirely new archive uploads all partitions and writes success manifest', async () => {
    const s3 = makeS3({});
    const entity = entityWithPartitions(
      ['2026-04-02', '2026-04-03'],
      { '2026-04-02': 2, '2026-04-03': 3 },
      {
        '2026-04-02': [{ id: 1 }, { id: 2 }],
        '2026-04-03': [{ id: 3 }, { id: 4 }, { id: 5 }],
      }
    );

    const summary = await archiveEntity({
      entity,
      db,
      s3,
      rawPrefix: 'raw',
      args: { season: 2025, dryRun: false, overwrite: false, batchSize: 1000 },
      ctx,
      nowIso: '2026-09-03T00:00:00.000Z',
    });

    expect(summary.status).toBe('success');
    expect(summary.recordCount).toBe(5);
    expect(summary.written).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(s3.putJsonLinesCalls).toHaveLength(2);
    const manifestPut = s3.putJsonCalls.find((c) => c.key === manifestKey);
    expect(manifestPut).toBeTruthy();
    const m = manifestPut!.obj as EntityManifest;
    expect(m.status).toBe('success');
    expect(m.recordCount).toBe(5);
    expect(m.partitions).toEqual(['2026-04-02', '2026-04-03']);
    expect(m.dateRange).toEqual({ from: '2026-04-02', to: '2026-04-03' });
  });

  it('entirely existing archive verifies objects, skips upload, writes complete success manifest', async () => {
    const s3 = makeS3({
      objects: {
        [d1]: ndjson([{ id: 1 }, { id: 2 }]),
        [d2]: ndjson([{ id: 3 }, { id: 4 }, { id: 5 }]),
      },
    });
    const entity = entityWithPartitions(
      ['2026-04-02', '2026-04-03'],
      { '2026-04-02': 2, '2026-04-03': 3 },
      {
        '2026-04-02': [{ id: 1 }, { id: 2 }],
        '2026-04-03': [{ id: 3 }, { id: 4 }, { id: 5 }],
      }
    );

    const summary = await archiveEntity({
      entity,
      db,
      s3,
      rawPrefix: 'raw',
      args: { season: 2025, dryRun: false, overwrite: false, batchSize: 1000 },
      ctx,
    });

    expect(summary.status).toBe('success');
    expect(summary.recordCount).toBe(5);
    expect(summary.written).toBe(0);
    expect(summary.skipped).toBe(2);
    expect(s3.putJsonLinesCalls).toHaveLength(0);
    const m = s3.putJsonCalls.find((c) => c.key === manifestKey)!.obj as EntityManifest;
    expect(m.status).toBe('success');
    expect(m.recordCount).toBe(5);
    expect(m.partitions).toEqual(['2026-04-02', '2026-04-03']);
    expect(m.dateRange).toEqual({ from: '2026-04-02', to: '2026-04-03' });
  });

  it('partially existing archive uploads missing partitions and includes verified ones', async () => {
    const s3 = makeS3({
      objects: {
        [d1]: ndjson([{ id: 1 }, { id: 2 }]),
      },
    });
    const entity = entityWithPartitions(
      ['2026-04-02', '2026-04-03'],
      { '2026-04-02': 2, '2026-04-03': 3 },
      {
        '2026-04-02': [{ id: 1 }, { id: 2 }],
        '2026-04-03': [{ id: 3 }, { id: 4 }, { id: 5 }],
      }
    );

    const summary = await archiveEntity({
      entity,
      db,
      s3,
      rawPrefix: 'raw',
      args: { season: 2025, dryRun: false, overwrite: false, batchSize: 1000 },
      ctx,
    });

    expect(summary.status).toBe('success');
    expect(summary.recordCount).toBe(5);
    expect(summary.written).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(s3.putJsonLinesCalls.map((c) => c.key)).toEqual([d2]);
    const m = s3.putJsonCalls.find((c) => c.key === manifestKey)!.obj as EntityManifest;
    expect(m.partitions).toEqual(['2026-04-02', '2026-04-03']);
    expect(m.recordCount).toBe(5);
  });

  it('rerunning a completed archive never writes empty/skipped manifest', async () => {
    const existing = successManifest({
      recordCount: 5,
      partitions: ['2026-04-02', '2026-04-03'],
      dateRange: { from: '2026-04-02', to: '2026-04-03' },
    });
    const s3 = makeS3({
      objects: {
        [d1]: ndjson([{ id: 1 }, { id: 2 }]),
        [d2]: ndjson([{ id: 3 }, { id: 4 }, { id: 5 }]),
        [manifestKey]: JSON.stringify(existing),
      },
      manifests: { [manifestKey]: existing },
    });
    const entity = entityWithPartitions(
      ['2026-04-02', '2026-04-03'],
      { '2026-04-02': 2, '2026-04-03': 3 },
      {
        '2026-04-02': [{ id: 1 }, { id: 2 }],
        '2026-04-03': [{ id: 3 }, { id: 4 }, { id: 5 }],
      }
    );

    const summary = await archiveEntity({
      entity,
      db,
      s3,
      rawPrefix: 'raw',
      args: { season: 2025, dryRun: false, overwrite: false, batchSize: 1000 },
      ctx,
    });

    expect(summary.status).toBe('success');
    expect(summary.recordCount).toBe(5);
    expect(s3.putJsonLinesCalls).toHaveLength(0);
    // Manifest rewritten with complete success (not skipped/empty)
    const lastManifest = s3.putJsonCalls.filter((c) => c.key === manifestKey).at(-1)?.obj as EntityManifest;
    expect(lastManifest.status).toBe('success');
    expect(lastManifest.recordCount).toBe(5);
    expect(lastManifest.partitions).toHaveLength(2);
  });

  it('missing/corrupt existing partition fails verification and does not upload a false success', async () => {
    const s3 = makeS3({
      objects: {
        // Corrupt: only 1 row but DB expects 2
        [d1]: ndjson([{ id: 1 }]),
      },
      manifests: {
        [manifestKey]: successManifest({ recordCount: 5, partitions: ['2026-04-02', '2026-04-03'] }),
      },
    });
    const entity = entityWithPartitions(
      ['2026-04-02'],
      { '2026-04-02': 2 },
      { '2026-04-02': [{ id: 1 }, { id: 2 }] }
    );

    await expect(
      archiveEntity({
        entity,
        db,
        s3,
        rawPrefix: 'raw',
        args: { season: 2025, dryRun: false, overwrite: false, batchSize: 1000 },
        ctx,
      })
    ).rejects.toThrow(/failed verification/);

    // Safety: must not have replaced the good manifest with empty/skipped
    const badOverwrite = s3.putJsonCalls.find((c) => {
      if (c.key !== manifestKey) return false;
      const m = c.obj as EntityManifest;
      return m.status === 'skipped' || m.recordCount === 0;
    });
    expect(badOverwrite).toBeUndefined();
  });

  it('preserves existing successful manifest if a degenerate next would wipe it', async () => {
    // Simulate the old bug path by forcing empty inclusion via all-empty source counts
    // while a successful manifest already exists — shouldPreserve kicks in.
    const existing = successManifest({
      recordCount: 948233,
      partitions: Array.from({ length: 26 }, (_, i) => `2026-04-${String(i + 1).padStart(2, '0')}`).slice(0, 26),
    });
    // Fix partitions to real dates used in production verification
    existing.partitions = [
      '2026-04-02',
      '2026-04-03',
      '2026-04-04',
      '2026-04-05',
      '2026-04-06',
      '2026-04-07',
      '2026-04-08',
      '2026-04-09',
      '2026-04-10',
      '2026-04-12',
      '2026-04-17',
      '2026-04-18',
      '2026-04-19',
      '2026-04-20',
      '2026-04-21',
      '2026-04-22',
      '2026-04-23',
      '2026-04-24',
      '2026-04-25',
      '2026-04-26',
      '2026-04-27',
      '2026-04-28',
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
    ];
    existing.dateRange = { from: '2026-04-02', to: '2026-05-02' };

    const s3 = makeS3({
      manifests: { [manifestKey]: existing },
      objects: { [manifestKey]: JSON.stringify(existing) },
    });

    // No partitions discovered → empty next manifest
    const entity = entityWithPartitions([], {}, {});

    const summary = await archiveEntity({
      entity,
      db,
      s3,
      rawPrefix: 'raw',
      args: { season: 2025, dryRun: false, overwrite: false, batchSize: 1000 },
      ctx,
    });

    expect(summary.preservedManifest).toBe(true);
    expect(summary.recordCount).toBe(948233);
    expect(summary.status).toBe('success');
    // putJson for manifest should not have wiped it — either no put, or preserve path
    const wiped = s3.putJsonCalls.find((c) => {
      if (c.key !== manifestKey) return false;
      const m = c.obj as EntityManifest;
      return m.recordCount === 0 || m.status === 'skipped';
    });
    expect(wiped).toBeUndefined();
  });
});
