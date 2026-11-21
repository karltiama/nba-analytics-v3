import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryAcqLedgerWriter } from '@/lib/acquisition/ledger-pg';
import { CLUSTER_HALT_BYTES } from '@/lib/ops/storage-budget';
import { SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES } from '@/lib/ops/storage-growth-bounds';
import { MemoryStorageReservationStore, type AdmissionMeasurement } from '@/lib/ops/storage-admission';
import { BDL_RATE_LIMIT_TABLE_NAME } from '@/lib/ops/cluster-measurement-dynamo';
import { runLambdaScoreboard, SCOREBOARD_OPERATOR_REVIEW_BYTES } from '@/lib/scoreboard/lambda';
import { wireProductionScoreboard } from '@/lib/scoreboard/production-storage';
import { createMemoryScoreboardStore } from '@/lib/scoreboard/store';

const LIVE = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: '1',
  SCOREBOARD_COLLECT_PRESEASON: '1',
  SCOREBOARD_TARGET_SEASON: '2026',
  BALLDONTLIE_API_KEY: 'test-not-a-real-key',
  NBA_RAW_PREFIX: 'raw',
  BDL_RATE_LIMIT_BACKEND: 'memory',
};

const NOW = new Date('2026-10-10T00:06:00.000Z');
const FRESH = '2026-10-10T00:00:00.000Z';
const CLUSTER = 399_110_321;

function iamPolicyBlock(source: string, name: string): string {
  const marker = `resource "aws_iam_role_policy" "${name}"`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nresource "', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function dynamoActions(block: string): string[] {
  return [...block.matchAll(/"dynamodb:([^"]+)"/g)].map((match) => match[1]).sort();
}

function measurement(over: Partial<AdmissionMeasurement> = {}): AdmissionMeasurement {
  return {
    clusterBytes: CLUSTER,
    measuredAt: FRESH,
    source: 'scoreboard-collector:pg_database',
    valid: true,
    complete: true,
    ...over,
  };
}

function tracked() {
  const calls: string[] = [];
  const store = createMemoryScoreboardStore();
  const ledger = createMemoryAcqLedgerWriter();
  const upsert = store.upsertGames.bind(store);
  const lines = store.replacePlayerLines.bind(store);
  const record = store.recordGamesRequest.bind(store);
  const insert = ledger.insertRow.bind(ledger);
  store.upsertGames = async (...args) => {
    calls.push('upsert');
    return upsert(...args);
  };
  store.replacePlayerLines = async (...args) => {
    calls.push('lines');
    return lines(...args);
  };
  store.recordGamesRequest = async (...args) => {
    calls.push('record');
    return record(...args);
  };
  ledger.insertRow = async (row) => {
    calls.push('ledger');
    return insert(row);
  };
  const fetch = vi.fn(async () => ({
    status: 200,
    ok: true,
    json: { data: [], meta: { next_cursor: null } },
    acquisition: { requestIds: ['req-1'], archiveStatuses: ['ARCHIVED' as const], s3Keys: [], blockedReason: null },
  }));
  return { calls, store, ledger, fetch };
}

function base(extra: Record<string, unknown> = {}) {
  const subject = tracked();
  return {
    subject,
    deps: {
      env: LIVE,
      now: NOW,
      store: subject.store,
      ledger: subject.ledger,
      fetch: { games: subject.fetch, liveBox: subject.fetch },
      ...extra,
    },
  };
}

