import { describe, expect, it } from 'vitest';
import { resolvePlayerIdentityFromName } from '../player';
import { PLAYERS } from './fixtures';

describe('resolvePlayerIdentityFromName', () => {
  it('resolves an exact unique full name', () => {
    const r = resolvePlayerIdentityFromName('Nikola Jokic', PLAYERS);
    expect(r.status).toBe('RESOLVED');
    expect(r.value?.displayName).toBe('Nikola Jokic');
    expect(r.value?.playerId).toBe('203999');
    expect(r.extracted).toBe('Nikola Jokic');
  });

  it('keeps Jockic as extracted text and only proposes Jokic for confirmation', () => {
    const r = resolvePlayerIdentityFromName('Jockic', PLAYERS);
    expect(r.status).toBe('NEEDS_CONFIRMATION');
    expect(r.extracted).toBe('Jockic');
    expect(r.candidates).toEqual([
      expect.objectContaining({ displayName: 'Nikola Jokic', playerId: '203999' }),
    ]);
    expect(r.reason).toBe('FUZZY_LAST_NAME');
  });

  it('does not auto-resolve initials when multiple surnames match', () => {
    const r = resolvePlayerIdentityFromName('J. Williams', PLAYERS);
    expect(r.status).toBe('NEEDS_CONFIRMATION');
    expect(r.value).toBeNull();
    expect(r.candidates.map((c) => c.displayName).sort()).toEqual(['Jalen Williams', 'Jaylin Williams']);
  });

  it('does not pick a famous player for a common surname', () => {
    const r = resolvePlayerIdentityFromName('Williams', PLAYERS);
    expect(r.status).toBe('NEEDS_CONFIRMATION');
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.value).toBeNull();
  });

  it('returns unmatched when no player exists', () => {
    const r = resolvePlayerIdentityFromName('Zzyzx Quark', PLAYERS);
    expect(r.status).toBe('UNRESOLVED');
    expect(r.candidates).toEqual([]);
    expect(r.reason).toBe('NO_PLAYER');
  });

  it('resolves a unique exact last name', () => {
    const r = resolvePlayerIdentityFromName('Antetokounmpo', PLAYERS);
    expect(r.status).toBe('RESOLVED');
    expect(r.value?.displayName).toBe('Giannis Antetokounmpo');
  });
});
