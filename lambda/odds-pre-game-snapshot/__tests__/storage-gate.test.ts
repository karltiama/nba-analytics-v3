import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { UpdateItemCommand } from '@aws-sdk/client-dynamodb';

import { admitPersistentWrite, MemoryStorageReservationStore } from '@/lib/ops/storage-admission';
import { createDynamoStorageReservationStore } from '@/lib/ops/storage-reservation-dynamo';
import type { ClusterMeasurementRecord } from '@/lib/ops/cluster-measurement';
import { ODDS_PHYSICAL_GROWTH_BOUND_BYTES } from '@/lib/ops/storage-growth-bounds';
import { acquireOdds, type AcquireDeps, type OddsProviderRow } from '../acquire';
import { createMemoryOddsClaim } from '../overlap-claim';
import { admitOddsInvocation, admitOddsWrites, planOddsStorage } from '../storage-gate';

const now = '2026-11-22T17:00:00.000Z';
const freshAt = '2026-11-22T16:30:00.000Z';
const staleAt = '2026-11-22T15:00:00.000Z';
const futureAt = '2026-11-22T18:00:00.000Z';

const limiter = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  BDL_RATE_LIMIT_INTERVAL_MS: '13000',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
  BDL_RATE_LIMIT_BACKEND: 'memory',
};

function record(clusterBytes: number, measuredAt: string, valid = true): ClusterMeasurementRecord {
  return { schemaVersion: 1, valid, clusterBytes, measuredAt, reason: null };
}

function measurement(clusterBytes: number, measuredAt = freshAt, valid = true) {
  return {
    clusterBytes,
    measuredAt,
    source: 'nba-storage-cluster-measurement',
    valid,
    complete: valid,
  };
}

function row(gameId: number, vendor = 'draftkings'): OddsProviderRow {
  return {
    id: gameId,
    game_id: gameId,
    vendor,
    updated_at: '2026-10-21T15:00:00.000Z',
    total_value: '220.5',
    spread_home_value: '1.5',
    moneyline_home_odds: -110,
  };
}

