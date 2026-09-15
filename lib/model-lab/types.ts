/** Court Context Model Lab — typed experiment records. Not hardcoded to A/B/C/D. */

export type SplitKind = 'training' | 'selection' | 'historical_confirmation' | 'prospective_shadow';

export type ModelRole = 'baseline' | 'learned' | 'candidate' | 'frozen_shadow' | 'production';

export type ArtifactAvailability = 'available' | 'partial' | 'unavailable';

export type MetricSet = {
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  coverage: number | null;
  n: number;
  nFinite: number | null;
};

export type TargetSpec = {
  id: string;
  label: string;
  units: string;
  derived: boolean;
};

export type FeatureGroupSpec = {
  id: string;
  label: string;
  description: string;
};

export type ModelVersionSpec = {
  id: string;
  label: string;
  featureGroupId: string;
  role: ModelRole;
};

export type SplitSpec = {
  id: string;
  kind: SplitKind;
  label: string;
  season: string | null;
  n: number | null;
  note: string;
};

export type MetricRow = {
  splitId: string;
  targetId: string;
  modelId: string;
  metrics: MetricSet;
};

export type PairedDelta = {
  leftModelId: string;
  rightModelId: string;
  splitId: string;
  targetId: string;
  delta: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  n: number;
  nGroups: number | null;
  iterations: number | null;
  leftMae: number | null;
  rightMae: number | null;
  /** Only paired observation CIs are stored. Never derived by subtracting separate intervals. */
  source: 'paired_observations';
};

export type SliceFamily = 'limited_history' | 'minutes_change' | 'minutes_volume' | string;

export type SliceRow = {
  id: string;
  family: SliceFamily;
  label: string;
  splitId: string;
  targetId: string;
  n: number;
  metricsByModel: Record<string, { mae: number | null; n: number }>;
  pairedDelta: PairedDelta | null;
};

export type ExperimentDecision = {
  label: string;
  note: string;
  source: string;
};

export type ExperimentRecord = {
  id: string;
  version: string;
  title: string;
  adapter: string;
  status: ArtifactAvailability;
  availabilityNotes: string[];
  targets: TargetSpec[];
  featureGroups: FeatureGroupSpec[];
  modelVersions: ModelVersionSpec[];
  periods: {
    train: string | null;
    validation: string | null;
    test: string | null;
    prospective: string | null;
  };
  datasetHash: string | null;
  featureSpecVersion: string | null;
  historicalValidityClass: string | null;
  historicalValidityNote: string;
  eligibility: string;
  splits: SplitSpec[];
  metrics: MetricRow[];
  pairedDeltas: PairedDelta[];
  slices: SliceRow[];
  slicesAvailable: boolean;
  rowExplorerAvailable: boolean;
  decisions: ExperimentDecision[];
  notesMarkdown: string | null;
  warnings: string[];
};

export type ComparePointer = {
  experimentId: string;
  modelId: string;
  splitId: string;
  targetId: string;
};

export type ComparisonFlag = {
  level: 'incompatible' | 'warning' | 'info';
  message: string;
};

export type ComparisonSide = {
  pointer: ComparePointer;
  experimentTitle: string;
  experimentVersion: string;
  modelLabel: string;
  featureGroupLabel: string;
  split: SplitSpec;
  target: TargetSpec;
  metrics: MetricSet | null;
  datasetHash: string | null;
  eligibility: string;
  historicalValidityClass: string | null;
};

export type ComparisonResult = {
  compatible: boolean;
  flags: ComparisonFlag[];
  left: ComparisonSide | null;
  right: ComparisonSide | null;
  unpairedMaeDifference: number | null;
  pairedDelta: PairedDelta | null;
};

export type ExplorerListRow = {
  playerId: string;
  gameId: string;
  gameDate: string | null;
  split: string;
  targetId: string;
  baselineModelId: string;
  learnedModelId: string;
  baselinePrediction: number | null;
  learnedPrediction: number | null;
  actual: number | null;
  error: number | null;
};

export type ExplorerListResult = {
  available: boolean;
  reason: string | null;
  experimentId: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  rows: ExplorerListRow[];
};

export type ExplorerDetail = {
  available: boolean;
  reason: string | null;
  playerId: string;
  gameId: string;
  gameDate: string | null;
  split: string;
  historicalValidityClass: string | null;
  commonEligible: boolean | null;
  minutesChangeBucket: string | null;
  volumeBucket: string | null;
  limitedHistory: boolean | null;
  predictions: Array<{
    modelId: string;
    label: string;
    targetId: string;
    predicted: number | null;
    actual: number | null;
    error: number | null;
  }>;
  features: Array<{ name: string; value: number | null; group: string }>;
  featureNote: string;
};

export type ModelLabStatus = {
  production: {
    model: string;
    note: string;
  };
  shadowCandidates: Array<{
    target: string;
    featureSet: string;
    modelVersion: string;
    sha256: string | null;
    frozen: boolean;
  }>;
  deployment: {
    implementationComplete: boolean;
    deployed: boolean;
    running: boolean;
    terraformDefaults: string;
    stateSummary: string;
  };
  collection: {
    freshness: string;
    lastSuccessfulCollectionAt: string | null;
    schemaEnrichment: string | null;
  };
  prospectiveEvaluation: {
    started: boolean;
    note: string;
  };
};

export type RegistryEntry = {
  id: string;
  adapter: string;
  title: string;
  artifactDir: string;
  notesRelPath: string;
  resultsFile?: string;
  slicesFile?: string;
  rowsFile?: string;
  predictionsFile?: string;
  selectionFile?: string;
  featureSpecFile?: string;
  reconciliationFile?: string;
  manifestFile?: string;
};

export type ExperimentAdapter = {
  id: string;
  load(entry: RegistryEntry): ExperimentRecord;
};
