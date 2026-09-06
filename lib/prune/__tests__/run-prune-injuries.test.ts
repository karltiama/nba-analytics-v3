import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runPruneInjuriesJob } from '@/lib/prune/run-prune-injuries';
import type { ArchiveS3Reader } from '@/lib/prune/archive-gate';
import type { EntityManifest } from '@/scripts/archive/archive-entity-core';
import {
  deleteRawInjuriesEligibleBatches,
  resolveInjuryRawRetentionDays,
} from '@/lib/injuries/retention';

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

function successInjuriesManifest(overrides: Partial<EntityManifest> = {}): EntityManifest {
  return {
    schemaVersion: 1,
    s3Prefix: 'raw/...',
    exportMode: 'full',
    source: 'existing_ingestion',
    league: 'nba',
    season: 2025,
    entity: 'raw_player_injuries',
    sourceTable: 'raw.player_injuries',
    exportedAt: '2026-09-06T00:00:00.000Z',
    recordCount: 24469,
    dateRange: { from: '2026-03-10', to: '2026-05-06' },
    partitions: ['2026-03-10', '2026-05-06'],
    status: 'success',
    notes: null,
    ...overrides,
  };
}

function injuriesS3(
  manifest: EntityManifest | null = successInjuriesManifest()
): ArchiveS3Reader {
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
  players: number;
  seasons: number[];
  unresolvedLeaveReports?: number;
  oldest?: string;
  newest?: string;
  cutoffEt?: string;
}): QueryHandler {
  return async (sql) => {
    const s = sql.replace(/\s+/g, ' ').toLowerCase();
    if (s.includes('delete from raw.player_injuries')) {
      throw new Error('real DELETE must not run in tests');
    }
    if (s.includes('cutoff_et')) {
      return { rows: [{ cutoff_et: state.cutoffEt ?? '2026-08-30' }] };
    }
    if (s.includes('eligible_rows')) {
      return {
        rows: [
          {
            eligible_rows: String(state.eligible),
            eligible_players: String(state.players),
            oldest: state.oldest ?? '2026-03-10T16:00:00.000Z',
            newest: state.newest ?? '2026-05-06T18:00:27.355Z',
          },
        ],
      };
    }
    if (
      s.includes('from raw.player_injuries') &&
      s.includes('count(*)') &&
      !s.includes('america/new_york') &&
      !s.includes('::int as n')
    ) {
      return { rows: [{ count: String(state.total) }] };
    }
    if (s.includes('from bounds b') || (s.includes('distinct b.season') && s.includes('analytics.games'))) {
      return { rows: state.seasons.map((season) => ({ season: String(season) })) };
    }
    if (s.includes("h.status = 'removedfromreport'")) {
      if (s.includes('having count(*) > 1')) {
        return { rows: [{ n: 0 }] };
      }
      return { rows: [{ n: state.unresolvedLeaveReports ?? 0 }] };
    }
    if (s.includes('count(*)::int as n from (') && s.includes('next_pulled_at')) {
      return { rows: [{ n: 789 }] };
    }
    if (s.includes('first_pull')) {
      return { rows: [{ n: 0 }] };
    }
    if (s.includes('provider_team_id is distinct from')) {
      return { rows: [{ n: 0 }] };
    }
    if (s.includes('having count(*) > 1')) {
      return { rows: [{ n: 0 }] };
    }
    throw new Error(`unexpected sql: ${sql}`);
  };
}

describe('resolveInjuryRawRetentionDays', () => {
  it('defaults missing/invalid/non-positive to 7', () => {
    expect(resolveInjuryRawRetentionDays(undefined)).toBe(7);
    expect(resolveInjuryRawRetentionDays('')).toBe(7);
    expect(resolveInjuryRawRetentionDays('abc')).toBe(7);
    expect(resolveInjuryRawRetentionDays('0')).toBe(7);
    expect(resolveInjuryRawRetentionDays('-5')).toBe(7);
  });

  it('accepts a positive integer', () => {
    expect(resolveInjuryRawRetentionDays('7')).toBe(7);
    expect(resolveInjuryRawRetentionDays('14')).toBe(14);
  });
});

describe('deleteRawInjuriesEligibleBatches', () => {
  it('targets only raw.player_injuries', async () => {
    const seen: string[] = [];
    const pool = makePool(async (sql) => {
      seen.push(sql);
      return { rows: [], rowCount: 0 };
    });
    await deleteRawInjuriesEligibleBatches(pool, 7);
    const joined = seen.join('\n').toLowerCase();
    expect(joined).toMatch(/delete from raw\.player_injuries/);
    expect(joined).not.toMatch(/player_injury_status_current/);
    expect(joined).not.toMatch(/player_injury_status_history/);
    expect(joined).not.toMatch(/injury_pull_runs/);
    expect(joined).not.toMatch(/team_injury_summary/);
  });
});

