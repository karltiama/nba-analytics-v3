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

const PROP_TO_TARGET: Record<string, string> = {
  PTS: 'points',
  REB: 'rebounds',
  AST: 'assists',
  '3PM': 'threes',
  PRA: 'pra',
  PA: 'pa',
  PR: 'pr',
  RA: 'ra',
};

const TARGETS: TargetSpec[] = [
  { id: 'points', label: 'Points', units: 'points', derived: false },
  { id: 'rebounds', label: 'Rebounds', units: 'rebounds', derived: false },
  { id: 'assists', label: 'Assists', units: 'assists', derived: false },
  { id: 'threes', label: 'Threes', units: 'made threes', derived: false },
  { id: 'pra', label: 'PRA (derived)', units: 'points+rebounds+assists', derived: true },
  { id: 'pa', label: 'PA (derived)', units: 'points+assists', derived: true },
  { id: 'pr', label: 'PR (derived)', units: 'points+rebounds', derived: true },
  { id: 'ra', label: 'RA (derived)', units: 'rebounds+assists', derived: true },
];

const SLICE_FAMILY: Record<string, string> = {
  minutes: 'minutes_change',
  volume: 'minutes_volume',
  role: 'role',
};

function splitKind(split: string): 'training' | 'selection' | 'historical_confirmation' | null {
  if (split === 'train') return 'training';
  if (split === 'validation') return 'selection';
  if (split === 'test') return 'historical_confirmation';
  return null;
}

