import { describe, expect, it } from 'vitest';
import { lookupHeadshotIds, XRAY_HEADSHOT_MAX_NAMES } from '../headshots-lookup';
import { PLAYERS } from '../resolution/__tests__/fixtures';

describe('lookupHeadshotIds', () => {
  it('returns NBA ids only for unique exact catalog matches', () => {
    expect(lookupHeadshotIds(['Nikola Jokic', 'Giannis Antetokounmpo'], PLAYERS)).toEqual([
      { extracted: 'Nikola Jokic', nbaPlayerId: '203999' },
      { extracted: 'Giannis Antetokounmpo', nbaPlayerId: '203507' },
    ]);
  });

  it('does not guess OCR misspellings or ambiguous initials', () => {
    expect(lookupHeadshotIds(['Jockic', 'J. Williams'], PLAYERS)).toEqual([
      { extracted: 'Jockic', nbaPlayerId: null },
      { extracted: 'J. Williams', nbaPlayerId: null },
    ]);
  });

  it('dedupes names case-insensitively and caps the lookup', () => {
    const names = ['Nikola Jokic', 'nikola jokic', ...Array.from({ length: 25 }, (_, i) => `Player ${i}`)];
    const rows = lookupHeadshotIds(names, PLAYERS);
    expect(rows[0]).toEqual({ extracted: 'Nikola Jokic', nbaPlayerId: '203999' });
    expect(rows.filter((row) => row.extracted.toLowerCase() === 'nikola jokic')).toHaveLength(1);
    expect(rows).toHaveLength(XRAY_HEADSHOT_MAX_NAMES);
  });
});
