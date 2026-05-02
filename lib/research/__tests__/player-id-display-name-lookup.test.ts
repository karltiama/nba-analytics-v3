import { describe, expect, it } from 'vitest';
import {
  mergePlayerDisplayNameMaps,
  parsePlayerIdDisplayNameLookupJson,
  playerIdDisplayNameLookupS3Keys,
} from '@/lib/research/player-id-display-name-lookup';

describe('player-id-display-name-lookup', () => {
  it('parses by_player_id record', () => {
    const m = parsePlayerIdDisplayNameLookupJson({ by_player_id: { '1': 'One', '2': '  ' } });
    expect(m.get('1')).toBe('One');
    expect(m.has('2')).toBe(false);
  });

  it('aliases digit-only keys to canonical Number form for lookup', () => {
    const m = parsePlayerIdDisplayNameLookupJson({ by_player_id: { '000123': 'Leading Zero Player' } });
    expect(m.get('123')).toBe('Leading Zero Player');
  });

  it('parses byPlayerId camelCase', () => {
    const m = parsePlayerIdDisplayNameLookupJson({ byPlayerId: { '5': 'Five' } });
    expect(m.get('5')).toBe('Five');
  });

  it('parses entries with id field', () => {
    const m = parsePlayerIdDisplayNameLookupJson({
      entries: [{ id: 99, display_name: 'Ninety Nine' }],
    });
    expect(m.get('99')).toBe('Ninety Nine');
  });

  it('parses players record and entries array', () => {
    const m = parsePlayerIdDisplayNameLookupJson({
      players: { a: 'A' },
      entries: [
        { player_id: 'b', display_name: 'B' },
        { player_id: 'c', full_name: 'Cee' },
        { player_id: 'd', player_name: 'Dee' },
      ],
    });
    expect(m.get('a')).toBe('A');
    expect(m.get('b')).toBe('B');
    expect(m.get('c')).toBe('Cee');
    expect(m.get('d')).toBe('Dee');
  });

  it('mergePlayerDisplayNameMaps lets later maps override earlier keys', () => {
    const a = new Map([['x', 'first']]);
    const b = new Map([['x', 'second']]);
    const m = mergePlayerDisplayNameMaps([a, b]);
    expect(m.get('x')).toBe('second');
  });

  it('mergePlayerDisplayNameMaps handles empty input', () => {
    expect(mergePlayerDisplayNameMaps([]).size).toBe(0);
  });

  it('exposes stable S3 key list for a seasons tag', () => {
    const keys = playerIdDisplayNameLookupS3Keys('2023-2024-2025');
    expect(keys.some((k) => k.includes('dimensions'))).toBe(true);
    expect(keys.some((k) => k.includes('seasons=2023-2024-2025'))).toBe(true);
  });
});
