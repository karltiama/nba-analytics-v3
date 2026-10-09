import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectInjuryPages,
  DEFAULT_INJURY_MAX_PAGES,
  resolveInjuryMaxPages,
} from '../../../lambda/injuries-snapshot/pull-pages';
import * as lambdaLeave from '../../../lambda/injuries-snapshot/leave-report';
import * as lambdaPlan from '../../../lambda/injuries-snapshot/ingest-plan';
import * as lambdaExtras from '../../../lambda/injuries-snapshot/collector-persist';
import * as libLeave from '@/lib/injuries/leave-report';
import * as libPlan from '@/lib/injuries/ingest-plan';
import * as libExtras from '@/lib/injuries/collector-persist';
import { INJURY_SERVING_ENABLED_ENV, isFrozenInjuryServing } from '@/lib/injuries/freshness';
import type { InjuryFieldSnapshot, InjuryPullRow } from '@/lib/injuries/ingest-plan';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

function injury(id: number, extra: Record<string, unknown> = {}) {
  return {
    player: { id, first_name: 'A', last_name: `P${id}`, team_id: 1, jersey_number: '7' },
    status: 'Out',
    description: 'Ankle',
    return_date: 'Nov 17',
    provider_note: 'unknown field',
    ...extra,
  };
}

function pages(byCursor: Record<string, unknown>) {
  const calls: Array<number | null> = [];
  const fetchPage = async (cursor: number | null) => {
    calls.push(cursor);
    return byCursor[String(cursor)];
  };
  return { fetchPage, calls };
}

describe('injury pull pagination', () => {
  it('keeps the provider row verbatim, including fields the schema does not name', async () => {
    const first = injury(1, { nested: { a: 1 } });
    const { fetchPage, calls } = pages({
      null: { data: [first], meta: { next_cursor: 5, per_page: 100 } },
      5: { data: [injury(2)], meta: { next_cursor: null } },
    });
    const { records, pages: n } = await collectInjuryPages(fetchPage, { maxPages: 20 });
    expect(n).toBe(2);
    expect(calls).toEqual([null, 5]);
    expect(records.map((r) => r.row.player.id)).toEqual([1, 2]);
    expect(records[0].raw).toBe(first);
    expect(JSON.parse(JSON.stringify(records[0].raw))).toEqual(first);
    expect((records[0].row as Record<string, unknown>).provider_note).toBe('unknown field');
    expect((records[0].row.player as Record<string, unknown>).jersey_number).toBe('7');
  });

  it('a cursor left at the page cap fails the pull instead of returning a partial report', async () => {
    const { fetchPage } = pages({
      null: { data: [injury(1)], meta: { next_cursor: 2 } },
      2: { data: [injury(2)], meta: { next_cursor: 3 } },
    });
    await expect(collectInjuryPages(fetchPage, { maxPages: 2 })).rejects.toThrow(/page cap 2.*incomplete/);
  });

  it('exactly maxPages pages with no cursor left succeeds', async () => {
    const { fetchPage } = pages({
      null: { data: [injury(1)], meta: { next_cursor: 2 } },
      2: { data: [injury(2)], meta: {} },
    });
    await expect(collectInjuryPages(fetchPage, { maxPages: 2 })).resolves.toMatchObject({ pages: 2 });
  });

  it('a repeated cursor fails instead of looping', async () => {
    const { fetchPage } = pages({
      null: { data: [injury(1)], meta: { next_cursor: 4 } },
      4: { data: [injury(2)], meta: { next_cursor: 4 } },
    });
    await expect(collectInjuryPages(fetchPage, { maxPages: 20 })).rejects.toThrow(/repeated cursor 4/);
  });

  it('a malformed page or row fails the whole pull', async () => {
    await expect(collectInjuryPages(async () => ({ error: 'nope' }), { maxPages: 20 })).rejects.toThrow();
    await expect(
      collectInjuryPages(async () => ({ data: [{ status: 'Out' }], meta: {} }), { maxPages: 20 })
    ).rejects.toThrow();
  });

  it('INJURY_MAX_PAGES defaults to 20 and rejects anything outside 1..50', () => {
    expect(resolveInjuryMaxPages(undefined)).toBe(DEFAULT_INJURY_MAX_PAGES);
    expect(resolveInjuryMaxPages(' ')).toBe(20);
    expect(resolveInjuryMaxPages('1')).toBe(1);
    expect(resolveInjuryMaxPages('50')).toBe(50);
    for (const bad of ['0', '51', '-1', '2.5', 'abc', '1e1']) {
      expect(() => resolveInjuryMaxPages(bad), bad).toThrow(/INJURY_MAX_PAGES/);
    }
  });
});

