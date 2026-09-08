import { describe, expect, it } from 'vitest';
import { generateContextCheckFromManual, isGeneratedContextCheck } from '../generate-from-manual';

describe('generateContextCheckFromManual', () => {
  it('builds ContextCheckData without requiring sample fields in the form', () => {
    const result = generateContextCheckFromManual(
      {
        playerId: 'mock-jalen-brunson',
        marketType: 'points',
        direction: 'over',
        line: 27.5,
        contextType: 'recent_form',
      },
      { dataAsOf: '2026-09-08T16:00:00.000Z', id: 'test-manual' }
    );

    expect(isGeneratedContextCheck(result)).toBe(true);
    if (!isGeneratedContextCheck(result)) return;

    expect(result.source).toBe('manual');
    expect(result.player.name).toBe('Jalen Brunson');
    expect(result.market.line).toBe(27.5);
    expect(result.samples.map((s) => s.label)).toEqual(['L5', 'L10', 'L20', 'Season']);
    expect(result.headline.hits).toBe(5);
    expect(result.verdict.type).toBe('mixed');
    expect(result.lineContext?.currentLine).toBe(27.5);
  });

  it('attaches role context for role_change and not for roster_change', () => {
    const role = generateContextCheckFromManual({
      playerId: 'mock-tyrese-haliburton',
      marketType: 'assists',
      direction: 'over',
      line: 8.5,
      contextType: 'role_change',
    });
    const roster = generateContextCheckFromManual({
      playerId: 'mock-anthony-edwards',
      marketType: 'threes',
      direction: 'over',
      line: 3.5,
      contextType: 'roster_change',
    });

    expect(isGeneratedContextCheck(role) && role.roleContext?.recentMinutes).toBe(35.7);
    expect(isGeneratedContextCheck(roster) && roster.roleContext).toBeUndefined();
    expect(isGeneratedContextCheck(roster) && roster.verdict.type).toBe('insufficient');
  });

  it('returns an error for an unknown player id', () => {
    const result = generateContextCheckFromManual({
      playerId: 'not-a-player',
      marketType: 'points',
      direction: 'over',
      line: 20,
      contextType: 'recent_form',
    });
    expect(isGeneratedContextCheck(result)).toBe(false);
  });
});
