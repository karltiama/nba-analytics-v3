import { describe, expect, it } from 'vitest';
import {
  NBA_TEAM_LOGOS,
  getNbaTeamLogoSrc,
  getNbaTeamName,
  resolveNbaTeamAbbreviation,
} from '@/lib/nba/team-logos';

const EXPECTED = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
] as const;

describe('NBA team logos', () => {
  it('maps all 30 canonical abbreviations', () => {
    expect(Object.keys(NBA_TEAM_LOGOS).sort()).toEqual([...EXPECTED].sort());
  });

  it('points each team at a lowercase public SVG path', () => {
    for (const abbr of EXPECTED) {
      expect(NBA_TEAM_LOGOS[abbr]).toBe(`/nba/teams/${abbr.toLowerCase()}.svg`);
    }
  });

  it('resolves aliases used by some providers', () => {
    expect(resolveNbaTeamAbbreviation('brk')).toBe('BKN');
    expect(resolveNbaTeamAbbreviation('CHO')).toBe('CHA');
    expect(resolveNbaTeamAbbreviation('pho')).toBe('PHX');
  });

  it('returns null for unknown abbreviations', () => {
    expect(getNbaTeamLogoSrc('SEA')).toBeNull();
    expect(getNbaTeamName('FAKE')).toBeNull();
  });
});
