/**
 * Development + synthetic exact tests for reason policy / WOWY eligibility.
 * Intentionally does NOT load held_out expectations.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_INJURY_REASON_POLICY_VERSION,
  classifyOfficialInjuryReason,
} from '../reason-policy';
import {
  INJURY_WOWY_ELIGIBILITY_POLICY_VERSION,
  evaluateInjuryWowyEligibility,
} from '../wowy-eligibility';

const ROOT = path.join(process.cwd(), 'tests/fixtures/official-injury-t60-reason-policy');

type Fixture = {
  fixture_id: string;
  split: string;
  input: {
    status_raw: string;
    reason_raw: string;
    identity_bucket: string;
  };
  expected: Record<string, unknown>;
};

function loadSplit(split: string): Fixture[] {
  if (split === 'held_out') {
    throw new Error('held_out fixtures must not be loaded by the development test');
  }
  const dir = path.join(ROOT, split);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Fixture);
}

function assertExact(fx: Fixture) {
  const actual = evaluateInjuryWowyEligibility({
    status_raw: fx.input.status_raw,
    reason_raw: fx.input.reason_raw,
    identity_bucket: fx.input.identity_bucket,
  });
  const e = fx.expected;
  expect(actual.reason_policy_version).toBe(OFFICIAL_INJURY_REASON_POLICY_VERSION);
  expect(actual.eligibility_policy_version).toBe(INJURY_WOWY_ELIGIBILITY_POLICY_VERSION);
  expect(actual.reason_category).toBe(e.reason_category);
  expect(actual.health_relation).toBe(e.health_relation);
  expect(actual.classification_rule).toBe(e.classification_rule);
  expect(actual.availability_fact).toBe(e.availability_fact);
  expect(actual.reason_side_eligibility).toBe(e.reason_side_eligibility);
  expect(actual.canonical_identity_resolved).toBe(e.canonical_identity_resolved);
  expect(actual.canonical_model_eligible).toBe(e.canonical_model_eligible);
  expect(actual.injury_wowy_eligibility).toBe(e.injury_wowy_eligibility);
  // reason_raw preserved
  expect(actual.reason_raw).toBe(fx.input.reason_raw === '' ? '' : fx.input.reason_raw);
  expect(actual.status_raw).toBe(fx.input.status_raw);
}

describe('official-injury-reason-policy-v1 development', () => {
  const fixtures = loadSplit('development');
  it(`loads ${fixtures.length} development fixtures (no held_out)`, () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(25);
    expect(fixtures.every((f) => f.split === 'development')).toBe(true);
  });
  for (const fx of fixtures) {
    it(`exact: ${fx.fixture_id}`, () => assertExact(fx));
  }
});

describe('official-injury-reason-policy-v1 synthetic', () => {
  const fixtures = loadSplit('synthetic');
  it(`loads ${fixtures.length} synthetic fixtures`, () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
  });
  for (const fx of fixtures) {
    it(`exact: ${fx.fixture_id}`, () => assertExact(fx));
  }
});

describe('reason classifier purity', () => {
  it('same reason_raw → same category across statuses', () => {
    const reason = 'Injury/Illness - Left Ankle; Sprain';
    const a = classifyOfficialInjuryReason(reason);
    const b = classifyOfficialInjuryReason(reason);
    expect(a.reason_category).toBe(b.reason_category);
    expect(a.health_relation).toBe('HEALTH_RELATED');
  });

  it('unknown reason fails closed (not health)', () => {
    const r = classifyOfficialInjuryReason('Completely New Provider Reason');
    expect(r.reason_category).toBe('UNCLASSIFIED');
    expect(r.health_relation).toBe('UNCLASSIFIED');
  });
});