describe('configurable completeness floor', () => {
  for (const [label, leave] of [
    ['lib', libLeave],
    ['lambda', lambdaLeave],
  ] as const) {
    it(`${label}: INJURY_MIN_COMPLETE_ROW_COUNT defaults to 50 and rejects values outside 10..1000`, () => {
      expect(leave.resolveMinCompleteInjuryRowCount(undefined)).toBe(50);
      expect(leave.resolveMinCompleteInjuryRowCount('80')).toBe(80);
      for (const bad of ['9', '1001', '0', 'x', '50.5', '-50']) {
        expect(() => leave.resolveMinCompleteInjuryRowCount(bad), bad).toThrow(/INJURY_MIN_COMPLETE_ROW_COUNT/);
      }
    });

    it(`${label}: a raised floor marks a smaller pull incomplete; the default is unchanged`, () => {
      const base = { status: 'success', completed: true, rowsStored: 60, rowsReturned: 60, previousRowsStored: null };
      expect(leave.evaluateInjuryPullCompleteness(base).complete).toBe(true);
      expect(leave.evaluateInjuryPullCompleteness({ ...base, minRowCount: 80 }).complete).toBe(false);
      expect(leave.completeInjuryRowFloor(200)).toBe(100);
      expect(leave.completeInjuryRowFloor(null, 80)).toBe(80);
    });
  }
});

const observedAt = '2026-10-09T18:00:00.000Z';
const pullRow = (playerId: string): InjuryPullRow => ({
  playerId,
  teamId: '22',
  status: 'Out',
  description: 'Calf',
  returnDateRaw: null,
  snapshotAt: observedAt,
});
const snapshot = (playerId: string): InjuryFieldSnapshot => ({
  playerId,
  teamId: '22',
  status: 'Out',
  description: 'Calf',
  returnDateRaw: null,
});

function planArgs(extra: Partial<Parameters<typeof libPlan.planInjuryIngest>[0]> = {}) {
  return {
    pullRunId: 9,
    pullStatus: 'success',
    completed: true,
    rowsStored: 120,
    rowsReturned: 120,
    previousCompleteRowCount: 120,
    observedAt,
    pullRows: [pullRow('1')],
    previousCurrent: new Map([
      ['1', snapshot('1')],
      ['2', snapshot('2')],
      ['3', snapshot('3')],
    ]),
    ...extra,
  };
}

