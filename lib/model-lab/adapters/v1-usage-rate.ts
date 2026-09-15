import { HISTORICAL_VALIDITY_NOTE } from '@/lib/model-lab/metric-copy';
import { asNumber, asString, fileExists, isRecord, readJsonIfExists } from '@/lib/model-lab/fs';
import { loadNotesMarkdown } from '@/lib/model-lab/notes';
import { artifactFile, unavailableRecord } from '@/lib/model-lab/adapters/common';
import type {
  ExperimentAdapter,
  ExperimentRecord,
  MetricRow,
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

const PROP_TYPE_TO_TARGET: Record<string, string> = {
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  threes: 'threes',
  points_rebounds_assists: 'pra',
};

const SLICE_FAMILY: Record<string, string> = {
  minutes: 'minutes_change',
  volume: 'minutes_volume',
};

function splitKind(split: string): 'training' | 'selection' | 'historical_confirmation' | null {
  if (split === 'train') return 'training';
  if (split === 'validation') return 'selection';
  if (split === 'test') return 'historical_confirmation';
  return null;
}

function loadV1UsageRate(entry: RegistryEntry): ExperimentRecord {
  const resultsPath = artifactFile(entry, entry.resultsFile);
  if (!resultsPath || !fileExists(resultsPath)) {
    return unavailableRecord(
      entry,
      'Missing player-projection-v1-usage-rate-results.json (local research dump; not required in every environment).'
    );
  }
  const raw = readJsonIfExists<unknown>(resultsPath);
  if (!isRecord(raw)) return unavailableRecord(entry, 'v1 usage-rate JSON is not an object.');

  const chrono = isRecord(raw.chronoSplit) ? raw.chronoSplit : {};
  const scored = isRecord(raw.scored) ? raw.scored : {};
  const splitN = isRecord(scored.splitN) ? scored.splitN : {};
  const valBest = isRecord(raw.valBest) ? raw.valBest : {};
  const bySplit = isRecord(raw.bySplit) ? raw.bySplit : {};

  const selectedByTarget: Record<string, string> = {};
  for (const [propType, block] of Object.entries(valBest)) {
    if (!isRecord(block)) continue;
    const candidate = asString(block.candidate);
    const targetId = PROP_TYPE_TO_TARGET[propType];
    if (candidate && targetId) selectedByTarget[targetId] = candidate;
  }

  const modelIds = new Set<string>([
    'played_track_a',
    'track_a_conditional_ewm_minutes',
    ...Object.values(selectedByTarget),
  ]);

  const metrics: MetricRow[] = [];
  const propKey: Record<string, string> = {
    PTS: 'points',
    REB: 'rebounds',
    AST: 'assists',
    '3PM': 'threes',
    PRA: 'pra',
  };
  for (const [splitName, props] of Object.entries(bySplit)) {
    const kind = splitKind(splitName);
    if (!kind || !isRecord(props)) continue;
    for (const [prop, models] of Object.entries(props)) {
      const targetId = propKey[prop];
      if (!targetId || !isRecord(models)) continue;
      for (const modelId of modelIds) {
        const m = models[modelId];
        if (!isRecord(m)) continue;
        metrics.push({
          splitId: kind,
          targetId,
          modelId,
          metrics: {
            mae: asNumber(m.mae),
            rmse: asNumber(m.rmse),
            bias: asNumber(m.bias),
            coverage: null,
            n: asNumber(m.n) ?? 0,
            nFinite: asNumber(m.n),
          },
        });
      }
    }
  }

  const pairedDeltas: PairedDelta[] = [];
  if (Array.isArray(raw.testTable)) {
    for (const row of raw.testTable) {
      if (!isRecord(row)) continue;
      const targetId = PROP_TYPE_TO_TARGET[asString(row.propType) ?? ''];
      const usageModel = asString(row.selectedCandidate);
      const n = asNumber(row.n);
      if (!targetId || !usageModel || n == null) continue;
      if (asNumber(row.ciLow) == null && asNumber(row.ciHigh) == null) continue;
      pairedDeltas.push({
        leftModelId: 'track_a_conditional_ewm_minutes',
        rightModelId: usageModel,
        splitId: 'historical_confirmation',
        targetId,
        delta: asNumber(row.deltaVsMinutes),
        ciLow: asNumber(row.ciLow),
        ciHigh: asNumber(row.ciHigh),
        n,
        nGroups: null,
        iterations: isRecord(raw.bootstrap) ? asNumber(raw.bootstrap.iterations) : 400,
        leftMae: asNumber(row.minutesMae),
        rightMae: asNumber(row.usageMae),
        source: 'paired_observations',
      });
    }
  }

  const slices: SliceRow[] = [];
  const ptsUsage = selectedByTarget.points;
  if (ptsUsage && Array.isArray(raw.segments)) {
    for (const row of raw.segments) {
      if (!isRecord(row)) continue;
      if (asString(row.prop) !== 'PTS') continue;
      if (asString(row.candidate) !== ptsUsage && asString(row.candidate) !== 'track_a_conditional_ewm_minutes') {
        continue;
      }
      const slice = asString(row.slice);
      const bucket = asString(row.bucket);
      const n = asNumber(row.n);
      if (!slice || !bucket || n == null) continue;
      const family = SLICE_FAMILY[slice];
      if (!family) continue;
      const modelId = asString(row.candidate) ?? ptsUsage;
      slices.push({
        id: `${entry.id}:pts:${family}:${bucket}:${modelId}`,
        family,
        label: `${slice} ${bucket}`,
        splitId: 'selection',
        targetId: 'points',
        n,
        metricsByModel: {
          played_track_a: { mae: asNumber(row.baselineMae), n },
          [modelId]: { mae: asNumber(row.candidateMae), n },
        },
        pairedDelta:
          asNumber(row.ciLow) != null && asNumber(row.ciHigh) != null
            ? {
                leftModelId: 'played_track_a',
                rightModelId: modelId,
                splitId: 'selection',
                targetId: 'points',
                delta: asNumber(row.delta),
                ciLow: asNumber(row.ciLow),
                ciHigh: asNumber(row.ciHigh),
                n,
                nGroups: null,
                iterations: null,
                leftMae: asNumber(row.baselineMae),
                rightMae: asNumber(row.candidateMae),
                source: 'paired_observations',
              }
            : null,
      });
    }
  }

  const decision = isRecord(raw.decision) ? raw.decision : {};
  const minutesNote = isRecord(raw.frozenMinutes) ? asString(raw.frozenMinutes.note) : null;

  return {
    id: entry.id,
    version: asString(raw.version) ?? 'player-projection-v1-usage-rate-r1',
    title: entry.title,
    adapter: entry.adapter,
    status: 'partial',
    availabilityNotes: [
      'Row-level explorer is not available for this experiment (no rows.jsonl).',
      slices.length
        ? 'Minutes-change / volume slices shown only when stored on the val-selected PTS candidate.'
        : 'No minutes-change or minutes-volume slices were stored for the selected usage candidate.',
    ],
    targets: TARGETS,
    featureGroups: [
      {
        id: 'track_a',
        label: 'Played-only Track A',
        description: 'Frozen counting-stat baseline.',
      },
      {
        id: 'minutes',
        label: 'Frozen conditional EWM minutes',
        description: minutesNote ?? 'Not retuned in this experiment.',
      },
      {
        id: 'usage_rate',
        label: 'Usage / FGA / shot-volume candidates',
        description: 'Val-selected usage or rate adjustment. Pregame reconstructed features.',
      },
    ],
    modelVersions: [
      { id: 'played_track_a', label: 'Played-only Track A', featureGroupId: 'track_a', role: 'baseline' },
      {
        id: 'track_a_conditional_ewm_minutes',
        label: 'Frozen minutes candidate',
        featureGroupId: 'minutes',
        role: 'baseline',
      },
      ...[...new Set(Object.values(selectedByTarget))]
        .filter((id) => id !== 'played_track_a' && id !== 'track_a_conditional_ewm_minutes')
        .map((id) => ({
          id,
          label: id,
          featureGroupId: 'usage_rate' as const,
          role: 'candidate' as const,
        })),
    ],
    periods: {
      train: asString(chrono.train),
      validation: asString(chrono.validation),
      test: asString(chrono.test),
      prospective: null,
    },
    datasetHash: null,
    featureSpecVersion: asString(raw.version),
    historicalValidityClass: 'reconstructed_historical',
    historicalValidityNote: HISTORICAL_VALIDITY_NOTE,
    eligibility: 'Final played player-games with ≥1 prior in-season played game (same universe as minutes-role v1).',
    splits: [
      {
        id: 'training',
        kind: 'training',
        label: 'Train 2023',
        season: asString(chrono.train),
        n: asNumber(splitN.train),
        note: 'Fit / not used to pick the reported candidate.',
      },
      {
        id: 'selection',
        kind: 'selection',
        label: 'Validation 2024 (selection)',
        season: asString(chrono.validation),
        n: asNumber(splitN.validation),
        note: 'Hyperparameters chosen on validation only.',
      },
      {
        id: 'historical_confirmation',
        kind: 'historical_confirmation',
        label: 'Test 2025 (previously inspected)',
        season: asString(chrono.test),
        n: asNumber(splitN.test),
        note: 'Chronological confirmation after validation selection. Not an untouched holdout.',
      },
    ],
    metrics,
    pairedDeltas,
    slices,
    slicesAvailable: slices.length > 0,
    rowExplorerAvailable: false,
    decisions: isRecord(decision)
      ? [
          {
            label: asString(decision.label) ?? 'Recorded decision',
            note: asString(decision.why) ?? '',
            source: entry.resultsFile ?? 'v1 usage-rate JSON',
          },
        ]
      : [],
    notesMarkdown: loadNotesMarkdown(entry),
    warnings: [],
  };
}

export const v1UsageRateAdapter: ExperimentAdapter = {
  id: 'v1-usage-rate',
  load: loadV1UsageRate,
};