function loadV1MinutesRole(entry: RegistryEntry): ExperimentRecord {
  const resultsPath = artifactFile(entry, entry.resultsFile);
  if (!resultsPath || !fileExists(resultsPath)) {
    return unavailableRecord(
      entry,
      'Missing player-projection-v1-minutes-role-results.json (local research dump; not required in every environment).'
    );
  }
  const raw = readJsonIfExists<unknown>(resultsPath);
  if (!isRecord(raw)) return unavailableRecord(entry, 'v1 minutes-role JSON is not an object.');

  const chrono = isRecord(raw.chronoSplit) ? raw.chronoSplit : {};
  const scored = isRecord(raw.scored) ? raw.scored : {};
  const splitN = isRecord(scored.splitN) ? scored.splitN : {};
  const valBest = isRecord(raw.valBest) ? raw.valBest : {};
  const bySplit = isRecord(raw.bySplit) ? raw.bySplit : {};

  const selectedByTarget: Record<string, string> = {};
  for (const [propType, block] of Object.entries(valBest)) {
    if (!isRecord(block)) continue;
    const candidate = asString(block.candidate);
    if (!candidate) continue;
    const targetId =
      propType === 'points'
        ? 'points'
        : propType === 'rebounds'
          ? 'rebounds'
          : propType === 'assists'
            ? 'assists'
            : propType === 'threes'
              ? 'threes'
              : propType === 'points_rebounds_assists'
                ? 'pra'
                : propType === 'points_assists'
                  ? 'pa'
                  : propType === 'points_rebounds'
                    ? 'pr'
                    : propType === 'rebounds_assists'
                      ? 'ra'
                      : null;
    if (targetId) selectedByTarget[targetId] = candidate;
  }

  const modelIds = new Set<string>(['played_track_a', ...Object.values(selectedByTarget)]);
  const metrics: MetricRow[] = [];
  for (const [splitName, props] of Object.entries(bySplit)) {
    const kind = splitKind(splitName);
    if (!kind || !isRecord(props)) continue;
    for (const [prop, models] of Object.entries(props)) {
      const targetId = PROP_TO_TARGET[prop];
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
      const targetId = asString(row.propType)
        ? row.propType === 'points_rebounds_assists'
          ? 'pra'
          : row.propType === 'points_assists'
            ? 'pa'
            : row.propType === 'points_rebounds'
              ? 'pr'
              : row.propType === 'rebounds_assists'
                ? 'ra'
                : asString(row.propType)
        : PROP_TO_TARGET[asString(row.prop) ?? ''];
      const candidate = asString(row.selectedCandidate);
      const n = asNumber(row.n);
      if (!targetId || !candidate || n == null) continue;
      if (asNumber(row.ciLow) == null && asNumber(row.ciHigh) == null) continue;
      pairedDeltas.push({
        leftModelId: 'played_track_a',
        rightModelId: candidate,
        splitId: 'historical_confirmation',
        targetId,
        delta: asNumber(row.delta),
        ciLow: asNumber(row.ciLow),
        ciHigh: asNumber(row.ciHigh),
        n,
        nGroups: null,
        iterations: isRecord(raw.bootstrap) ? asNumber(raw.bootstrap.iterations) : 400,
        leftMae: asNumber(row.baselineMae),
        rightMae: asNumber(row.candidateMae),
        source: 'paired_observations',
      });
    }
  }

  const slices: SliceRow[] = [];
  const ptsCandidate = selectedByTarget.points;
  if (ptsCandidate && Array.isArray(raw.segments)) {
    for (const row of raw.segments) {
      if (!isRecord(row)) continue;
      if (asString(row.prop) !== 'PTS') continue;
      if (asString(row.candidate) !== ptsCandidate) continue;
      const slice = asString(row.slice);
      const bucket = asString(row.bucket);
      const n = asNumber(row.n);
      if (!slice || !bucket || n == null) continue;
      const family = SLICE_FAMILY[slice] ?? slice;
      if (family !== 'minutes_change' && family !== 'minutes_volume') continue;
      const paired: PairedDelta | null =
        asNumber(row.ciLow) != null && asNumber(row.ciHigh) != null
          ? {
              leftModelId: 'played_track_a',
              rightModelId: ptsCandidate,
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
          : null;
      slices.push({
        id: `${entry.id}:pts:${family}:${bucket}`,
        family,
        label: `${slice} ${bucket}`,
        splitId: 'selection',
        targetId: 'points',
        n,
        metricsByModel: {
          played_track_a: { mae: asNumber(row.baselineMae), n },
          [ptsCandidate]: { mae: asNumber(row.candidateMae), n },
        },
        pairedDelta: paired,
      });
    }
  }

  const decision = isRecord(raw.decision) ? raw.decision : {};

  return {
    id: entry.id,
    version: asString(raw.version) ?? 'player-projection-v1-minutes-role-r1',
    title: entry.title,
    adapter: entry.adapter,
    status: 'partial',
    availabilityNotes: [
      'Row-level explorer is not available for this experiment (no rows.jsonl).',
      slices.length
        ? 'Minutes-change and volume slices are the val-selected PTS candidate vs played-only Track A.'
        : 'Limited-history, minutes-change, and volume slices were not stored for the val-selected PTS candidate.',
    ],
    targets: TARGETS,
    featureGroups: [
      {
        id: 'track_a',
        label: 'Played-only Track A',
        description: '0.70 last-10 played + 0.30 season played.',
      },
      {
        id: 'minutes_role',
        label: 'Expected minutes / role candidates',
        description: 'Val-selected minutes or role-shift candidate per target. Not learned CatBoost.',
      },
    ],
    modelVersions: [
      { id: 'played_track_a', label: 'Played-only Track A', featureGroupId: 'track_a', role: 'baseline' },
      ...[...new Set(Object.values(selectedByTarget))].map((id) => ({
        id,
        label: id,
        featureGroupId: 'minutes_role',
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
    eligibility:
      asString(isRecord(raw.benchmark) ? raw.benchmark.targetUniverse : null) ??
      'Final played player-games with ≥1 prior in-season played game.',
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
            source: entry.resultsFile ?? 'v1 minutes-role JSON',
          },
        ]
      : [],
    notesMarkdown: loadNotesMarkdown(entry),
    warnings: [],
  };
}

export const v1MinutesRoleAdapter: ExperimentAdapter = {
  id: 'v1-minutes-role',
  load: loadV1MinutesRole,
};