describe('identity quarantine is not a removal', () => {
  for (const [label, plan] of [
    ['lib', libPlan],
    ['lambda', lambdaPlan],
  ] as const) {
    it(`${label}: a player still on the report but quarantined keeps its current row`, () => {
      const r = plan.planInjuryIngest(planArgs({ reportPlayerIds: ['1', '2'] }));
      expect(r.currentDeletes).toEqual(['3']);
      expect(r.historyInserts.filter((h) => h.kind === 'leave_report').map((h) => h.playerId)).toEqual(['3']);
    });

    it(`${label}: without reportPlayerIds the prior behavior is unchanged`, () => {
      expect(plan.planInjuryIngest(planArgs()).currentDeletes.sort()).toEqual(['2', '3']);
    });

    it(`${label}: the configured floor blocks removals on a small pull`, () => {
      const r = plan.planInjuryIngest(planArgs({ rowsStored: 60, rowsReturned: 60, previousCompleteRowCount: null, minCompleteRowCount: 80 }));
      expect(r.massClearBlocked).toBe(true);
      expect(r.currentDeletes).toEqual([]);
    });
  }

  it('lib and lambda copies plan identically', () => {
    const cases = [
      planArgs(),
      planArgs({ reportPlayerIds: ['1', '3'] }),
      planArgs({ rowsStored: 60, rowsReturned: 60, previousCompleteRowCount: null, minCompleteRowCount: 80 }),
      planArgs({ pullStatus: 'error', completed: false }),
    ];
    for (const args of cases) {
      expect(lambdaPlan.planInjuryIngest(args)).toEqual(libPlan.planInjuryIngest(args));
    }
  });

  it('collector extras use the same floor as the plan', () => {
    const args = {
      pullRunId: 9,
      observedAt,
      pullStatus: 'success',
      completed: true,
      rowsStored: 60,
      rowsReturned: 60,
      previousCompleteRowCount: null,
      inReportPlayerIds: ['1'],
      notInReportPlayerIds: ['2'],
      minCompleteRowCount: 80,
    };
    for (const extras of [libExtras, lambdaExtras]) {
      const r = extras.planInjuryCollectorExtras(args);
      expect(r.complete).toBe(false);
      expect(r.membership.every((m) => m.inReport)).toBe(true);
    }
    expect(lambdaExtras.planInjuryCollectorExtras(args)).toEqual(libExtras.planInjuryCollectorExtras(args));
  });
});

