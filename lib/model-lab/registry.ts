import type { RegistryEntry } from '@/lib/model-lab/types';

/**
 * Experiment catalog. Add a row here for a new adapter; do not hardcode A/B/C/D in the page.
 * Future feature groups (including WOWY) register as ordinary model versions.
 */
export const MODEL_LAB_REGISTRY: RegistryEntry[] = [
  {
    id: 'learned-r1',
    adapter: 'learned-r1',
    title: 'Learned projection r1 (A/B/C/D)',
    artifactDir: 'reports/modeling/learned-r1',
    notesRelPath: 'reports/modeling/model-lab/notes/learned-r1.md',
    resultsFile: 'results.json',
    slicesFile: 'slices.json',
    rowsFile: 'rows.jsonl',
    predictionsFile: 'predictions.jsonl',
    selectionFile: 'selection.json',
    featureSpecFile: 'feature_spec.json',
    reconciliationFile: 'reconciliation.json',
  },
  {
    id: 'v1-minutes-role',
    adapter: 'v1-minutes-role',
    title: 'v1 expected minutes / role',
    artifactDir: 'reports/modeling',
    notesRelPath: 'reports/modeling/model-lab/notes/v1-minutes-role.md',
    resultsFile: 'player-projection-v1-minutes-role-results.json',
  },
  {
    id: 'v1-usage-rate',
    adapter: 'v1-usage-rate',
    title: 'v1 usage / rate',
    artifactDir: 'reports/modeling',
    notesRelPath: 'reports/modeling/model-lab/notes/v1-usage-rate.md',
    resultsFile: 'player-projection-v1-usage-rate-results.json',
  },
  {
    id: 'shadow-pts-reb-c-r1',
    adapter: 'shadow-pts-reb-c-r1',
    title: 'Frozen shadow PTS C / REB C r1',
    artifactDir: 'reports/modeling/shadow-pts-reb-c-r1',
    notesRelPath: 'reports/modeling/model-lab/notes/shadow-pts-reb-c-r1.md',
    manifestFile: 'manifest.json',
  },
];

export function getRegistryEntry(id: string): RegistryEntry | null {
  return MODEL_LAB_REGISTRY.find((e) => e.id === id) ?? null;
}
