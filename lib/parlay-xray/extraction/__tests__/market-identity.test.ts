import { describe, expect, it } from 'vitest';
import { applyXrayExtractionContract } from '../document-contract';
import { marketKindsFromText, propKindFromEvidence, resolveLegMarket } from '../market-identity';
import { sampleVision, sampleVisionLeg } from './fixtures';
import type { XrayPropKind } from '@/lib/parlay-xray/types';

function ids(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `leg-${n}`;
  };
}

function samePlayerLegs(
  rows: Array<{
    market: string;
    kind: XrayPropKind;
    line: number;
    snippet: string;
  }>
) {
  return rows.map((row) =>
    sampleVisionLeg({
      player_name: 'Giannis Antetokounmpo',
      player_evidence: 'Giannis Antetokounmpo',
      prop_kind: row.kind,
      market_evidence: row.market,
      side: 'over',
      side_evidence: 'Over',
      line: row.line,
      line_evidence: String(row.line),
      raw_snippet: row.snippet,
    })
  );
}

function extractKinds(rows: Array<{ market: string; kind: XrayPropKind; line: number; snippet: string }>) {
  const contracted = applyXrayExtractionContract(sampleVision({ legs: samePlayerLegs(rows) }), ids());
  if (!contracted.ok) throw new Error('expected ok contract');
  return {
    result: contracted.result,
    kinds: contracted.legs.map((leg) => ({ value: leg.propKind.value, status: leg.propKind.status })),
  };
}

describe('market alias normalization', () => {
  it('maps unambiguous aliases without collapsing REB into AST or PTS', () => {
    expect(propKindFromEvidence('Points')).toBe('points');
    expect(propKindFromEvidence('PTS')).toBe('points');
    expect(propKindFromEvidence('player points')).toBe('points');
    expect(propKindFromEvidence('Rebounds')).toBe('rebounds');
    expect(propKindFromEvidence('REB')).toBe('rebounds');
    expect(propKindFromEvidence('rebs')).toBe('rebounds');
    expect(propKindFromEvidence('player rebounds')).toBe('rebounds');
    expect(propKindFromEvidence('Assists')).toBe('assists');
    expect(propKindFromEvidence('AST')).toBe('assists');
    expect(propKindFromEvidence('asts')).toBe('assists');
    expect(propKindFromEvidence('player assists')).toBe('assists');
    expect(propKindFromEvidence('3-Pointers Made')).toBe('threes');
    expect(propKindFromEvidence('3PM')).toBe('threes');
    expect(propKindFromEvidence('Threes')).toBe('threes');
    expect(propKindFromEvidence('three pointers made')).toBe('threes');
    expect(propKindFromEvidence('PRA')).toBe('points_rebounds_assists');
    expect(marketKindsFromText('Over 8.5 Rebounds')).toEqual(new Set(['rebounds']));
    expect(marketKindsFromText('Over 8.5 Assists')).toEqual(new Set(['assists']));
    expect(propKindFromEvidence('Over 8.5 Rebounds')).toBe('rebounds');
    expect(propKindFromEvidence('Rebounds')).not.toBe('assists');
    expect(propKindFromEvidence('REB')).not.toBe('assists');
    expect(propKindFromEvidence('AST')).not.toBe('rebounds');
    expect(propKindFromEvidence('8.5')).toBeNull();
  });

  it('does not treat a bare 3 in a line as threes', () => {
    expect(propKindFromEvidence('Over 13.5 Rebounds')).toBe('rebounds');
    expect(propKindFromEvidence('Over 3.5 Assists')).toBe('assists');
  });
});

