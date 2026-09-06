import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runPruneOddsJob } from '@/lib/prune/run-prune-odds';
import type { ArchiveS3Reader } from '@/lib/prune/archive-gate';
import type { EntityManifest } from '@/scripts/archive/archive-entity-core';
import { resolveOddsRawRetentionDays } from '@/lib/prune/odds-retention';

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

function freezeEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATA_MODE: 'replay',
    OFFSEASON_MODE: '1',
    CRON_DRY_RUN: '1',
    NBA_RAW_PREFIX: 'raw',
    ...overrides,
  };
}

function successOddsManifest(overrides: Partial<EntityManifest> = {}): EntityManifest {
  return {
    schemaVersion: 1,
    s3Prefix: 'raw/...',
    exportMode: 'full',
    source: 'existing_ingestion',
    league: 'nba',
    season: 2025,
    entity: 'raw_odds_snapshots',
    sourceTable: 'raw.odds_snapshots',
    exportedAt: '2026-09-06T00:00:00.000Z',
    recordCount: 65735,
    dateRange: { from: '2026-03-09', to: '2026-05-06' },
    partitions: ['2026-03-09', '2026-05-06'],
    status: 'success',
    notes: null,
    ...overrides,
  };
}

function oddsS3(manifest: EntityManifest | null = successOddsManifest()): ArchiveS3Reader {
  return {
    getJson: async <T>() => manifest as T,
    objectExists: async () => manifest != null,
  };
}

type QueryHandler = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }>;

function makePool(handler: QueryHandler): Pool {
  return { query: vi.fn(handler) } as unknown as Pool;
}

function sqlHandler(state: {
  total: number;
  eligible: number;
  games: number;
  seasons: number[];
  missingHistory?: string[];
  missingCurrent?: string[];
  oldest?: string;
  newest?: string;
  cutoffEt?: string;
}): QueryHandler {
  return async (sql) => {
    const s = sql.replace(/\s+/g, ' ').toLowerCase();
    if (s.includes('delete from raw.odds_snapshots')) {
      throw new Error('real DELETE must not run in tests');
    }
    if (s.includes('cutoff_et')) {
      return { rows: [{ cutoff_et: state.cutoffEt ?? '2026-08-07' }] };
    }
    if (s.includes('eligible_rows')) {
      return {
        rows: [
          {
            eligible_rows: String(state.eligible),
            eligible_games: String(state.games),
            oldest: state.oldest ?? '2026-03-09T13:55:14.873Z',
            newest: state.newest ?? '2026-05-06T21:30:07.382Z',
          },
        ],
      };
    }
    if (s.includes('from raw.odds_snapshots') && s.includes('count(*)') && !s.includes('america/new_york')) {
      return { rows: [{ count: String(state.total) }] };
    }
    if (s.includes('distinct') && s.includes('season')) {
      return { rows: state.seasons.map((season) => ({ season: String(season) })) };
    }
    if (s.includes('count(distinct r.game_id)')) {
      return { rows: [{ n: state.games }] };
    }
    if (s.includes('game_odds_history')) {
      return { rows: (state.missingHistory ?? []).map((game_id) => ({ game_id })) };
    }
    if (s.includes('game_odds_current')) {
      return { rows: (state.missingCurrent ?? []).map((game_id) => ({ game_id })) };
    }
    throw new Error(`unexpected sql: ${sql}`);
  };
}

describe('resolveOddsRawRetentionDays', () => {
  it('defaults missing/invalid/non-positive to 30', () => {
    expect(resolveOddsRawRetentionDays(undefined)).toBe(30);
    expect(resolveOddsRawRetentionDays('')).toBe(30);
    expect(resolveOddsRawRetentionDays('abc')).toBe(30);
    expect(resolveOddsRawRetentionDays('0')).toBe(30);
    expect(resolveOddsRawRetentionDays('-5')).toBe(30);
  });

  it('accepts a positive integer', () => {
    expect(resolveOddsRawRetentionDays('14')).toBe(14);
    expect(resolveOddsRawRetentionDays('30')).toBe(30);
  });
});

