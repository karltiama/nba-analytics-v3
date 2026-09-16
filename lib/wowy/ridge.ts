/**
 * Tiny ridge with optional intercept (unpenalized). For residual experiments only.
 */

export type RidgeModel = {
  lambda: number;
  intercept: number;
  coef: number[];
  means: number[];
  stds: number[];
  featureNames: string[];
};

function colMeanStd(X: number[][], j: number): { mean: number; std: number } {
  const n = X.length;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += X[i][j];
  const mean = n ? sum / n : 0;
  let varSum = 0;
  for (let i = 0; i < n; i += 1) {
    const d = X[i][j] - mean;
    varSum += d * d;
  }
  const std = n > 1 ? Math.sqrt(varSum / (n - 1)) : 1;
  return { mean, std: std > 1e-12 ? std : 1 };
}

function solveSymmetric(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < n; k += 1) {
    let pivot = k;
    for (let i = k + 1; i < n; i += 1) {
      if (Math.abs(M[i][k]) > Math.abs(M[pivot][k])) pivot = i;
    }
    [M[k], M[pivot]] = [M[pivot], M[k]];
    const diag = M[k][k];
    if (Math.abs(diag) < 1e-12) throw new Error('Ridge design matrix is singular');
    for (let j = k; j <= n; j += 1) M[k][j] /= diag;
    for (let i = 0; i < n; i += 1) {
      if (i === k) continue;
      const f = M[i][k];
      for (let j = k; j <= n; j += 1) M[i][j] -= f * M[k][j];
    }
  }
  return M.map((row) => row[n]);
}

export function standardizeTrain(X: number[][]): { Z: number[][]; means: number[]; stds: number[] } {
  if (!X.length) return { Z: [], means: [], stds: [] };
  const p = X[0].length;
  const means: number[] = [];
  const stds: number[] = [];
  for (let j = 0; j < p; j += 1) {
    const { mean, std } = colMeanStd(X, j);
    means.push(mean);
    stds.push(std);
  }
  const Z = X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));
  return { Z, means, stds };
}

export function applyStandardize(X: number[][], means: number[], stds: number[]): number[][] {
  return X.map((row) => row.map((v, j) => (v - (means[j] ?? 0)) / (stds[j] ?? 1)));
}

export function fitRidge(args: {
  X: number[][];
  y: number[];
  lambda: number;
  featureNames: string[];
}): RidgeModel {
  const { Z, means, stds } = standardizeTrain(args.X);
  const n = Z.length;
  const p = args.featureNames.length;
  const q = p + 1;
  const XtX: number[][] = Array.from({ length: q }, () => Array(q).fill(0));
  const Xty = Array(q).fill(0);
  for (let i = 0; i < n; i += 1) {
    const xi = [1, ...Z[i]];
    for (let a = 0; a < q; a += 1) {
      Xty[a] += xi[a] * args.y[i];
      for (let b = 0; b < q; b += 1) XtX[a][b] += xi[a] * xi[b];
    }
  }
  for (let j = 1; j < q; j += 1) XtX[j][j] += args.lambda;
  const beta = solveSymmetric(XtX, Xty);
  return {
    lambda: args.lambda,
    intercept: beta[0],
    coef: beta.slice(1),
    means,
    stds,
    featureNames: args.featureNames,
  };
}

export function predictRidge(model: RidgeModel, X: number[][]): number[] {
  const Z = applyStandardize(X, model.means, model.stds);
  return Z.map((row) => {
    let s = model.intercept;
    for (let j = 0; j < model.coef.length; j += 1) s += model.coef[j] * (row[j] ?? 0);
    return s;
  });
}

export function mae(y: number[], yhat: number[]): number {
  const n = Math.min(y.length, yhat.length);
  if (!n) return NaN;
  let s = 0;
  for (let i = 0; i < n; i += 1) s += Math.abs(y[i] - yhat[i]);
  return s / n;
}
