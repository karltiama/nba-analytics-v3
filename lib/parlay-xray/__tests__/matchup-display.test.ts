import { describe, expect, it } from 'vitest';
import { known, needsConfirmation, unknown } from '../fields';
import { matchupDisplayFromLeg, parseMatchupLabel } from '../matchup-display';
import type { ExtractedParlayLeg } from '../types';

function fields(
  partial: Partial<Pick<ExtractedParlayLeg, 'teamAbbr' | 'opponentAbbr' | 'matchupLabel'>>
) {
  return {
    teamAbbr: unknown<string>(),
    opponentAbbr: unknown<string>(),
    matchupLabel: unknown<string>(),
    ...partial,
  };
}

describe('parseMatchupLabel', () => {
  it('keeps @ and vs order from the screenshot label', () => {
    expect(parseMatchupLabel('BOS @ MIA')).toEqual({ left: 'BOS', right: 'MIA', separator: '@' });
    expect(parseMatchupLabel('DEN vs DAL')).toEqual({ left: 'DEN', right: 'DAL', separator: 'vs' });
  });

  it('canonicalizes provider aliases and rejects junk', () => {
    expect(parseMatchupLabel('GS @ LAL')).toEqual({ left: 'GSW', right: 'LAL', separator: '@' });
    expect(parseMatchupLabel('foo vs bar')).toBeNull();
    expect(parseMatchupLabel('BOS @ BOS')).toBeNull();
    expect(parseMatchupLabel(null)).toBeNull();
  });
});

describe('matchupDisplayFromLeg', () => {
  it('prefers matchup label order over player team vs opponent', () => {
    expect(
      matchupDisplayFromLeg(
        fields({
          teamAbbr: known('MIA'),
          opponentAbbr: known('BOS'),
          matchupLabel: known('BOS @ MIA'),
        })
      )
    ).toEqual({ left: 'BOS', right: 'MIA', separator: '@' });
  });

  it('falls back to team vs opponent when the label is not parseable', () => {
    expect(
      matchupDisplayFromLeg(
        fields({
          teamAbbr: known('BOS'),
          opponentAbbr: known('MIA'),
          matchupLabel: unknown(),
        })
      )
    ).toEqual({ left: 'BOS', right: 'MIA', separator: 'vs' });
  });

  it('still renders logos from a needs-confirmation label and stays empty when nothing resolves', () => {
    expect(
      matchupDisplayFromLeg(fields({ matchupLabel: needsConfirmation('DAL @ DEN') }))
    ).toEqual({ left: 'DAL', right: 'DEN', separator: '@' });
    expect(matchupDisplayFromLeg(fields({ matchupLabel: known('Tonight') }))).toBeNull();
  });
});
