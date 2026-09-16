import { describe, expect, it } from 'vitest';
import { mapVisionOutput, resultFromLegs } from '../map-legs';
import { sampleVision } from './fixtures';

describe('xray vision → ExtractedParlayLeg', () => {
  it('never fills canonical player ids from OCR text', () => {
    const legs = mapVisionOutput(sampleVision(), () => 'leg-1');
    expect(legs).toHaveLength(1);
    expect(legs[0]?.playerDisplayName).toEqual({ value: 'Luka Doncic', status: 'known' });
    expect(legs[0]?.playerId).toEqual({ value: null, status: 'unknown' });
    expect(legs[0]?.nbaPlayerId).toEqual({ value: null, status: 'unknown' });
    expect(legs[0]?.resolution).toBe('resolved');
    expect(resultFromLegs(legs, 'good')).toBe('SUCCESS');
  });

  it('keeps ambiguous names as needs_confirmation and returns PARTIAL/NEEDS_CONFIRMATION rather than dropping the slip', () => {
    const mixed = sampleVision({
      legs: [
        {
          player_name: 'L. Doncic',
          player_name_confidence: 'low',
          team_abbr: 'DAL',
          opponent_abbr: null,
          matchup_label: null,
          prop_kind: 'assists',
          side: 'over',
          line: 7.5,
          odds_american: null,
          sportsbook: null,
          game_date: null,
          field_confidence: 'low',
          raw_snippet: 'L. Doncic O 7.5 AST',
          player_evidence: 'L. Doncic',
          market_evidence: 'AST',
          side_evidence: 'O',
          line_evidence: '7.5',
          odds_evidence: null,
        },
        {
          player_name: null,
          player_name_confidence: null,
          team_abbr: null,
          opponent_abbr: null,
          matchup_label: null,
          prop_kind: 'points',
          side: 'over',
          line: 24.5,
          odds_american: null,
          sportsbook: null,
          game_date: null,
          field_confidence: 'medium',
          raw_snippet: 'O 24.5 PTS',
          player_evidence: null,
          market_evidence: 'PTS',
          side_evidence: 'O',
          line_evidence: '24.5',
          odds_evidence: null,
        },
      ],
    });
    const legs = mapVisionOutput(mixed, () => 'x');
    expect(legs[0]?.resolution).toBe('needs_confirmation');
    expect(legs[1]?.resolution).toBe('unresolved');
    expect(resultFromLegs(legs, 'good')).toBe('PARTIAL');
  });
});
