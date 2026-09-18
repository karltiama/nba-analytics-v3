/**
 * Ridge linear residual augmentation (α=1.0, intercept not regularized, no feature scaling).
 * Mirrors selective predictive validation; coefficients are production-refit only.
 */

import { RIDGE_ALPHA } from '@/lib/context-projection/protocol';

export interface RidgeModel {
  alpha: number;
  featureNames: string[];
  /** [intercept, ...feature betas] */
  coefficients: number[];
  intercept: number;
  featureBetas: number[];
  trainingRows: number;
  featureStandardization: 'NONE';
}

export function fitRidgeResidual(
  X: number[][],
  yResidual: number[],
  featureNames: string[],
  alpha: number = RIDGE_ALPHA
): RidgeModel {
  const n = X.length;
  const p = featureNames.length;
  if (n < 2 || p === 0) {
    return {
      alpha,
      featureNames: [...featureNames],
      coefficients: [0, ...featureNames.map(() => 0)],
      intercept: 0,
      featureBetas: featureNames.map(() => 0),
      trainingRows: n,
      featureStandardization: 'NONE',
    };
  }

  // Design matrix with intercept column
  const XtX: number[][] = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0));
  const Xty: number[] = Array(p + 1).fill(0);

  for (let i = 0; i < n; i++) {
    const row = [1, ...X[i]!];
    for (let a = 0; a < p + 1; a++) {
      Xty[a]! += row[a]! * yResidual[i]!;
      for (let b = 0; b < p + 1; b++) {
        XtX[a]![b]! += row[a]! * row[b]!;
      }
    }
  }

  // Regularize all but intercept
  for (let j = 1; j < p + 1; j++) {
    XtX[j]![j]! += alpha;
  }

  const beta = solveLinearSystem(XtX, Xty);
  return {
    alpha,
    featureNames: [...featureNames],
    coefficients: beta,
    intercept: beta[0]!,
    featureBetas: beta.slice(1),
    trainingRows: n,
    featureStandardization: 'NONE',
  };
}

export function predictRidgeAdjustment(model: RidgeModel, x: number[]): number {
  if (x.length !== model.featureNames.length) {
    throw new Error(
      `feature length mismatch: got ${x.length}, expected ${model.featureNames.length}`
    );
  }
  let y = model.intercept;
  for (let i = 0; i < x.length; i++) {
    y += model.featureBetas[i]! * x[i]!;
  }
  return y;
}

/** Gaussian elimination with partial pivoting. */
function solveLinearSystem(Ain: number[][], bin: number[]): number[] {
  const n = bin.length;
  const A = Ain.map((row) => [...row]);
  const b = [...bin];
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    }
    if (Math.abs(A[piv]![col]!) < 1e-12) {
      // Singular — return zeros
      return Array(n).fill(0);
    }
    if (piv !== col) {
      [A[col], A[piv]] = [A[piv]!, A[col]!];
      [b[col], b[piv]] = [b[piv]!, b[col]!];
    }
    const div = A[col]![col]!;
    for (let c = col; c < n; c++) A[col]![c]! /= div;
    b[col]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r]![col]!;
      for (let c = col; c < n; c++) A[r]![c]! -= f * A[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  return b;
}

export function ridgeModelsEqual(a: RidgeModel, b: RidgeModel, eps = 1e-12): boolean {
  if (a.alpha !== b.alpha || a.trainingRows !== b.trainingRows) return false;
  if (a.featureNames.join('|') !== b.featureNames.join('|')) return false;
  if (a.coefficients.length !== b.coefficients.length) return false;
  for (let i = 0; i < a.coefficients.length; i++) {
    if (Math.abs(a.coefficients[i]! - b.coefficients[i]!) > eps) return false;
  }
  return true;
}
