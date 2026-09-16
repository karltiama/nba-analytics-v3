import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));
import { associateInjuryToGame } from '@/lib/injuries/game-association';
import { planInjuryCollectorExtras } from '@/lib/injuries/collector-persist';
import { evaluateInjuryPullCompleteness, REMOVED_FROM_REPORT_STATUS } from '@/lib/injuries/leave-report';
import { planInjuryIngest, planInjuryPullMembership } from '@/lib/injuries/ingest-plan';
import { selectKnownOutObservation, intendedCutoffIso } from '@/lib/wowy/known-out-association';
import { appendPredictionSnapshot, classifyDelivery, intendedCutoff, observationUsableByCutoff } from '@/lib/betting/player-projection-shadow-scoring';
import { CollectionSchemaPreflightError, assertSchemaReady } from '@/lib/db/schema-capability';
import { buildWowyResearchInput } from '@/lib/wowy/research-input';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('material risks for injuries-only / shadow prep', () => {
  it('re-observes unchanged Out on a later successful pull as last observed, not last changed', () => {
    const cutoff = intendedCutoffIso('2026-04-01T23:00:00.000Z')!;
    const result = selectKnownOutObservation({
      teammatePlayerId: 'B',
      teamId: '8',
      cutoffStartTime: cutoff,
      observations: [
        { playerId: 'B', teamId: '8', status: 'Out', snapshotAt: '2026-03-30T12:00:00.000Z' },
        { playerId: 'B', teamId: '8', status: 'Out', snapshotAt: '2026-04-01T20:00:00.000Z' },
      ],
    });
    expect(result.eligible).toBe(true);
    expect(result.usedSnapshotAt).toBe('2026-04-01T20:00:00.000Z');
  });

  it('failed pull is distinct from empty successful response and does not clear the board', () => {
    const failed = evaluateInjuryPullCompleteness({
      status: 'error',
      completed: true,
      rowsStored: 0,
      rowsReturned: 0,
      previousRowsStored: 128,
    });
    const emptyOk = evaluateInjuryPullCompleteness({
      status: 'success',
      completed: true,
      rowsStored: 0,
      rowsReturned: 0,
      previousRowsStored: 128,
    });
    expect(failed.reason).toBe('pull status is not success');
    expect(emptyOk.reason).toBe('empty_successful_provider_response');
    const prev = new Map([['p1', { playerId: 'p1', teamId: '8', status: 'Out', description: null, returnDateRaw: null }]]);
    const plan = planInjuryIngest({
      pullRunId: 9,
      pullStatus: 'error',
      completed: true,
      rowsStored: 0,
      rowsReturned: 0,
      previousCompleteRowCount: 128,
      observedAt: '2026-04-01T18:00:00.000Z',
      pullRows: [],
      previousCurrent: prev,
    });
    expect(plan.massClearBlocked).toBe(true);
    expect(plan.currentDeletes).toEqual([]);
  });

  it('report omission is RemovedFromReport / not_in_report, never Available', () => {
    expect(REMOVED_FROM_REPORT_STATUS).toBe('RemovedFromReport');
    const extras = planInjuryCollectorExtras({
      pullRunId: 3,
      observedAt: '2026-04-01T18:00:00.000Z',
      pullStatus: 'success',
      completed: true,
      rowsStored: 128,
      rowsReturned: 128,
      previousCompleteRowCount: 128,
      inReportPlayerIds: ['p2'],
      notInReportPlayerIds: ['p1'],
    });
    expect(extras.membership.find((r) => r.playerId === 'p1')).toEqual(
      expect.objectContaining({ inReport: false })
    );
    expect(JSON.stringify(extras.membership)).not.toMatch(/Available/);
    const incomplete = planInjuryCollectorExtras({
      pullRunId: 3,
      observedAt: '2026-04-01T18:00:00.000Z',
      pullStatus: 'success',
      completed: true,
      rowsStored: 0,
      rowsReturned: 0,
      previousCompleteRowCount: 128,
      inReportPlayerIds: [],
      notInReportPlayerIds: ['p1'],
    });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.membership.some((r) => r.inReport === false)).toBe(false);
  });

  it('ambiguous roster/game linkage stays unknown', () => {
    const assoc = associateInjuryToGame({
      teamId: '8',
      observedAt: '2026-04-01T23:00:00.000Z',
      slate: [
        { gameId: 'g1', teamId: '8', startTime: '2026-04-01T23:00:00.000Z' },
        { gameId: 'g2', teamId: '8', startTime: '2026-04-02T02:00:00.000Z' },
      ],
    });
    expect(assoc.gameId).toBeNull();
    expect(assoc.provenance).toBe('none');
    expect(assoc.unknownReason).toMatch(/ambiguous/);
  });

  it('excludes observations at or after cutoff', () => {
    const cutoff = intendedCutoff('2026-10-21T00:00:00.000Z');
    expect(observationUsableByCutoff('2026-10-20T23:00:01.000Z', cutoff)).toBe(false);
    expect(classifyDelivery('2026-10-20T23:20:00.000Z', cutoff)).toBe('late');
  });

  it('retry does not insert a second immutable prediction row', () => {
    const rec = {
      playerId: 'p1',
      gameId: 'g1',
      scheduledTipoff: '2026-10-21T00:00:00.000Z',
      intendedCutoffAt: intendedCutoff('2026-10-21T00:00:00.000Z'),
      generatedAt: '2026-10-20T22:50:00.000Z',
      modelVersion: 'player-projection-learned-r1-pts-reb-c',
      featureSpecVersion: 'player-projection-learned-features-r1',
      featureOrder: ['pts_l10'],
      featureValues: {},
      featureChecksum: 'x',
      modelChecksums: { points: 'p', rebounds: 'r' },
      predA: { points: 1, rebounds: 1 },
      predB: { points: 1, rebounds: 1 },
      predC: { points: 1, rebounds: 1 },
      eligibility: 'ok',
      sourceFreshness: {},
      tipoffRevision: 0,
    };
    const first = appendPredictionSnapshot({
      existing: [],
      candidate: rec,
    });
    const retry = appendPredictionSnapshot({
      existing: first.records,
      candidate: { ...rec, generatedAt: '2026-10-20T22:55:00.000Z' },
    });
    expect(first.accepted).toBe(true);
    expect(retry.accepted).toBe(false);
    expect(retry.records).toHaveLength(1);
  });

  it('required schema missing fails closed', () => {
    expect(() =>
      assertSchemaReady({ mode: 'required', ready: false, missing: ['raw.injury_pull_membership'] })
    ).toThrow(CollectionSchemaPreflightError);
  });

  it('scoped injuries overlay does not disable game_status_sync', () => {
    const overlay = readFileSync(
      path.join(process.cwd(), 'infra/activation/injuries-only.tfvars.example'),
      'utf8'
    );
    expect(overlay).toMatch(/injuries_execution_enabled = true/);
    expect(overlay).toMatch(/game_status_sync_execution_enabled = true/);
    expect(overlay).toMatch(/shadow_execution_enabled\s+= false/);
    expect(overlay).not.toMatch(/live_ingestion_enabled\s+= false/);
  });

  it('keeps reconstructed WOWY inputs distinct from captured pregame rows', () => {
    const reconstructed = buildWowyResearchInput({
      playerId: 'p1',
      gameId: 'g1',
      intendedCutoffAt: '2026-04-01T22:00:00.000Z',
      teammateIds: ['t1'],
      wowyHistory: { delta_minutes: 2.1 },
      sampleSupport: { withGames: 20, withoutGames: 8, tier: 'adequate' },
      calculationVersion: 'wowy-r1',
      pregameAvailability: {
        providerStatus: 'Out',
        lastObservedAt: null,
        lastChangedAt: '2026-03-20T00:00:00.000Z',
        reportMembership: 'unknown',
      },
      availabilityState: 'unknown',
      valueKind: 'reconstructed_historical',
      gameAssociation: { gameId: 'g1', provenance: 'scheduled_slate_join', unknownReason: null },
    });
    expect(reconstructed.valueKind).toBe('reconstructed_historical');
    expect(() =>
      buildWowyResearchInput({
        ...reconstructed,
        valueKind: 'captured_pregame',
      })
    ).toThrow(/lastObservedAt/);
    expect(() =>
      buildWowyResearchInput({
        ...reconstructed,
        availabilityState: 'with',
        valueKind: 'reconstructed_historical',
      })
    ).toThrow(/WITH/);
  });
});

describe('membership helper remains explicit', () => {
  it('does not coerce omitted players to in-report', () => {
    const rows = planInjuryPullMembership({
      pullRunId: 1,
      observedAt: 't',
      inReportPlayerIds: [],
      notInReportPlayerIds: ['p1'],
    });
    expect(rows).toEqual([{ pullRunId: 1, playerId: 'p1', inReport: false, observedAt: 't' }]);
  });
});
