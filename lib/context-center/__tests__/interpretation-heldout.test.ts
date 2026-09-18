import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateInterpretations,
  scanCausalLanguage,
  scanProhibitedLanguage,
} from '@/lib/context-center';
import {
  INTERPRETATION_HELDOUT_CASES,
  heldoutPayloadForSha,
} from './interpretation-heldout-fixtures';

function fixtureDigest(): string {
  return createHash('sha256')
    .update(JSON.stringify(heldoutPayloadForSha()))
    .digest('hex');
}

/** Frozen before final certification. */
export const INTERPRETATION_HELDOUT_FIXTURE_SHA256 =
  '4830f8761d990218ac928d5950586666867dd5d4ffc90647bec3f87b023f17fe';

describe('Blind held-out Context Interpretation V1', () => {
  it('covers required categories (≥30 cases)', () => {
    expect(INTERPRETATION_HELDOUT_CASES.length).toBeGreaterThanOrEqual(30);
    const cats = new Set(INTERPRETATION_HELDOUT_CASES.map((c) => c.category));
    for (const need of [
      'Availability COMPLETE',
      'Availability PARTIAL',
      'Schedule B2B',
      'Season opener',
      'Role increase',
      'Role decrease',
      'Role suppressed-at-precision',
      'Form increase',
      'Form decrease',
      'null 3P%',
      'small sample',
      'Matchup scoring',
      'Matchup perimeter COMPLETE',
      'Matchup perimeter PARTIAL',
      'cold start',
      'contradictory Role/Form',
    ]) {
      expect(cats.has(need), need).toBe(true);
    }
  });

  it('exact expectations hold and language is safe', () => {
    for (const c of INTERPRETATION_HELDOUT_CASES) {
      const result = generateInterpretations(c.bundle);
      const ids = new Set(result.interpretations.map((i) => i.interpretationId));
      const joined = result.rendered.map((r) => r.renderedText).join('\n');

      for (const id of c.expectIds ?? []) {
        expect(ids.has(id), `${c.id} missing ${id}`).toBe(true);
      }
      for (const id of c.expectMissingIds ?? []) {
        expect(ids.has(id), `${c.id} unexpectedly has ${id}`).toBe(false);
      }
      for (const s of c.expectRenderIncludes ?? []) {
        expect(joined, `${c.id} include ${s}`).toContain(s);
      }
      for (const s of c.expectRenderExcludes ?? []) {
        expect(joined.toLowerCase(), `${c.id} exclude ${s}`).not.toContain(s.toLowerCase());
      }
      if (c.id === 'matchup-perimeter-partial') {
        const perim = result.rendered.find(
          (r) => r.interpretation.interpretationId === 'interpretation.matchup_perimeter'
        )!;
        expect(perim.renderedText).not.toMatch(/percentage points/);
        expect(perim.interpretation.templateKey).toBe('MATCHUP_PERIMETER_REDUCED');
      }
      for (const r of result.rendered) {
        expect(scanProhibitedLanguage(r.renderedText), c.id).toEqual([]);
        expect(scanCausalLanguage(r.renderedText), c.id).toEqual([]);
      }
    }
  });

  it('fixture SHA is locked', () => {
    const sha = fixtureDigest();
    expect(sha).toBe(INTERPRETATION_HELDOUT_FIXTURE_SHA256);
  });
});
