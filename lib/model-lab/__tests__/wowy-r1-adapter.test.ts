import { describe, expect, it } from 'vitest';
import { loadExperiment } from '@/lib/model-lab/catalog';

describe('wowy-r1 adapter', () => {
  it('registers blocked predictive evaluation without inventing metrics', () => {
    const exp = loadExperiment('wowy-r1');
    expect(exp).not.toBeNull();
    if (!exp) return;
    expect(exp.version).toBe('player-projection-wowy-r1');
    expect(exp.status).toBe('partial');
    expect(exp.historicalValidityClass).toBe('reconstructed_historical');
    expect(exp.metrics).toEqual([]);
    expect(exp.pairedDeltas).toEqual([]);
    expect(exp.splits.every((s) => (s.n ?? 0) === 0)).toBe(true);
    expect(exp.targets.some((t) => t.id === 'pra' && t.derived)).toBe(true);
    expect(exp.modelVersions.map((m) => m.id)).toEqual(['frozen_c', 'wowy_ablation', 'wowy_candidate']);
    expect(exp.decisions[0]?.label).toBe('exploratory known-Out subset; not trained');
    expect(exp.slicesAvailable).toBe(true);
    expect(exp.slices.some((s) => s.family === 'wowy_support' && s.n === 0)).toBe(true);
    expect(exp.slices.some((s) => s.family === 'known_teammate_availability')).toBe(true);
    expect(exp.rowExplorerAvailable).toBe(false);
    expect(exp.availabilityNotes.join(' ')).toMatch(/399/);
    expect(exp.notesMarkdown).toMatch(/Browser verification/);
  });
});

describe('wowy-known-out-r1 adapter', () => {
  it('loads the residual experiment as inconclusive development evidence', () => {
    const exp = loadExperiment('wowy-known-out-r1');
    expect(exp).not.toBeNull();
    if (!exp) return;
    expect(exp.version).toBe('player-projection-wowy-known-out-r1');
    expect(exp.decisions[0]?.label).toBe('inconclusive');
    expect(exp.historicalValidityClass).toBe('reconstructed_historical');
    const ptsC = exp.metrics.find(
      (m) => m.splitId === 'historical_confirmation' && m.targetId === 'points' && m.modelId === 'residual_wowy'
    );
    expect(ptsC?.metrics.n).toBe(231);
    expect(ptsC?.metrics.mae).toBeGreaterThan(5);
    const paired = exp.pairedDeltas.find(
      (d) =>
        d.targetId === 'points' &&
        d.leftModelId === 'residual_role' &&
        d.rightModelId === 'residual_wowy'
    );
    expect(paired?.source).toBe('paired_observations');
    expect(paired?.nGroups).toBe(12);
    expect(exp.slices.some((s) => s.family === 'wowy_support')).toBe(true);
    expect(exp.splits.find((s) => s.id === 'training')?.n).toBe(394);
    expect(exp.splits.find((s) => s.id === 'historical_confirmation')?.n).toBe(231);
    expect(exp.decisions[0]?.source).toMatch(/wowy-known-out-r1/);
  });
});
