import { describe, expect, it } from 'vitest';
import {
  RAW_INJURIES_ARCHIVE_SPEC,
  RAW_ODDS_ARCHIVE_SPEC,
  validateManifestMetadata,
  verifyRawInjuriesArchiveGate,
  verifyRawOddsArchiveGate,
  verifyRawPropsArchiveGate,
  type ArchiveS3Reader,
} from '@/lib/prune/archive-gate';
import type { EntityManifest } from '@/scripts/archive/archive-entity-core';

function successManifest(overrides: Partial<EntityManifest> = {}): EntityManifest {
  return {
    schemaVersion: 1,
    s3Prefix: 'raw/...',
    exportMode: 'full',
    source: 'existing_ingestion',
    league: 'nba',
    season: 2025,
    entity: 'player_props_raw_v2',
    sourceTable: 'raw.player_prop_snapshots_v2',
    exportedAt: '2026-09-03T00:00:00.000Z',
    recordCount: 1000,
    dateRange: { from: '2026-04-02', to: '2026-05-02' },
    partitions: ['2026-04-02', '2026-04-03'],
    status: 'success',
    notes: null,
    ...overrides,
  };
}

function successOddsManifest(overrides: Partial<EntityManifest> = {}): EntityManifest {
  return successManifest({
    entity: 'raw_odds_snapshots',
    sourceTable: 'raw.odds_snapshots',
    recordCount: 65735,
    dateRange: { from: '2026-03-09', to: '2026-05-06' },
    partitions: ['2026-03-09', '2026-05-06'],
    ...overrides,
  });
}

function successInjuriesManifest(overrides: Partial<EntityManifest> = {}): EntityManifest {
  return successManifest({
    entity: 'raw_player_injuries',
    sourceTable: 'raw.player_injuries',
    recordCount: 24469,
    dateRange: { from: '2026-03-10', to: '2026-05-06' },
    partitions: ['2026-03-10', '2026-05-06'],
    ...overrides,
  });
}

describe('validateManifestMetadata', () => {
  it('blocks missing manifest', () => {
    expect(validateManifestMetadata(null, 2025)).toEqual({
      ok: false,
      reason: 'manifest missing',
    });
  });

  it('blocks failed/non-success status', () => {
    const r = validateManifestMetadata(successManifest({ status: 'error' }), 2025);
    expect(r.ok).toBe(false);
  });

  it('blocks zero recordCount', () => {
    const r = validateManifestMetadata(successManifest({ recordCount: 0 }), 2025);
    expect(r.ok).toBe(false);
  });

  it('blocks wrong entity/season/sourceTable', () => {
    expect(
      validateManifestMetadata(successManifest({ entity: 'other' }), 2025).ok
    ).toBe(false);
    expect(
      validateManifestMetadata(successManifest({ season: 2024 }), 2025).ok
    ).toBe(false);
    expect(
      validateManifestMetadata(
        successManifest({ sourceTable: 'raw.other' }),
        2025
      ).ok
    ).toBe(false);
  });

  it('accepts valid metadata', () => {
    expect(validateManifestMetadata(successManifest(), 2025)).toEqual({ ok: true });
  });

  it('accepts odds metadata only when the odds spec is passed', () => {
    const odds = successOddsManifest();
    expect(validateManifestMetadata(odds, 2025).ok).toBe(false);
    expect(validateManifestMetadata(odds, 2025, RAW_ODDS_ARCHIVE_SPEC)).toEqual({
      ok: true,
    });
  });

  it('does not accept a props manifest against the odds spec', () => {
    const r = validateManifestMetadata(successManifest(), 2025, RAW_ODDS_ARCHIVE_SPEC);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/entity mismatch/);
  });
});