describe('runPruneInjuriesJob', () => {
  it('skips and does not delete when PRUNE_ENABLED is missing', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 24469, eligible: 24469, players: 380, seasons: [2025] })),
      env: liveEnv({ PRUNE_ENABLED: undefined }),
      authenticated: true,
      s3: injuriesS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('skipped');
    expect(r.body.rowsDeleted).toBe(0);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('skips execute on frozen/replay runtime even if PRUNE_ENABLED=1', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 24469, eligible: 24469, players: 380, seasons: [2025] })),
      env: freezeEnv({ PRUNE_ENABLED: '1' }),
      authenticated: true,
      s3: injuriesS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('skipped');
    expect(String(r.audit.reason)).toMatch(/DATA_MODE=replay|live_api/);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('skips execute when OFFSEASON_MODE=1', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 24469, eligible: 24469, players: 380, seasons: [2025] })),
      env: liveEnv({ OFFSEASON_MODE: '1' }),
      authenticated: true,
      s3: injuriesS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('skipped');
    expect(String(r.audit.reason)).toMatch(/OFFSEASON_MODE/);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('skips execute when CRON_DRY_RUN=1', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 24469, eligible: 24469, players: 380, seasons: [2025] })),
      env: liveEnv({ CRON_DRY_RUN: '1' }),
      authenticated: true,
      s3: injuriesS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('skipped');
    expect(String(r.audit.reason)).toMatch(/CRON_DRY_RUN/);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('blocks when archive is missing', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 10, players: 4, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: injuriesS3(null),
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
    const bad = successInjuriesManifest({
      entity: 'player_props_raw_v2',
      sourceTable: 'raw.player_prop_snapshots_v2',
    });
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 10, players: 4, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: injuriesS3(bad),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('aborted');
    expect(String(r.audit.reason)).toMatch(/entity mismatch|archive gate failed/);
    expect(deleteEligible).not.toHaveBeenCalled();
  });

  it('blocks when meaningful-history coverage is incomplete', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneInjuriesJob({
      pool: makePool(
        sqlHandler({
          total: 100,
          eligible: 10,
          players: 4,
          seasons: [2025],
          unresolvedLeaveReports: 230,
        })
      ),
      env: liveEnv(),
      authenticated: true,
      s3: injuriesS3(),
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
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 10, players: 4, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: injuriesS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.outcome).toBe('completed');
    expect(r.audit.maxDelete.allowed).toBe(true);
    expect(r.audit.rowsDeleted).toBe(10);
    expect(deleteEligible).toHaveBeenCalledTimes(1);
  });

  it('refuses a >35% candidate set without override', async () => {
    const deleteEligible = vi.fn(async () => 24469);
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 24469, eligible: 24469, players: 380, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: injuriesS3(),
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
    const deleteEligible = vi.fn(async () => 24469);
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 24469, eligible: 24469, players: 380, seasons: [2025] })),
      env: liveEnv({ PRUNE_ALLOW_LARGE_DELETE: '1' }),
      authenticated: true,
      s3: injuriesS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.maxDelete.allowed).toBe(true);
    expect(String(r.audit.maxDelete.reason)).toMatch(/PRUNE_ALLOW_LARGE_DELETE=1/);
    expect(deleteEligible).toHaveBeenCalledTimes(1);
    expect(r.audit.rowsDeleted).toBe(24469);
  });

  it('does not let large-delete override bypass a missing archive', async () => {
    const deleteEligible = vi.fn(async () => 99);
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 24469, eligible: 24469, players: 380, seasons: [2025] })),
      env: liveEnv({ PRUNE_ALLOW_LARGE_DELETE: '1' }),
      authenticated: true,
      s3: injuriesS3(null),
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
    const r = await runPruneInjuriesJob({
      pool: makePool(
        sqlHandler({
          total: 24469,
          eligible: 24469,
          players: 380,
          seasons: [2025],
          unresolvedLeaveReports: 12,
        })
      ),
      env: liveEnv({ PRUNE_ALLOW_LARGE_DELETE: '1' }),
      authenticated: true,
      s3: injuriesS3(),
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
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 10, players: 4, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: injuriesS3(),
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
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 8, players: 3, seasons: [2025] })),
      env: liveEnv(),
      authenticated: true,
      s3: injuriesS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.event).toBe('prune_injuries');
    expect(r.audit.sourceTable).toBe('raw.player_injuries');
    expect(r.audit.pruneAllowed).toBe(true);
    expect(r.audit.archiveVerification.ok).toBe(true);
    expect(r.audit.coverage.ok).toBe(true);
    expect(r.audit.maxDelete.allowed).toBe(true);
    expect(deleteEligible).toHaveBeenCalledWith(expect.anything(), 7);
    expect(r.audit.rowsDeleted).toBe(8);
  });

  it('uses default retention 7 when env is invalid', async () => {
    const deleteEligible = vi.fn(async () => 8);
    const r = await runPruneInjuriesJob({
      pool: makePool(sqlHandler({ total: 100, eligible: 8, players: 3, seasons: [2025] })),
      env: liveEnv({ INJURY_RAW_RETENTION_DAYS: 'nope' }),
      authenticated: true,
      s3: injuriesS3(),
      dryRun: false,
      deleteEligible,
    });
    expect(r.audit.retentionDays).toBe(7);
    expect(deleteEligible).toHaveBeenCalledWith(expect.anything(), 7);
  });
});
