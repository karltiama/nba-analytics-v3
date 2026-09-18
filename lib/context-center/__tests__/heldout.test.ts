import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertCompletenessInvariants,
  computeTeamGameAvailability,
} from '@/lib/context-center';
import { HELDOUT_CASES } from './heldout-fixtures';

function fixtureDigest(): string {
  const payload = JSON.stringify(
    HELDOUT_CASES.map((c) => ({ id: c.id, category: c.category, input: c.input, expected: c.expected }))
  );
  return createHash('sha256').update(payload).digest('hex');
}

/** Frozen before final certification. */
export const HELDOUT_FIXTURE_SHA256 =
  '7053502cf0cc737da581b37fc3bf87f32a70e51072a0fed64d55d43a4a4af18a';

describe('Blind held-out Availability / Team Injury Burden V2', () => {
  it('covers required categories and exact expected outputs', () => {
    expect(HELDOUT_CASES.length).toBeGreaterThanOrEqual(15);
    const cats = new Set(HELDOUT_CASES.map((c) => c.category));
    for (const need of [
      'zero_Out',
      'single_Out',
      'multi_Out',
      'cold_start',
      'partial_role_coverage',
      'unresolved_identity',
      'Q_D_P',
      'non_health_Out',
      'source_unknown',
      'boundary_19.9',
      'boundary_20',
      'duplicate_input',
    ]) {
      expect(cats.has(need)).toBe(true);
    }

    for (const c of HELDOUT_CASES) {
      const snap = computeTeamGameAvailability(c.input);
      assertCompletenessInvariants(snap);
      expect(snap.completeness.status, c.id).toBe(c.expected.completeness);
      expect(snap.availability.healthOutCount, c.id).toBe(c.expected.healthOutCount);
      expect(snap.availability.healthOutSourceCount, c.id).toBe(c.expected.healthOutSourceCount);
      expect(snap.availability.healthOutUnresolvedCount, c.id).toBe(
        c.expected.healthOutUnresolvedCount
      );
      expect(snap.injuryBurden.expectedMissingMinutes, c.id).toBe(
        c.expected.expectedMissingMinutes
      );
      expect(snap.injuryBurden.expectedMissingFga, c.id).toBe(c.expected.expectedMissingFga);
      expect(snap.injuryBurden.expectedMissingPoints, c.id).toBe(
        c.expected.expectedMissingPoints
      );
      expect(snap.injuryBurden.missingRotationShare, c.id).toBe(c.expected.missingRotationShare);
      expect(snap.injuryBurden.maxMissingPriorMpg, c.id).toBe(c.expected.maxMissingPriorMpg);
      expect(snap.injuryBurden.rotationPlayersOutCount, c.id).toBe(
        c.expected.rotationPlayersOutCount
      );
      expect(snap.duplicateBurdenContributions, c.id).toBe(c.expected.duplicateBurdenContributions);
      expect(snap.predictiveStatus).toBe('NOT_TESTED');
    }
  });

  it('records held-out fixture SHA', () => {
    const sha = fixtureDigest();
    // eslint-disable-next-line no-console
    console.log(`HELDOUT_FIXTURE_SHA256=${sha}`);
    expect(sha.length).toBe(64);
    // Lock check: once PENDING replaced, must match
    if (HELDOUT_FIXTURE_SHA256 !== 'PENDING_LOCK') {
      expect(sha).toBe(HELDOUT_FIXTURE_SHA256);
    }
  });
});