function deps(fetchPage: AcquireDeps['fetchPage'], extra: Partial<AcquireDeps> = {}): AcquireDeps {
  return {
    env: limiter,
    now: () => new Date('2026-10-21T16:00:00.000Z'),
    preferredVendor: 'draftkings',
    fetchPage,
    createPullRun: async () => 1,
    completePullRun: async () => undefined,
    insertRaw: async () => undefined,
    loadGames: async () => [{ gameId: '21717922', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T23:00:00.000Z' }],
    transformComplete: async () => ({ current: 1, history: 1, movement: 1 }),
    ...extra,
  };
}

describe('planOddsStorage', () => {
  it('permits the normal path below 400 MB', () => {
    expect(planOddsStorage({ valid: true, clusterBytes: 399_999_999, measuredAt: freshAt }, now).mode).toBe('normal');
  });

  it('permits only the current board from 400 MB until the halt line', () => {
    expect(planOddsStorage({ valid: true, clusterBytes: 400_000_000, measuredAt: freshAt }, now).mode).toBe('current_only');
    expect(planOddsStorage({ valid: true, clusterBytes: 449_999_999, measuredAt: freshAt }, now).mode).toBe('current_only');
  });

  it('halts at 450 MB and when the measurement cannot be trusted', () => {
    expect(planOddsStorage({ valid: true, clusterBytes: 450_000_000, measuredAt: freshAt }, now).mode).toBe('halt');
    expect(planOddsStorage({ valid: true, clusterBytes: 399_000_000, measuredAt: staleAt }, now).mode).toBe('halt');
    expect(planOddsStorage({ valid: true, clusterBytes: 399_000_000, measuredAt: futureAt }, now).mode).toBe('halt');
    expect(planOddsStorage({ valid: false, clusterBytes: 1, measuredAt: freshAt }, now).mode).toBe('halt');
    expect(planOddsStorage({ valid: true, clusterBytes: null, measuredAt: freshAt }, now).mode).toBe('halt');
    expect(planOddsStorage({ valid: true, measuredAt: freshAt }, now).mode).toBe('halt');
  });
});

describe('admitOddsWrites', () => {
  it('reserves the full odds bound below 400 MB', async () => {
    const reservations = new MemoryStorageReservationStore();
    const decision = await admitOddsWrites({
      now,
      invocationId: 'req-normal',
      measurement: measurement(399_000_000),
      reservations,
    });
    expect(decision.mode).toBe('normal');
    expect(reservations.snapshot().protectedBytes).toBe(ODDS_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(reservations.snapshot().active['req-normal']?.operation).toBe('historical_raw_odds');
    await decision.settle();
    expect(reservations.snapshot().active['req-normal']).toBeUndefined();
  });

  it('reserves only the current board at 400 MB', async () => {
    const reservations = new MemoryStorageReservationStore();
    const decision = await admitOddsWrites({
      now,
      invocationId: 'req-current',
      measurement: measurement(400_000_000),
      reservations,
    });
    expect(decision.mode).toBe('current_only');
    expect(reservations.snapshot().active['req-current']?.operation).toBe('current_board');
  });

  it('does not reserve at the halt line or when the bound would reach it', async () => {
    const haltStore = new MemoryStorageReservationStore();
    const halted = await admitOddsWrites({
      now,
      invocationId: 'req-halt',
      measurement: measurement(450_000_000),
      reservations: haltStore,
    });
    expect(halted.mode).toBe('halt');
    expect(haltStore.snapshot().protectedBytes).toBe(0);

    const tight = new MemoryStorageReservationStore();
    const refused = await admitOddsWrites({
      now,
      invocationId: 'req-tight',
      measurement: measurement(449_999_999),
      reservations: tight,
    });
    expect(refused.mode).toBe('halt');
    expect(tight.snapshot().protectedBytes).toBe(0);

    const fits = new MemoryStorageReservationStore();
    const allowed = await admitOddsWrites({
      now,
      invocationId: 'req-fits',
      measurement: measurement(449_000_000),
      reservations: fits,
    });
    expect(allowed.mode).toBe('current_only');
    expect(fits.snapshot().protectedBytes).toBe(ODDS_PHYSICAL_GROWTH_BOUND_BYTES);
  });

  it('reserves nothing for a stale or missing measurement', async () => {
    const stale = new MemoryStorageReservationStore();
    const decision = await admitOddsWrites({
      now,
      invocationId: 'req-stale',
      measurement: measurement(100_000_000, staleAt),
      reservations: stale,
    });
    expect(decision.mode).toBe('halt');
    expect(stale.snapshot().protectedBytes).toBe(0);

    const missing = new MemoryStorageReservationStore();
    const unread = await admitOddsWrites({
      now,
      invocationId: 'req-missing',
      measurement: { clusterBytes: null, measuredAt: null, source: '', valid: false, complete: false },
      reservations: missing,
    });
    expect(unread.mode).toBe('halt');
    expect(missing.snapshot().protectedBytes).toBe(0);
  });
});

describe('admitOddsInvocation', () => {
  it('fails closed when the reservation table is not configured', async () => {
    let reads = 0;
    const decision = await admitOddsInvocation({
      env: {},
      now,
      invocationId: 'req-unconfigured',
      reader: {
        get: async () => {
          reads += 1;
          return record(100_000_000, freshAt);
        },
      },
    });
    expect(decision.mode).toBe('halt');
    expect(decision.reason).toContain('reservation table');
    expect(reads).toBe(0);
  });

  it('does not measure the cluster when the reservation table is not configured', async () => {
    let measured = 0;
    const decision = await admitOddsInvocation({
      env: {},
      now,
      invocationId: 'req-unconfigured-measure',
      measureCluster: async () => {
        measured += 1;
        return measurement(100_000_000);
      },
    });
    expect(decision.mode).toBe('halt');
    expect(measured).toBe(0);
  });

  it('fails closed when the direct measurement throws', async () => {
    const reservations = new MemoryStorageReservationStore();
    const decision = await admitOddsInvocation({
      env: {},
      now,
      invocationId: 'req-measure-failed',
      reservations,
      measureCluster: async () => {
        throw new Error('pg_database_size failed');
      },
    });
    expect(decision.mode).toBe('halt');
    expect(reservations.snapshot().protectedBytes).toBe(0);
  });

  it('admits the restricted band from a direct 400 MB measurement', async () => {
    const reservations = new MemoryStorageReservationStore();
    const decision = await admitOddsInvocation({
      env: {},
      now,
      invocationId: 'req-measured-restrict',
      reservations,
      measureCluster: async () => measurement(400_000_000),
    });
    expect(decision.mode).toBe('current_only');
    expect(reservations.snapshot().active['req-measured-restrict']?.operation).toBe('current_board');
  });

  it('uses an injected fresh measurement and reservation store', async () => {
    const reservations = new MemoryStorageReservationStore();
    const decision = await admitOddsInvocation({
      env: {},
      now,
      invocationId: 'req-injected',
      reservations,
      reader: { get: async () => record(350_000_000, freshAt) },
    });
    expect(decision.mode).toBe('normal');
    expect(reservations.snapshot().protectedBytes).toBe(ODDS_PHYSICAL_GROWTH_BOUND_BYTES);
  });
});

const CLUSTER_AT_RESTRICTED_PRODUCTION = 401_900_000;

describe('restricted production size', () => {
  it('reserves the current-odds bound at 401.9 MB and still fetches', async () => {
    const reservations = new MemoryStorageReservationStore();
    const decision = await admitOddsWrites({
      now,
      invocationId: 'req-4019',
      measurement: measurement(CLUSTER_AT_RESTRICTED_PRODUCTION),
      reservations,
    });
    expect(decision.mode).toBe('current_only');
    expect(decision.pressure).toBe('restrict');
    expect(reservations.snapshot().protectedBytes).toBe(ODDS_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(reservations.snapshot().active['req-4019']?.operation).toBe('current_board');

    let fetches = 0;
    let pulls = 0;
    let raw = 0;
    let budget = 0;
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
    const claim = createMemoryOddsClaim();
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      fetches += 1;
      return { ok: true, rows: [row(21717922), row(21717922, 'fanduel')], nextCursor: null };
    }, {
      storageGate: async () => decision,
      createPullRun: async () => {
        pulls += 1;
        return 1;
      },
      insertRaw: async () => {
        raw += 1;
      },
      reserveAttempt: async () => {
        budget += 1;
        return {
          ok: true,
          reservationId: 'budget-1',
          remaining: 59,
          ledger: { requested: 1, reserved: 1, attempted: 0, successful: 0, failed: 0, refused: 0 },
        };
      },
      recordAttempt: async () => undefined,
      claimDate: (input) => claim.claim(input),
      completeClaim: (input) => claim.complete(input),
      applyCurrentQuotes: async () => ({
        current: 1,
        history: 0,
        movement: 1,
        currentRowsUpdated: 1,
        historyRowsInserted: 0,
        movementRowsInserted: 1,
      }),
    }));
    const again = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      fetches += 1;
      return { ok: true, rows: [row(21717922)], nextCursor: null };
    }, {
      storageGate: async () => decision,
      createPullRun: async () => {
        pulls += 1;
        return 1;
      },
      claimDate: (input) => claim.claim(input),
      completeClaim: (input) => claim.complete(input),
    }));
    spy.mockRestore();
    expect(result.status).toBe('COMPLETE');
    expect(result.providerRequests).toBe(1);
    expect(fetches).toBe(1);
    expect(pulls).toBe(0);
    expect(raw).toBe(0);
    expect(budget).toBe(1);
    expect(result.results[0]?.transform).toMatchObject({ history: 0, historyRowsInserted: 0, current: 1, movement: 1 });
    expect(again.status).toBe('SKIPPED');
    expect(fetches).toBe(1);
    const event = logs.map((line) => {
      try {
        return JSON.parse(line) as { evt?: string; success?: boolean; historyRowsInserted?: number; currentRowsUpdated?: number };
      } catch {
        return null;
      }
    }).find((entry) => entry?.evt === 'odds_acquisition' && entry.success === true);
    expect(event).toMatchObject({ historyRowsInserted: 0, currentRowsUpdated: 1, rawRowsPersisted: 0 });
  });

  it('refuses the odds hold when another writer already occupies the room', async () => {
    const reservations = new MemoryStorageReservationStore();
    const roomFillingBound = 450_000_000 - CLUSTER_AT_RESTRICTED_PRODUCTION - ODDS_PHYSICAL_GROWTH_BOUND_BYTES;
    const other = await admitPersistentWrite({
      writerId: 'scoreboard-collector',
      kind: 'current_board',
      invocationId: 'scoreboard-in-flight',
      now,
      measurement: measurement(CLUSTER_AT_RESTRICTED_PRODUCTION),
      physicalGrowthBoundBytes: roomFillingBound,
      tables: ['display.scoreboard_game_odds'],
      reservations,
    });
    expect(other.allowed).toBe(true);
    const odds = await admitOddsWrites({
      now,
      invocationId: 'req-overlap',
      measurement: measurement(CLUSTER_AT_RESTRICTED_PRODUCTION),
      reservations,
    });
    expect(odds.mode).toBe('halt');
    expect(reservations.snapshot().active['req-overlap']).toBeUndefined();
  });

  it('plans the next tick from current odds rather than a pull run', () => {
    const src = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');
    const start = src.indexOf('async function loadPlannedGames');
    const end = src.indexOf('async function loadGames');
    const planner = src.slice(start, end);
    expect(planner).toContain('analytics.game_odds_current');
    expect(planner).not.toContain('odds_pull_runs');
  });
});

