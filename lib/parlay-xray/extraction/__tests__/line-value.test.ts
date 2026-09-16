import { describe, expect, it } from 'vitest';
import { recoverExtractedLine, recoverLineOnExtractedLeg, formatXrayPropLine, parseJsonLine } from '../line-value';
import { known, unknown } from '@/lib/parlay-xray/fields';

describe('recoverExtractedLine', () => {
  it('keeps an already-decimal line', () => {
    expect(recoverExtractedLine(8.5, '8.5', 'Over 8.5 Rebounds')).toEqual({
      value: 8.5,
      confirm: false,
    });
  });

  it('restores a truncated half-point from line_evidence', () => {
    expect(recoverExtractedLine(8, '8.5', 'Over 8.5 Rebounds -132')).toEqual({
      value: 8.5,
      confirm: false,
    });
  });

  it('restores a truncated half-point from the snippet when evidence is the integer', () => {
    expect(recoverExtractedLine(8, '8', 'Giannis Over 8.5 Rebounds -132')).toEqual({
      value: 8.5,
      confirm: true,
    });
  });

  it('does not invent .5 when the visible text is a whole number', () => {
    expect(recoverExtractedLine(29, '29', 'Jokic 29 PTS')).toEqual({ value: 29, confirm: false });
    expect(recoverExtractedLine(8, '8', '8 AST')).toEqual({ value: 8, confirm: false });
  });

  it('does not steal odds or a different market number', () => {
    expect(recoverExtractedLine(27, '27', 'Over 27.5 Points -113')).toEqual({
      value: 27.5,
      confirm: true,
    });
    expect(recoverExtractedLine(8, '8', 'Over 27.5 Points -132')).toEqual({
      value: 8,
      confirm: false,
    });
  });

  it('leaves the integer when both  n.5 and n-0.5 appear', () => {
    expect(recoverExtractedLine(8, '8', 'Over 8.5 and 7.5')).toEqual({ value: 8, confirm: false });
  });

  it('parses JSON string lines and comma decimals', () => {
    expect(parseJsonLine('8.5')).toBe(8.5);
    expect(parseJsonLine('8,5')).toBe(8.5);
    expect(parseJsonLine(8.5)).toBe(8.5);
  });

  it('keeps leftover Over/Under whole-number lines as-is without inventing .5', () => {
    const flagged = recoverLineOnExtractedLeg({
      id: 'leg-1',
      playerDisplayName: known('Giannis Antetokounmpo'),
      playerId: unknown(),
      nbaPlayerId: unknown(),
      teamAbbr: known('MIL'),
      opponentAbbr: known('MIA'),
      matchupLabel: known('MIL vs MIA'),
      propKind: known('rebounds'),
      propLabel: known('Rebounds'),
      side: known('over'),
      line: known(8),
      oddsAmerican: known(-132),
      sportsbookText: known('FanDuel'),
      gameDate: unknown(),
      extractionConfidence: known('high'),
      resolution: 'resolved',
      rawSnippet: 'Giannis Over 8 Rebounds',
    });
    expect(flagged.line).toEqual({ value: 8, status: 'known' });
    expect(formatXrayPropLine(8)).toBe('8');
    expect(formatXrayPropLine(8.5)).toBe('8.5');
  });
});
