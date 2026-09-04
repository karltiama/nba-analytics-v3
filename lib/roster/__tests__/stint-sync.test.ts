import { describe, expect, it } from 'vitest';
import {
  assertSingleOpenPerPlayerSeason,
  planStintSync,
  type ExistingStint,
  type ObservedMembership,
} from '../stint-sync';

const season = '2025';
const day = '2026-09-04';
const source = 'nba_stats';

function obs(partial: Partial<ObservedMembership> & Pick<ObservedMembership, 'playerId' | 'teamId'>): ObservedMembership {
  return {
    sourcePlayerId: 'nba-1',
    jersey: '1',
    position: 'G',
    membershipType: 'standard',
    ...partial,
  };
}

describe('planStintSync', () => {
  it('opens stint for resolved roster player', () => {
    const mutations = planStintSync({
      season,
      observedOn: day,
      source,
      observations: [obs({ playerId: 'p1', teamId: 't1' })],
      existingOpenStints: [],
    });
    expect(mutations).toEqual([
      expect.objectContaining({
        type: 'open',
        playerId: 'p1',
        teamId: 't1',
        observedFrom: day,
        source,
      }),
    ]);
  });

  it('same player/team rerun touches, does not duplicate open', () => {
    const existing: ExistingStint[] = [
      {
        stintId: 10,
        playerId: 'p1',
        teamId: 't1',
        season,
        observedFrom: '2026-01-01',
        observedTo: null,
        jersey: '1',
        position: 'G',
        source,
        sourcePlayerId: 'nba-1',
      },
    ];
    const mutations = planStintSync({
      season,
      observedOn: day,
      source,
      observations: [obs({ playerId: 'p1', teamId: 't1', jersey: '7' })],
      existingOpenStints: existing,
    });
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ type: 'touch', stintId: 10, jersey: '7' });
    assertSingleOpenPerPlayerSeason(mutations, existing, season);
  });

  it('player changing teams closes old and opens new', () => {
    const existing: ExistingStint[] = [
      {
        stintId: 10,
        playerId: 'p1',
        teamId: 't1',
        season,
        observedFrom: '2026-01-01',
        observedTo: null,
        jersey: null,
        position: null,
        source,
        sourcePlayerId: 'nba-1',
      },
    ];
    const mutations = planStintSync({
      season,
      observedOn: day,
      source,
      observations: [obs({ playerId: 'p1', teamId: 't2' })],
      existingOpenStints: existing,
    });
    expect(mutations.map((m) => m.type)).toEqual(['close', 'open']);
    expect(mutations[0]).toMatchObject({ type: 'close', stintId: 10, observedTo: day });
    expect(mutations[1]).toMatchObject({ type: 'open', teamId: 't2', playerId: 'p1' });
    assertSingleOpenPerPlayerSeason(mutations, existing, season);
  });

  it('no two open stints per player/season after plan', () => {
    const existing: ExistingStint[] = [
      {
        stintId: 1,
        playerId: 'p1',
        teamId: 't1',
        season,
        observedFrom: '2026-01-01',
        observedTo: null,
        jersey: null,
        position: null,
        source,
        sourcePlayerId: null,
      },
    ];
    const mutations = planStintSync({
      season,
      observedOn: day,
      source,
      observations: [obs({ playerId: 'p1', teamId: 't2' }), obs({ playerId: 'p2', teamId: 't3' })],
      existingOpenStints: existing,
    });
    expect(() => assertSingleOpenPerPlayerSeason(mutations, existing, season)).not.toThrow();
  });

  it('closed historical stint remains outside open set (not re-opened by absence logic)', () => {
    const existing: ExistingStint[] = [
      {
        stintId: 5,
        playerId: 'p9',
        teamId: 't9',
        season,
        observedFrom: '2025-11-01',
        observedTo: '2026-02-01',
        jersey: null,
        position: null,
        source,
        sourcePlayerId: null,
      },
    ];
    const mutations = planStintSync({
      season,
      observedOn: day,
      source,
      observations: [obs({ playerId: 'p1', teamId: 't1' })],
      existingOpenStints: existing,
    });
    expect(mutations.every((m) => m.type !== 'close' || (m as { stintId: number }).stintId !== 5)).toBe(
      true
    );
    expect(mutations.some((m) => m.type === 'open' && m.playerId === 'p9')).toBe(false);
  });

  it('observation dates are explicit observed_from/to fields (not transaction labels)', () => {
    const mutations = planStintSync({
      season,
      observedOn: day,
      source,
      observations: [obs({ playerId: 'p1', teamId: 't1' })],
      existingOpenStints: [],
    });
    const open = mutations.find((m) => m.type === 'open');
    expect(open && 'observedFrom' in open && open.observedFrom).toBe(day);
    // Contract: helpers expose observation fields only — no start_date/end_date keys.
    expect(JSON.stringify(mutations)).not.toMatch(/start_date|end_date|signed_at|traded_at/);
  });

  it('absent player with open nba_stats stint is closed on snapshot', () => {
    const existing: ExistingStint[] = [
      {
        stintId: 3,
        playerId: 'gone',
        teamId: 't1',
        season,
        observedFrom: '2026-01-01',
        observedTo: null,
        jersey: null,
        position: null,
        source,
        sourcePlayerId: 'x',
      },
    ];
    const mutations = planStintSync({
      season,
      observedOn: day,
      source,
      observations: [obs({ playerId: 'p1', teamId: 't1' })],
      existingOpenStints: existing,
    });
    expect(mutations.some((m) => m.type === 'close' && m.stintId === 3)).toBe(true);
  });
});
