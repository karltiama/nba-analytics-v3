import fs from 'node:fs';
import path from 'node:path';
import { UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { acquireOdds, type AcquireDeps, type OddsProviderRow } from '../acquire';
import { createMemoryLiveRateLimitStore, fetchBdlLive } from '../bdl-live-rate-limit';
import { planDate } from '../collection-planner';
import { createDynamoOddsClaim, createMemoryOddsClaim, ODDS_CLAIM_LEASE_MS, ODDS_CLAIM_PK } from '../overlap-claim';
import { applyReserve, budgetDay, createDynamoOddsBudget, createMemoryOddsBudget, emptyBudgetLedger, ODDS_BUDGET_PK } from '../request-budget';
import {
  ODDS_EMERGENCY_STOP_STEPS,
  PROPOSED_EVENTBRIDGE_TARGET_MAX_RETRY_ATTEMPTS,
  PROPOSED_LAMBDA_MAX_EVENT_AGE_SECONDS,
  PROPOSED_LAMBDA_MAX_RETRY_ATTEMPTS,
  oddsAcquisitionEvent,
} from '../safety-policy';

const root = path.resolve(__dirname, '../../..');
const noonEt = new Date('2026-10-20T16:00:00.000Z');
const twoPmEt = new Date('2026-10-20T18:00:00.000Z');
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

const opening = [
  { gameId: '21717855', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-20T19:00:00.000Z', latestSnapshotAt: null },
  { gameId: '21717856', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-20T23:00:00.000Z', latestSnapshotAt: null },
  { gameId: '21717857', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T01:30:00.000Z', latestSnapshotAt: null },
];

function row(gameId: number, vendor = 'draftkings'): OddsProviderRow {
  return { id: gameId, game_id: gameId, vendor, updated_at: '2026-10-20T15:00:00.000Z', total_value: '220.5' };
}

function deps(fetchPage: AcquireDeps['fetchPage'], extra: Partial<AcquireDeps> = {}): AcquireDeps {
  return {
    env: limiter,
    now: () => noonEt,
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

describe('daily odds budget', () => {
  it('stops reserving once the daily ceiling is exhausted', async () => {
    const budget = createMemoryOddsBudget({ ceiling: 2 });
    const first = await budget.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 3 });
    const second = await budget.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 3 });
    const third = await budget.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 3 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third).toMatchObject({ ok: false, reason: 'exhausted' });
    expect(budget.ledger()).toMatchObject({ requested: 3, reserved: 2, refused: 1 });
  });

  it('keeps concurrent reservations inside the ceiling', async () => {
    const budget = createMemoryOddsBudget({ ceiling: 60 });
    const results = await Promise.all(Array.from({ length: 100 }, () => (
      budget.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 60 })
    )));
    expect(results.filter((result) => result.ok)).toHaveLength(60);
    expect(budget.ledger().reserved).toBe(60);
  });

  it('does not let one date consume another date ceiling', async () => {
    const budget = createMemoryOddsBudget({ ceiling: 60 });
    const grants = [];
    for (let n = 0; n < 5; n += 1) {
      grants.push(await budget.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 3 }));
      grants.push(await budget.reserve({ day: '2026-10-20', date: '2026-10-21', dateCeiling: 3 }));
    }
    expect(grants.filter((result) => result.ok)).toHaveLength(6);
    expect(budget.dateUsed('2026-10-20')).toBe(3);
    expect(budget.dateUsed('2026-10-21')).toBe(3);
  });

  it('counts a failed provider attempt and does not release it', async () => {
    const budget = createMemoryOddsBudget({ ceiling: 1 });
    let calls = 0;
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      calls += 1;
      throw Object.assign(new Error('socket timeout'), { timeout: true });
    }, {
      reserveAttempt: (input) => budget.reserve(input),
      recordAttempt: (input) => budget.record(input),
    }));
    expect(result.results[0]?.classification).toBe('TIMEOUT');
    expect(calls).toBe(1);
    expect(budget.ledger()).toMatchObject({ reserved: 1, attempted: 1, failed: 1, successful: 0 });
    const again = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      calls += 1;
      return { ok: true, rows: [], nextCursor: null };
    }, {
      reserveAttempt: (input) => budget.reserve(input),
      recordAttempt: (input) => budget.record(input),
    }));
    expect(again.status).toBe('BUDGET_EXHAUSTED');
    expect(calls).toBe(1);
  });

  it('does not call the provider when budget storage is unavailable', async () => {
    let calls = 0;
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      calls += 1;
      return { ok: true, rows: [row(21717922)], nextCursor: null };
    }, {
      reserveAttempt: async () => ({ ok: false, reason: 'unavailable', ledger: { requested: 0, reserved: 0, attempted: 0, successful: 0, failed: 0, refused: 0 } }),
    }));
    expect(result.status).toBe('BUDGET_UNAVAILABLE');
    expect(result.providerRequests).toBe(0);
    expect(calls).toBe(0);
  });

  it('treats a reservation timeout as ambiguous and does not retry the write', async () => {
    const sends: UpdateItemCommand[] = [];
    const budget = createDynamoOddsBudget({
      tableName: 'nba-bdl-rate-limit',
      ceiling: 60,
      client: {
        send: async (command) => {
          sends.push(command);
          const error = new Error('timed out');
          error.name = 'TimeoutError';
          throw error;
        },
      },
    });
    const decision = await budget.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 3 });
    expect(decision).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(sends).toHaveLength(1);
    expect(sends[0]?.input.Key?.pk).toEqual({ S: ODDS_BUDGET_PK });
    expect(sends[0]?.input.ConditionExpression).toContain('reserved < :ceiling');
  });
});

