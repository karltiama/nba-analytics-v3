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
    expect(report.postgame.status).toBe('UNKNOWN');
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
    expect(report.freeze.liveIngestionEnabled).toBe(false);
    expect(report.identity.alert).toBe(false);
    expect(report.identity.status).toBe('HEALTHY');
    expect(report.postgame.status).toBe('FROZEN_EXPECTED');
    expect(report.families.every((f) => f.config === 'FROZEN' || f.config === 'MANUAL_ONLY' || f.config === 'NOT_DEPLOYED')).toBe(
      true
    );
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

    const report = await collectPlatformHealth({
      env: liveEnv,
      now,
      s3,
      liveIngestionEnabled: true,
      goatSubscriptionActive: true,
    });
    expect(report.ingestion.find((s) => s.source === 'props')?.status).toBe('HEALTHY');
    expect(report.coverage.every((c) => c.status === 'HEALTHY')).toBe(true);
    expect(report.archives.every((a) => a.status === 'HEALTHY')).toBe(true);
    expect(report.injuryServing.status).toBe('HEALTHY');
    expect(report.injuryServing.authoritative).toBe(true);
    expect(report.overall).toBe('HEALTHY');
  });

  it('unresolved quarantine is visible; Class C census alone is not', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('player_identity_unresolved')) {
        return [{ status: 'UNRESOLVED', n: '2' }];
      }
      return [];
    });
    mockQueryOne.mockResolvedValue({ n: '81' });
    const report = await collectPlatformHealth({ env: freezeEnv, now, s3: null });
    expect(report.identity.unresolved).toBe(2);
    expect(report.identity.classCCanonical).toBe(81);
    expect(report.identity.alert).toBe(true);
    expect(report.identity.status).toBe('DEGRADED');
  });

  it('non-zero DLQ is visible without crashing /ops', async () => {
    const report = await collectPlatformHealth({
      env: freezeEnv,
      now,
      s3: null,
      aws: {
        scheduleObserved: 'DISABLED',
        queueDepth: 0,
        oldestAgeSeconds: 0,
        dlqDepth: 2,
        reservedConcurrencyApplied: false,
      },
    });
    expect(report.queues.dlqDepth).toBe(2);
    expect(report.queues.status).toBe('DEGRADED');
    expect(report.scheduleMismatch.status).toBe('FROZEN_EXPECTED');
  });

  it('frozen families never emit missed-run', async () => {
    const report = await collectPlatformHealth({ env: freezeEnv, now, s3: null });
    expect(report.families.every((f) => f.missedRun === 'NOT_EXPECTED')).toBe(true);
    expect(report.families.every((f) => f.status !== 'FAILED' && f.status !== 'STALE')).toBe(true);
    expect(report.overall).not.toBe('FAILED');
  });

  it('ACTIVE + recent invocation is healthy for nightly', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_database_size')) {
        return { pretty: '293 MB', bytes: '307000000' };
      }
      if (sql.includes('max(updated_at)') && sql.includes("season = '2026'")) {
        return { ts: '2026-09-06T12:00:00.000Z' };
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
    const report = await collectPlatformHealth({
      env: liveEnv,
      now,
      s3: null,
      liveIngestionEnabled: true,
      goatSubscriptionActive: true,
      aws: {
        queried: true,
        scheduleObserved: 'ENABLED',
        reservedConcurrencyApplied: false,
        lambdas: [
          {
            id: 'schedule_nightly_bdl',
            familyId: 'schedule_nightly_bdl',
            functionName: 'nightly-bdl-updater',
            optional: false,
            exists: true,
            state: 'Active',
            lastInvocationAt: '2026-09-06T12:00:00.000Z',
            lastInvocationSuccess: 'UNKNOWN',
            errors24h: 0,
            throttles24h: 0,
            durationMs: 800,
            reservedConcurrencyApplied: false,
            scheduleObserved: 'ENABLED',
            queried: true,
            deployState: 'DEPLOYED',
          },
        ],
      },
    });
    const nightly = report.families.find((f) => f.id === 'schedule_nightly_bdl')!;
    expect(nightly.config).toBe('ACTIVE');
    expect(nightly.missedRun).toBe('OK');
    expect(nightly.status).toBe('HEALTHY');
    expect(nightly.lastInvocationSuccess).toBe('UNKNOWN');
  });

  it('ACTIVE + enabled + overdue invocation is MISSED', async () => {
    const report = await collectPlatformHealth({
      env: liveEnv,
      now,
      s3: null,
      liveIngestionEnabled: true,
      goatSubscriptionActive: true,
      aws: {
        queried: true,
        scheduleObserved: 'ENABLED',
        lambdas: [
          {
            id: 'schedule_nightly_bdl',
            familyId: 'schedule_nightly_bdl',
            functionName: 'nightly-bdl-updater',
            optional: false,
            exists: true,
            state: 'Active',
            lastInvocationAt: '2026-09-01T12:00:00.000Z',
            lastInvocationSuccess: 'UNKNOWN',
            errors24h: 0,
            throttles24h: 0,
            durationMs: null,
            reservedConcurrencyApplied: false,
            scheduleObserved: 'ENABLED',
            queried: true,
            deployState: 'DEPLOYED',
          },
        ],
      },
    });
    expect(report.families.find((f) => f.id === 'schedule_nightly_bdl')?.missedRun).toBe('MISSED');
  });

  it('ACTIVE + schedule disabled is FAILED config mismatch', async () => {
    const report = await collectPlatformHealth({
      env: liveEnv,
      now,
      s3: null,
      liveIngestionEnabled: true,
      goatSubscriptionActive: true,
      aws: { queried: true, scheduleObserved: 'DISABLED' },
    });
    expect(report.scheduleMismatch.status).toBe('FAILED');
    expect(report.families.find((f) => f.id === 'schedule_nightly_bdl')?.missedRun).toBe(
      'CONFIG_MISMATCH'
    );
  });

  it('frozen + AWS schedule unexpectedly enabled is DEGRADED', async () => {
    const report = await collectPlatformHealth({
      env: freezeEnv,
      now,
      s3: null,
      aws: { queried: true, scheduleObserved: 'ENABLED' },
    });
    expect(report.scheduleMismatch.status).toBe('DEGRADED');
    expect(report.families.every((f) => f.missedRun === 'NOT_EXPECTED')).toBe(true);
  });

  it('AWS unavailable is UNKNOWN and /ops still renders', async () => {
    const report = await collectPlatformHealth({
      env: freezeEnv,
      now,
      s3: null,
      aws: { queried: true, scheduleObserved: 'UNKNOWN' },
    });
    expect(report.aws.status).toBe('UNKNOWN');
    expect(report.overall).toBeTruthy();
    expect(report.families.length).toBeGreaterThan(0);
  });

  it('postgame NOT_DEPLOYED is not an incident; provider block is not FAILED', async () => {
    const report = await collectPlatformHealth({
      env: freezeEnv,
      now,
      s3: null,
      aws: {
        queried: true,
        scheduleObserved: 'DISABLED',
        queues: [
          {
            id: 'postgame_stage',
            optional: true,
            deployed: false,
            visible: null,
            notVisible: null,
            oldestAgeSeconds: null,
            dlqDepth: null,
            deployState: 'NOT_DEPLOYED',
          },
        ],
        lambdas: [
          {
            id: 'postgame_stage_worker',
            familyId: null,
            functionName: 'postgame-stage-worker',
            optional: true,
            exists: false,
            state: null,
            lastInvocationAt: null,
            lastInvocationSuccess: 'UNKNOWN',
            errors24h: null,
            throttles24h: null,
            durationMs: null,
            reservedConcurrencyApplied: null,
            scheduleObserved: 'UNKNOWN',
            queried: true,
            deployState: 'NOT_DEPLOYED',
          },
        ],
      },
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('postgame_game_stages')) {
        throw new Error('relation "analytics.postgame_game_stages" does not exist');
      }
      return [];
    });
    const missing = await collectPlatformHealth({
      env: freezeEnv,
      now,
      s3: null,
      aws: {
        queried: true,
        scheduleObserved: 'DISABLED',
        queues: [
          {
            id: 'postgame_stage',
            optional: true,
            deployed: false,
            visible: null,
            notVisible: null,
            oldestAgeSeconds: null,
            dlqDepth: null,
            deployState: 'NOT_DEPLOYED',
          },
        ],
        lambdas: [
          {
            id: 'postgame_stage_worker',
            familyId: null,
            functionName: 'postgame-stage-worker',
            optional: true,
            exists: false,
            state: null,
            lastInvocationAt: null,
            lastInvocationSuccess: 'UNKNOWN',
            errors24h: null,
            throttles24h: null,
            durationMs: null,
            reservedConcurrencyApplied: null,
            scheduleObserved: 'UNKNOWN',
            queried: true,
            deployState: 'NOT_DEPLOYED',
          },
        ],
      },
    });
    expect(missing.postgame.schemaState).toBe('NOT_APPLIED');
    expect(missing.postgame.status).toBe('FROZEN_EXPECTED');
    expect(missing.queueCards.find((q) => q.id === 'postgame_stage')?.deployState).toBe(
      'NOT_DEPLOYED'
    );
    expect(missing.queueCards.find((q) => q.id === 'postgame_stage')?.status).not.toBe('FAILED');
    expect(missing.providers.find((p) => p.id === 'v1_stats')?.state).toBe(
      'BLOCKED_BY_SUBSCRIPTION'
    );
    expect(missing.providers.find((p) => p.id === 'v1_stats')?.status).toBe('BLOCKED');
    expect(missing.providers.find((p) => p.id === 'v1_stats')?.status).not.toBe('FAILED');
    expect(report.queues.reservedConcurrency).toBe('UNKNOWN');
  });
});