describe('verifyRawPropsArchiveGate', () => {
  it('blocks when S3 unavailable and seasons present', async () => {
    const r = await verifyRawPropsArchiveGate({
      s3: null,
      rawPrefix: 'raw',
      seasons: [2025],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/S3 archive client unavailable/);
  });

  it('passes when no seasons eligible', async () => {
    const r = await verifyRawPropsArchiveGate({
      s3: null,
      rawPrefix: 'raw',
      seasons: [],
    });
    expect(r.ok).toBe(true);
  });

  it('blocks missing manifest object', async () => {
    const s3: ArchiveS3Reader = {
      getJson: async () => null,
      objectExists: async () => false,
    };
    const r = await verifyRawPropsArchiveGate({
      s3,
      rawPrefix: 'raw',
      seasons: [2025],
    });
    expect(r.ok).toBe(false);
    expect(r.seasons[0]?.reason).toMatch(/manifest missing/);
  });

  it('blocks when partition objects are missing', async () => {
    const s3: ArchiveS3Reader = {
      getJson: async <T>() => successManifest() as T,
      objectExists: async () => false,
    };
    const r = await verifyRawPropsArchiveGate({
      s3,
      rawPrefix: 'raw',
      seasons: [2025],
    });
    expect(r.ok).toBe(false);
    expect(r.seasons[0]?.reason).toMatch(/missing/);
  });

  it('passes when manifest + partitions exist', async () => {
    const s3: ArchiveS3Reader = {
      getJson: async <T>() => successManifest() as T,
      objectExists: async () => true,
    };
    const r = await verifyRawPropsArchiveGate({
      s3,
      rawPrefix: 'raw',
      seasons: [2025],
    });
    expect(r.ok).toBe(true);
    expect(r.seasons[0]?.recordCount).toBe(1000);
  });
});

describe('verifyRawOddsArchiveGate', () => {
  it('blocks when S3 unavailable and seasons present', async () => {
    const r = await verifyRawOddsArchiveGate({
      s3: null,
      rawPrefix: 'raw',
      seasons: [2025],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/S3 archive client unavailable/);
  });

  it('rejects a props manifest for the odds entity', async () => {
    const s3: ArchiveS3Reader = {
      getJson: async <T>() => successManifest() as T,
      objectExists: async () => true,
    };
    const r = await verifyRawOddsArchiveGate({
      s3,
      rawPrefix: 'raw',
      seasons: [2025],
    });
    expect(r.ok).toBe(false);
    expect(r.seasons[0]?.reason).toMatch(/entity mismatch/);
  });

  it('passes when odds manifest + partitions exist', async () => {
    const s3: ArchiveS3Reader = {
      getJson: async <T>() => successOddsManifest() as T,
      objectExists: async () => true,
    };
    const r = await verifyRawOddsArchiveGate({
      s3,
      rawPrefix: 'raw',
      seasons: [2025],
    });
    expect(r.ok).toBe(true);
    expect(r.seasons[0]?.recordCount).toBe(65735);
    expect(r.seasons[0]?.partitionsChecked).toBe(2);
  });
});

describe('verifyRawInjuriesArchiveGate', () => {
  it('accepts injury metadata only when the injury spec is passed', () => {
    const injuries = successInjuriesManifest();
    expect(validateManifestMetadata(injuries, 2025).ok).toBe(false);
    expect(validateManifestMetadata(injuries, 2025, RAW_INJURIES_ARCHIVE_SPEC)).toEqual({
      ok: true,
    });
  });

  it('does not accept a props manifest against the injury spec', () => {
    const r = validateManifestMetadata(successManifest(), 2025, RAW_INJURIES_ARCHIVE_SPEC);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/entity mismatch/);
  });

  it('rejects an odds manifest for the injury entity', async () => {
    const s3: ArchiveS3Reader = {
      getJson: async <T>() => successOddsManifest() as T,
      objectExists: async () => true,
    };
    const r = await verifyRawInjuriesArchiveGate({
      s3,
      rawPrefix: 'raw',
      seasons: [2025],
    });
    expect(r.ok).toBe(false);
    expect(r.seasons[0]?.reason).toMatch(/entity mismatch/);
  });

  it('passes when injury manifest + partitions exist', async () => {
    const s3: ArchiveS3Reader = {
      getJson: async <T>() => successInjuriesManifest() as T,
      objectExists: async () => true,
    };
    const r = await verifyRawInjuriesArchiveGate({
      s3,
      rawPrefix: 'raw',
      seasons: [2025],
    });
    expect(r.ok).toBe(true);
    expect(r.seasons[0]?.recordCount).toBe(24469);
    expect(r.seasons[0]?.partitionsChecked).toBe(2);
  });
});