describe('scoreboard production admission', () => {
  it('refuses a missing reservation table before constructing a writer', () => {
    expect(wireProductionScoreboard({}, { awsRequestId: 'req-1' }).reservationRefusal).toMatch(/not configured/);
    expect(
      wireProductionScoreboard(
        { STORAGE_RESERVATION_TABLE: BDL_RATE_LIMIT_TABLE_NAME, SUPABASE_DB_URL: 'postgresql://unused.example/db' },
        { awsRequestId: 'req-1' }
      ).reservationRefusal
    ).toMatch(/not configured/);
    const wired = wireProductionScoreboard(
      { STORAGE_RESERVATION_TABLE: 'nba-storage-admission', SUPABASE_DB_URL: 'postgresql://unused.example/db' },
      { awsRequestId: 'req-1' }
    );
    expect(wired.invocationId).toBe('req-1');
    expect(wired.reservations).toBeDefined();
    expect(wired.measureCluster).toBeTypeOf('function');
  });

  it('makes zero scoreboard writes when measurement, reservation, or capacity is missing', async () => {
    const missing = base();
    const missingResult = await runLambdaScoreboard(missing.deps);
    expect(missingResult.reason).toContain('not configured');
    expect(missing.subject.calls).toEqual([]);
    expect(missing.subject.fetch).not.toHaveBeenCalled();

    const stale = base({
      storage: {
        now: '2026-10-10T00:06:00.000Z',
        invocationId: 'stale',
        measurement: measurement({ measuredAt: '2026-10-09T00:00:00.000Z' }),
        physicalGrowthBoundBytes: SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
        reservations: new MemoryStorageReservationStore(),
      },
    });
    const staleResult = await runLambdaScoreboard(stale.deps);
    expect(staleResult.reason).toMatch(/60 minutes|stale/);
    expect(stale.subject.calls).toEqual([]);

    const thrown = base({
      invocationId: 'measure-threw',
      reservations: new MemoryStorageReservationStore(),
      measureCluster: async () => {
        throw new Error('iam denied');
      },
    });
    const thrownResult = await runLambdaScoreboard(thrown.deps);
    expect(thrownResult.reason).toMatch(/measurement failed/);
    expect(thrown.subject.calls).toEqual([]);

    const halted = base({
      storage: {
        now: '2026-10-10T00:06:00.000Z',
        invocationId: 'halted',
        measurement: measurement({ clusterBytes: CLUSTER_HALT_BYTES }),
        physicalGrowthBoundBytes: SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
        reservations: new MemoryStorageReservationStore(),
      },
    });
    const haltedResult = await runLambdaScoreboard(halted.deps);
    expect(haltedResult.reason).toContain('450,000,000');
    expect(halted.subject.calls).toEqual([]);
    expect(SCOREBOARD_OPERATOR_REVIEW_BYTES).toBe(425_000_000);
    expect(CLUSTER_HALT_BYTES).toBe(450_000_000);
  });

  it('settles one fitting reservation only after a newer post-write measurement', async () => {
    const reservations = new MemoryStorageReservationStore();
    const release = vi.spyOn(reservations, 'releaseStranded');
    let reads = 0;
    const preWriteDb = '2026-11-20T02:00:00.000Z';
    const postWriteDb = '2026-11-20T02:00:20.000Z';
    const subject = tracked();
    const result = await runLambdaScoreboard({
      env: LIVE,
      now: NOW,
      store: subject.store,
      ledger: subject.ledger,
      fetch: { games: subject.fetch, liveBox: subject.fetch },
      invocationId: 'canary-1',
      reservations,
      measureCluster: async () => {
        reads += 1;
        return measurement({
          measuredAt: new Date(Date.now() + reads * 1000).toISOString(),
          databaseObservedAt: reads === 1 ? preWriteDb : postWriteDb,
          clusterBytes: reads === 1 ? CLUSTER : CLUSTER + 1000,
        });
      },
    });
    expect(result.status).toBe('success');
    expect(subject.calls).toContain('record');
    expect(reads).toBe(2);
    expect(reservations.snapshot().settled['canary-1']?.boundBytes).toBe(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(reservations.snapshot().settled['canary-1']?.observedThrough).toBe(postWriteDb);
    expect(reservations.snapshot().active['canary-1']).toBeUndefined();
    expect(reservations.snapshot().protectedBytes).toBe(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(release).not.toHaveBeenCalled();

    const retry = tracked();
    const again = await runLambdaScoreboard({
      env: LIVE,
      now: NOW,
      store: retry.store,
      ledger: retry.ledger,
      fetch: { games: retry.fetch, liveBox: retry.fetch },
      invocationId: 'canary-1',
      reservations,
      measureCluster: async () =>
        measurement({
          measuredAt: new Date(Date.now() + 5_000).toISOString(),
          databaseObservedAt: postWriteDb,
          clusterBytes: CLUSTER + 1000,
        }),
    });
    expect(again.status).toBe('success');
    expect(reservations.snapshot().protectedBytes).toBe(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES);
  });

  it('retains the reservation when the write or the post-write measurement fails', async () => {
    const reservations = new MemoryStorageReservationStore();
    const release = vi.spyOn(reservations, 'releaseStranded');
    const subject = tracked();
    subject.fetch.mockRejectedValueOnce(new Error('writer interrupted'));
    await expect(
      runLambdaScoreboard({
        env: LIVE,
        now: NOW,
        store: subject.store,
        ledger: subject.ledger,
        fetch: { games: subject.fetch, liveBox: subject.fetch },
        invocationId: 'partial',
        reservations,
        measureCluster: async () => measurement(),
      })
    ).rejects.toThrow('writer interrupted');
    expect(reservations.snapshot().active.partial?.boundBytes).toBe(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(reservations.snapshot().settled.partial).toBeUndefined();
    expect(release).not.toHaveBeenCalled();

    const unverified = tracked();
    const separate = new MemoryStorageReservationStore();
    const failed = await runLambdaScoreboard({
      env: LIVE,
      now: NOW,
      store: unverified.store,
      ledger: unverified.ledger,
      fetch: { games: unverified.fetch, liveBox: unverified.fetch },
      invocationId: 'stale-after',
      reservations: separate,
      measureCluster: async () => measurement({ measuredAt: '2026-10-10T00:00:00.000Z' }),
    });
    expect(failed.status).toBe('failed');
    expect(failed.reason).toMatch(/not fresh/);
    expect(separate.snapshot().active['stale-after']?.boundBytes).toBe(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(separate.snapshot().active['stale-after']?.inWrite).toBe(false);
    expect(separate.snapshot().settled['stale-after']).toBeUndefined();
    expect(release).not.toHaveBeenCalled();

    const incomplete = tracked();
    const held = new MemoryStorageReservationStore();
    const sameDb = '2026-11-20T02:00:00.000Z';
    const unfinished = await runLambdaScoreboard({
      env: LIVE,
      now: NOW,
      store: incomplete.store,
      ledger: incomplete.ledger,
      fetch: { games: incomplete.fetch, liveBox: incomplete.fetch },
      invocationId: 'same-db-clock',
      reservations: held,
      measureCluster: async () =>
        measurement({
          measuredAt: new Date(Date.now() + 1_000).toISOString(),
          databaseObservedAt: sameDb,
          clusterBytes: CLUSTER,
        }),
    });
    expect(unfinished.status).toBe('failed');
    expect(unfinished.reason).toMatch(/not fresh/);
    expect(held.snapshot().active['same-db-clock']?.boundBytes).toBe(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(held.snapshot().settled['same-db-clock']).toBeUndefined();
    expect(release).not.toHaveBeenCalled();
  });

  it('scopes collector admission IAM to the reservation ledger and keeps the scoreboard schedule local', () => {
    const root = path.resolve(__dirname, '../../..');
    const infra = path.join(root, 'infra');
    const lambdaTf = fs.readFileSync(path.join(infra, 'lambda.tf'), 'utf8');
    const scoreboardTf = fs.readFileSync(path.join(infra, 'scoreboard.tf'), 'utf8');
    const gameStatusTf = fs.readFileSync(path.join(infra, 'game-status-sync.tf'), 'utf8');
    const admissionTf = fs.readFileSync(path.join(infra, 'storage-admission.tf'), 'utf8');
    const rateLimitTf = fs.readFileSync(path.join(infra, 'bdl-rate-limit.tf'), 'utf8');

    expect(lambdaTf).toMatch(/ingestion_schedule_lock\s*=\s*true/);
    expect(scoreboardTf).toMatch(/state\s*=\s*local\.scoreboard_schedule_state/);
    expect(scoreboardTf).not.toMatch(/state\s*=\s*"ENABLED"/);
    expect(admissionTf).toMatch(/name\s*=\s*var\.storage_reservation_table_name/);
    expect(admissionTf).toMatch(/default\s*=\s*"nba-storage-admission"/);
    expect(admissionTf).not.toMatch(/aws_scheduler_schedule|aws_cloudwatch_event_rule|dynamodb:/);

    const policies = [
      {
        source: scoreboardTf,
        name: 'scoreboard_storage_admission',
        role: 'aws_iam_role.lambda_scoreboard_execution[0].id',
      },
      {
        source: gameStatusTf,
        name: 'game_status_sync_storage_admission',
        role: 'aws_iam_role.lambda_game_status_sync_execution[0].id',
      },
      {
        source: lambdaTf,
        name: 'nightly_bdl_storage_admission',
        role: 'aws_iam_role.lambda_nightly_bdl_execution.id',
      },
    ];
    for (const policy of policies) {
      const block = iamPolicyBlock(policy.source, policy.name);
      expect(block).toMatch(new RegExp(`role\\s*=\\s*${policy.role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      expect(dynamoActions(block)).toEqual(['GetItem', 'UpdateItem']);
      expect(block).toContain('Resource = aws_dynamodb_table.storage_admission.arn');
      expect(block).not.toMatch(/dynamodb:(DeleteItem|PutItem|Query|Scan|\*)/);
    }
    expect(scoreboardTf).toMatch(/STORAGE_RESERVATION_TABLE\s*=\s*aws_dynamodb_table\.storage_admission\.name/);
    expect(gameStatusTf).toMatch(/STORAGE_RESERVATION_TABLE\s*=\s*aws_dynamodb_table\.storage_admission\.name/);
    expect(lambdaTf).toMatch(/STORAGE_RESERVATION_TABLE\s*=\s*aws_dynamodb_table\.storage_admission\.name/);

    const admissionWriters = fs.readdirSync(infra)
      .filter((name) => name.endsWith('.tf'))
      .filter((name) => fs.readFileSync(path.join(infra, name), 'utf8').includes('aws_dynamodb_table.storage_admission.arn'));
    expect(admissionWriters.sort()).toEqual(['game-status-sync.tf', 'lambda.tf', 'scoreboard.tf']);
    expect(rateLimitTf).toContain('Resource = aws_dynamodb_table.bdl_rate_limit.arn');
    expect(rateLimitTf).not.toContain('storage_admission');
    expect(rateLimitTf).not.toMatch(/"dynamodb:\*"/);
  });
});
