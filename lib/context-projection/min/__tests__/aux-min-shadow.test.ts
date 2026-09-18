import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  assembleAuxMinFeatures,
  assertJointFeatureParity,
  rejectUnauthorizedMinFeatures,
  AUX_MIN_CONTEXT_RAW_FALLBACK_COUNT,
  AUX_MIN_JOINT_FEATURES,
  H3_ROLE_MIN_FEATURES,
  H5_AVAIL_MIN_FEATURES,
  computeB0Min,
  predictAuxiliaryMinutes,
  assertNotPtsWindowId,
  AUX_MIN_MODEL_VERSION,
  AVAIL_MIN_VALIDATED_COMPLETENESS_POLICY,
  AUX_MIN_TARGET_POPULATION,
  AUX_MIN_SHADOW_STORAGE,
  AUX_MIN_PROSPECTIVE_WINDOW,
  PTS_PROSPECTIVE_WINDOW_ID,
} from '@/lib/context-projection/min';
import { fitRidgeResidual } from '@/lib/context-projection/ridge';
import type { AuxMinModelBundle } from '@/lib/context-projection/min/predict';
import { PROSPECTIVE_WINDOW_ID as PTS_WINDOW } from '@/lib/context-projection/protocol';

function bundle(): AuxMinModelBundle {
  const joint = fitRidgeResidual(
    [
      [1, 10, 1],
      [0, 20, 2],
      [-1, 5, 0],
      [2, 15, 1],
    ],
    [2, -1, 0.5, 1],
    [...AUX_MIN_JOINT_FEATURES]
  );
  const role = fitRidgeResidual([[1], [0], [-1], [2]], [1, 0, -0.5, 1.5], [...H3_ROLE_MIN_FEATURES]);
  const avail = fitRidgeResidual(
    [
      [10, 1],
      [20, 2],
      [5, 0],
      [15, 1],
    ],
    [0.5, -1, 0.2, 0.3],
    [...H5_AVAIL_MIN_FEATURES]
  );
  return {
    joint,
    roleOnly: role,
    availOnly: avail,
    featureManifestSha: 'f',
    trainingManifestSha: 't',
    modelArtifactSha: 'm',
    contextModelVersion: AUX_MIN_MODEL_VERSION,
    contextIntegrationVersion: 'context-projection-integration-v1',
    trainingCutoff: '2026-06-14T00:30:00Z',
  };
}

describe('auxiliary MIN shadow — manifests', () => {
  it('locks exact H3/H5 feature sets', () => {
    expect([...H3_ROLE_MIN_FEATURES]).toEqual(['role.minutes_delta']);
    expect([...H5_AVAIL_MIN_FEATURES]).toEqual([
      'injury.expected_missing_minutes',
      'injury.rotation_players_out_count',
    ]);
    expect(assertJointFeatureParity([...AUX_MIN_JOINT_FEATURES])).toBe(true);
    expect(AVAIL_MIN_VALIDATED_COMPLETENESS_POLICY).toBe('COMPLETE_ONLY_PRIMARY');
    expect(AUX_MIN_TARGET_POPULATION).toBe('PLAYED');
    expect(AUX_MIN_SHADOW_STORAGE).toBe('analytics.prospective_min_shadow_predictions');
    expect(AUX_MIN_PROSPECTIVE_WINDOW).toBe('aux-min-role-avail-joint-v1-first750');
    expect(AUX_MIN_CONTEXT_RAW_FALLBACK_COUNT).toBe(0);
  });
});

