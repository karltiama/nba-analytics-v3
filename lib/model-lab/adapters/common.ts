import { join } from 'path';
import { HISTORICAL_VALIDITY_NOTE } from '@/lib/model-lab/metric-copy';
import { fileExists, readJsonIfExists } from '@/lib/model-lab/fs';
import { loadNotesMarkdown } from '@/lib/model-lab/notes';
import type { ExperimentRecord, RegistryEntry } from '@/lib/model-lab/types';

export function artifactFile(entry: RegistryEntry, file: string | undefined): string | null {
  if (!file) return null;
  return join(entry.artifactDir, file);
}

export function unavailableRecord(entry: RegistryEntry, reason: string): ExperimentRecord {
  return {
    id: entry.id,
    version: entry.id,
    title: entry.title,
    adapter: entry.adapter,
    status: 'unavailable',
    availabilityNotes: [reason],
    targets: [],
    featureGroups: [],
    modelVersions: [],
    periods: { train: null, validation: null, test: null, prospective: null },
    datasetHash: null,
    featureSpecVersion: null,
    historicalValidityClass: null,
    historicalValidityNote: HISTORICAL_VALIDITY_NOTE,
    eligibility: '',
    splits: [],
    metrics: [],
    pairedDeltas: [],
    slices: [],
    slicesAvailable: false,
    rowExplorerAvailable: false,
    decisions: [],
    notesMarkdown: loadNotesMarkdown(entry),
    warnings: [reason],
  };
}

export function readSidecarJson<T>(entry: RegistryEntry, file: string | undefined): T | null {
  const path = artifactFile(entry, file);
  if (!path || !fileExists(path)) return null;
  return readJsonIfExists<T>(path);
}

export function rowsAvailable(entry: RegistryEntry): boolean {
  const rows = artifactFile(entry, entry.rowsFile);
  return Boolean(rows && fileExists(rows));
}
