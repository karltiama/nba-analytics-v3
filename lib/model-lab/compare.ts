import { METRIC_COPY } from '@/lib/model-lab/metric-copy';
import type {
  ComparePointer,
  ComparisonFlag,
  ComparisonResult,
  ComparisonSide,
  ExperimentRecord,
  PairedDelta,
} from '@/lib/model-lab/types';

function findExperiment(catalog: ExperimentRecord[], id: string): ExperimentRecord | null {
  return catalog.find((e) => e.id === id) ?? null;
}

function side(catalog: ExperimentRecord[], pointer: ComparePointer): ComparisonSide | null {
  const experiment = findExperiment(catalog, pointer.experimentId);
  if (!experiment) return null;
  const split = experiment.splits.find((s) => s.id === pointer.splitId);
  const target = experiment.targets.find((t) => t.id === pointer.targetId);
  const model = experiment.modelVersions.find((m) => m.id === pointer.modelId);
  if (!split || !target || !model) return null;
  const featureGroup = experiment.featureGroups.find((g) => g.id === model.featureGroupId);
  const metricRow = experiment.metrics.find(
    (m) => m.splitId === pointer.splitId && m.targetId === pointer.targetId && m.modelId === pointer.modelId
  );
  return {
    pointer,
    experimentTitle: experiment.title,
    experimentVersion: experiment.version,
    modelLabel: model.label,
    featureGroupLabel: featureGroup?.label ?? model.featureGroupId,
    split,
    target,
    metrics: metricRow?.metrics ?? null,
    datasetHash: experiment.datasetHash,
    eligibility: experiment.eligibility,
    historicalValidityClass: experiment.historicalValidityClass,
  };
}

function findPairedDelta(
  catalog: ExperimentRecord[],
  left: ComparePointer,
  right: ComparePointer
): PairedDelta | null {
  if (left.experimentId !== right.experimentId) return null;
  if (left.splitId !== right.splitId || left.targetId !== right.targetId) return null;
  const experiment = findExperiment(catalog, left.experimentId);
  if (!experiment) return null;
  return (
    experiment.pairedDeltas.find(
      (d) =>
        d.splitId === left.splitId &&
        d.targetId === left.targetId &&
        ((d.leftModelId === left.modelId && d.rightModelId === right.modelId) ||
          (d.leftModelId === right.modelId && d.rightModelId === left.modelId))
    ) ?? null
  );
}

export function compareExperiments(
  catalog: ExperimentRecord[],
  leftPointer: ComparePointer,
  rightPointer: ComparePointer
): ComparisonResult {
  const flags: ComparisonFlag[] = [];
  const left = side(catalog, leftPointer);
  const right = side(catalog, rightPointer);

  if (!left || !right) {
    flags.push({
      level: 'incompatible',
      message: 'One or both sides could not be resolved (unknown experiment, model, split, or target).',
    });
    return { compatible: false, flags, left, right, unpairedMaeDifference: null, pairedDelta: null };
  }

  if (left.target.id !== right.target.id) {
    flags.push({
      level: 'incompatible',
      message: `Different targets (${left.target.label} vs ${right.target.label}). Not apples-to-apples.`,
    });
  } else if (left.target.units !== right.target.units) {
    flags.push({
      level: 'incompatible',
      message: `Different units (${left.target.units} vs ${right.target.units}).`,
    });
  }

  if (left.split.kind !== right.split.kind) {
    flags.push({
      level: 'incompatible',
      message: `Different evaluation classes (${left.split.label} vs ${right.split.label}). Training, selection, historical confirmation, and prospective shadow are not interchangeable.`,
    });
  }

  if (left.target.derived || right.target.derived) {
    flags.push({
      level: 'warning',
      message: `${METRIC_COPY.mae.name} on PRA (and other combos) is a derived target, not independent evidence.`,
    });
  }

  if (left.datasetHash && right.datasetHash && left.datasetHash !== right.datasetHash) {
    flags.push({
      level: 'warning',
      message: 'Dataset hashes differ. Rows may not be the same universe.',
    });
  }

  if (left.eligibility && right.eligibility && left.eligibility !== right.eligibility) {
    flags.push({
      level: 'warning',
      message: 'Eligibility rules are worded differently. Confirm the row universes match before treating this as a paired test.',
    });
  }

  const leftN = left.metrics?.n ?? null;
  const rightN = right.metrics?.n ?? null;
  if (leftN != null && rightN != null && leftN !== rightN) {
    flags.push({
      level: 'warning',
      message: `Sample sizes differ (n=${leftN} vs n=${rightN}).`,
    });
  }

  if (left.pointer.experimentId !== right.pointer.experimentId) {
    flags.push({
      level: 'warning',
      message: 'Different experiment records. Metrics are side-by-side only; do not treat the MAE gap as a paired test unless a paired artifact exists.',
    });
  }

  if (left.split.kind === 'prospective_shadow' || right.split.kind === 'prospective_shadow') {
    const n = (left.metrics?.n ?? 0) + (right.metrics?.n ?? 0);
    if (n === 0) {
      flags.push({
        level: 'info',
        message: 'Prospective shadow evaluation has not started. Empty cells are not a completed result.',
      });
    }
  }

  const compatible = flags.every((f) => f.level !== 'incompatible');

  let pairedDelta = compatible ? findPairedDelta(catalog, leftPointer, rightPointer) : null;
  if (pairedDelta && pairedDelta.leftModelId === rightPointer.modelId && pairedDelta.rightModelId === leftPointer.modelId) {
    pairedDelta = {
      ...pairedDelta,
      leftModelId: leftPointer.modelId,
      rightModelId: rightPointer.modelId,
      delta: pairedDelta.delta == null ? null : -pairedDelta.delta,
      ciLow: pairedDelta.ciHigh == null ? null : -pairedDelta.ciHigh,
      ciHigh: pairedDelta.ciLow == null ? null : -pairedDelta.ciLow,
      leftMae: pairedDelta.rightMae,
      rightMae: pairedDelta.leftMae,
    };
  }

  const unpairedMaeDifference =
    compatible && left.metrics?.mae != null && right.metrics?.mae != null
      ? right.metrics.mae - left.metrics.mae
      : null;

  return {
    compatible,
    flags,
    left,
    right,
    unpairedMaeDifference: pairedDelta ? null : unpairedMaeDifference,
    pairedDelta,
  };
}
