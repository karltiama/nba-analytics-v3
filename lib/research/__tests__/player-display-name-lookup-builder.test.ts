import { describe, expect, it } from 'vitest';
import { parsePlayerIdDisplayNameLookupJson } from '@/lib/research/player-id-display-name-lookup';
import {
  buildPlayerDisplayNameLookupPayload,
  normalizePlayerIdForLookup,
  trimPlayerDisplayName,
} from '@/lib/research/player-display-name-lookup-builder';

describe('normalizePlayerIdForLookup', () => {
  it('canonicalizes digit-only strings', () => {
    expect(normalizePlayerIdForLookup('000123')).toBe('123');
    expect(normalizePlayerIdForLookup('007')).toBe('7');
  });
});

describe('player-display-name-lookup-builder', () => {
  it('maps basic rows', () => {
    const payload = buildPlayerDisplayNameLookupPayload({
      source: 'player_game_features',
      generatedAt: '2026-05-01T12:00:00.000Z',
      rows: [
        { player_id: '1', player_name: 'One' },
        { player_id: '2', player_name: 'Two' },
      ],
    });
    expect(payload.by_player_id).toEqual({ '1': 'One', '2': 'Two' });
    expect(payload.entry_count).toBe(2);
    expect(payload.league).toBe('nba');
    expect(payload.source).toBe('player_game_features');
    expect(payload.generated_at).toBe('2026-05-01T12:00:00.000Z');
  });

  it('normalizes numeric and string player_id', () => {
    expect(normalizePlayerIdForLookup(12345)).toBe('12345');
    expect(normalizePlayerIdForLookup(12345.7)).toBe('12345');
    expect(normalizePlayerIdForLookup('  99  ')).toBe('99');
    expect(normalizePlayerIdForLookup(BigInt(7))).toBe('7');
    expect(normalizePlayerIdForLookup(Number.NaN)).toBeNull();
    expect(normalizePlayerIdForLookup(null)).toBeNull();
  });

  it('ignores blank names and missing ids', () => {
    const payload = buildPlayerDisplayNameLookupPayload({
      source: 'player_game_features',
      rows: [
        { player_id: '', player_name: 'X' },
        { player_id: '  ', player_name: 'Y' },
        { player_id: 'a', player_name: '' },
        { player_id: 'a', player_name: '   ' },
        { player_id: 'b', player_name: 'Ok' },
        { player_name: 'orphan' },
      ],
    });
    expect(payload.by_player_id).toEqual({ b: 'Ok' });
    expect(payload.entry_count).toBe(1);
  });

  it('ignores non-string player_name', () => {
    const payload = buildPlayerDisplayNameLookupPayload({
      source: 'x',
      rows: [
        { player_id: '1', player_name: 123 },
        { player_id: '2', player_name: 'Good' },
      ],
    });
    expect(payload.by_player_id).toEqual({ '2': 'Good' });
  });

  it('trimPlayerDisplayName returns null for blank', () => {
    expect(trimPlayerDisplayName(null)).toBeNull();
    expect(trimPlayerDisplayName('')).toBeNull();
    expect(trimPlayerDisplayName('  \t ')).toBeNull();
    expect(trimPlayerDisplayName('  A ')).toBe('A');
  });

  it('duplicate player_id: later row wins', () => {
    const payload = buildPlayerDisplayNameLookupPayload({
      source: 'player_game_features',
      rows: [
        { player_id: '1', player_name: 'First' },
        { player_id: '1', player_name: 'Second' },
      ],
    });
    expect(payload.by_player_id['1']).toBe('Second');
    expect(payload.entry_count).toBe(1);
  });

  it('empty input yields empty by_player_id and zero entry_count', () => {
    const payload = buildPlayerDisplayNameLookupPayload({ source: 'player_game_features', rows: [] });
    expect(payload.by_player_id).toEqual({});
    expect(payload.entry_count).toBe(0);
  });

  it('entry_count matches by_player_id size', () => {
    const payload = buildPlayerDisplayNameLookupPayload({
      source: 'player_game_features',
      rows: Array.from({ length: 50 }, (_, i) => ({ player_id: String(i), player_name: `N${i}` })),
    });
    expect(payload.entry_count).toBe(50);
    expect(Object.keys(payload.by_player_id)).toHaveLength(50);
  });

  it('output is compatible with parsePlayerIdDisplayNameLookupJson', () => {
    const payload = buildPlayerDisplayNameLookupPayload({
      source: 'player_game_features',
      rows: [{ player_id: '10', player_name: 'Ten' }],
    });
    const m = parsePlayerIdDisplayNameLookupJson(payload);
    expect(m.get('10')).toBe('Ten');
  });

  it('canonicalizes digit-only string ids to a single map entry', () => {
    const payload = buildPlayerDisplayNameLookupPayload({
      source: 'player_game_features',
      rows: [{ player_id: '0007', player_name: 'Seven' }],
    });
    expect(payload.by_player_id['7']).toBe('Seven');
    expect(payload.by_player_id['0007']).toBeUndefined();
    expect(payload.entry_count).toBe(1);
  });
});
