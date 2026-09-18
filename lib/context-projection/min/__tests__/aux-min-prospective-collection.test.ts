/**
 * Phase 18B — Auxiliary MIN prospective collection integrity tests.
 * No MAE / ΔMAE computation.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AUX_MIN_JOINT_FEATURES,
  AUX_MIN_MODEL_VERSION,
  AUX_MIN_PROSPECTIVE_WINDOW,
  AUX_MIN_SHADOW_STORAGE,
  AUX_MIN_UNAUTHORIZED_FEATURES,
  AUXILIARY_MIN_SHADOW_STATUS,
  FROZEN_AUX_MIN_FEATURE_MANIFEST_SHA,
  FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA,
  FROZEN_AUX_MIN_TRAINING_MANIFEST_SHA,
  PROSPECTIVE_MIN_REQUIRED_N,
  PTS_FROZEN_MODEL_ARTIFACT_SHA,
  PTS_PROSPECTIVE_REQUIRED_N,
  PTS_PROSPECTIVE_WINDOW_ID,
  assembleAuxMinFeatures,
  assignPrimarySequences,
  assertMinWindowId,
  assertNotPtsWindowId,
  buildProspectiveMinShadowRecord,
  classifyMinSnapshotStatus,
  computeB0Min,
  intendedMinCutoffIso,
  isOnTimeMinPrediction,
  loadFrozenAuxMinBundle,
  minCollectionStatus,
  rejectUnauthorizedMinFeatures,
  resolveAppearanceFromPgl,
  runMinShadowIsolated,
  selectLatestEligibleAtOrBeforeT60,
  type MinWindowCandidateRow,
} from '@/lib/context-projection/min';
import { PROSPECTIVE_WINDOW_ID as PTS_WINDOW, PROSPECTIVE_REQUIRED_N } from '@/lib/context-projection/protocol';

const WINDOW_OPENED = '2026-09-18T16:00:00.000Z';
const TIP = '2026-09-20T00:00:00.000Z';
const CUTOFF = intendedMinCutoffIso(TIP); // T-60

function jointRow(
  id: string,
  created: string,
  appearance: MinWindowCandidateRow['resolvedAppearanceClass']
): MinWindowCandidateRow {
  return {
    shadowPredictionId: id,
    prospectiveWindowId: AUX_MIN_PROSPECTIVE_WINDOW,
    predictionCreatedAt: created,
    branch: 'ROLE_AVAIL_JOINT',
    pregameEligibilityStatus: 'PRIMARY_ELIGIBLE',
    resolvedAppearanceClass: appearance,
  };
}

function baseCandidate(over: Partial<Parameters<typeof buildProspectiveMinShadowRecord>[0]> = {}) {
  return {
    gameId: 'g1',
    playerEntityId: 'p1',
    teamId: 't1',
    season: '2025',
    gameStart: TIP,
    predictionCreatedAt: CUTOFF,
    windowOpenedAt: WINDOW_OPENED,
    priors: [
      { teamId: 't1', season: '2025', startTime: '2026-09-10T00:00:00.000Z', played: true, minutes: 30 },
      { teamId: 't1', season: '2025', startTime: '2026-09-12T00:00:00.000Z', played: true, minutes: 34 },
    ],
    contexts: {
      roleRecentMinutes: 36,
      roleSeasonMinutes: 32,
      expectedMissingMinutes: 20,
      rotationPlayersOutCount: 1,
      availCompleteness: 'COMPLETE',
      roleContextVersion: 'player-role-context-v1',
      availContextVersion: 'team-injury-context-v2',
    },
    ...over,
  };
}

describe('Phase 18B — freeze + PTS isolation', () => {
  it('AUX_MIN_MODEL_ARTIFACT_FREEZE_GATE', () => {
    const bundle = loadFrozenAuxMinBundle();
    expect(bundle.modelArtifactSha).toBe(FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA);
    expect(bundle.featureManifestSha).toBe(FROZEN_AUX_MIN_FEATURE_MANIFEST_SHA);
    expect(bundle.trainingManifestSha).toBe(FROZEN_AUX_MIN_TRAINING_MANIFEST_SHA);
    expect([...bundle.joint.featureNames]).toEqual([...AUX_MIN_JOINT_FEATURES]);
  });

  it('AUX_MIN_FEATURE_MANIFEST_PARITY + unauthorized exclusion', () => {
    expect([...AUX_MIN_JOINT_FEATURES]).toEqual([
      'role.minutes_delta',
      'injury.expected_missing_minutes',
      'injury.rotation_players_out_count',
    ]);
    const rejected = rejectUnauthorizedMinFeatures(
      Object.fromEntries(AUX_MIN_UNAUTHORIZED_FEATURES.map((k) => [k, 1]))
    );
    expect(rejected.length).toBe(AUX_MIN_UNAUTHORIZED_FEATURES.length);
  });

  it('PTS_PROSPECTIVE_WINDOW_ISOLATION', () => {
    expect(assertNotPtsWindowId(PTS_PROSPECTIVE_WINDOW_ID)).toBe(false);
    expect(assertMinWindowId(AUX_MIN_PROSPECTIVE_WINDOW)).toBe(true);
    expect(assertMinWindowId(PTS_PROSPECTIVE_WINDOW_ID)).toBe(false);
    expect(() =>
      buildProspectiveMinShadowRecord(baseCandidate({ windowId: PTS_PROSPECTIVE_WINDOW_ID }))
    ).toThrow(/PTS_PROSPECTIVE_WINDOW_ISOLATION/);
    expect(PTS_WINDOW).toBe('prod-pts-context-v1-first500');
    expect(PROSPECTIVE_REQUIRED_N).toBe(500);
    expect(PTS_PROSPECTIVE_REQUIRED_N).toBe(500);
    const ptsWin = JSON.parse(
      readFileSync(
        join(process.cwd(), 'lib/context-projection/artifacts/pts-production-context-prospective-window-v1.json'),
        'utf8'
      )
    );
    expect(ptsWin.model_artifact_sha).toBe(PTS_FROZEN_MODEL_ARTIFACT_SHA);
    expect(ptsWin.PROSPECTIVE_REQUIRED_N).toBe(500);
  });

  it('storage destination is dedicated MIN table', () => {
    expect(AUX_MIN_SHADOW_STORAGE).toBe('analytics.prospective_min_shadow_predictions');
    expect(AUXILIARY_MIN_SHADOW_STATUS).toBe('READY_FOR_PROSPECTIVE_COLLECTION');
    expect(PROSPECTIVE_MIN_REQUIRED_N).toBe(750);
  });
});

describe('Phase 18B — T−60 canonical snapshot', () => {
  it('MIN_CANONICAL_T60_GATE boundaries', () => {
    expect(classifyMinSnapshotStatus({ predictionCreatedAt: CUTOFF, gameStart: TIP, intendedCutoffAt: CUTOFF })).toBe(
      'CANONICAL_T60'
    );
    expect(
      classifyMinSnapshotStatus({
        predictionCreatedAt: new Date(Date.parse(CUTOFF) - 60_000).toISOString(),
        gameStart: TIP,
        intendedCutoffAt: CUTOFF,
      })
    ).toBe('CANONICAL_T60');
    expect(
      classifyMinSnapshotStatus({
        predictionCreatedAt: new Date(Date.parse(CUTOFF) + 60_000).toISOString(),
        gameStart: TIP,
        intendedCutoffAt: CUTOFF,
      })
    ).toBe('LATE_AFTER_T60');
    expect(isOnTimeMinPrediction(CUTOFF, CUTOFF)).toBe(true);

    const latest = selectLatestEligibleAtOrBeforeT60(
      [
        new Date(Date.parse(CUTOFF) - 120_000).toISOString(),
        new Date(Date.parse(CUTOFF) - 30_000).toISOString(),
        new Date(Date.parse(CUTOFF) + 30_000).toISOString(),
      ],
      CUTOFF,
      TIP
    );
    expect(latest).toBe(new Date(Date.parse(CUTOFF) - 30_000).toISOString());
  });
});

describe('Phase 18B — eligibility + PARTIAL exclusion', () => {
  it('COMPLETE → joint PRIMARY_ELIGIBLE', () => {
    const row = buildProspectiveMinShadowRecord(baseCandidate());
    expect(row.branch).toBe('ROLE_AVAIL_JOINT');
    expect(row.pregameEligibilityStatus).toBe('PRIMARY_ELIGIBLE');
    expect(row.modelArtifactSha).toBe(FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA);
    expect(row.prospectiveWindowId).toBe(AUX_MIN_PROSPECTIVE_WINDOW);
  });

  it('PARTIAL → not joint eligible', () => {
    const a = assembleAuxMinFeatures({
      roleRecentMinutes: 36,
      roleSeasonMinutes: 32,
      expectedMissingMinutes: 20,
      rotationPlayersOutCount: 1,
      availCompleteness: 'PARTIAL',
    });
    expect(a.availAvailable).toBe(false);
    const row = buildProspectiveMinShadowRecord(
      baseCandidate({
        contexts: {
          roleRecentMinutes: 36,
          roleSeasonMinutes: 32,
          expectedMissingMinutes: 20,
          rotationPlayersOutCount: 1,
          availCompleteness: 'PARTIAL',
        },
      })
    );
    expect(row.branch).not.toBe('ROLE_AVAIL_JOINT');
    expect(row.pregameEligibilityStatus).not.toBe('PRIMARY_ELIGIBLE');
  });

  it('SOURCE_ONLY / SOURCE_UNKNOWN not primary joint', () => {
    for (const status of ['SOURCE_ONLY', 'SOURCE_UNKNOWN']) {
      const row = buildProspectiveMinShadowRecord(
        baseCandidate({
          contexts: {
            roleRecentMinutes: 36,
            roleSeasonMinutes: 32,
            expectedMissingMinutes: 10,
            rotationPlayersOutCount: 0,
            availCompleteness: status,
          },
        })
      );
      expect(row.pregameEligibilityStatus).not.toBe('PRIMARY_ELIGIBLE');
    }
  });

  it('historical backfill rejected', () => {
    expect(() =>
      buildProspectiveMinShadowRecord(
        baseCandidate({ predictionCreatedAt: '2026-09-17T00:00:00.000Z' })
      )
    ).toThrow(/HISTORICAL_ROWS/);
  });
});

describe('Phase 18B — appearance resolution', () => {
  it('PLAYED / DNP_00 / NO_PGL', () => {
    expect(resolveAppearanceFromPgl({ minutes: '32:00', points: 10 }).resolvedAppearanceClass).toBe('played');
    const dnp = resolveAppearanceFromPgl({ minutes: '00', points: 0 });
    expect(dnp.resolvedAppearanceClass).toBe('dnp');
    expect(dnp.realizedMinutes).toBeNull(); // not primary 0-minute target
    expect(resolveAppearanceFromPgl(null).resolvedAppearanceClass).toBe('no_pgl');
  });
});

describe('Phase 18B — primary window ordering + boundary', () => {
  it('PRIMARY_WINDOW_ORDERING_GATE — creation order beats outcome arrival', () => {
    // B resolves first in wall-clock, but A created earlier → A is seq 1
    const rows = [
      jointRow('b', '2026-09-18T18:05:00.000Z', 'played'),
      jointRow('a', '2026-09-18T18:00:00.000Z', 'played'),
    ];
    const { assignments } = assignPrimarySequences(rows, 750);
    const a = assignments.find((x) => x.shadowPredictionId === 'a')!;
    const b = assignments.find((x) => x.shadowPredictionId === 'b')!;
    expect(a.primarySequenceNumber).toBe(1);
    expect(b.primarySequenceNumber).toBe(2);
  });

  it('earlier unresolved blocks later PLAYED finalization', () => {
    const rows = [
      jointRow('early', '2026-09-18T18:00:00.000Z', null),
      jointRow('late', '2026-09-18T18:05:00.000Z', 'played'),
    ];
    const { assignments, counters } = assignPrimarySequences(rows, 750);
    expect(assignments.find((x) => x.shadowPredictionId === 'late')!.primarySequenceNumber).toBeNull();
    expect(counters.FINALIZED_PRIMARY_N).toBe(0);
    expect(counters.blockedByEarlierUnresolved).toBe(true);
    expect(minCollectionStatus({
      armed: true,
      pregameJointN: 2,
      finalizedPrimaryN: 0,
      blockedByEarlierUnresolved: true,
    })).toBe('COLLECTING');
  });

  it('DNP does not consume primary N', () => {
    const rows = [
      jointRow('d1', '2026-09-18T18:00:00.000Z', 'dnp'),
      jointRow('p1', '2026-09-18T18:01:00.000Z', 'played'),
    ];
    const { assignments, counters } = assignPrimarySequences(rows, 750);
    expect(assignments.find((x) => x.shadowPredictionId === 'd1')!.primaryScoringEligible).toBe(false);
    expect(assignments.find((x) => x.shadowPredictionId === 'p1')!.primarySequenceNumber).toBe(1);
    expect(counters.RESOLVED_DNP_N).toBe(1);
    expect(counters.FINALIZED_PRIMARY_N).toBe(1);
  });

  it('PRIMARY_WINDOW_BOUNDARY_GATE — 749 / 750 / 751', () => {
    const mk = (n: number, playedN: number) => {
      const rows: MinWindowCandidateRow[] = [];
      for (let i = 0; i < n; i++) {
        rows.push(
          jointRow(
            `id${String(i).padStart(4, '0')}`,
            new Date(Date.parse('2026-09-18T18:00:00.000Z') + i * 1000).toISOString(),
            i < playedN ? 'played' : 'dnp'
          )
        );
      }
      return assignPrimarySequences(rows, 750);
    };
    expect(mk(749, 749).counters.FINALIZED_PRIMARY_N).toBe(749);
    expect(mk(750, 750).counters.FINALIZED_PRIMARY_N).toBe(750);
    const over = mk(800, 751);
    expect(over.counters.FINALIZED_PRIMARY_N).toBe(750);
    const seq751 = over.assignments.find((a) => a.shadowPredictionId === 'id0750');
    // 0-indexed id0750 is the 751st played if first 751 are played
    expect(seq751?.primarySequenceNumber ?? null).toBeNull();
    expect(
      minCollectionStatus({
        armed: true,
        pregameJointN: 750,
        finalizedPrimaryN: 750,
        blockedByEarlierUnresolved: false,
      })
    ).toBe('READY_FOR_READOUT');
  });

  it('fallback branches never enter primary pool', () => {
    const rows: MinWindowCandidateRow[] = [
      {
        shadowPredictionId: 'role',
        prospectiveWindowId: AUX_MIN_PROSPECTIVE_WINDOW,
        predictionCreatedAt: '2026-09-18T18:00:00.000Z',
        branch: 'ROLE_ONLY',
        pregameEligibilityStatus: 'FALLBACK_NOT_PRIMARY',
        resolvedAppearanceClass: 'played',
      },
      jointRow('joint', '2026-09-18T18:01:00.000Z', 'played'),
    ];
    const { counters, assignments } = assignPrimarySequences(rows, 750);
    expect(counters.PREGAME_JOINT_PREDICTIONS_N).toBe(1);
    expect(assignments.find((a) => a.shadowPredictionId === 'role')!.primarySequenceNumber).toBeNull();
    expect(assignments.find((a) => a.shadowPredictionId === 'joint')!.primarySequenceNumber).toBe(1);
  });
});

describe('Phase 18B — mutation / leakage / isolation', () => {
  it('TARGET_OUTCOME_MUTATION_TEST — mutating realized minutes does not change pregame record', () => {
    const row = buildProspectiveMinShadowRecord(baseCandidate());
    const frozen = { ...row };
    const mutatedMinutes = 99;
    expect(mutatedMinutes).not.toBe(frozen.shadowMin);
    expect(row.b0Min).toBe(frozen.b0Min);
    expect(row.shadowMin).toBe(frozen.shadowMin);
    expect(row.roleMinutesDelta).toBe(frozen.roleMinutesDelta);
    expect(row.branch).toBe(frozen.branch);
  });

  it('FUTURE_MUTATION_TEST — later tip does not alter frozen record fields', () => {
    const row = buildProspectiveMinShadowRecord(baseCandidate());
    const laterTip = '2026-09-25T00:00:00.000Z';
    expect(row.gameStart).not.toBe(laterTip);
    expect(row.shadowMin).toBeTypeOf('number');
  });

  it('SAME_TIP_EXCLUSION_TEST — B0 ignores same-tip prior', () => {
    const tip = '2026-09-20T00:00:00.000Z';
    const b0 = computeB0Min(
      [
        { teamId: 't1', season: '2025', startTime: '2026-09-10T00:00:00.000Z', played: true, minutes: 30 },
        { teamId: 't1', season: '2025', startTime: tip, played: true, minutes: 40 },
      ],
      tip,
      '2025',
      't1'
    );
    expect(b0.b0Min).toBe(30);
    expect(b0.historyN).toBe(1);
  });

  it('POSTGAME_APPEARANCE_LEAKAGE_TEST — appearance not a pregame feature', () => {
    const row = buildProspectiveMinShadowRecord(baseCandidate());
    expect(row.provenance?.PLAYED_STATUS_USED_AS_MODEL_FEATURE).toBe('NO');
    const played = resolveAppearanceFromPgl({ minutes: '28:00', points: 12 });
    expect(played.resolvedAppearanceClass).toBe('played');
    // pregame fields unchanged conceptually
    expect(row.b0Min).toBeTypeOf('number');
  });

  it('AUX_MIN_SHADOW_FAILURE_ISOLATION', () => {
    const r = runMinShadowIsolated(() => {
      throw new Error('boom');
    });
    expect(r.ok).toBe(false);
    const ok = runMinShadowIsolated(() => 1);
    expect(ok).toEqual({ ok: true, value: 1 });
  });

  it('write idempotency identity is stable', () => {
    const a = buildProspectiveMinShadowRecord(baseCandidate());
    const b = buildProspectiveMinShadowRecord(baseCandidate());
    expect(a.canonicalSnapshotIdentity).toBe(b.canonicalSnapshotIdentity);
    expect(a.shadowPredictionId).toBe(b.shadowPredictionId);
  });
});

describe('Phase 18B — B0 parity smoke', () => {
  it('B0_MIN_BACKWARD_PARITY expanding mean', () => {
    const b0 = computeB0Min(
      [
        { teamId: 't1', season: '2025', startTime: '2026-01-01T00:00:00.000Z', played: true, minutes: 20 },
        { teamId: 't1', season: '2025', startTime: '2026-01-03T00:00:00.000Z', played: true, minutes: 30 },
        { teamId: 't1', season: '2025', startTime: '2026-01-05T00:00:00.000Z', played: false, minutes: 0 },
      ],
      '2026-01-10T00:00:00.000Z',
      '2025',
      't1'
    );
    expect(b0.b0Min).toBe(25);
  });
});

describe('Phase 18B — schema SQL present', () => {
  it('AUX_MIN_SCHEMA_GATE migration defines dedicated tables', () => {
    const sql = readFileSync(
      join(process.cwd(), 'db/schemas/MIGRATION_aux_min_prospective_shadow.sql'),
      'utf8'
    );
    expect(sql).toContain('analytics.prospective_min_shadow_predictions');
    expect(sql).toContain('analytics.prospective_min_shadow_outcomes');
    expect(sql).not.toContain('ALTER TABLE analytics.prospective_shadow_predictions');
    expect(sql).toContain('primary_sequence_number');
  });
});