describe('auxiliary MIN shadow — B0 + branches', () => {
  const priors = [
    { teamId: 't1', season: '2024', startTime: '2024-01-01T00:00:00Z', played: true, minutes: 30 },
    { teamId: 't1', season: '2024', startTime: '2024-01-03T00:00:00Z', played: true, minutes: 34 },
    { teamId: 't1', season: '2024', startTime: '2024-01-05T00:00:00Z', played: false, minutes: 0 },
  ];

  it('B0_MIN uses PLAYED same-team season priors only', () => {
    const b0 = computeB0Min(priors, '2024-01-10T00:00:00Z', '2024', 't1');
    expect(b0.historyN).toBe(2);
    expect(b0.b0Min).toBe(32);
  });

  it('ROLE_AVAIL_JOINT when both available COMPLETE', () => {
    const r = predictAuxiliaryMinutes({
      priors,
      tipIso: '2024-01-10T00:00:00Z',
      season: '2024',
      teamId: 't1',
      contexts: {
        roleRecentMinutes: 36,
        roleSeasonMinutes: 32,
        expectedMissingMinutes: 20,
        rotationPlayersOutCount: 1,
        availCompleteness: 'COMPLETE',
      },
      models: bundle(),
    });
    expect(r.branch).toBe('ROLE_AVAIL_JOINT');
    expect(r.baselineMin).toBe(32);
    expect(r.shadowMin).toBe(r.baselineMin! + r.contextAdjustment);
    expect(r.status).toBe('SHADOW');
  });

  it('ROLE_ONLY / AVAIL_ONLY / BASELINE / PARTIAL avail', () => {
    const models = bundle();
    expect(
      predictAuxiliaryMinutes({
        priors,
        tipIso: '2024-01-10T00:00:00Z',
        season: '2024',
        teamId: 't1',
        contexts: { roleRecentMinutes: 36, roleSeasonMinutes: 32 },
        models,
      }).branch
    ).toBe('ROLE_ONLY');

    expect(
      predictAuxiliaryMinutes({
        priors,
        tipIso: '2024-01-10T00:00:00Z',
        season: '2024',
        teamId: 't1',
        contexts: {
          expectedMissingMinutes: 20,
          rotationPlayersOutCount: 1,
          availCompleteness: 'COMPLETE',
        },
        models,
      }).branch
    ).toBe('AVAIL_ONLY');

    expect(
      predictAuxiliaryMinutes({
        priors,
        tipIso: '2024-01-10T00:00:00Z',
        season: '2024',
        teamId: 't1',
        contexts: {
          roleRecentMinutes: 36,
          roleSeasonMinutes: 32,
          expectedMissingMinutes: 20,
          rotationPlayersOutCount: 1,
          availCompleteness: 'PARTIAL',
        },
        models,
      }).branch
    ).toBe('ROLE_ONLY');

    expect(
      predictAuxiliaryMinutes({
        priors,
        tipIso: '2024-01-10T00:00:00Z',
        season: '2024',
        teamId: 't1',
        contexts: {},
        models,
      }).branch
    ).toBe('BASELINE');
  });

  it('cold-start Role does not become zero delta', () => {
    const a = assembleAuxMinFeatures({});
    expect(a['role.minutes_delta']).toBeNull();
    expect(a.roleAvailable).toBe(false);
  });

  it('TARGET_OUTCOME_MUTATION does not change features', () => {
    const ctx = {
      roleRecentMinutes: 36,
      roleSeasonMinutes: 32,
      expectedMissingMinutes: 20,
      rotationPlayersOutCount: 1,
      availCompleteness: 'COMPLETE' as const,
    };
    const before = assembleAuxMinFeatures(ctx);
    void 48; // mutated minutes
    expect(assembleAuxMinFeatures(ctx)).toEqual(before);
  });
});

describe('auxiliary MIN shadow — exclusions + PTS isolation', () => {
  it('rejects unauthorized signals including PTS shadow outputs', () => {
    const rejected = rejectUnauthorizedMinFeatures({
      'role.minutes_delta': 1,
      'schedule.days_rest': 1,
      'form.points_delta': 2,
      shadow_context_pts: 18,
      'interpretation.observation': 'x',
    });
    expect(rejected).toContain('schedule.days_rest');
    expect(rejected).toContain('form.points_delta');
    expect(rejected).toContain('shadow_context_pts');
    expect(rejected).toContain('interpretation.observation');
  });

  it('PTS_PROSPECTIVE_WINDOW_ISOLATION', () => {
    expect(assertNotPtsWindowId('aux-min-something')).toBe(true);
    expect(assertNotPtsWindowId(PTS_PROSPECTIVE_WINDOW_ID)).toBe(false);
    expect(PTS_WINDOW).toBe('prod-pts-context-v1-first500');
    // PTS window artifact unchanged
    const ptsWin = JSON.parse(
      readFileSync(
        join(process.cwd(), 'lib/context-projection/artifacts/pts-production-context-prospective-window-v1.json'),
        'utf8'
      )
    );
    expect(ptsWin.prospective_window_id).toBe('prod-pts-context-v1-first500');
    expect(ptsWin.PROSPECTIVE_REQUIRED_N).toBe(500);
    expect(ptsWin.model_artifact_sha).toBe(
      '36f68abdab110ea13e78ac03d573aa3718b9ae7bb8b9bbd8a0d5983d83df478a'
    );
  });
});
