/**
 * Phase 19 — Active experiment freeze regression (hashes / windows / N).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PROSPECTIVE_REQUIRED_N,
  PROSPECTIVE_WINDOW_ID,
  PRODUCTION_PTS_CONTEXT_FEATURES,
} from '@/lib/context-projection/protocol';
import {
  AUX_MIN_JOINT_FEATURES,
  AUX_MIN_PROSPECTIVE_WINDOW,
  FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA,
  PROSPECTIVE_MIN_REQUIRED_N,
} from '@/lib/context-projection/min/protocol';
import { classifyContextProspectiveDue } from '@/lib/context-projection/collection-candidates';
import { intendedCutoffIso } from '@/lib/context-projection/window';
import { runShadowIsolated } from '@/lib/context-projection/store';

const PTS_SHA = '36f68abdab110ea13e78ac03d573aa3718b9ae7bb8b9bbd8a0d5983d83df478a';
const MIN_SHA = '7354e0a8f9a8a15ade3c5f77e95b45b009661f49abfdcfea2c1e9edc3a4b1904';

describe('Phase 19 — active prospective freeze locks', () => {
  it('PTS SHA / window / N / features frozen', () => {
    const pts = JSON.parse(
      readFileSync(
        join(process.cwd(), 'lib/context-projection/artifacts/pts-production-context-prospective-window-v1.json'),
        'utf8'
      )
    );
    expect(pts.model_artifact_sha).toBe(PTS_SHA);
    expect(pts.prospective_window_id).toBe('prod-pts-context-v1-first500');
    expect(pts.PROSPECTIVE_REQUIRED_N).toBe(500);
    expect(PROSPECTIVE_WINDOW_ID).toBe('prod-pts-context-v1-first500');
    expect(PROSPECTIVE_REQUIRED_N).toBe(500);
    expect([...PRODUCTION_PTS_CONTEXT_FEATURES]).toEqual(['role.fga_delta', 'form.points_delta']);
  });

  it('MIN SHA / window / N / features frozen', () => {
    const min = JSON.parse(
      readFileSync(
        join(process.cwd(), 'lib/context-projection/artifacts/aux-min-model_artifact.json'),
        'utf8'
      )
    );
    expect(min.model_artifact_sha).toBe(MIN_SHA);
    expect(min.model_artifact_sha).toBe(FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA);
    expect(AUX_MIN_PROSPECTIVE_WINDOW).toBe('aux-min-role-avail-joint-v1-first750');
    expect(PROSPECTIVE_MIN_REQUIRED_N).toBe(750);
    expect([...AUX_MIN_JOINT_FEATURES]).toEqual([
      'role.minutes_delta',
      'injury.expected_missing_minutes',
      'injury.rotation_players_out_count',
    ]);
  });

  it('T−60 due window inclusive at cutoff', () => {
    const tip = '2026-10-20T00:00:00.000Z';
    const cutoff = intendedCutoffIso(tip);
    expect(classifyContextProspectiveDue({ tipIso: tip, nowIso: cutoff, cutoffIso: cutoff })).toBe(
      'due'
    );
    expect(
      classifyContextProspectiveDue({
        tipIso: tip,
        nowIso: new Date(Date.parse(cutoff) - 10 * 60_000).toISOString(),
        cutoffIso: cutoff,
      })
    ).toBe('too_early');
    expect(
      classifyContextProspectiveDue({
        tipIso: tip,
        nowIso: new Date(Date.parse(cutoff) + 60_000).toISOString(),
        cutoffIso: cutoff,
      })
    ).toBe('late_open');
  });

  it('SHADOW_RUNTIME_FAILURE_ISOLATION', () => {
    const r = runShadowIsolated(() => {
      throw new Error('x');
    });
    expect(r.ok).toBe(false);
  });
});
