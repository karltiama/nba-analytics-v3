import { HISTORICAL_VALIDITY_NOTE } from '@/lib/model-lab/metric-copy';
import { asNumber, asString, fileExists, isRecord, readJsonIfExists } from '@/lib/model-lab/fs';
import { loadNotesMarkdown } from '@/lib/model-lab/notes';
import { artifactFile, readSidecarJson, rowsAvailable, unavailableRecord } from '@/lib/model-lab/adapters/common';
import type {
  ExperimentAdapter,
  ExperimentRecord,
  MetricSet,
  ModelRole,
  PairedDelta,
  RegistryEntry,
  SliceRow,
  SplitKind,
} from '@/lib/model-lab/types';

const ROLES: ModelRole[] = ['baseline', 'learned', 'candidate', 'frozen_shadow', 'production'];

function metricSet(raw: unknown): MetricSet {
  const rec = isRecord(raw) ? raw : {};
  return {
    mae: asNumber(rec.mae),
    rmse: asNumber(rec.rmse),
    bias: asNumber(rec.bias),
    coverage: asNumber(rec.coverage),
    n: asNumber(rec.n) ?? 0,
    nFinite: asNumber(rec.nFinite),
  };
}

function splitIdFromKey(raw: string): string {
  if (raw === 'test') return 'historical_confirmation';
  if (raw === 'validation') return 'selection';
  return raw;
}

function asRole(raw: unknown): ModelRole {
  const s = asString(raw);
  if (s && (ROLES as string[]).includes(s)) return s as ModelRole;
  return 'candidate';
}

function paired(
  raw: unknown,
  splitId: string,
  targetId: string,
  fallbackLeft: string,
  fallbackRight: string
): PairedDelta | null {
  if (!isRecord(raw)) return null;
  const n = asNumber(raw.n) ?? asNumber(raw.N);
  if (n == null) return null;
  return {
    leftModelId: asString(raw.left_model_id) ?? asString(raw.leftModelId) ?? fallbackLeft,
    rightModelId: asString(raw.right_model_id) ?? asString(raw.rightModelId) ?? fallbackRight,
    splitId,
    targetId,
    delta: asNumber(raw.delta),
    ciLow: asNumber(raw.ci_low) ?? asNumber(raw.ciLow),
    ciHigh: asNumber(raw.ci_high) ?? asNumber(raw.ciHigh),
    n,
    nGroups: asNumber(raw.n_groups) ?? asNumber(raw.nGroups),
    iterations: asNumber(raw.iterations),
    leftMae: asNumber(raw.left_mae) ?? asNumber(raw.leftMae),
    rightMae: asNumber(raw.right_mae) ?? asNumber(raw.rightMae),
    source: 'paired_observations',
  };
}

function loadSlices(path: string | null, experimentId: string): SliceRow[] {
  if (!path) return [];
  const payload = readJsonIfExists<unknown>(path);
  if (!isRecord(payload) || !Array.isArray(payload.slices)) return [];
  const out: SliceRow[] = [];
  for (const row of payload.slices) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    const family = asString(row.family);
    const label = asString(row.label);
    const splitId = asString(row.splitId);
    const targetId = asString(row.targetId);
    const n = asNumber(row.n);
    if (!id || !family || !label || !splitId || !targetId || n == null) continue;
    const metricsByModel: SliceRow['metricsByModel'] = {};
    if (isRecord(row.metricsByModel)) {
      for (const [modelId, m] of Object.entries(row.metricsByModel)) {
        if (!isRecord(m)) continue;
        metricsByModel[modelId] = { mae: asNumber(m.mae), n: asNumber(m.n) ?? n };
      }
    }
    out.push({
      id: `${experimentId}:${id}`,
      family,
      label,
      splitId,
      targetId,
      n,
      metricsByModel,
      pairedDelta: isRecord(row.pairedDelta)
        ? paired(row.pairedDelta, splitId, targetId, 'wowy_ablation', 'wowy_candidate')
        : null,
    });
  }
  return out;
}

