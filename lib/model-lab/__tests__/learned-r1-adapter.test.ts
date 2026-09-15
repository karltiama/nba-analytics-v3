import { describe, expect, it } from 'vitest';
import { loadExperiment } from '@/lib/model-lab/catalog';

describe('learned-r1 adapter', () => {
  it('maps MAE/RMSE/bias/coverage from results.json and keeps PRA derived', () => {
    const exp = loadExperiment('learned-r1');
    expect(exp).not.toBeNull();
    if (!exp) return;
    expect(exp.version).toBe('player-projection-learned-r1');
    const pra = exp.targets.find((t) => t.id === 'pra');
    expect(pra?.derived).toBe(true);
    expect(pra?.label).toContain('derived');

    const ptsC = exp.metrics.find(
      (m) => m.splitId === 'selection' && m.targetId === 'points' && m.modelId === 'C'
    );
    expect(ptsC?.metrics.mae).toBeCloseTo(4.6039, 3);
    expect(ptsC?.metrics.rmse).toBeGreaterThan(ptsC?.metrics.mae ?? 0);
    expect(ptsC?.metrics.n).toBe(27696);
    expect(ptsC?.metrics.coverage).toBe(1);

    const paired = exp.pairedDeltas.find(
      (d) => d.splitId === 'selection' && d.targetId === 'points' && d.leftModelId === 'B' && d.rightModelId === 'C'
    );
    expect(paired?.source).toBe('paired_observations');
    expect(paired?.ciLow).not.toBeNull();

    expect(exp.slicesAvailable).toBe(true);
    expect(exp.slices.some((s) => s.family === 'limited_history')).toBe(true);
    expect(exp.splits.some((s) => s.kind === 'prospective_shadow' && s.n === 0)).toBe(true);
    expect(exp.historicalValidityClass).toBe('reconstructed_historical');
  });
});

describe('shadow freeze adapter', () => {
  it('keeps prospective evaluation empty', () => {
    const exp = loadExperiment('shadow-pts-reb-c-r1');
    expect(exp).not.toBeNull();
    if (!exp) return;
    expect(exp.metrics).toEqual([]);
    expect(exp.splits.every((s) => s.kind === 'prospective_shadow')).toBe(true);
    expect(exp.splits[0]?.n).toBe(0);
    expect(exp.rowExplorerAvailable).toBe(false);
  });
});
