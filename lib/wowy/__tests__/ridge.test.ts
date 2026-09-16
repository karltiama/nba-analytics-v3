import { describe, expect, it } from 'vitest';
import { fitRidge, mae, predictRidge } from '../ridge';

describe('fitRidge', () => {
  it('recovers a linear residual with small lambda', () => {
    const X = [[1], [2], [3], [4], [5]];
    const y = [3, 5, 7, 9, 11];
    const model = fitRidge({ X, y, lambda: 0.0001, featureNames: ['x'] });
    const yhat = predictRidge(model, X);
    expect(mae(y, yhat)).toBeLessThan(0.05);
  });
});