describe('collection-gap baseline', () => {
  for (const [label, plan, leave] of [
    ['lib', libPlan, libLeave],
    ['lambda', lambdaPlan, lambdaLeave],
  ] as const) {
    it(`${label}: absent players get one gap marker that carries no injury detail and no recovery`, () => {
      const r = plan.planInjuryIngest(planArgs({ collectionGap: true }));
      expect(r.baseline).toBe(true);
      expect(r.currentDeletes.sort()).toEqual(['2', '3']);
      const exits = r.historyInserts.filter((h) => h.playerId !== '1');
      expect(exits.map((h) => [h.playerId, h.kind, h.status]).sort()).toEqual([
        ['2', 'gap_exit', 'AbsentAfterCollectionGap'],
        ['3', 'gap_exit', 'AbsentAfterCollectionGap'],
      ]);
      for (const h of exits) {
        expect(h.description).toBeNull();
        expect(h.returnDateRaw).toBeNull();
        expect(h.teamId).toBe('22');
        expect(h.snapshotAt).toBe(observedAt);
        expect(h.status).not.toMatch(/available|cleared|healthy|active|removedfromreport/i);
      }
    });

    it(`${label}: players already terminated in history are deleted from current with no new row`, () => {
      for (const collectionGap of [true, false]) {
        const r = plan.planInjuryIngest(planArgs({ collectionGap, terminatedPlayerIds: ['3'] }));
        expect(r.currentDeletes.sort()).toEqual(['2', '3']);
        expect(r.alreadyTerminatedIds).toEqual(['3']);
        expect(r.historyInserts.some((h) => h.playerId === '3')).toBe(false);
      }
    });

    it(`${label}: an incomplete pull after a gap is not a baseline and removes nobody`, () => {
      const r = plan.planInjuryIngest(planArgs({ collectionGap: true, pullStatus: 'error', completed: false }));
      expect(r.baseline).toBe(false);
      expect(r.currentDeletes).toEqual([]);
      expect(r.historyInserts.some((h) => h.kind === 'gap_exit')).toBe(false);
    });

    it(`${label}: without a gap removals stay RemovedFromReport`, () => {
      const r = plan.planInjuryIngest(planArgs());
      expect(r.baseline).toBe(false);
      expect(r.historyInserts.filter((h) => h.kind === 'leave_report')).toHaveLength(2);
    });

    it(`${label}: gap detection uses a strict window and the 24-168 hour bound`, () => {
      const at = '2026-10-10T00:00:00.000Z';
      expect(leave.isCollectionGap({ previousCompletedAt: '2026-10-08T00:00:00.000Z', observedAt: at, maxGapHours: 48 })).toBe(false);
      expect(leave.isCollectionGap({ previousCompletedAt: '2026-10-07T23:59:59.000Z', observedAt: at, maxGapHours: 48 })).toBe(true);
      expect(leave.isCollectionGap({ previousCompletedAt: null, observedAt: at, maxGapHours: 48 })).toBe(false);
      expect(() => leave.isCollectionGap({ previousCompletedAt: 'nope', observedAt: at, maxGapHours: 48 })).toThrow();
      expect(leave.resolveContinuityMaxGapHours(undefined)).toBe(48);
      expect(leave.resolveContinuityMaxGapHours('168')).toBe(168);
      for (const bad of ['23', '169', '48.5', 'abc', '-48']) {
        expect(() => leave.resolveContinuityMaxGapHours(bad), bad).toThrow();
      }
      expect(leave.isTerminalReportHistoryStatus('AbsentAfterCollectionGap')).toBe(true);
      expect(leave.isTerminalReportHistoryStatus('RemovedFromReport')).toBe(true);
      expect(leave.isTerminalReportHistoryStatus('Out')).toBe(false);
    });
  }

  it('the gap marker is never an active injury and is distinct from every recovery status', () => {
    expect(libLeave.isActiveReportedInjuryStatus('AbsentAfterCollectionGap')).toBe(false);
    expect(libLeave.COLLECTION_GAP_EXIT_STATUS).toBe(lambdaLeave.COLLECTION_GAP_EXIT_STATUS);
    for (const s of ['Available', 'Cleared', 'RemovedFromReport', 'Active', 'Healthy']) {
      expect(libLeave.isCollectionGapExitStatus(s)).toBe(false);
    }
  });

  it('lib and lambda copies plan baselines identically', () => {
    for (const args of [
      planArgs({ collectionGap: true }),
      planArgs({ collectionGap: true, terminatedPlayerIds: ['2'] }),
      planArgs({ terminatedPlayerIds: ['3'] }),
    ]) {
      expect(lambdaPlan.planInjuryIngest(args)).toEqual(libPlan.planInjuryIngest(args));
    }
  });

  it('leave-report candidates exclude baseline pulls, failing closed until the table exists', () => {
    expect(read('lib/injuries/leave-report-sql.ts')).toMatch(
      /FROM raw\.injury_collection_baselines b\s+WHERE b\.baseline_pull_run_id = complete\.pull_run_id/
    );
  });

  it('the Lambda refuses a baseline write when the baselines table is missing', () => {
    const src = read('lambda/injuries-snapshot/index.ts');
    expect(src).toContain("to_regclass('raw.injury_collection_baselines')");
    expect(src).toContain('collectionGap,\n    terminatedPlayerIds,');
    expect(src).toContain('ON CONFLICT (baseline_pull_run_id) DO NOTHING');
  });
});

describe('INJURY_SERVING_ENABLED', () => {
  const frozenApp = { DATA_MODE: 'replay', OFFSEASON_MODE: '1', CRON_DRY_RUN: '1' };
  const liveApp = { DATA_MODE: 'live_api', OFFSEASON_MODE: '0', CRON_DRY_RUN: '0' };

  it('unset follows the app-wide freeze, including missing DATA_MODE', () => {
    expect(isFrozenInjuryServing(frozenApp)).toBe(true);
    expect(isFrozenInjuryServing(liveApp)).toBe(false);
    expect(isFrozenInjuryServing({})).toBe(true);
  });

  it('=1 serves injuries while the rest of the app stays frozen', () => {
    expect(isFrozenInjuryServing({ ...frozenApp, [INJURY_SERVING_ENABLED_ENV]: '1' })).toBe(false);
  });

  it('=0 or any other set value freezes injuries even when the app is live', () => {
    for (const v of ['0', 'true', 'yes', '2']) {
      expect(isFrozenInjuryServing({ ...liveApp, [INJURY_SERVING_ENABLED_ENV]: v }), v).toBe(true);
    }
  });
});

