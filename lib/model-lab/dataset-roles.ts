/**
 * Dataset role policy for Model Lab. Previously inspected historical periods
 * must not be silently relabeled as pristine holdout.
 */

import type { SplitKind } from '@/lib/model-lab/types';

export const DATASET_ROLES = {
  DEVELOPMENT: 'DEVELOPMENT',
  VALIDATION: 'VALIDATION',
  HOLDOUT_TEST: 'HOLDOUT_TEST',
  PROSPECTIVE: 'PROSPECTIVE',
} as const;

export type DatasetRole = (typeof DATASET_ROLES)[keyof typeof DATASET_ROLES];

export const CONTAMINATION_CLASS = {
  DEVELOPMENT_EVIDENCE: 'DEVELOPMENT_EVIDENCE',
  PREVIOUSLY_INSPECTED: 'PREVIOUSLY_INSPECTED',
  UNTOUCHED_HOLDOUT: 'UNTOUCHED_HOLDOUT',
  PROSPECTIVE_UNTOUCHED: 'PROSPECTIVE_UNTOUCHED',
} as const;

export type ContaminationClass = (typeof CONTAMINATION_CLASS)[keyof typeof CONTAMINATION_CLASS];

export type DatasetRoleRecord = {
  role: DatasetRole;
  contamination: ContaminationClass;
  tuningAllowed: boolean;
  mayReplayRepeatedly: boolean;
  pristineHoldout: boolean;
  note: string;
};

export const KNOWN_HISTORICAL_BOUNDARIES = {
  originalModelingPlayerGames: 83479,
  injuryObservationWindow: 'March–May 2026 only',
  knownOutQualifiedPlayerGames: 625,
  wowyKnownOutEvalExamples: 231,
  wowyKnownOutEvalDates: 12,
  note: 'Previously inspected historical periods are development evidence, not untouched tests.',
} as const;

const DEFAULT_BY_SPLIT: Record<SplitKind, DatasetRoleRecord> = {
  training: {
    role: DATASET_ROLES.DEVELOPMENT,
    contamination: CONTAMINATION_CLASS.DEVELOPMENT_EVIDENCE,
    tuningAllowed: true,
    mayReplayRepeatedly: true,
    pristineHoldout: false,
    note: 'Training period. May be replayed. Tuning allowed. Not a holdout.',
  },
  selection: {
    role: DATASET_ROLES.VALIDATION,
    contamination: CONTAMINATION_CLASS.PREVIOUSLY_INSPECTED,
    tuningAllowed: true,
    mayReplayRepeatedly: true,
    pristineHoldout: false,
    note: 'Candidate comparison / limited tuning. Not an untouched holdout.',
  },
  historical_confirmation: {
    role: DATASET_ROLES.HOLDOUT_TEST,
    contamination: CONTAMINATION_CLASS.PREVIOUSLY_INSPECTED,
    tuningAllowed: false,
    mayReplayRepeatedly: true,
    pristineHoldout: false,
    note: 'Previously inspected historical confirmation. Cannot be marked pristine holdout.',
  },
  prospective_shadow: {
    role: DATASET_ROLES.PROSPECTIVE,
    contamination: CONTAMINATION_CLASS.PROSPECTIVE_UNTOUCHED,
    tuningAllowed: false,
    mayReplayRepeatedly: false,
    pristineHoldout: true,
    note: 'Prediction frozen before outcome. Strongest future evidence. Empty until live collection starts.',
  },
};

export function datasetRoleForSplit(kind: SplitKind): DatasetRoleRecord {
  return DEFAULT_BY_SPLIT[kind];
}

export function isPristineHoldout(kind: SplitKind): boolean {
  return datasetRoleForSplit(kind).pristineHoldout;
}

/**
 * Default config never promotes previously inspected data to pristine holdout.
 * Explicit override is rejected for historical_confirmation.
 */
export function markAsPristineHoldout(kind: SplitKind): DatasetRoleRecord {
  const current = datasetRoleForSplit(kind);
  if (kind !== 'prospective_shadow') {
    throw new Error(
      `Cannot mark ${kind} as pristine holdout. Previously inspected historical periods stay ${current.contamination}.`
    );
  }
  return current;
}

export function assertHistoricalConfirmationNotPristine(kind: SplitKind): void {
  if (kind === 'historical_confirmation' && isPristineHoldout(kind)) {
    throw new Error('historical_confirmation was marked pristine holdout; that is forbidden.');
  }
}
