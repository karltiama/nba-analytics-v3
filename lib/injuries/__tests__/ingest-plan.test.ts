import { describe, expect, it } from 'vitest';
import { REMOVED_FROM_REPORT_STATUS } from '@/lib/injuries/leave-report';
import { injuryTupleChanged, planInjuryIngest } from '@/lib/injuries/ingest-plan';
import type { InjuryFieldSnapshot, InjuryPullRow } from '@/lib/injuries/ingest-plan';

const observedAt = '2026-05-06T18:00:00.000Z';

function row(
  partial: Partial<InjuryPullRow> & Pick<InjuryPullRow, 'playerId'>
): InjuryPullRow {
  return {
    teamId: '22',
    status: 'Out',
    description: 'Calf',
    returnDateRaw: null,
    snapshotAt: observedAt,
    ...partial,
  };
}

function current(
  partial: Partial<InjuryFieldSnapshot> & Pick<InjuryFieldSnapshot, 'playerId'>
): InjuryFieldSnapshot {
  return {
    teamId: '22',
    status: 'Out',
    description: 'Calf',
    returnDateRaw: null,
    ...partial,
  };
}

function plan(overrides: Parameters<typeof planInjuryIngest>[0]) {
  return planInjuryIngest(overrides);
}

const completeBase = {
  pullRunId: 12,
  pullStatus: 'success',
  completed: true,
  rowsStored: 128,
  rowsReturned: 128,
  previousCompleteRowCount: 128,
  observedAt,
};

describe('injury ingest plan', () => {
  it('unchanged status does not write redundant history', () => {
    const prev = new Map<string, InjuryFieldSnapshot>([
      ['p1', current({ playerId: 'p1', status: 'Questionable' })],
    ]);
    const r = plan({
      ...completeBase,
      pullRows: [row({ playerId: 'p1', status: 'Questionable' })],
      previousCurrent: prev,
    });
    expect(r.historyInserts).toEqual([]);
    expect(r.currentUpserts).toHaveLength(1);
    expect(r.currentDeletes).toEqual([]);
  });

  it('meaningful status change writes a history row', () => {
    const prev = new Map<string, InjuryFieldSnapshot>([
      ['p1', current({ playerId: 'p1', status: 'Questionable' })],
    ]);
    const r = plan({
      ...completeBase,
      pullRows: [row({ playerId: 'p1', status: 'Out' })],
      previousCurrent: prev,
    });
    expect(r.historyInserts).toEqual([
      expect.objectContaining({ playerId: 'p1', status: 'Out', kind: 'change' }),
    ]);
  });

  it('leave-report writes RemovedFromReport history before current delete', () => {
    const prev = new Map<string, InjuryFieldSnapshot>([
      ['p1', current({ playerId: 'p1', status: 'Questionable', description: 'Ankle' })],
      ['p2', current({ playerId: 'p2', status: 'Out' })],
    ]);
    const r = plan({
      ...completeBase,
      pullRows: [row({ playerId: 'p2', status: 'Out' })],
      previousCurrent: prev,
    });
    const leave = r.historyInserts.filter((h) => h.kind === 'leave_report');
    expect(leave).toEqual([
      expect.objectContaining({
        playerId: 'p1',
        status: REMOVED_FROM_REPORT_STATUS,
        teamId: '22',
        description: 'Ankle',
        snapshotAt: observedAt,
        pullRunId: 12,
      }),
    ]);
    expect(r.currentDeletes).toEqual(['p1']);
    expect(r.massClearBlocked).toBe(false);
  });

  it('leave-report idempotency skips a duplicate clearance for the same pull', () => {
    const prev = new Map<string, InjuryFieldSnapshot>([
      ['p1', current({ playerId: 'p1', status: 'Probable' })],
    ]);
    const r = plan({
      ...completeBase,
      pullRows: [row({ playerId: 'other', status: 'Out' })],
      previousCurrent: prev,
      existingLeaveReportPlayerIds: ['p1'],
    });
    expect(r.historyInserts.filter((h) => h.kind === 'leave_report')).toEqual([]);
    expect(r.currentDeletes).toEqual(['p1']);
  });

  it('failed pull does not clear anyone', () => {
    const prev = new Map<string, InjuryFieldSnapshot>([
      ['p1', current({ playerId: 'p1' })],
    ]);
    const r = plan({
      ...completeBase,
      pullStatus: 'error',
      pullRows: [],
      previousCurrent: prev,
    });
    expect(r.massClearBlocked).toBe(true);
    expect(r.currentDeletes).toEqual([]);
    expect(r.historyInserts.filter((h) => h.kind === 'leave_report')).toEqual([]);
  });

  it('partial or abnormally small response does not mass-clear', () => {
    const prev = new Map<string, InjuryFieldSnapshot>([
      ['p1', current({ playerId: 'p1' })],
      ['p2', current({ playerId: 'p2' })],
    ]);
    const partial = plan({
      ...completeBase,
      rowsStored: 10,
      rowsReturned: 128,
      pullRows: [row({ playerId: 'p1' })],
      previousCurrent: prev,
    });
    expect(partial.massClearBlocked).toBe(true);
    expect(partial.currentDeletes).toEqual([]);
    expect(partial.currentUpserts.map((u) => u.playerId)).toEqual(['p1']);

    const tiny = plan({
      ...completeBase,
      rowsStored: 8,
      rowsReturned: 8,
      pullRows: [row({ playerId: 'p1' })],
      previousCurrent: prev,
    });
    expect(tiny.massClearBlocked).toBe(true);
    expect(tiny.currentDeletes).toEqual([]);
  });

  it('clearance then later re-injury writes a first-seen provider status', () => {
    const afterLeave = new Map<string, InjuryFieldSnapshot>();
    const r = plan({
      ...completeBase,
      pullRunId: 20,
      pullRows: [row({ playerId: 'p1', status: 'Questionable', description: 'Knee' })],
      previousCurrent: afterLeave,
    });
    expect(r.historyInserts).toEqual([
      expect.objectContaining({
        playerId: 'p1',
        status: 'Questionable',
        kind: 'first',
      }),
    ]);
    expect(r.historyInserts[0]?.status).not.toBe(REMOVED_FROM_REPORT_STATUS);
  });

  it('team-change around disappearance keeps last known team_id', () => {
    const prev = new Map<string, InjuryFieldSnapshot>([
      ['p1', current({ playerId: 'p1', teamId: 'old-team', status: 'Out' })],
    ]);
    const r = plan({
      ...completeBase,
      pullRows: [row({ playerId: 'other', teamId: 'new-team' })],
      previousCurrent: prev,
    });
    expect(r.historyInserts.find((h) => h.kind === 'leave_report')).toEqual(
      expect.objectContaining({
        playerId: 'p1',
        teamId: 'old-team',
        status: REMOVED_FROM_REPORT_STATUS,
      })
    );
  });

  it('injuryTupleChanged ignores identical tuples', () => {
    expect(
      injuryTupleChanged(
        { teamId: '1', status: 'Out', description: 'x', returnDateRaw: null },
        { teamId: '1', status: 'Out', description: 'x', returnDateRaw: null }
      )
    ).toBe(false);
  });
});