describe('injuries Lambda wiring', () => {
  const src = read('lambda/injuries-snapshot/index.ts');
  const transform = src.slice(src.indexOf('async function transformToAnalytics('), src.indexOf('export const handler'));
  const body = transform.slice(transform.indexOf('async function transformInTransaction('));

  it('analytics writes run in one transaction under an advisory lock on a dedicated client', () => {
    expect(transform).toContain("await client.query('BEGIN')");
    expect(transform).toContain('pg_try_advisory_xact_lock(hashtext($1))');
    expect(transform).toContain("await client.query('COMMIT')");
    expect(transform).toContain("client.query('ROLLBACK')");
    expect(transform).toContain('client.release()');
    expect(body).not.toContain('pool.query');
    expect(body).toMatch(/db\.query\(\s*`DELETE FROM analytics\.player_injury_status_current/);
  });

  it('plan and extras receive the configured floor; the plan receives full report membership', () => {
    expect(body).toContain('reportPlayerIds: requestedIds');
    expect(body.match(/minCompleteRowCount: MIN_COMPLETE_ROW_COUNT/g)).toHaveLength(2);
  });

  it('raw_payload stores the provider row, not the parsed row', () => {
    expect(src).toContain('JSON.stringify(record.raw)');
  });

  it('a failure after the success record does not overwrite it', () => {
    const successAt = src.indexOf('pullRecordedSuccess = true');
    expect(successAt).toBeGreaterThan(src.indexOf("completePullRun(pullRunId, 'success'"));
    const catchAt = src.indexOf('if (pullRecordedSuccess) {');
    const errorUpdate = src.indexOf("completePullRun(pullRunId, 'error'", catchAt);
    expect(catchAt).toBeGreaterThan(successAt);
    expect(src.slice(catchAt, errorUpdate)).toMatch(/return \{\s*statusCode: 500/);
    expect(src.slice(catchAt, errorUpdate)).toContain('Error in injuries snapshot');
  });
});

describe('injuries Terraform gating', () => {
  const tf = read('infra/lambda.tf');
  const fn = tf.slice(
    tf.indexOf('resource "aws_lambda_function" "injuries_snapshot"'),
    tf.indexOf('resource "aws_cloudwatch_event_rule" "injuries_schedule"')
  );

  it('live mode keys are merged last and follow injuries_execution_enabled only', () => {
    const envMapAt = fn.indexOf('var.injuries_lambda_env,');
    for (const line of [
      'LIVE_INGESTION_ENABLED = local.family_schedule_enabled.injuries ? "1" : "0"',
      'DATA_MODE              = local.family_schedule_enabled.injuries ? "live_api" : "replay"',
      'OFFSEASON_MODE         = local.family_schedule_enabled.injuries ? "0" : "1"',
      'CRON_DRY_RUN           = local.family_schedule_enabled.injuries ? "0" : "1"',
    ]) {
      expect(fn.indexOf(line), line).toBeGreaterThan(envMapAt);
    }
    expect(tf).toContain('injuries         = var.live_ingestion_enabled && var.injuries_execution_enabled');
  });

  it('async invoke config never retries a failed pull', () => {
    const cfgAt = tf.indexOf('resource "aws_lambda_function_event_invoke_config" "injuries_snapshot"');
    expect(cfgAt).toBeGreaterThan(0);
    const cfg = tf.slice(cfgAt, tf.indexOf('\n}', cfgAt));
    expect(cfg).toContain('function_name                = aws_lambda_function.injuries_snapshot.function_name');
    expect(cfg).toContain('maximum_retry_attempts       = 0');
    expect(cfg).toContain('maximum_event_age_in_seconds = 3600');
  });
});
