import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  injuryIdentityNameKey,
  reorderLastCommaFirst,
} from '../injury-identity-name-key';
import {
  OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
  resolveOfficialInjuryPlayerIdentity,
  type OfficialInjuryCandidateEvidence,
} from '../official-injury-player-identity';

const FIXTURE_ROOT = path.join(
  process.cwd(),
  'tests/fixtures/official-injury-player-identity'
);

type FixtureFile = {
  fixture_id: string;
  kind: string;
  split: string;
  category: string;
  input: {
    game_id: string;
    team_id: string;
    game_date_et: string;
    player_name_raw: string;
    name_key: string;
  };
  evidence: OfficialInjuryCandidateEvidence & {
    suffix_collision_peer?: { name_key: string };
    servingPlayerId?: string | null;
  };
  expected: {
    resolution_status: string;
    player_entity_id: string | null;
    serving_player_id: string | null;
    confidence_class: string | null;
    provenance_category: string | null;
    independent_source_count: number;
    quarantine_reason: string | null;
    name_key_must_equal?: string;
    name_key_must_not_equal_peer?: string;
  };
};

function loadSplit(split: 'development' | 'held_out' | 'synthetic'): FixtureFile[] {
  const dir = path.join(FIXTURE_ROOT, split);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as FixtureFile);
}

function evidenceFromFixture(fx: FixtureFile): OfficialInjuryCandidateEvidence {
  return {
    u2: fx.evidence.u2,
    u4Nba: fx.evidence.u4Nba,
    u4Inferred: fx.evidence.u4Inferred,
    servingPlayerId: fx.evidence.servingPlayerId ?? null,
  };
}

function assertFixture(fx: FixtureFile) {
  const nameKey = injuryIdentityNameKey(fx.input.player_name_raw);
  expect(nameKey).toBe(fx.input.name_key);

  if (fx.expected.name_key_must_equal) {
    expect(nameKey).toBe(fx.expected.name_key_must_equal);
  }
  if (fx.expected.name_key_must_not_equal_peer) {
    expect(nameKey).not.toBe(fx.expected.name_key_must_not_equal_peer);
  }

  const result = resolveOfficialInjuryPlayerIdentity(
    {
      gameId: fx.input.game_id,
      teamId: fx.input.team_id,
      gameDateEt: fx.input.game_date_et,
      playerNameRaw: fx.input.player_name_raw,
    },
    evidenceFromFixture(fx)
  );

  expect(result.resolverVersion).toBe(OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION);
  expect(result.nameKey).toBe(fx.input.name_key);
  expect(result.resolutionStatus).toBe(fx.expected.resolution_status);
  expect(result.playerEntityId).toBe(fx.expected.player_entity_id);
  expect(result.servingPlayerId).toBe(fx.expected.serving_player_id);
  expect(result.confidenceClass).toBe(fx.expected.confidence_class);
  expect(result.provenanceCategory).toBe(fx.expected.provenance_category);
  expect(result.independentSourceCount).toBe(fx.expected.independent_source_count);
  expect(result.quarantineReason).toBe(fx.expected.quarantine_reason);
}

describe('injuryIdentityNameKey', () => {
  it('reorders Butler III, Jimmy and preserves III', () => {
    expect(reorderLastCommaFirst('Butler III, Jimmy')).toBe('Jimmy Butler III');
    expect(injuryIdentityNameKey('Butler III, Jimmy')).toBe('jimmy butler iii');
  });

  it('keeps Gary Payton and Gary Payton II distinct', () => {
    expect(injuryIdentityNameKey('Payton, Gary')).toBe('gary payton');
    expect(injuryIdentityNameKey('Payton II, Gary')).toBe('gary payton ii');
    expect(injuryIdentityNameKey('Gary Payton')).not.toBe(
      injuryIdentityNameKey('Gary Payton II')
    );
  });

  it('preserves Jr. / Sr. / II / III / IV', () => {
    expect(injuryIdentityNameKey('Porter Jr., Michael')).toBe('michael porter jr');
    expect(injuryIdentityNameKey('Morris Sr., Marcus')).toBe('marcus morris sr');
    expect(injuryIdentityNameKey('Towns, Karl-Anthony')).toBe('karl anthony towns');
    expect(injuryIdentityNameKey("O'Neale, Royce")).toBe('royce oneale');
  });

  it('collapses whitespace and is deterministic', () => {
    expect(injuryIdentityNameKey('  Butler   III,   Jimmy  ')).toBe('jimmy butler iii');
    expect(injuryIdentityNameKey('Butler III, Jimmy')).toBe(
      injuryIdentityNameKey('Butler III, Jimmy')
    );
  });
});

describe('official injury player identity — development fixtures', () => {
  const fixtures = loadSplit('development');
  it(`loads ${fixtures.length} development fixtures`, () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });
  for (const fx of fixtures) {
    it(`exact: ${fx.fixture_id} (${fx.category})`, () => {
      assertFixture(fx);
    });
  }
});

describe('official injury player identity — synthetic contract fixtures', () => {
  const fixtures = loadSplit('synthetic');
  it(`loads ${fixtures.length} synthetic fixtures`, () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(5);
  });
  for (const fx of fixtures) {
    it(`exact: ${fx.fixture_id} (${fx.category})`, () => {
      assertFixture(fx);
    });
  }
});

describe('held-out fixtures are not loaded by development suite', () => {
  it('does not import held_out expectations into this file’s development describe', () => {
    // Structural: this suite only calls loadSplit('development') / synthetic above.
    expect(loadSplit('development').every((f) => f.split === 'development')).toBe(
      true
    );
  });
});