describe('same-player market identity matrix', () => {
  it('A: Points then Rebounds stay independent', () => {
    const got = extractKinds([
      { market: 'Points', kind: 'points', line: 27.5, snippet: 'Giannis Over 27.5 Points' },
      { market: 'Rebounds', kind: 'rebounds', line: 8.5, snippet: 'Giannis Over 8.5 Rebounds' },
    ]);
    expect(got.kinds).toEqual([
      { value: 'points', status: 'known' },
      { value: 'rebounds', status: 'known' },
    ]);
    expect(got.result).toBe('SUCCESS');
  });

  it('A reversed: Rebounds then Points', () => {
    const got = extractKinds([
      { market: 'REB', kind: 'rebounds', line: 8.5, snippet: 'Giannis Over 8.5 Rebounds' },
      { market: 'PTS', kind: 'points', line: 27.5, snippet: 'Giannis Over 27.5 Points' },
    ]);
    expect(got.kinds.map((k) => k.value)).toEqual(['rebounds', 'points']);
  });

  it('B: Rebounds then Assists stay independent', () => {
    const got = extractKinds([
      { market: 'Rebounds', kind: 'rebounds', line: 8.5, snippet: 'Giannis Over 8.5 Rebounds' },
      { market: 'Assists', kind: 'assists', line: 6.5, snippet: 'Giannis Over 6.5 Assists' },
    ]);
    expect(got.kinds.map((k) => k.value)).toEqual(['rebounds', 'assists']);
  });

  it('B reversed: Assists then Rebounds', () => {
    const got = extractKinds([
      { market: 'AST', kind: 'assists', line: 6.5, snippet: 'Giannis Over 6.5 Assists' },
      { market: 'REB', kind: 'rebounds', line: 8.5, snippet: 'Giannis Over 8.5 Rebounds' },
    ]);
    expect(got.kinds.map((k) => k.value)).toEqual(['assists', 'rebounds']);
  });

  it('C: Points + Rebounds + Assists', () => {
    const got = extractKinds([
      { market: 'Points', kind: 'points', line: 29.5, snippet: 'Giannis Over 29.5 Points' },
      { market: 'Rebounds', kind: 'rebounds', line: 8.5, snippet: 'Giannis Over 8.5 Rebounds' },
      { market: 'Assists', kind: 'assists', line: 6.5, snippet: 'Giannis Over 6.5 Assists' },
    ]);
    expect(got.kinds.map((k) => k.value)).toEqual(['points', 'rebounds', 'assists']);
    expect(got.result).toBe('SUCCESS');
  });

  it('D: same player Rebounds twice stays rebounds', () => {
    const got = extractKinds([
      { market: 'Rebounds', kind: 'rebounds', line: 8.5, snippet: 'Giannis Over 8.5 Rebounds' },
      { market: 'REB', kind: 'rebounds', line: 10.5, snippet: 'Giannis Over 10.5 Rebounds' },
    ]);
    expect(got.kinds.map((k) => k.value)).toEqual(['rebounds', 'rebounds']);
  });

  it('E: 3PM then Assists', () => {
    const got = extractKinds([
      { market: '3PM', kind: 'threes', line: 2.5, snippet: 'Giannis Over 2.5 3-Pointers Made' },
      { market: 'Assists', kind: 'assists', line: 6.5, snippet: 'Giannis Over 6.5 Assists' },
    ]);
    expect(got.kinds.map((k) => k.value)).toEqual(['threes', 'assists']);
  });
});

describe('evidence / model market mismatch', () => {
  it('does not keep known assists when evidence says Rebounds (real A2 class)', () => {
    const resolved = resolveLegMarket({
      prop_kind: 'assists',
      market_evidence: 'Rebounds',
      raw_snippet: 'Giannis Over 8.5 Rebounds -132',
      field_confidence: 'high',
    });
    expect(resolved.propKind.value).toBe('rebounds');
    expect(resolved.propKind.status).not.toBe('known');
    expect(resolved.propKind).toEqual({ value: 'rebounds', status: 'needs_confirmation' });
  });

  it('does not keep known rebounds when evidence says Assists', () => {
    const resolved = resolveLegMarket({
      prop_kind: 'rebounds',
      market_evidence: 'Assists',
      raw_snippet: 'Giannis Over 6.5 Assists',
      field_confidence: 'high',
    });
    expect(resolved.propKind.value).toBe('assists');
    expect(resolved.propKind.status).toBe('needs_confirmation');
  });

  it('does not keep known points when evidence says REB', () => {
    const resolved = resolveLegMarket({
      prop_kind: 'points',
      market_evidence: 'REB',
      raw_snippet: 'Giannis Over 8.5 Rebounds',
      field_confidence: 'high',
    });
    expect(resolved.propKind.value).toBe('rebounds');
    expect(resolved.propKind.status).not.toBe('known');
  });

  it('downgrades when market_evidence and this-leg snippet disagree', () => {
    const resolved = resolveLegMarket({
      prop_kind: 'assists',
      market_evidence: 'AST',
      raw_snippet: 'Giannis Over 8.5 Rebounds -132',
      field_confidence: 'high',
    });
    expect(resolved.propKind.status).toBe('unknown');
    expect(resolved.propKind.value).toBeNull();
  });

  it('leaves an ambiguous market unknown instead of guessing', () => {
    const resolved = resolveLegMarket({
      prop_kind: 'assists',
      market_evidence: 'Over 8.5',
      raw_snippet: 'Giannis Over 8.5',
      field_confidence: 'high',
    });
    expect(resolved.propKind.status).toBe('unknown');
    expect(resolved.propKind.value).toBeNull();
  });

  it('maps a mismatched provider payload to NEEDS_CONFIRMATION rather than SUCCESS with known wrong market', () => {
    const contracted = applyXrayExtractionContract(
      sampleVision({
        legs: [
          sampleVisionLeg({
            player_name: 'Giannis Antetokounmpo',
            player_evidence: 'Giannis Antetokounmpo',
            prop_kind: 'points',
            market_evidence: 'Points',
            line: 27.5,
            line_evidence: '27.5',
            raw_snippet: 'Giannis Over 27.5 Points',
          }),
          sampleVisionLeg({
            player_name: 'Giannis Antetokounmpo',
            player_evidence: 'Giannis Antetokounmpo',
            prop_kind: 'assists',
            market_evidence: 'Rebounds',
            line: 8.5,
            line_evidence: '8.5',
            odds_american: -132,
            odds_evidence: '-132',
            raw_snippet: 'Giannis Over 8.5 Rebounds -132',
          }),
        ],
      }),
      ids()
    );
    expect(contracted.ok).toBe(true);
    if (!contracted.ok) return;
    expect(contracted.legs[1]?.propKind.value).toBe('rebounds');
    expect(contracted.legs[1]?.propKind.status).toBe('needs_confirmation');
    expect(contracted.result).toBe('NEEDS_CONFIRMATION');
  });
});
