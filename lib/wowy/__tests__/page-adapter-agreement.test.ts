import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../');

describe('WOWY page and model adapter share one summarizer', () => {
  it('API pair route loads the shared module rather than a private copy', () => {
    const src = readFileSync(join(ROOT, 'app/api/wowy/pair/route.ts'), 'utf8');
    expect(src).toMatch(/loadWowyPairSummary/);
    expect(src).toMatch(/from '@\/lib\/wowy/);
    expect(src).toMatch(/wowyCacheKey/);
  });

  it('model adapter route uses summarizeWowyBeforeCutoff', () => {
    const src = readFileSync(join(ROOT, 'app/api/wowy/model-pair/route.ts'), 'utf8');
    expect(src).toMatch(/loadWowyModelPair/);
    expect(src).toMatch(/from '@\/lib\/wowy/);
  });

  it('does not import frozen projection modules', () => {
    const files = [
      'lib/wowy/queries.ts',
      'lib/wowy/model-adapter.ts',
      'lib/wowy/aggregate.ts',
      'lib/wowy/candidate-features.ts',
      'lib/wowy/availability-gate.ts',
      'app/api/wowy/pair/route.ts',
    ];
    for (const file of files) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src).not.toMatch(/player-projection-learned-features/);
      expect(src).not.toMatch(/player-prop-model/);
      expect(src).not.toMatch(/collection-asof/);
    }
  });
});