function loadWowyR1(entry: RegistryEntry): ExperimentRecord {
  const resultsPath = artifactFile(entry, entry.resultsFile);
  if (!resultsPath || !fileExists(resultsPath)) {
    return unavailableRecord(entry, `Missing ${entry.resultsFile ?? 'results.json'}.`);
  }
  const results = readJsonIfExists<unknown>(resultsPath);
  if (!isRecord(results)) {
    return unavailableRecord(entry, 'results.json is not a valid wowy-r1 payload.');
  }

  const spec = readSidecarJson<unknown>(entry, entry.featureSpecFile);
  const recon = readSidecarJson<unknown>(entry, entry.reconciliationFile);
  const notes = isRecord(results.note) ? results.note : {};
  const periods = isRecord(results.periods) ? results.periods : {};
  const nBlock = isRecord(results.n) ? results.n : {};
  const nPred = isRecord(results.n_predictive_eligible) ? results.n_predictive_eligible : {};

  const targets = Array.isArray(results.targets)
    ? results.targets.flatMap((t) => {
        if (!isRecord(t)) return [];
        const id = asString(t.id);
        if (!id) return [];
        return [
          {
            id,
            label: asString(t.label) ?? id,
            units: asString(t.units) ?? id,
            derived: Boolean(t.derived),
          },
        ];
      })
    : [];

  const featureGroups = Array.isArray(results.feature_groups)
    ? results.feature_groups.flatMap((g) => {
        if (!isRecord(g)) return [];
        const id = asString(g.id);
        if (!id) return [];
        return [
          {
            id,
            label: asString(g.label) ?? id,
            description: asString(g.description) ?? '',
          },
        ];
      })
    : [];

  const modelVersions = Array.isArray(results.models)
    ? results.models.flatMap((m) => {
        if (!isRecord(m)) return [];
        const id = asString(m.id);
        if (!id) return [];
        return [
          {
            id,
            label: asString(m.label) ?? id,
            featureGroupId: asString(m.feature_group_id) ?? asString(m.featureGroupId) ?? id,
            role: asRole(m.role),
          },
        ];
      })
    : [];

  const metrics: ExperimentRecord['metrics'] = [];
  const pairedDeltas: PairedDelta[] = [];
  if (isRecord(results.results)) {
    for (const [key, block] of Object.entries(results.results)) {
      if (!isRecord(block)) continue;
      const [splitRaw, targetId] = key.split('|');
      if (!splitRaw || !targetId) continue;
      const splitId = splitIdFromKey(splitRaw);
      if (isRecord(block.metrics)) {
        for (const [modelId, m] of Object.entries(block.metrics)) {
          metrics.push({ splitId, targetId, modelId, metrics: metricSet(m) });
        }
      }
      const deltas = Array.isArray(block.paired_deltas)
        ? block.paired_deltas
        : Array.isArray(block.pairedDeltas)
          ? block.pairedDeltas
          : [];
      for (const d of deltas) {
        const row = paired(d, splitId, targetId, 'wowy_ablation', 'wowy_candidate');
        if (row) pairedDeltas.push(row);
      }
    }
  }

  const slices = loadSlices(artifactFile(entry, entry.slicesFile), entry.id);
  const explorer = rowsAvailable(entry);
  const scored = asString(results.predictive_evaluation) === 'complete';
  const availabilityNotes: string[] = [];
  const blockedReason = asString(results.blocked_reason);
  if (blockedReason) availabilityNotes.push(blockedReason);
  availabilityNotes.push(
    'Historical with/without summaries are reconstructed from completed box scores, not timestamp-verified pregame observations.'
  );
  availabilityNotes.push(
    'Hypothetical scenario files are not scored predictions. Frozen PTS C / REB C were not retrained.'
  );
  if (!explorer) {
    availabilityNotes.push('Row explorer unavailable: no predictive rows.jsonl (eval did not run).');
  }

  const decisionRaw = isRecord(results.decision) ? results.decision : {};
  const decisions: ExperimentRecord['decisions'] = [
    {
      label: asString(decisionRaw.label) ?? 'insufficient evidence',
      note: asString(decisionRaw.note) ?? '',
      source: `${entry.artifactDir}/${entry.resultsFile ?? 'results.json'}`,
    },
  ];

  const splitNote = (kind: SplitKind, fallback: string) => {
    if (kind === 'selection') return asString(notes.validation) ?? fallback;
    if (kind === 'historical_confirmation') return asString(notes.test) ?? fallback;
    return fallback;
  };

  const season = asString(results.season) ?? '2023';
  const customSplits = Array.isArray(results.model_lab_splits)
    ? results.model_lab_splits.flatMap((row) => {
        if (!isRecord(row)) return [];
        const id = asString(row.id);
        const kindRaw = asString(row.kind);
        const kind: SplitKind | null =
          kindRaw === 'training' ||
          kindRaw === 'selection' ||
          kindRaw === 'historical_confirmation' ||
          kindRaw === 'prospective_shadow'
            ? kindRaw
            : null;
        if (!id || !kind) return [];
        return [
          {
            id,
            kind,
            label: asString(row.label) ?? id,
            season: asString(row.season) ?? season,
            n: asNumber(row.n) ?? 0,
            note: asString(row.note) ?? '',
          },
        ];
      })
    : [];

  return {
    id: entry.id,
    version: asString(results.version) ?? 'player-projection-wowy-r1',
    title: entry.title,
    adapter: entry.adapter,
    status: scored && explorer ? 'available' : 'partial',
    availabilityNotes,
    targets,
    featureGroups,
    modelVersions,
    periods: {
      train: asString(periods.train),
      validation: asString(periods.validation),
      test: asString(periods.test),
      prospective: asString(periods.prospective),
    },
    datasetHash:
      asString(results.dataset_sha256) ??
      (isRecord(recon) ? asString(recon.dataset_sha256) : null),
    featureSpecVersion:
      asString(results.feature_spec_version) ??
      (isRecord(spec) ? asString(spec.feature_spec_version) : null),
    historicalValidityClass:
      asString(results.historical_validity_class) ??
      (isRecord(spec) ? asString(spec.historical_validity_class) : 'reconstructed_historical'),
    historicalValidityNote: HISTORICAL_VALIDITY_NOTE,
    eligibility: asString(results.eligibility) ?? '',
    splits:
      customSplits.length > 0
        ? customSplits
        : [
            {
              id: 'training',
              kind: 'training',
              label: 'Train 2023',
              season: '2023',
              n: asNumber(nPred.train) ?? asNumber(nBlock.train) ?? 0,
              note: splitNote('training', 'No predictive-eligible rows. Not fit.'),
            },
            {
              id: 'selection',
              kind: 'selection',
              label: 'Validation 2024 (selection)',
              season: '2024',
              n: asNumber(nPred.validation) ?? asNumber(nBlock.validation) ?? 0,
              note: splitNote('selection', 'Would be used for selection if coverage existed.'),
            },
            {
              id: 'historical_confirmation',
              kind: 'historical_confirmation',
              label: '2025 previously inspected confirmation',
              season: '2025',
              n: asNumber(nPred.test) ?? asNumber(nBlock.test) ?? 0,
              note: splitNote('historical_confirmation', 'Previously inspected. Cannot promote.'),
            },
            {
              id: 'prospective_shadow',
              kind: 'prospective_shadow',
              label: '2026–27 prospective shadow',
              season: '2026',
              n: 0,
              note: 'Future holdout. Collection for WOWY availability has not started.',
            },
          ],
    metrics,
    pairedDeltas,
    slices,
    slicesAvailable: slices.length > 0,
    rowExplorerAvailable: explorer,
    decisions,
    notesMarkdown: loadNotesMarkdown(entry),
    warnings: availabilityNotes,
  };
}

export const wowyR1Adapter: ExperimentAdapter = {
  id: 'wowy-r1',
  load: loadWowyR1,
};
