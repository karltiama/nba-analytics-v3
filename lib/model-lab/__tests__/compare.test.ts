import { describe, expect, it } from 'vitest';
import { compareExperiments } from '@/lib/model-lab/compare';
import type { ExperimentRecord, MetricSet } from '@/lib/model-lab/types';

function metrics(mae: number, n: number): MetricSet {
  return { mae, rmse: mae + 1, bias: 0, coverage: 1, n, nFinite: n };
}

function baseExperiment(id: string): ExperimentRecord {
  return {
    id,
    version: id,
    title: id,
    adapter: id,
    status: 'available',
    availabilityNotes: [],
    targets: [
      { id: 'points', label: 'Points', units: 'points', derived: false },
      { id: 'pra', label: 'PRA (derived)', units: 'points+rebounds+assists', derived: true },
    ],
    featureGroups: [{ id: 'A', label: 'A', description: '' }],
    modelVersions: [
      { id: 'A', label: 'A', featureGroupId: 'A', role: 'baseline' },
      { id: 'C', label: 'C', featureGroupId: 'A', role: 'learned' },
    ],
    periods: { train: '2023', validation: '2024', test: '2025', prospective: '2026' },
    datasetHash: 'abc',
    featureSpecVersion: 'spec',
    historicalValidityClass: 'reconstructed_historical',
    historicalValidityNote: '',
    eligibility: 'played-only',
    splits: [
      { id: 'selection', kind: 'selection', label: 'Val 2024', season: '2024', n: 10, note: '' },
      {
        id: 'historical_confirmation',
        kind: 'historical_confirmation',
        label: '2025',
        season: '2025',
        n: 10,
        note: '',
      },
      { id: 'prospective_shadow', kind: 'prospective_shadow', label: '2026', season: '2026', n: 0, note: '' },
    ],
    metrics: [
      { splitId: 'selection', targetId: 'points', modelId: 'A', metrics: metrics(4.6, 10) },
      { splitId: 'selection', targetId: 'points', modelId: 'C', metrics: metrics(4.5, 10) },
    ],
    pairedDeltas: [
      {
        leftModelId: 'A',
        rightModelId: 'C',
        splitId: 'selection',
        targetId: 'points',
        delta: -0.1,
        ciLow: -0.2,
        ciHigh: -0.05,
        n: 10,
        nGroups: 2,
        iterations: 400,
        leftMae: 4.6,
        rightMae: 4.5,
        source: 'paired_observations',
      },
    ],
    slices: [],
    slicesAvailable: false,
    rowExplorerAvailable: false,
    decisions: [],
    notesMarkdown: null,
    warnings: [],
  };
}

describe('compareExperiments', () => {
  const catalog = [baseExperiment('exp-1')];

  it('returns paired CI only from stored paired observations', () => {
    const out = compareExperiments(
      catalog,
      { experimentId: 'exp-1', modelId: 'A', splitId: 'selection', targetId: 'points' },
      { experimentId: 'exp-1', modelId: 'C', splitId: 'selection', targetId: 'points' }
    );
    expect(out.compatible).toBe(true);
    expect(out.pairedDelta?.delta).toBe(-0.1);
    expect(out.pairedDelta?.source).toBe('paired_observations');
    expect(out.unpairedMaeDifference).toBeNull();
  });

  it('flips a stored pair when sides are reversed rather than subtracting separate intervals', () => {
    const out = compareExperiments(
      catalog,
      { experimentId: 'exp-1', modelId: 'C', splitId: 'selection', targetId: 'points' },
      { experimentId: 'exp-1', modelId: 'A', splitId: 'selection', targetId: 'points' }
    );
    expect(out.pairedDelta?.delta).toBe(0.1);
    expect(out.pairedDelta?.ciLow).toBe(0.05);
    expect(out.pairedDelta?.ciHigh).toBe(0.2);
  });

  it('flags selection vs historical confirmation as incompatible', () => {
    const out = compareExperiments(
      catalog,
      { experimentId: 'exp-1', modelId: 'C', splitId: 'selection', targetId: 'points' },
      { experimentId: 'exp-1', modelId: 'C', splitId: 'historical_confirmation', targetId: 'points' }
    );
    expect(out.compatible).toBe(false);
    expect(out.pairedDelta).toBeNull();
    expect(out.flags.some((f) => f.level === 'incompatible')).toBe(true);
  });

  it('does not invent a paired interval across experiments', () => {
    const other = { ...baseExperiment('exp-2'), datasetHash: 'other', pairedDeltas: [] };
    const out = compareExperiments(
      [...catalog, other],
      { experimentId: 'exp-1', modelId: 'C', splitId: 'selection', targetId: 'points' },
      { experimentId: 'exp-2', modelId: 'C', splitId: 'selection', targetId: 'points' }
    );
    expect(out.compatible).toBe(true);
    expect(out.pairedDelta).toBeNull();
    expect(out.unpairedMaeDifference).toBeCloseTo(0);
    expect(out.flags.some((f) => f.message.includes('Different experiment'))).toBe(true);
  });

  it('notes empty prospective evaluation', () => {
    const out = compareExperiments(
      catalog,
      { experimentId: 'exp-1', modelId: 'A', splitId: 'prospective_shadow', targetId: 'points' },
      { experimentId: 'exp-1', modelId: 'C', splitId: 'prospective_shadow', targetId: 'points' }
    );
    expect(out.flags.some((f) => f.message.includes('has not started'))).toBe(true);
  });
});
