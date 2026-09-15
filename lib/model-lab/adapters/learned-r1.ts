import { HISTORICAL_VALIDITY_NOTE } from '@/lib/model-lab/metric-copy';
import { asNumber, asString, fileExists, isRecord, readJsonIfExists } from '@/lib/model-lab/fs';
import { loadNotesMarkdown } from '@/lib/model-lab/notes';
import { artifactFile, readSidecarJson, rowsAvailable, unavailableRecord } from '@/lib/model-lab/adapters/common';
import type {
  ExperimentAdapter,
  ExperimentRecord,
  MetricSet,
  PairedDelta,
  RegistryEntry,
  SliceRow,
  TargetSpec,
} from '@/lib/model-lab/types';

const TARGETS: TargetSpec[] = [
  { id: 'points', label: 'Points', units: 'points', derived: false },
  { id: 'rebounds', label: 'Rebounds', units: 'rebounds', derived: false },
  { id: 'assists', label: 'Assists', units: 'assists', derived: false },
  { id: 'threes', label: 'Threes', units: 'made threes', derived: false },
  { id: 'pra', label: 'PRA (derived)', units: 'points+rebounds+assists', derived: true },
];

const FEATURE_GROUPS = [
  {
    id: 'A',
    label: 'Played-only Track A',
    description: 'Frozen 70/30 last-10 / season mean on played games. Baseline.',
  },
  {
    id: 'B',
    label: 'Conditional EWM minutes',
    description: 'Frozen minutes-scaled Track A. Never applied to 3PM.',
  },
  {
    id: 'C',
    label: 'Learned production / role / opportunity',
    description: 'CatBoost on allowlisted C features plus Track A predictions.',
  },
  {
    id: 'D',
    label: 'C + reconstructed context',
    description: 'C plus schedule / team / opponent reconstructed features. Not verified original pregame observations.',
  },
];

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

function paired(
  raw: unknown,
  leftModelId: string,
  rightModelId: string,
  splitId: string,
  targetId: string
): PairedDelta | null {
  if (!isRecord(raw)) return null;
  const n = asNumber(raw.n);
  if (n == null) return null;
  return {
    leftModelId,
    rightModelId,
    splitId,
    targetId,
    delta: asNumber(raw.delta),
    ciLow: asNumber(raw.ciLow),
    ciHigh: asNumber(raw.ciHigh),
    n,
    nGroups: asNumber(raw.nGroups),
    iterations: asNumber(raw.iterations),
    leftMae: asNumber(raw.leftMae),
    rightMae: asNumber(raw.rightMae),
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
    let pairedDelta: PairedDelta | null = null;
    if (isRecord(row.pairedDelta)) {
      pairedDelta = paired(
        row.pairedDelta,
        asString(row.pairedDelta.leftModelId) ?? 'C',
        asString(row.pairedDelta.rightModelId) ?? 'D',
        splitId,
        targetId
      );
    }
    out.push({
      id: `${experimentId}:${id}`,
      family,
      label,
      splitId,
      targetId,
      n,
      metricsByModel,
      pairedDelta,
    });
  }
  return out;
}

