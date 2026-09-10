import { describe, expect, it } from 'vitest';
import {
  INJURY_FRESHNESS_FIELD,
  displayInjuryStatus,
  dryRunInjuryBoard,
  inventoryInjuryStatuses,
  partitionInjuryIdentity,
  preservedProviderStatus,
} from '@/lib/injuries/canary-board';
import type { InjuryFieldSnapshot } from '@/lib/injuries/ingest-plan';

const outRow = {
  player: { id: 1, first_name: 'A', last_name: 'One', team_id: 1 },
  status: 'Out',
  description: 'Knee',
  return_date: null,
};

describe('injury canary board', () => {
  it('partitions mapped vs unmapped by player id only (no name matching)', () => {
    const rows = [
      outRow,
      { player: { id: 99, first_name: 'Rookie', last_name: 'X', team_id: 2 }, status: 'Questionable' },
      { player: { id: 1, first_name: 'A', last_name: 'One', team_id: 1 }, status: 'Out' },
      { player: { id: null }, status: 'Out' },
    ];
    const part = partitionInjuryIdentity(rows, new Set(['1']));
    expect(part.mapped).toHaveLength(2);
    expect(part.unmapped).toHaveLength(2);
    expect(part.duplicates).toEqual(['1']);
    expect(part.missingPlayerId).toBe(1);
  });

  it('preserves provider status text and only maps known UI labels', () => {
    expect(preservedProviderStatus('Day-To-Day')).toBe('Day-To-Day');
    expect(displayInjuryStatus('day-to-day')).toBe('Day-To-Day');
    expect(displayInjuryStatus('Available')).toBe('Available');
    expect(displayInjuryStatus('GTD')).toBe('GTD');
    expect(inventoryInjuryStatuses([outRow, { status: 'Doubtful' }, { status: null }])).toEqual({
      Out: 1,
      Doubtful: 1,
      '(null)': 1,
    });
  });

  it('uses observed snapshot_at for freshness, not a provider changed-at', () => {
    expect(INJURY_FRESHNESS_FIELD.persisted).toBe('snapshot_at');
    expect(INJURY_FRESHNESS_FIELD.providerTimestamp).toBeNull();
    expect(INJURY_FRESHNESS_FIELD.semantics).toBe('court_context_observed');
  });

  it('dry-run reports inserts/updates/unchanged/skipped and does not claim injury-as-of', () => {
    const previous = new Map<string, InjuryFieldSnapshot>([
      ['1', { playerId: '1', teamId: 't1', status: 'Questionable', description: 'Knee', returnDateRaw: null }],
    ]);
    const result = dryRunInjuryBoard({
      pullRunId: 99,
      observedAt: '2026-09-10T21:00:00.000Z',
      mappedRows: [
        outRow,
        { player: { id: 2, team_id: 1 }, status: 'Probable', description: null, return_date: null },
      ],
      unmappedCount: 3,
      previousCurrent: previous,
      previousCompleteRowCount: 80,
    });
    expect(result.injuryAsOf).toBe(false);
    expect(result.proposed.skippedUnmapped).toBe(3);
    expect(result.proposed.inserts).toBe(1);
    expect(result.proposed.updates).toBe(1);
    expect(result.proposed.conflicts).toBe(0);
    expect(result.currentUpserts).toHaveLength(2);
  });

  it('idempotent current update writes no extra history when the tuple is unchanged', () => {
    const previous = new Map<string, InjuryFieldSnapshot>([
      ['1', { playerId: '1', teamId: null, status: 'Out', description: 'Knee', returnDateRaw: null }],
    ]);
    const result = dryRunInjuryBoard({
      pullRunId: 100,
      observedAt: '2026-09-10T21:00:00.000Z',
      mappedRows: [outRow],
      unmappedCount: 0,
      previousCurrent: previous,
      previousCompleteRowCount: 80,
    });
    expect(result.historyInserts).toEqual([]);
    expect(result.proposed.unchanged).toBe(1);
    expect(result.proposed.updates).toBe(0);
  });

  it('null status is stored as null rather than invented Available', () => {
    const result = dryRunInjuryBoard({
      pullRunId: 101,
      observedAt: '2026-09-10T21:00:00.000Z',
      mappedRows: [{ player: { id: 3, team_id: 1 }, status: null, description: null, return_date: null }],
      unmappedCount: 0,
      previousCurrent: new Map(),
      previousCompleteRowCount: null,
    });
    expect(result.currentUpserts[0]?.status).toBeNull();
  });
});
