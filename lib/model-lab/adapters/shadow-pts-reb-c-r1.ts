import { HISTORICAL_VALIDITY_NOTE } from '@/lib/model-lab/metric-copy';
import { asString, fileExists, isRecord, readJsonIfExists } from '@/lib/model-lab/fs';
import { loadNotesMarkdown } from '@/lib/model-lab/notes';
import { artifactFile, unavailableRecord } from '@/lib/model-lab/adapters/common';
import type { ExperimentAdapter, ExperimentRecord, RegistryEntry } from '@/lib/model-lab/types';

function loadShadowPtsRebC(entry: RegistryEntry): ExperimentRecord {
  const manifestPath = artifactFile(entry, entry.manifestFile);
  if (!manifestPath || !fileExists(manifestPath)) {
    return unavailableRecord(entry, 'Missing shadow freeze manifest.json.');
  }
  const raw = readJsonIfExists<unknown>(manifestPath);
  if (!isRecord(raw)) return unavailableRecord(entry, 'Shadow manifest is not an object.');

  const frozenTargets = Array.isArray(raw.frozen_targets)
    ? raw.frozen_targets.map((t) => asString(t)).filter((t): t is string => Boolean(t))
    : ['points', 'rebounds'];
  const featureSet = asString(raw.feature_set) ?? 'C';
  const modelVersion = asString(raw.model_version) ?? 'player-projection-learned-r1-pts-reb-c';
  const hashes = isRecord(raw.model_sha256) ? raw.model_sha256 : {};

  return {
    id: entry.id,
    version: asString(raw.protocol_version) ?? entry.id,
    title: entry.title,
    adapter: entry.adapter,
    status: 'partial',
    availabilityNotes: [
      'This record is a freeze / deployment status artifact, not a scored retrospective experiment.',
      'Prospective shadow metrics are empty: collection has not started.',
      'Row-level explorer is not served from model binaries.',
    ],
    targets: frozenTargets.map((id) => ({
      id,
      label: id === 'points' ? 'Points' : id === 'rebounds' ? 'Rebounds' : id,
      units: id,
      derived: false,
    })),
    featureGroups: [
      {
        id: featureSet,
        label: `Frozen feature set ${featureSet}`,
        description: 'Allowlisted C features from learned-r1. Models were not retrained in the freeze.',
      },
    ],
    modelVersions: frozenTargets.map((id) => ({
      id: `${featureSet}_${id}`,
      label: `${featureSet} ${id} (frozen)`,
      featureGroupId: featureSet,
      role: 'frozen_shadow' as const,
    })),
    periods: {
      train: '2023 (source experiment)',
      validation: '2024 selection (source experiment)',
      test: '2025 confirmation (source experiment; cannot promote)',
      prospective: '2026–27 (not started)',
    },
    datasetHash: asString(raw.dataset_sha256),
    featureSpecVersion: asString(raw.feature_spec_version),
    historicalValidityClass: 'reconstructed_historical',
    historicalValidityNote: HISTORICAL_VALIDITY_NOTE,
    eligibility: 'Prospective: on-time pregame snapshots only, once collection runs. No live rows yet.',
    splits: [
      {
        id: 'prospective_shadow',
        kind: 'prospective_shadow',
        label: '2026–27 prospective shadow',
        season: '2026',
        n: 0,
        note: 'Not deployed and not running. Prospective evaluation has not started.',
      },
    ],
    metrics: [],
    pairedDeltas: [],
    slices: [],
    slicesAvailable: false,
    rowExplorerAvailable: false,
    decisions: [
      {
        label: 'Implementation complete · not deployed · not running',
        note: `Frozen targets ${frozenTargets.join(', ')} on feature set ${featureSet}. Models retrained=${String(raw.models_retrained ?? false)}. SHA points=${asString(hashes.points) ?? 'n/a'}; rebounds=${asString(hashes.rebounds) ?? 'n/a'}.`,
        source: 'reports/modeling/shadow-pts-reb-c-r1/manifest.json',
      },
    ],
    notesMarkdown: loadNotesMarkdown(entry),
    warnings: ['Do not read empty prospective cells as a completed evaluation.'],
  };
}

export const shadowPtsRebCR1Adapter: ExperimentAdapter = {
  id: 'shadow-pts-reb-c-r1',
  load: loadShadowPtsRebC,
};