describe('overlap claims', () => {
  it('skips a duplicate scheduled window without a second provider call', async () => {
    const claim = createMemoryOddsClaim();
    let calls = 0;
    const fetchPage: AcquireDeps['fetchPage'] = async () => {
      calls += 1;
      return { ok: true, rows: [row(21717922)], nextCursor: null };
    };
    const extra = { claimDate: (input: Parameters<NonNullable<AcquireDeps['claimDate']>>[0]) => claim.claim(input) };
    const first = await acquireOdds({ date: '2026-10-21' }, deps(fetchPage, extra));
    const second = await acquireOdds({ date: '2026-10-21' }, deps(fetchPage, extra));
    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.status).toBe('SKIPPED');
    expect(calls).toBe(1);
  });

  it('lets one of two simultaneous invocations fetch', async () => {
    const claim = createMemoryOddsClaim();
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchPage: AcquireDeps['fetchPage'] = async () => {
      calls += 1;
      if (calls === 1) await gate;
      return { ok: true, rows: [row(21717922)], nextCursor: null };
    };
    const extra = { claimDate: (input: Parameters<NonNullable<AcquireDeps['claimDate']>>[0]) => claim.claim(input) };
    const pending = Promise.all([
      acquireOdds({ date: '2026-10-21' }, deps(fetchPage, extra)),
      acquireOdds({ date: '2026-10-21' }, deps(fetchPage, extra)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const results = await pending;
    expect(results.map((result) => result.status).sort()).toEqual(['COMPLETE', 'SKIPPED']);
    expect(calls).toBe(1);
  });

  it('recovers a claim after the lease expires', async () => {
    const claim = createMemoryOddsClaim({ leaseMs: 1_000 });
    const first = await claim.claim({ day: '2026-10-20', date: '2026-10-20', windowId: 't60', nowMs: 1_000, owner: 'a' });
    const during = await claim.claim({ day: '2026-10-20', date: '2026-10-20', windowId: 't60', nowMs: 1_500, owner: 'b' });
    const after = await claim.claim({ day: '2026-10-20', date: '2026-10-20', windowId: 't60', nowMs: 2_001, owner: 'b' });
    expect(first.ok).toBe(true);
    expect(during).toEqual({ ok: false, reason: 'skipped' });
    expect(after.ok).toBe(true);
    expect(ODDS_CLAIM_LEASE_MS).toBeGreaterThan(300_000);
  });

  it('uses a conditional claim that is not the shared token bucket', async () => {
    let condition = '';
    let update = '';
    const claim = createDynamoOddsClaim({
      tableName: 'nba-bdl-rate-limit',
      client: {
        send: async (command) => {
          condition = command.input.ConditionExpression ?? '';
          update = command.input.UpdateExpression ?? '';
          expect(command.input.Key?.pk).toEqual({ S: ODDS_CLAIM_PK });
          expect(command.input.Key?.sk?.S).not.toBe('token-bucket');
          expect(command.input.ExpressionAttributeNames).toEqual({ '#owner': 'owner' });
          return {};
        },
      },
    });
    const decision = await claim.claim({ day: '2026-10-20', date: '2026-10-20', windowId: 't15', nowMs: 10, owner: 'odds' });
    expect(decision.ok).toBe(true);
    expect(update).toContain('#owner = :owner');
    expect(update).not.toContain('SET owner =');
    expect(condition).toContain('lease_until_ms < :now');
    expect(condition).toContain('attribute_not_exists(completed_at)');
  });

  it.each([
    ['ValidationException', 'unavailable'],
    ['AccessDeniedException', 'unavailable'],
    ['ResourceNotFoundException', 'unavailable'],
    ['TimeoutError', 'ambiguous'],
  ] as const)('keeps a %s claim off the budget and the provider', async (name, reason) => {
    let fetches = 0;
    let reserves = 0;
    let sends = 0;
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
    const claim = createDynamoOddsClaim({
      tableName: 'nba-bdl-rate-limit',
      client: {
        send: async () => {
          sends += 1;
          const error = new Error(`postgres://user:secret@db.example/app ${name}`);
          error.name = name;
          Object.assign(error, { $metadata: { httpStatusCode: 400, requestId: 'req-claim', attempts: 1 } });
          throw error;
        },
      },
    });
    const result = await acquireOdds({ date: '2026-10-20' }, deps(async () => {
      fetches += 1;
      return { ok: true, rows: [row(21717855)], nextCursor: null };
    }, {
      requireSafety: true,
      slateForDate: async () => opening,
      reserveAttempt: async () => {
        reserves += 1;
        return { ok: true, reservationId: 'should-not-run', remaining: 59, ledger: emptyBudgetLedger() };
      },
      claimDate: (input) => claim.claim(input),
      completeClaim: (input) => claim.complete(input),
    }));
    spy.mockRestore();
    const failure = logs.flatMap((line) => {
      try {
        return [JSON.parse(line) as { evt?: string; message?: string; name?: string }];
      } catch {
        return [];
      }
    }).find((event) => event.evt === 'odds_claim_failure');
    expect(result.success).toBe(false);
    expect(result.status).toBe('CLAIM_UNAVAILABLE');
    expect(result.results[0]?.reason).toBe(reason);
    expect(fetches).toBe(0);
    expect(reserves).toBe(0);
    expect(sends).toBe(1);
    expect(failure).toMatchObject({ evt: 'odds_claim_failure', operation: 'UpdateItem', name, date: '2026-10-20', windowId: 'two_hour' });
    expect(failure?.message).not.toContain('postgres://');
    expect(failure?.message).toContain('[redacted]');
    expect(JSON.stringify(failure)).not.toContain('UpdateExpression');
  });

  it('does not fetch a completed window again after the lease expires', async () => {
    const claim = createMemoryOddsClaim({ leaseMs: 1_000 });
    let nowMs = Date.parse('2026-10-20T16:00:00.000Z');
    let calls = 0;
    const fetchPage: AcquireDeps['fetchPage'] = async () => {
      calls += 1;
      return { ok: true, rows: [row(21717922)], nextCursor: null };
    };
    const extra = {
      now: () => new Date(nowMs),
      claimDate: (input: Parameters<NonNullable<AcquireDeps['claimDate']>>[0]) => claim.claim(input),
      completeClaim: (input: Parameters<NonNullable<AcquireDeps['claimDate']>>[0]) => claim.complete(input),
    };
    const first = await acquireOdds({ date: '2026-10-21' }, deps(fetchPage, extra));
    nowMs += 60 * 60 * 1000;
    const second = await acquireOdds({ date: '2026-10-21' }, deps(fetchPage, extra));
    expect(first.success).toBe(true);
    expect(second.status).toBe('SKIPPED');
    expect(calls).toBe(1);
  });

  it('allows recovery after a crash once the lease expires', async () => {
    const claim = createMemoryOddsClaim({ leaseMs: 1_000 });
    let nowMs = Date.parse('2026-10-20T16:00:00.000Z');
    let calls = 0;
    const extra = {
      now: () => new Date(nowMs),
      claimDate: (input: Parameters<NonNullable<AcquireDeps['claimDate']>>[0]) => claim.claim(input),
      completeClaim: (input: Parameters<NonNullable<AcquireDeps['claimDate']>>[0]) => claim.complete(input),
    };
    const crashed = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      calls += 1;
      throw Object.assign(new Error('socket timeout'), { timeout: true });
    }, extra));
    nowMs += 60 * 60 * 1000;
    const recovered = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      calls += 1;
      return { ok: true, rows: [row(21717922)], nextCursor: null };
    }, extra));
    expect(crashed.results[0]?.classification).toBe('TIMEOUT');
    expect(recovered.success).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('collection planner', () => {
  it('rolls the budget day at Eastern midnight rather than UTC midnight', () => {
    expect(budgetDay(new Date('2026-10-21T03:59:59.000Z'))).toBe('2026-10-20');
    expect(budgetDay(new Date('2026-10-21T04:00:00.000Z'))).toBe('2026-10-21');
    expect(budgetDay(new Date('2026-10-21T00:30:00.000Z'))).toBe('2026-10-20');
  });

  it('does not fetch a game without a verified tip', () => {
    const plan = planDate({
      etDate: '2026-10-20',
      now: twoPmEt,
      games: [{ gameId: '1', season: '2026', seasonPhase: 'REGULAR', startTime: null, latestSnapshotAt: null }],
    });
    expect(plan.due).toBe(false);
    expect(plan.reason).toBe('unverified_tip');
  });

  it('does not fetch when every eligible game already has the snapshot due for this window', async () => {
    const plan = planDate({
      etDate: '2026-10-20',
      now: twoPmEt,
      games: [{
        ...opening[0],
        latestSnapshotAt: '2026-10-20T18:00:00.000Z',
      }],
    });
    expect(plan.due).toBe(false);
    let calls = 0;
    const result = await acquireOdds({}, deps(async () => {
      calls += 1;
      return { ok: true, rows: [], nextCursor: null };
    }, {
      now: () => twoPmEt,
      slateForDate: async () => [{ ...opening[0], latestSnapshotAt: '2026-10-20T18:00:00.000Z' }],
    }));
    expect(plan.reason).toBe('already_snapshotted');
    expect(result.status).toBe('NO_DUE_WORK');
    expect(result.success).toBe(true);
    expect(calls).toBe(0);
  });

  it('marks the opening slate due at the 60-minute window without naming those games in the planner', () => {
    const plan = planDate({ etDate: '2026-10-20', now: twoPmEt, games: opening });
    expect(plan.due).toBe(true);
    expect(plan.windowId).toBe('t60');
    expect(plan.dueGameIds).toEqual(['21717855', '21717856', '21717857']);
    const source = fs.readFileSync(path.join(root, 'lambda/odds-pre-game-snapshot/collection-planner.ts'), 'utf8');
    expect(source).not.toContain('21717855');
  });

  it('stops pregame collection after tip', () => {
    const plan = planDate({
      etDate: '2026-10-20',
      now: new Date('2026-10-20T19:05:00.000Z'),
      games: [opening[0]],
    });
    expect(plan.due).toBe(false);
    expect(plan.reason).toBe('post_tip');
  });

  it('keeps the second date inside the six-page invocation ceiling', async () => {
    const calls: string[] = [];
    const result = await acquireOdds({}, deps(async (date) => {
      calls.push(date);
      const gameId = date === '2026-10-20' ? 21717855 : 21717922;
      return { ok: true, rows: [row(gameId, `book-${calls.length}`)], nextCursor: 1 };
    }, {
      loadGames: async (ids) => ids.map((id) => ({
        gameId: id,
        season: '2026',
        seasonPhase: 'REGULAR',
        startTime: id === '21717922' ? '2026-10-21T23:00:00.000Z' : '2026-10-20T19:00:00.000Z',
      })),
    }));
    expect(calls).toHaveLength(6);
    expect(result.results.map((item) => item.classification)).toEqual(['INCOMPLETE', 'INCOMPLETE']);
    expect(result.success).toBe(false);
  });

  it('keeps a successful date when the other date fails', async () => {
    const result = await acquireOdds({ dates: ['2026-10-20', '2026-10-21'] }, deps(async (date) => {
      if (date === '2026-10-21') return { ok: false, status: 401 };
      return { ok: true, rows: [row(21717855)], nextCursor: null };
    }, {
      loadGames: async (ids) => ids.map((id) => ({
        gameId: id,
        season: '2026',
        seasonPhase: 'REGULAR',
        startTime: id === '21717855' ? '2026-10-20T19:00:00.000Z' : '2026-10-21T23:00:00.000Z',
      })),
    }));
    expect(result.status).toBe('PARTIAL');
    expect(result.success).toBe(false);
    expect(result.results.map((item) => item.classification)).toEqual(['COMPLETE', 'UNAUTHORIZED']);
  });
});