describe('reservation failures', () => {
  it('halts when DynamoDB denies the ledger', async () => {
    let updates = 0;
    const decision = await admitOddsWrites({
      now,
      invocationId: 'req-denied',
      measurement: measurement(350_000_000),
      reservations: createDynamoStorageReservationStore({
        send: async (command: GetItemCommand | UpdateItemCommand) => {
          if (command instanceof UpdateItemCommand) updates += 1;
          const error = new Error('AccessDeniedException');
          error.name = 'AccessDeniedException';
          throw error;
        },
      }, 'nba-storage-admission'),
    });
    expect(decision.mode).toBe('halt');
    expect(decision.reason).toContain('reservation service failed');
    expect(updates).toBe(0);
  });

  it('halts when every conditional reservation write loses', async () => {
    let reads = 0;
    let updates = 0;
    const decision = await admitOddsWrites({
      now,
      invocationId: 'req-conflict',
      measurement: measurement(350_000_000),
      reservations: createDynamoStorageReservationStore({
        send: async (command: { constructor: { name: string } }) => {
          if (command.constructor.name === 'GetItemCommand') {
            reads += 1;
            return { Item: undefined };
          }
          updates += 1;
          const error = new Error('conflict');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        },
      }, 'nba-storage-admission'),
    });
    expect(decision.mode).toBe('halt');
    expect(decision.reason).toContain('could not commit a conditional update');
    expect(reads).toBe(8);
    expect(updates).toBe(8);
  });

  it('settles the hold when the invocation throws after admission', async () => {
    const reservations = new MemoryStorageReservationStore();
    const admitted: { current: { settle: () => Promise<void> } | null } = { current: null };
    try {
      admitted.current = await admitOddsWrites({
        now,
        invocationId: 'req-threw',
        measurement: measurement(350_000_000),
        reservations,
      });
      throw new Error('odds invocation failed after admission');
    } catch (error) {
      expect(error).toMatchObject({ message: 'odds invocation failed after admission' });
    } finally {
      await admitted.current?.settle();
    }
    const ledger = reservations.snapshot();
    expect(ledger.active['req-threw']).toBeUndefined();
    expect(ledger.settled['req-threw']?.boundBytes).toBe(ODDS_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(ledger.protectedBytes).toBe(ODDS_PHYSICAL_GROWTH_BOUND_BYTES);
  });
});

describe('acquireOdds storage gate', () => {
  it('does not fetch or write when the gate halts', async () => {
    let fetches = 0;
    let pulls = 0;
    let raw = 0;
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      fetches += 1;
      return { ok: true, rows: [row(21717922)], nextCursor: null };
    }, {
      storageGate: async () => ({ mode: 'halt', reason: 'cluster size measurement is older than 60 minutes or has a bad timestamp' }),
      createPullRun: async () => {
        pulls += 1;
        return 1;
      },
      insertRaw: async () => {
        raw += 1;
      },
    }));
    expect(result.status).toBe('STORAGE_HALT');
    expect(result.providerRequests).toBe(0);
    expect(fetches).toBe(0);
    expect(pulls).toBe(0);
    expect(raw).toBe(0);
  });

  it('refuses a safety-required run that has no storage gate', async () => {
    let fetches = 0;
    let pulls = 0;
    let slates = 0;
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      fetches += 1;
      return { ok: true, rows: [row(21717922)], nextCursor: null };
    }, {
      requireSafety: true,
      slateForDate: async () => {
        slates += 1;
        return [];
      },
      reserveAttempt: async () => ({ ok: true, reservationId: 'r', remaining: 59, ledger: { requested: 1, reserved: 1, attempted: 0, successful: 0, failed: 0, refused: 0 } }),
      claimDate: async () => ({ ok: true }),
      createPullRun: async () => {
        pulls += 1;
        return 1;
      },
    }));
    spy.mockRestore();
    expect(result.status).toBe('SAFETY_UNAVAILABLE');
    expect(fetches).toBe(0);
    expect(pulls).toBe(0);
    expect(slates).toBe(0);
    expect(logs.some((line) => line.includes('"status":"SAFETY_UNAVAILABLE"') && line.includes('"success":false'))).toBe(true);
  });

  it('does not read the slate or the provider when admission halts', async () => {
    let fetches = 0;
    let slates = 0;
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      fetches += 1;
      return { ok: true, rows: [row(21717922)], nextCursor: null };
    }, {
      requireSafety: true,
      storageGate: async () => ({ mode: 'halt', reason: 'cluster size measurement is missing or invalid' }),
      slateForDate: async () => {
        slates += 1;
        return [];
      },
      reserveAttempt: async () => ({ ok: true, reservationId: 'r', remaining: 59, ledger: { requested: 1, reserved: 1, attempted: 0, successful: 0, failed: 0, refused: 0 } }),
      claimDate: async () => ({ ok: true }),
    }));
    expect(result.status).toBe('STORAGE_HALT');
    expect(fetches).toBe(0);
    expect(slates).toBe(0);
  });

  it('keeps the normal write path below 400 MB', async () => {
    let pulls = 0;
    let raw = 0;
    let current = 0;
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => ({
      ok: true,
      rows: [row(21717922), row(21717922, 'fanduel')],
      nextCursor: null,
    }), {
      storageGate: async () => ({ mode: 'normal', reason: 'below 400 MB' }),
      createPullRun: async () => {
        pulls += 1;
        return 41;
      },
      insertRaw: async () => {
        raw += 1;
      },
      applyCurrentQuotes: async () => {
        current += 1;
        return { current: 1, history: 0, movement: 1 };
      },
    }));
    expect(result.status).toBe('COMPLETE');
    expect(pulls).toBe(1);
    expect(raw).toBe(2);
    expect(current).toBe(0);
    expect(result.results[0]?.pullRunId).toBe(41);
  });

  it('writes current quotes only from 400 MB to below the reserved halt line', async () => {
    let pulls = 0;
    let raw = 0;
    let history = 0;
    const seen: string[] = [];
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => ({
      ok: true,
      rows: [row(21717922), row(21717922, 'fanduel')],
      nextCursor: null,
    }), {
      storageGate: async () => ({ mode: 'current_only', reason: 'restrict' }),
      createPullRun: async () => {
        pulls += 1;
        return 1;
      },
      insertRaw: async () => {
        raw += 1;
      },
      transformComplete: async () => {
        history += 1;
        return { current: 1, history: 1, movement: 1 };
      },
      applyCurrentQuotes: async (rows) => {
        seen.push(...rows.map((item) => item.vendor));
        return {
          current: 1,
          history: 0,
          movement: 1,
          currentRowsUpdated: 1,
          historyRowsInserted: 0,
          movementRowsInserted: 1,
        };
      },
    }));
    expect(result.status).toBe('COMPLETE');
    expect(result.providerRequests).toBe(1);
    expect(pulls).toBe(0);
    expect(raw).toBe(0);
    expect(history).toBe(0);
    expect(seen).toEqual(['draftkings', 'fanduel']);
    expect(result.results[0]?.pullRunId).toBeUndefined();
    expect(result.results[0]?.transform).toMatchObject({ history: 0, historyRowsInserted: 0, current: 1, movement: 1 });
  });
});
