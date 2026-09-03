import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runPrunePropsJob } from '@/lib/prune/run-prune-props';
import type { ArchiveS3Reader } from '@/lib/prune/archive-gate';
import type { EntityManifest } from '@/scripts/archive/archive-entity-core';

function liveEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    PRUNE_ENABLED: '1',
    DATA_MODE: 'live_api',
    OFFSEASON_MODE: '0',
    CRON_DRY_RUN: '0',
    NBA_RAW_PREFIX: 'raw',
    ...overrides,
  };
}

function successManifest(): EntityManifest {
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
    partitions: ['2026-04-02'],
    status: 'success',
    notes: null,
  };
}

type QueryHandler = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;

function makePool(handler: QueryHandler): Pool {
  return { query: vi.fn(handler) } as unknown as Pool;
}

function defaultSqlHandler(state: {
  rawTotal: number;
  rawEligible: number;
  currentTotal: number;
  currentEligible: number;
  pending: number;
  seasons: number[];
  materializeCount?: number;
}): QueryHandler {
  let rawDeleted = false;
  let currentDeleted = false;
  return async (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').toLowerCase();
    if (s.includes('insert into research.prop_decision_lines')) {
      return { rows: [], rowCount: state.materializeCount ?? 0 };
    }
    if (s.includes('from (') && s.includes('prop_decision_lines') && s.includes('pending')) {
      return { rows: [{ count: String(state.pending) }] };
    }
    if (s.includes('from raw.player_prop_snapshots_v2') && s.includes('fetched_at < now()') && s.includes('count')) {
      return { rows: [{ count: String(state.rawEligible) }] };
    }
    if (s.includes('from analytics.player_props_current p') && s.includes('count')) {
      return { rows: [{ count: String(state.currentEligible) }] };
    }
    if (s.includes('from raw.player_prop_snapshots_v2') && s.includes('count(*)') && !s.includes('fetched_at <')) {
      return { rows: [{ count: String(rawDeleted ? 0 : state.rawTotal) }] };
    }
    if (s.includes('from analytics.player_props_current') && s.includes('count(*)') && !s.includes('inner join')) {
      return { rows: [{ count: String(currentDeleted ? 0 : state.currentTotal) }] };
    }
    if (s.includes('distinct') && s.includes('season')) {
      return { rows: state.seasons.map((season) => ({ season: String(season) })) };
    }
    if (s.includes('delete from raw.player_prop_snapshots_v2')) {
      if (rawDeleted) return { rows: [], rowCount: 0 };
      rawDeleted = true;
      return { rows: [], rowCount: state.rawEligible };
    }
    if (s.includes('delete from analytics.player_props_current')) {
      if (currentDeleted) return { rows: [], rowCount: 0 };
      currentDeleted = true;
      return { rows: [], rowCount: state.currentEligible };
    }
    throw new Error(`unexpected SQL in test: ${s.slice(0, 120)}`);
  };
}

describe('runPrunePropsJob', () => {
  it('skips mutations when PRUNE_ENABLED missing and live flags missing', async () => {
    const pool = makePool(async () => {
      throw new Error('should not query');
    });
    const result = await runPrunePropsJob({
      pool,
      authenticated: true,
      env: {},
      s3: null,
    });
    expect(result.body.skipped).toBe(true);
    expect(String(result.body.reason)).toMatch(/PRUNE_ENABLED/);
  });

  it('blocks raw prune when pending closing lines remain', async () => {
    const pool = makePool(
      defaultSqlHandler({
        rawTotal: 1000,
        rawEligible: 100,
        currentTotal: 500,
        currentEligible: 50,
        pending: 12,
        seasons: [2025],
      })
    );
    const result = await runPrunePropsJob({
      pool,
      authenticated: true,
      env: liveEnv(),
      s3: {
        getJson: async <T>() => successManifest() as T,
        objectExists: async () => true,
      },
    });
    expect(result.body.aborted).toBe(true);
    expect(result.body.rawPruneBlocked).toBe(true);
    expect(String(result.body.reason)).toMatch(/pending closing-line/);
    expect(result.audit.rowsDeleted.rawV2).toBe(0);
    expect(result.audit.rowsDeleted.analyticsCurrent).toBe(50);
  });

  it('blocks raw prune when archive missing but may still prune current', async () => {
    const pool = makePool(
      defaultSqlHandler({
        rawTotal: 1000,
        rawEligible: 100,
        currentTotal: 500,
        currentEligible: 50,
        pending: 0,
        seasons: [2025],
      })
    );
    const s3: ArchiveS3Reader = {
      getJson: async () => null,
      objectExists: async () => false,
    };
    const result = await runPrunePropsJob({
      pool,
      authenticated: true,
      env: liveEnv(),
      s3,
    });
    expect(result.body.rawPruneBlocked).toBe(true);
    expect(result.audit.rowsDeleted.rawV2).toBe(0);
    expect(result.audit.rowsDeleted.analyticsCurrent).toBe(50);
  });

  it('completes when gates pass', async () => {
    const pool = makePool(
      defaultSqlHandler({
        rawTotal: 1000,
        rawEligible: 100,
        currentTotal: 500,
        currentEligible: 50,
        pending: 0,
        seasons: [2025],
        materializeCount: 3,
      })
    );
    const result = await runPrunePropsJob({
      pool,
      authenticated: true,
      env: liveEnv(),
      s3: {
        getJson: async <T>() => successManifest() as T,
        objectExists: async () => true,
      },
    });
    expect(result.body.ok).toBe(true);
    expect(result.body.prunedRawV2).toBe(100);
    expect(result.body.prunedAnalyticsCurrent).toBe(50);
    expect(result.body.materialized).toBe(3);
    expect(result.audit.outcome).toBe('completed');
  });

  it('aborts when current max-delete caps exceeded', async () => {
    const pool = makePool(
      defaultSqlHandler({
        rawTotal: 948_233,
        rawEligible: 948_233,
        currentTotal: 152_790,
        currentEligible: 152_790,
        pending: 0,
        seasons: [2025],
      })
    );
    const result = await runPrunePropsJob({
      pool,
      authenticated: true,
      env: liveEnv(),
      s3: {
        getJson: async <T>() => successManifest() as T,
        objectExists: async () => true,
      },
    });
    expect(result.body.aborted).toBe(true);
    expect(String(result.body.reason)).toMatch(/PRUNE_MAX_DELETE/);
    expect(result.audit.rowsDeleted.rawV2).toBe(0);
    expect(result.audit.rowsDeleted.analyticsCurrent).toBe(0);
  });

  it('blocks raw via max-delete but can still prune current', async () => {
    const pool = makePool(
      defaultSqlHandler({
        rawTotal: 500_000,
        rawEligible: 250_000,
        currentTotal: 10_000,
        currentEligible: 1_000,
        pending: 0,
        seasons: [2025],
      })
    );
    const result = await runPrunePropsJob({
      pool,
      authenticated: true,
      env: liveEnv(),
      s3: {
        getJson: async <T>() => successManifest() as T,
        objectExists: async () => true,
      },
    });
    expect(result.body.rawPruneBlocked).toBe(true);
    expect(String(result.body.reason)).toMatch(/PRUNE_MAX_DELETE_ROWS/);
    expect(result.audit.rowsDeleted.rawV2).toBe(0);
    expect(result.audit.rowsDeleted.analyticsCurrent).toBe(1_000);
  });
});