describe('observability and canary', () => {
  it('reports success false without turning that into a provider request', () => {
    const event = oddsAcquisitionEvent({
      success: false,
      status: 'PARTIAL',
      providerRequests: 2,
      classifications: ['COMPLETE', 'MOVEMENT_PERSISTENCE'],
      budgetRemaining: 57,
    });
    expect(event).toMatchObject({
      evt: 'odds_acquisition',
      success: false,
      movementFailed: 1,
      budgetRemaining: 57,
    });
  });

  it('reports budget exhaustion without a pull when nothing was fetched', async () => {
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      throw new Error('should not fetch');
    }, {
      reserveAttempt: async () => ({ ok: false, reason: 'exhausted', ledger: { requested: 1, reserved: 60, attempted: 60, successful: 0, failed: 60, refused: 1 } }),
    }));
    expect(result.success).toBe(false);
    expect(result.status).toBe('BUDGET_EXHAUSTED');
    expect(result.providerRequests).toBe(0);
    expect(result.results[0]?.pullRunId).toBeUndefined();
  });

  it('still runs the opening-night canary when the daily budget is already exhausted', async () => {
    let calls = 0;
    await expect(acquireOdds({ dates: ['2026-10-20'] }, deps(async () => {
      calls += 1;
      return { ok: true, rows: [row(21717855)], nextCursor: null };
    }, {
      requireSafety: true,
      reserveAttempt: async () => ({ ok: false, reason: 'exhausted', ledger: { requested: 1, reserved: 60, attempted: 60, successful: 0, failed: 60, refused: 1 } }),
    }))).resolves.toMatchObject({ success: true, status: 'COMPLETE' });
    expect(calls).toBe(1);
  });

  it('waits on the shared limiter before a second live attempt', async () => {
    const store = createMemoryLiveRateLimitStore();
    let now = 0;
    const sleeps: number[] = [];
    const fetchImpl = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    const options = {
      env: limiter,
      store,
      fetchImpl,
      nowMs: () => now,
      sleepFn: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    };
    await fetchBdlLive('https://example.test/odds', {}, options);
    await fetchBdlLive('https://example.test/odds', {}, options);
    expect(sleeps[0]).toBeGreaterThanOrEqual(13_000);
  });

  it('lets the 60th reservation succeed and refuses the 61st', async () => {
    const budget = createMemoryOddsBudget({ ceiling: 60 });
    const grants = [];
    for (let n = 0; n < 61; n += 1) {
      grants.push(await budget.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 60 }));
    }
    expect(grants[59]?.ok).toBe(true);
    expect(grants[60]).toMatchObject({ ok: false, reason: 'exhausted' });
    expect(budget.ledger().reserved).toBe(60);
  });

  it('fails closed on a negative reservation count', () => {
    const decision = applyReserve({ ...emptyBudgetLedger(), reserved: -1 }, 60, 0, 3);
    expect(decision.granted).toBe(false);
    expect(decision.ledger.reserved).toBe(-1);
  });

  it('keeps the Eastern budget day across both 2026 daylight-saving transitions', () => {
    expect(budgetDay(new Date('2026-03-08T04:59:59.000Z'))).toBe('2026-03-07');
    expect(budgetDay(new Date('2026-03-08T05:00:00.000Z'))).toBe('2026-03-08');
    expect(budgetDay(new Date('2026-03-08T07:30:00.000Z'))).toBe('2026-03-08');
    expect(budgetDay(new Date('2026-11-01T03:59:59.000Z'))).toBe('2026-10-31');
    expect(budgetDay(new Date('2026-11-01T04:00:00.000Z'))).toBe('2026-11-01');
    expect(budgetDay(new Date('2026-11-01T06:30:00.000Z'))).toBe('2026-11-01');
    expect(budgetDay(new Date('2026-11-02T04:59:59.000Z'))).toBe('2026-11-01');
    expect(budgetDay(new Date('2026-11-02T05:00:00.000Z'))).toBe('2026-11-02');
  });

  it('fetches one date when games on that date are in different windows', async () => {
    const calls: string[] = [];
    const result = await acquireOdds({}, deps(async (date) => {
      calls.push(date);
      return {
        ok: true,
        rows: opening.map((game, index) => ({
          ...row(Number(game.gameId), index === 0 ? 'draftkings' : `book-${index}`),
        })),
        nextCursor: null,
      };
    }, {
      now: () => twoPmEt,
      slateForDate: async (date) => (date === '2026-10-20' ? opening : []),
      loadGames: async (ids) => opening.filter((game) => ids.includes(game.gameId)),
    }));
    expect(calls).toEqual(['2026-10-20']);
    expect(result.success).toBe(true);
    expect(result.providerRequests).toBe(1);
  });

  it('stops the second date when the daily budget is exhausted by the first', async () => {
    const budget = createMemoryOddsBudget({ ceiling: 1 });
    const calls: string[] = [];
    const result = await acquireOdds({ dates: ['2026-10-20', '2026-10-21'] }, deps(async (date) => {
      calls.push(date);
      return { ok: true, rows: [row(date === '2026-10-20' ? 21717855 : 21717922)], nextCursor: null };
    }, {
      reserveAttempt: (input) => budget.reserve(input),
      recordAttempt: (input) => budget.record(input),
      loadGames: async (ids) => ids.map((id) => ({
        gameId: id,
        season: '2026',
        seasonPhase: 'REGULAR',
        startTime: id === '21717855' ? '2026-10-20T19:00:00.000Z' : '2026-10-21T23:00:00.000Z',
      })),
    }));
    expect(calls).toEqual(['2026-10-20']);
    expect(result.results.map((item) => item.classification)).toEqual(['COMPLETE', 'BUDGET_EXHAUSTED']);
    expect(budget.ledger().reserved).toBe(1);
  });

  it('keeps an empty scheduled event off the canary bypass and still budgets an explicit normal date', async () => {
    let reserved = 0;
    const reserve = async () => {
      reserved += 1;
      return {
        ok: true as const,
        reservationId: `r-${reserved}`,
        remaining: 59,
        ledger: emptyBudgetLedger(),
      };
    };
    const scheduled = await acquireOdds({}, deps(async () => ({ ok: true, rows: [row(21717855)], nextCursor: null }), {
      now: () => noonEt,
      reserveAttempt: reserve,
      loadGames: async () => opening,
    }));
    expect(scheduled.dates).toEqual(['2026-10-20', '2026-10-21']);
    expect(reserved).toBeGreaterThan(0);
    const beforeCanary = reserved;
    await acquireOdds({ dates: ['2026-10-20'] }, deps(async () => ({ ok: true, rows: [row(21717855)], nextCursor: null }), {
      requireSafety: true,
      reserveAttempt: reserve,
    }));
    expect(reserved).toBe(beforeCanary);
    reserved = 0;
    await acquireOdds({ date: '2026-10-21' }, deps(async () => ({ ok: true, rows: [row(21717922)], nextCursor: null }), {
      reserveAttempt: reserve,
    }));
    expect(reserved).toBe(1);
  });

  it('documents the emergency stop and the unapplied retry proposal', () => {
    expect(ODDS_EMERGENCY_STOP_STEPS).toHaveLength(9);
    expect(ODDS_EMERGENCY_STOP_STEPS.join(' ')).toContain('scoreboard');
    expect(ODDS_EMERGENCY_STOP_STEPS.join(' ')).toContain('props');
    expect(PROPOSED_LAMBDA_MAX_RETRY_ATTEMPTS).toBe(0);
    expect(PROPOSED_LAMBDA_MAX_EVENT_AGE_SECONDS).toBe(900);
    expect(PROPOSED_EVENTBRIDGE_TARGET_MAX_RETRY_ATTEMPTS).toBe(0);
    const planner = fs.readFileSync(path.join(root, 'lambda/odds-pre-game-snapshot/collection-planner.ts'), 'utf8');
    expect(planner).not.toContain('21717855');
  });
});
