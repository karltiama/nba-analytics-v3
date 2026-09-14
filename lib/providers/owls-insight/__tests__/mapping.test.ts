import { describe, expect, it } from 'vitest';
import { matchOwlsGameToCourtContext, matchOwlsPlayer, normalizePersonName, normalizeTeamKey, owlsHistoryDateWindow } from '../mapping';
import { FIXTURE_COURT_CONTEXT_GAMES, FIXTURE_PLAYERS } from '../fixtures';
import type { CourtContextGame } from '../types';

describe('game identity mapping', () => {
  it('matches home, away, season, and start time', () => {
    const result = matchOwlsGameToCourtContext(
      {
        providerGameId: 'owls-fixture-event-1037995',
        season: '2023-24',
        startTime: '2023-12-25T22:00:00.000Z',
        homeTeam: 'Los Angeles Lakers',
        awayTeam: 'Boston Celtics',
        raw: {},
      },
      FIXTURE_COURT_CONTEXT_GAMES
    );
    expect(result.status).toBe('MATCHED');
    expect(result.courtContextGameId).toBe('1037995');
  });

  it('rejects ambiguous games instead of picking one', () => {
    const games: CourtContextGame[] = [
      { ...FIXTURE_COURT_CONTEXT_GAMES[0]!, courtContextGameId: 'a' },
      { ...FIXTURE_COURT_CONTEXT_GAMES[0]!, courtContextGameId: 'b' },
    ];
    const result = matchOwlsGameToCourtContext(
      {
        providerGameId: 'dup',
        season: '2023-24',
        startTime: '2023-12-25T22:00:00.000Z',
        homeTeam: 'Lakers',
        awayTeam: 'Celtics',
        raw: {},
      },
      games
    );
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.courtContextGameId).toBeNull();
    expect(result.candidates.sort()).toEqual(['a', 'b']);
  });

  it('does not auto-accept a reversed home/away pair', () => {
    const result = matchOwlsGameToCourtContext(
      {
        providerGameId: 'rev',
        season: '2023-24',
        startTime: '2023-12-25T22:00:00.000Z',
        homeTeam: 'Boston Celtics',
        awayTeam: 'Los Angeles Lakers',
        raw: {},
      },
      FIXTURE_COURT_CONTEXT_GAMES
    );
    expect(result.status).toBe('UNMATCHED');
    expect(result.reason).toContain('reversed');
  });

  it('matches date-only midnight gameDate to the same UTC calendar tip-off', () => {
    const result = matchOwlsGameToCourtContext(
      {
        providerGameId: 'nba:Boston Celtics@Los Angeles Lakers-20231225',
        season: '2023-24',
        startTime: '2023-12-25T00:00:00.000Z',
        homeTeam: 'Los Angeles Lakers',
        awayTeam: 'Boston Celtics',
        raw: {},
      },
      FIXTURE_COURT_CONTEXT_GAMES
    );
    expect(result.status).toBe('MATCHED');
    expect(result.courtContextGameId).toBe('1037995');
  });

  it('matches Owls date-only gameDate to a late-ET tip that crosses UTC midnight', () => {
    const games: CourtContextGame[] = [
      {
        courtContextGameId: '15905067',
        season: '2023',
        startTime: '2024-06-18T00:30:00.000Z',
        homeTeam: 'BOS',
        awayTeam: 'DAL',
        homeTeamName: 'Boston Celtics',
        awayTeamName: 'Dallas Mavericks',
      },
    ];
    const result = matchOwlsGameToCourtContext(
      {
        providerGameId: 'nba:Dallas Mavericks@Boston Celtics-20240617',
        season: '2023-24',
        startTime: '2024-06-17T00:00:00.000Z',
        homeTeam: 'Boston Celtics',
        awayTeam: 'Dallas Mavericks',
        raw: {},
      },
      games
    );
    expect(result.status).toBe('MATCHED');
    expect(result.courtContextGameId).toBe('15905067');
  });

  it('queries Owls history across the ET/UTC date split for late tips', () => {
    expect(owlsHistoryDateWindow('2023-12-25T22:00:00.000Z')).toEqual({
      startDate: '2023-12-25',
      endDate: '2023-12-25',
    });
    expect(owlsHistoryDateWindow('2024-06-18T00:30:00.000Z')).toEqual({
      startDate: '2024-06-17',
      endDate: '2024-06-18',
    });
  });

  it('normalizes Clippers / Lakers aliases', () => {
    expect(normalizeTeamKey('LA Clippers')).toBe('LAC');
    expect(normalizeTeamKey('Los Angeles Lakers')).toBe('LAL');
    expect(normalizeTeamKey('NY Knicks')).toBe('NYK');
  });
});

describe('player identity mapping', () => {
  it('matches unique normalized names including Jr/punctuation', () => {
    expect(normalizePersonName('LeBron James Jr.')).toBe('lebron james');
    expect(normalizePersonName("D'Angelo Russell")).toBe('dangelo russell');
    const result = matchOwlsPlayer({
      providerPlayerName: 'LeBron James Jr.',
      index: FIXTURE_PLAYERS,
    });
    expect(result.status).toBe('MATCHED');
    expect(result.courtContextPlayerId).toBe('237');
  });

  it('rejects duplicate names rather than fuzzy-accepting', () => {
    const result = matchOwlsPlayer({
      providerPlayerName: 'Jalen Johnson',
      index: FIXTURE_PLAYERS,
    });
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.courtContextPlayerId).toBeNull();
  });

  it('can disambiguate duplicate names with team context', () => {
    const result = matchOwlsPlayer({
      providerPlayerName: 'Jalen Johnson',
      teamAbbr: 'ATL',
      index: FIXTURE_PLAYERS,
    });
    expect(result.status).toBe('MATCHED');
    expect(result.courtContextPlayerId).toBe('999001');
  });
});
