import { describe, expect, it } from 'vitest';
import { assertAdvancingCursor } from '@/lib/archive/resumable-s3-archive';

describe('assertAdvancingCursor', () => {
  it('accepts a chain of new next_cursor values', () => {
    const seen = new Set<string>();
    assertAdvancingCursor(seen, null, '68837');
    assertAdvancingCursor(seen, '68837', '69253');
    assertAdvancingCursor(seen, '69253', '69826');
    expect(seen.size).toBe(3);
  });

  it('rejects a repeated next_cursor', () => {
    const seen = new Set<string>();
    assertAdvancingCursor(seen, null, '68837');
    expect(() => assertAdvancingCursor(seen, '69253', '68837')).toThrow(/already seen/);
  });

  it('rejects next_cursor equal to the request cursor', () => {
    const seen = new Set<string>();
    expect(() => assertAdvancingCursor(seen, '68837', '68837')).toThrow(/request cursor/);
  });

  it('ignores a null next_cursor (exhaustion)', () => {
    const seen = new Set<string>();
    assertAdvancingCursor(seen, '71153', null);
    expect(seen.size).toBe(0);
  });
});