describe('runPruneOddsJob', () => {
  it('skips and does not delete when PRUNE_ENABLED is missing', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 65735, eligible: 65735, games: 334, seasons: [2025] })),
      env: liveEnv({ PRUNE_ENABLED: undefined }),
      authenticated: true,
      s3: oddsS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('skipped');
    expect(r.body.rowsDeleted).toBe(0);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('skips execute on frozen/replay runtime even if PRUNE_ENABLED=1', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 65735, eligible: 65735, games: 334, seasons: [2025] })),
      env: freezeEnv({ PRUNE_ENABLED: '1' }),
      authenticated: true,
      s3: oddsS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('skipped');
    expect(String(r.audit.reason)).toMatch(/DATA_MODE=replay|live_api/);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('blocks when archive is missing', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 10, games: 2, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: oddsS3(null),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('aborted');
    expect(r.audit.archiveVerification.ok).toBe(false);
    expect(String(r.audit.reason)).toMatch(/archive gate failed/);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('blocks a props/wrong-entity manifest', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const bad = successOddsManifest({
      entity: 'player_props_raw_v2',
      sourceTable: 'raw.player_prop_snapshots_v2',
    });
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 10, games: 2, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: oddsS3(bad),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('aborted');
    expect(String(r.audit.reason)).toMatch(/entity mismatch|archive gate failed/);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('blocks when compact coverage fails', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneOddsJob({
      pool: makePool(
        sqlHandler({
          total: 100,
          eligible: 10,
          games: 2,
          seasons: [2025],
          missingHistory: ['21681577'],
        })
      ),
      env: liveEnv(),
      authenticated: true,
      s3: oddsS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('aborted');
    expect(r.audit.coverage.ok).toBe(false);
    expect(String(r.audit.reason)).toMatch(/coverage gate failed/);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('allows a normal candidate percentage under 35%', async () => {
    const deleteEligible = vi.fn(async () => 10);
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 10, games: 2, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: oddsS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('completed');
    expect(r.audit.maxDelete.allowed).toBe(true);
    expect(r.audit.rowsDeleted).toBe(10);
    expect(deleteEligible).toHaveBeenCalledTimes(1);
  });

  it('refuses a >35% candidate set without override', async () => {
    const deleteEligible = vi.fn(async () => 65735);
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 65735, eligible: 65735, games: 334, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: oddsS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('aborted');
    expect(r.audit.maxDelete.allowed).toBe(false);
    expect(String(r.audit.maxDelete.reason)).toMatch(/PRUNE_MAX_DELETE_PERCENT=35/);
    expect(r.audit.rowsDeleted).toBe(0);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('allows max-delete progression with explicit PRUNE_ALLOW_LARGE_DELETE=1', async () => {
    const deleteEligible = vi.fn(async () => 65735);
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 65735, eligible: 65735, games: 334, seasons: [2025] })),
      env: liveEnv({ PRUNE_ALLOW_LARGE_DELETE: '1' }),
      authenticated: true,
      s3: oddsS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.maxDelete.allowed).toBe(true);
    expect(String(r.audit.maxDelete.reason)).toMatch(/PRUNE_ALLOW_LARGE_DELETE=1/);
    expect(deleteEligible).toHaveBeenCalledTimes(1);
    expect(r.audit.rowsDeleted).toBe(65735);
  });

  it('does not let large-delete override bypass a missing archive', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 65735, eligible: 65735, games: 334, seasons: [2025] })),
      env: liveEnv({ PRUNE_ALLOW_LARGE_DELETE: '1' }),
      authenticated: true,
      s3: oddsS3(null),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.maxDelete.allowed).toBe(true);
    expect(r.audit.archiveVerification.ok).toBe(false);
    expect(r.audit.outcome).toBe('aborted');
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('does not let large-delete override bypass coverage failure', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneOddsJob({
      pool: makePool(
        sqlHandler({
          total: 65735,
          eligible: 65735,
          games: 334,
          seasons: [2025],
          missingCurrent: ['21708301'],
        })
      ),
      env: liveEnv({ PRUNE_ALLOW_LARGE_DELETE: '1' }),
      authenticated: true,
      s3: oddsS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.maxDelete.allowed).toBe(true);
    expect(r.audit.coverage.ok).toBe(false);
    expect(r.audit.outcome).toBe('aborted');
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('never calls delete during dry-run even when every gate would pass', async () => {
    const deleteEligible = vi.fn(async () => 10);
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 10, games: 2, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: oddsS3(),
      dryRun: true,
      deleteEligible,
    });
    expect(r.audit.dryRun).toBe(true);
    expect(r.audit.outcome).toBe('completed');
    expect(r.body.wouldDelete).toBe(10);
    expect(r.audit.rowsDeleted).toBe(0);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('reaches the delete layer only when every guard passes', async () => {
    const deleteEligible = vi.fn(async () => 8);
    const r = await runPruneOddsJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 8, games: 1, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: oddsS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.pruneAllowed).toBe(true);
    expect(r.audit.archiveVerification.ok).toBe(true);
    expect(r.audit.coverage.ok).toBe(true);
    expect(r.audit.maxDelete.allowed).toBe(true);
    expect(deleteEligible).toHaveBeenCalledWith(expect.anything(), 30);
    expect(r.audit.rowsDeleted).toBe(8);
  });
});
