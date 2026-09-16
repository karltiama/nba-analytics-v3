import { describe, expect, it } from 'vitest';
import { resolveGameIdentity } from '../game';
import { CATALOG } from './fixtures';

describe('resolveGameIdentity', () => {
  it('resolves a unique game from date + matchup', () => {
    const r = resolveGameIdentity({
      games: CATALOG.games,
      teams: CATALOG.teams,
      gameDate: '2026-03-17',
      teamAbbr: 'DEN',
      opponentAbbr: 'OKC',
      matchupLabel: 'DEN vs OKC',
    });
    expect(r.status).toBe('RESOLVED');
    expect(r.value?.gameId).toBe('game-den-okc-2026-03-17');
  });

  it('leaves game unresolved when only a player/date-less matchup exists', () => {
    const r = resolveGameIdentity({
      games: CATALOG.games,
      teams: CATALOG.teams,
      gameDate: null,
      teamAbbr: 'DEN',
      opponentAbbr: 'OKC',
      matchupLabel: 'DEN vs OKC',
    });
    expect(r.status).toBe('UNRESOLVED');
    expect(r.reason).toBe('MISSING_DATE');
    expect(r.candidates).toEqual([]);
  });

  it('does not pick a game for an invalid matchup on a real date', () => {
    const r = resolveGameIdentity({
      games: CATALOG.games,
      teams: CATALOG.teams,
      context: { slateDate: '2026-03-17' },
      gameDate: null,
      teamAbbr: 'DEN',
      opponentAbbr: 'MIL',
      matchupLabel: 'DEN vs MIL',
    });
    expect(r.status).toBe('UNRESOLVED');
    expect(r.reason).toBe('NO_GAME');
  });

  it('resolves a historical stored game from an explicit as-of date', () => {
    const r = resolveGameIdentity({
      games: CATALOG.games,
      teams: CATALOG.teams,
      context: { asOfDate: '2025-04-01' },
      gameDate: null,
      teamAbbr: 'OKC',
      opponentAbbr: 'DEN',
      matchupLabel: 'OKC @ DEN',
    });
    expect(r.status).toBe('RESOLVED');
    expect(r.value?.gameId).toBe('game-den-okc-2025-04-01');
  });

  it('returns unresolved for a nonexistent date', () => {
    const r = resolveGameIdentity({
      games: CATALOG.games,
      teams: CATALOG.teams,
      context: { eventDate: '2010-01-01' },
      gameDate: null,
      teamAbbr: 'DEN',
      opponentAbbr: 'OKC',
      matchupLabel: 'DEN vs OKC',
    });
    expect(r.status).toBe('UNRESOLVED');
    expect(r.reason).toBe('NO_GAME');
  });

  it('asks for confirmation when two games share the date and matchup', () => {
    const r = resolveGameIdentity({
      games: [
        ...CATALOG.games,
        {
          gameId: 'game-den-okc-2026-03-17-b',
          startTime: '2026-03-17T23:00:00.000Z',
          homeTeamAbbr: 'OKC',
          awayTeamAbbr: 'DEN',
        },
      ],
      teams: CATALOG.teams,
      gameDate: '2026-03-17',
      teamAbbr: 'DEN',
      opponentAbbr: 'OKC',
      matchupLabel: 'DEN vs OKC',
    });
    expect(r.status).toBe('NEEDS_CONFIRMATION');
    expect(r.candidates).toHaveLength(2);
    expect(r.value).toBeNull();
  });
});