function loadLearnedR1(entry: RegistryEntry): ExperimentRecord {
  const resultsPath = artifactFile(entry, entry.resultsFile);
  if (!resultsPath || !fileExists(resultsPath)) {
    return unavailableRecord(entry, `Missing ${entry.resultsFile ?? 'results.json'}.`);
  }
  const results = readJsonIfExists<unknown>(resultsPath);
  if (!isRecord(results) || !isRecord(results.results)) {
    return unavailableRecord(entry, 'results.json is not a valid learned-r1 payload.');
  }

  const selection = readSidecarJson<unknown>(entry, entry.selectionFile);
  const spec = readSidecarJson<unknown>(entry, entry.featureSpecFile);
  const recon = readSidecarJson<unknown>(entry, entry.reconciliationFile);

  const nCommon = isRecord(results.n_common) ? results.n_common : {};
  const notes = isRecord(results.note) ? results.note : {};
  const datasetHash =
    (isRecord(selection) ? asString(selection.dataset_sha256) : null) ??
    (isRecord(recon) ? asString(recon.dataset_sha256) : null);
  const featureSpecVersion =
    (isRecord(spec) ? asString(spec.feature_spec_version) : null) ??
    (isRecord(selection) ? asString(selection.feature_spec_version) : null);
  const historicalValidityClass = isRecord(spec)
    ? asString(spec.historical_validity_class)
    : 'reconstructed_historical';

  const trainN =
    isRecord(recon) && isRecord(recon.common_eligible) ? asNumber(recon.common_eligible.train) : null;

  const metrics: ExperimentRecord['metrics'] = [];
  const pairedDeltas: PairedDelta[] = [];

  for (const [key, block] of Object.entries(results.results)) {
    if (!isRecord(block)) continue;
    const [splitRaw, targetId] = key.split('|');
    if (!splitRaw || !targetId) continue;
    const splitId = splitRaw === 'test' ? 'historical_confirmation' : splitRaw === 'validation' ? 'selection' : splitRaw;
    if (isRecord(block.metrics)) {
      for (const [modelId, m] of Object.entries(block.metrics)) {
        metrics.push({ splitId, targetId, modelId, metrics: metricSet(m) });
      }
    }
    const cb = paired(block.delta_c_minus_b, 'B', 'C', splitId, targetId);
    const dc = paired(block.delta_d_minus_c, 'C', 'D', splitId, targetId);
    const db = paired(block.delta_d_minus_b, 'B', 'D', splitId, targetId);
    if (cb) pairedDeltas.push(cb);
    if (dc) pairedDeltas.push(dc);
    if (db) pairedDeltas.push(db);
  }

  const slicesPath = artifactFile(entry, entry.slicesFile);
  const slices = loadSlices(slicesPath, entry.id);
  const explorer = rowsAvailable(entry);
  const availabilityNotes: string[] = [];
  if (!slices.length) {
    availabilityNotes.push('Pregame slice table not found as JSON (slices.json). Aggregate metrics remain usable.');
  }
  if (!explorer) {
    availabilityNotes.push(
      'Row-level explorer unavailable: rows.jsonl / predictions.jsonl are not on this host (gitignored research dumps).'
    );
  }

  const decisions: ExperimentRecord['decisions'] = [
    {
      label: 'Shadow nomination from 2024 validation only',
      note: 'PTS C and REB C nominated. AST/3PM did not clear the bar. D not nominated over C. 2025 confirmation cannot promote. PRA ignored for nomination.',
      source: 'reports/modeling/learned-r1/player-projection-learned-r1-results.md',
    },
  ];

  return {
    id: entry.id,
    version: asString(results.version) ?? 'player-projection-learned-r1',
    title: entry.title,
    adapter: entry.adapter,
    status: explorer && slices.length ? 'available' : 'partial',
    availabilityNotes,
    targets: TARGETS,
    featureGroups: FEATURE_GROUPS,
    modelVersions: FEATURE_GROUPS.map((g) => ({
      id: g.id,
      label: g.id,
      featureGroupId: g.id,
      role: g.id === 'A' || g.id === 'B' ? 'baseline' : 'learned',
    })),
    periods: {
      train: '2023',
      validation: '2024',
      test: '2025',
      prospective: '2026–27 shadow (not started)',
    },
    datasetHash,
    featureSpecVersion,
    historicalValidityClass,
    historicalValidityNote: HISTORICAL_VALIDITY_NOTE,
    eligibility:
      'Final played player-games with ≥1 prior in-season played game; common-eligible with Track A/B. Realized target minutes are not inputs.',
    splits: [
      {
        id: 'training',
        kind: 'training',
        label: 'Train 2023',
        season: '2023',
        n: trainN,
        note: 'Used to fit CatBoost. Not a claim of generalization.',
      },
      {
        id: 'selection',
        kind: 'selection',
        label: 'Validation 2024 (selection)',
        season: '2024',
        n: asNumber(nCommon.validation),
        note: asString(notes.validation) ?? 'Used for early stopping and model selection.',
      },
      {
        id: 'historical_confirmation',
        kind: 'historical_confirmation',
        label: '2025 previously inspected confirmation',
        season: '2025',
        n: asNumber(nCommon.test),
        note:
          asString(notes.test) ??
          'Previously inspected historical confirmation (2025). Not an untouched holdout.',
      },
      {
        id: 'prospective_shadow',
        kind: 'prospective_shadow',
        label: '2026–27 prospective shadow',
        season: '2026',
        n: 0,
        note: 'Future holdout. Collection and scoring have not started.',
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

export const learnedR1Adapter: ExperimentAdapter = {
  id: 'learned-r1',
  load: loadLearnedR1,
};
