import { describe, expect, it } from 'vitest';
import {
  LOAD_GAMES_SQL,
  LOAD_PLAYERS_SQL,
  LOAD_TEAMS_SQL,
  assertResolutionSqlIsOutcomeFree,
} from '../load-catalog';
import { canonicalizeSportsbook } from '../sportsbook';
import { resolveTeamAbbr } from '../team';
import { TEAMS } from './fixtures';

describe('resolution safety helpers', () => {
  it('does not select scores or box logs in catalog SQL', () => {
    expect(() => assertResolutionSqlIsOutcomeFree(LOAD_PLAYERS_SQL)).not.toThrow();
    expect(() => assertResolutionSqlIsOutcomeFree(LOAD_TEAMS_SQL)).not.toThrow();
    expect(() => assertResolutionSqlIsOutcomeFree(LOAD_GAMES_SQL)).not.toThrow();
    expect(LOAD_GAMES_SQL.toLowerCase()).not.toContain('home_score');
    expect(LOAD_GAMES_SQL.toLowerCase()).not.toContain('away_score');
  });

  it('rejects SQL that would leak outcomes', () => {
    expect(() => assertResolutionSqlIsOutcomeFree('select home_score from analytics.games')).toThrow();
  });

  it('normalizes known books and leaves unknown books unresolved', () => {
    expect(canonicalizeSportsbook('DraftKings')?.vendor).toBe('draftkings');
    expect(canonicalizeSportsbook('FanDuel')?.vendor).toBe('fanduel');
    expect(canonicalizeSportsbook('BetMGM')?.vendor).toBe('betmgm');
    expect(canonicalizeSportsbook('Caesars')?.vendor).toBe('caesars');
    expect(canonicalizeSportsbook('DK')?.vendor).toBe('draftkings');
    expect(canonicalizeSportsbook('bet365')).toBeNull();
  });

  it('reuses team aliases without guessing unknown clubs', () => {
    expect(resolveTeamAbbr('Lakers', TEAMS)?.abbreviation).toBe('LAL');
    expect(resolveTeamAbbr('MIN', TEAMS)?.abbreviation).toBe('MIN');
    expect(resolveTeamAbbr('Minnesota Timberwolves', TEAMS)?.abbreviation).toBe('MIN');
    expect(resolveTeamAbbr('XYZ', TEAMS)).toBeNull();
  });
});
