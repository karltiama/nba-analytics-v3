import { describe, expect, it } from 'vitest';
import {
  applyQuarantineObservation,
  applyQuarantineResolution,
  quarantineNaturalKey,
} from '../player-identity-quarantine';

const baseObs = {
  provider: 'nba' as const,
  providerPlayerId: '1643412',
  sourceContext: 'BOX_SCORE' as const,
  observedAt: '2026-09-10T20:00:00.000Z',
  kind: 'UNRESOLVED' as const,
};

describe('player identity quarantine', () => {
  it('creates a row on first unresolved observation', () => {
    const row = applyQuarantineObservation(null, baseObs);
    expect(row.status).toBe('UNRESOLVED');
    expect(row.occurrenceCount).toBe(1);
    expect(row.firstSeenAt).toBe(baseObs.observedAt);
    expect(row.lastSeenAt).toBe(baseObs.observedAt);
    expect(row.resolvedPlayerEntityId).toBeNull();
  });

  it('repeat observation updates last_seen and count, preserves first_seen', () => {
    const first = applyQuarantineObservation(null, baseObs);
    const second = applyQuarantineObservation(first, {
      ...baseObs,
      observedAt: '2026-09-10T21:00:00.000Z',
      sampleGameId: 'g1',
    });
    expect(second.occurrenceCount).toBe(2);
    expect(second.firstSeenAt).toBe(baseObs.observedAt);
    expect(second.lastSeenAt).toBe('2026-09-10T21:00:00.000Z');
    expect(second.sampleGameId).toBe('g1');
  });

  it('different source context is a different natural key', () => {
    const a = quarantineNaturalKey({
      provider: 'nba',
      providerPlayerId: '1643412',
      sourceContext: 'BOX_SCORE',
    });
    const b = quarantineNaturalKey({
      provider: 'nba',
      providerPlayerId: '1643412',
      sourceContext: 'PLAYER_PROP',
    });
    expect(a).not.toBe(b);
  });

  it('conflict remains distinct and does not demote after unresolved repeats', () => {
    const conflict = applyQuarantineObservation(null, {
      ...baseObs,
      kind: 'CONFLICT',
    });
    expect(conflict.status).toBe('CONFLICT');
    const again = applyQuarantineObservation(conflict, {
      ...baseObs,
      kind: 'UNRESOLVED',
      observedAt: '2026-09-10T22:00:00.000Z',
    });
    expect(again.status).toBe('CONFLICT');
    expect(again.occurrenceCount).toBe(2);
  });

  it('later resolution marks RESOLVED without deleting audit history', () => {
    const first = applyQuarantineObservation(null, baseObs);
    const twice = applyQuarantineObservation(first, {
      ...baseObs,
      observedAt: '2026-09-10T21:00:00.000Z',
    });
    const resolved = applyQuarantineResolution(twice, {
      playerEntityId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      resolvedAt: '2026-09-11T00:00:00.000Z',
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedPlayerEntityId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(resolved.occurrenceCount).toBe(2);
    expect(resolved.firstSeenAt).toBe(baseObs.observedAt);
  });

  it('observations after resolve keep RESOLVED status', () => {
    const first = applyQuarantineObservation(null, baseObs);
    const resolved = applyQuarantineResolution(first, {
      playerEntityId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      resolvedAt: '2026-09-11T00:00:00.000Z',
    });
    const seenAgain = applyQuarantineObservation(resolved, {
      ...baseObs,
      kind: 'UNRESOLVED',
      observedAt: '2026-09-12T00:00:00.000Z',
    });
    expect(seenAgain.status).toBe('RESOLVED');
    expect(seenAgain.resolvedPlayerEntityId).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    );
    expect(seenAgain.occurrenceCount).toBe(2);
  });
});
