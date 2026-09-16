import { learnedR1Adapter } from '@/lib/model-lab/adapters/learned-r1';
import { shadowPtsRebCR1Adapter } from '@/lib/model-lab/adapters/shadow-pts-reb-c-r1';
import { v1MinutesRoleAdapter } from '@/lib/model-lab/adapters/v1-minutes-role';
import { v1UsageRateAdapter } from '@/lib/model-lab/adapters/v1-usage-rate';
import { wowyR1Adapter } from '@/lib/model-lab/adapters/wowy-r1';
import { MODEL_LAB_REGISTRY, getRegistryEntry } from '@/lib/model-lab/registry';
import type { ExperimentAdapter, ExperimentRecord } from '@/lib/model-lab/types';

const ADAPTERS: Record<string, ExperimentAdapter> = {
  [learnedR1Adapter.id]: learnedR1Adapter,
  [v1MinutesRoleAdapter.id]: v1MinutesRoleAdapter,
  [v1UsageRateAdapter.id]: v1UsageRateAdapter,
  [shadowPtsRebCR1Adapter.id]: shadowPtsRebCR1Adapter,
  [wowyR1Adapter.id]: wowyR1Adapter,
};

export function registerAdapter(adapter: ExperimentAdapter): void {
  ADAPTERS[adapter.id] = adapter;
}

export function loadExperiment(id: string): ExperimentRecord | null {
  const entry = getRegistryEntry(id);
  if (!entry) return null;
  const adapter = ADAPTERS[entry.adapter];
  if (!adapter) {
    return {
      id: entry.id,
      version: entry.id,
      title: entry.title,
      adapter: entry.adapter,
      status: 'unavailable',
      availabilityNotes: [`No adapter registered for "${entry.adapter}".`],
      targets: [],
      featureGroups: [],
      modelVersions: [],
      periods: { train: null, validation: null, test: null, prospective: null },
      datasetHash: null,
      featureSpecVersion: null,
      historicalValidityClass: null,
      historicalValidityNote: '',
      eligibility: '',
      splits: [],
      metrics: [],
      pairedDeltas: [],
      slices: [],
      slicesAvailable: false,
      rowExplorerAvailable: false,
      decisions: [],
      notesMarkdown: null,
      warnings: [`No adapter registered for "${entry.adapter}".`],
    };
  }
  return adapter.load(entry);
}

export function loadCatalog(): ExperimentRecord[] {
  return MODEL_LAB_REGISTRY.map((entry) => loadExperiment(entry.id)).filter(
    (row): row is ExperimentRecord => row != null
  );
}
