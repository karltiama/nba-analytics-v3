import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  default: { query: vi.fn() },
}));

vi.mock('@/lib/prune/odds-coverage-gate', () => ({
  evaluateOddsCompactCoverage: vi.fn(),
}));
vi.mock('@/lib/prune/injury-coverage-gate', () => ({
  evaluateInjuryTransitionCoverage: vi.fn(),
}));
vi.mock('@/lib/prune/closing-lines', () => ({
  countPendingClosingLinesForPruneEligible: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { evaluateOddsCompactCoverage } from '@/lib/prune/odds-coverage-gate';
import { evaluateInjuryTransitionCoverage } from '@/lib/prune/injury-coverage-gate';
import { countPendingClosingLinesForPruneEligible } from '@/lib/prune/closing-lines';
import { collectPlatformHealth } from '@/lib/ops/platform-health';
import type { ArchiveS3Reader } from '@/lib/prune/archive-gate';
import type { EntityManifest } from '@/scripts/archive/archive-entity-core';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;
const mockOdds = evaluateOddsCompactCoverage as ReturnType<typeof vi.fn>;
const mockInjury = evaluateInjuryTransitionCoverage as ReturnType<typeof vi.fn>;
const mockProps = countPendingClosingLinesForPruneEligible as ReturnType<typeof vi.fn>;

const freezeEnv = {
  DATA_MODE: 'replay',
  OFFSEASON_MODE: '1',
  CRON_DRY_RUN: '1',
  NBA_RAW_PREFIX: 'raw',
} as NodeJS.ProcessEnv;

const liveEnv = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  NBA_RAW_PREFIX: 'raw',
} as NodeJS.ProcessEnv;

const now = new Date('2026-09-06T18:00:00.000Z');

function successManifest(entity: string, sourceTable: string): EntityManifest {
  return {
    schemaVersion: 1,
    s3Prefix: 'raw/...',
    exportMode: 'full',
    source: 'existing_ingestion',
    league: 'nba',
    season: 2025,
    entity,
    sourceTable,
    exportedAt: '2026-09-05T00:00:00.000Z',
    recordCount: 100,
    dateRange: { from: '2026-03-09', to: '2026-05-06' },
    partitions: ['2026-03-09'],
    status: 'success',
    notes: null,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockOdds.mockReset();
  mockInjury.mockReset();
  mockProps.mockReset();
  mockQuery.mockResolvedValue([]);
  mockQueryOne.mockResolvedValue(null);
  mockOdds.mockResolvedValue({
    ok: true,
    missingHistory: [],
    missingCurrent: [],
  });
  mockInjury.mockResolvedValue({
    unresolvedLeaveReports: 0,
    missingFirstSeen: 0,
    missingChanges: 0,
    duplicateLeaveReports: 0,
  });
  mockProps.mockResolvedValue(0);
});

describe('collectPlatformHealth', () => {
  it('does not crash when metrics are missing', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    mockQueryOne.mockRejectedValue(new Error('db down'));
    mockOdds.mockRejectedValue(new Error('coverage down'));
    mockInjury.mockRejectedValue(new Error('coverage down'));
    mockProps.mockRejectedValue(new Error('coverage down'));

    const report = await collectPlatformHealth({ env: freezeEnv, now, s3: null });
    expect(report.overall).toBeTruthy();
    expect(report.database.status).toBe('UNKNOWN');
    expect(report.coverage.every((c) => c.status === 'UNKNOWN')).toBe(true);
    expect(report.archives.every((a) => a.status === 'UNKNOWN')).toBe(true);
    expect(report.prune.status).toBe('UNKNOWN');
  });

  it('frozen + no recent ingest is expected, not a red failure', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_database_size')) {
        return { pretty: '293 MB', bytes: '307000000' };
      }
      if (sql.includes("status = 'success'")) {
        return { pulled_at: '2026-05-06T18:00:00.000Z' };
      }
      if (sql.includes('_pull_runs')) {
        return {
          status: 'success',
          pulled_at: '2026-05-06T18:00:00.000Z',
          completed_at: '2026-05-06T18:00:00.000Z',
          rows_stored: 1,
        };
      }
      if (sql.includes('player_injury_status_current')) {
        return { snapshot_at: '2026-05-06T18:00:00.000Z', pulled_at: '2026-05-06T18:00:00.000Z' };
      }
      return null;
    });

    const report = await collectPlatformHealth({ env: freezeEnv, now, s3: null });
    expect(report.freeze.frozen).toBe(true);
    expect(report.ingestion.find((s) => s.source === 'props')?.status).toBe('FROZEN_EXPECTED');
    expect(report.ingestion.find((s) => s.source === 'odds')?.status).toBe('FROZEN_EXPECTED');
    expect(report.ingestion.find((s) => s.source === 'injuries')?.status).toBe('FROZEN_EXPECTED');
    expect(report.injuryServing.authoritative).toBe(false);
    expect(report.injuryServing.status).toBe('FROZEN_EXPECTED');
    expect(report.overall).not.toBe('FAILED');
    expect(report.overall).not.toBe('STALE');
  });

  it('live + stale ingest and failed archive surface as stale/failed', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_database_size')) {
        return { pretty: '293 MB', bytes: '307000000' };
      }
      if (sql.includes('player_injury_status_current')) {
        return { snapshot_at: '2026-05-06T18:00:00.000Z' };
      }
      if (sql.includes("status = 'success'") || sql.includes('_pull_runs')) {
        return {
          status: 'success',
          pulled_at: '2026-05-06T18:00:00.000Z',
          completed_at: '2026-05-06T18:00:00.000Z',
          rows_stored: 1,
        };
      }
      return null;
    });
    mockInjury.mockResolvedValue({
      unresolvedLeaveReports: 4,
      missingFirstSeen: 0,
      missingChanges: 0,
      duplicateLeaveReports: 0,
    });

    const s3: ArchiveS3Reader = {
      getJson: async () =>
        ({
          ...successManifest('raw_odds_snapshots', 'raw.odds_snapshots'),
          status: 'error',
        }) as EntityManifest,
      objectExists: async () => true,
    };

    const report = await collectPlatformHealth({ env: liveEnv, now, s3 });
    expect(report.ingestion.find((s) => s.source === 'odds')?.status).toBe('STALE');
    expect(report.coverage.find((c) => c.kind === 'injury_meaningful_history')?.status).toBe(
      'DEGRADED'
    );
    expect(report.archives.some((a) => a.status === 'FAILED')).toBe(true);
    expect(report.overall).toBe('FAILED');
  });

  it('live + fresh success and complete coverage is healthy', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_database_size')) {
        return { pretty: '293 MB', bytes: '307000000' };
      }
      if (sql.includes('player_injury_status_current')) {
        return { snapshot_at: '2026-09-06T12:00:00.000Z' };
      }
      if (sql.includes("status = 'success'") || sql.includes('_pull_runs')) {
        return {
          status: 'success',
          pulled_at: '2026-09-06T12:00:00.000Z',
          completed_at: '2026-09-06T12:00:00.000Z',
          rows_stored: 10,
        };
      }
      return null;
    });

    const s3: ArchiveS3Reader = {
      getJson: async (key: string) => {
        if (key.includes('player_props_raw_v2')) {
          return successManifest('player_props_raw_v2', 'raw.player_prop_snapshots_v2');
        }
        if (key.includes('raw_odds_snapshots')) {
          return successManifest('raw_odds_snapshots', 'raw.odds_snapshots');
        }
        return successManifest('raw_player_injuries', 'raw.player_injuries');
      },
      objectExists: async () => true,
    };

    const report = await collectPlatformHealth({ env: liveEnv, now, s3 });
    expect(report.ingestion.find((s) => s.source === 'props')?.status).toBe('HEALTHY');
    expect(report.coverage.every((c) => c.status === 'HEALTHY')).toBe(true);
    expect(report.archives.every((a) => a.status === 'HEALTHY')).toBe(true);
    expect(report.injuryServing.status).toBe('HEALTHY');
    expect(report.injuryServing.authoritative).toBe(true);
    expect(report.overall).toBe('HEALTHY');
  });
});
