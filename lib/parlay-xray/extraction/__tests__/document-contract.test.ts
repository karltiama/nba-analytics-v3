import { describe, expect, it } from 'vitest';
import { applyXrayExtractionContract } from '../document-contract';
import { XRAY_NON_SLIP_MESSAGE } from '../copy';
import { xrayVisionOutputSchema } from '../schema';
import { boxScoreVision, sampleVision, sampleVisionLeg } from './fixtures';

function ids(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `leg-${n}`;
  };
}

describe('xray document-type refusal', () => {
  it('refuses a box score even when the model invents Over legs (X2C F1)', () => {
    const contracted = applyXrayExtractionContract(boxScoreVision(), ids());
    expect(contracted).toEqual({
      ok: true,
      legs: [],
      result: 'NO_LEGS_FOUND',
      message: XRAY_NON_SLIP_MESSAGE,
    });
  });

  it('refuses a misclassified BET_SLIP that only cites player statistics', () => {
    const fakeSlip = sampleVision({
      document_type: 'BET_SLIP',
      wager_evidence: null,
      sportsbook: null,
      legs: [
        sampleVisionLeg({
          player_name: 'Nikola Jokic',
          prop_kind: 'points',
          side: 'over',
          line: 29,
          odds_american: null,
          sportsbook: null,
          side_evidence: null,
          line_evidence: '29',
          odds_evidence: null,
          market_evidence: 'PTS',
          raw_snippet: 'Jokic 29 PTS',
        }),
      ],
    });
    const contracted = applyXrayExtractionContract(fakeSlip, ids());
    expect(contracted.ok).toBe(true);
    if (!contracted.ok) return;
    expect(contracted.result).toBe('NO_LEGS_FOUND');
    expect(contracted.legs).toEqual([]);
    expect(contracted.message).toBe(XRAY_NON_SLIP_MESSAGE);
  });

  it('maps UNCERTAIN documents to empty NO_LEGS_FOUND without usable legs', () => {
    const contracted = applyXrayExtractionContract(
      sampleVision({
        document_type: 'UNCERTAIN',
        wager_evidence: null,
        legs: [sampleVisionLeg()],
      }),
      ids()
    );
    expect(contracted.ok).toBe(true);
    if (!contracted.ok) return;
    expect(contracted.result).toBe('NO_LEGS_FOUND');
    expect(contracted.legs).toEqual([]);
  });

  it('fails closed on malformed document_type', () => {
    expect(xrayVisionOutputSchema.safeParse({ ...sampleVision(), document_type: 'BOX_SCORE' }).success).toBe(
      false
    );
    expect(applyXrayExtractionContract({ ...sampleVision(), document_type: 'BOX_SCORE' }, ids())).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(applyXrayExtractionContract({ image_quality: 'good', sportsbook: null, legs: [] }, ids())).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('xray field identity', () => {
  it('keeps same-player multi-market legs independent (no points carry-over)', () => {
    const contracted = applyXrayExtractionContract(
      sampleVision({
        legs: [
          sampleVisionLeg({
            player_name: 'Jayson Tatum',
            player_evidence: 'Jayson Tatum',
            prop_kind: 'points',
            market_evidence: 'Points',
            side: 'over',
            side_evidence: 'Over',
            line: 27.5,
            line_evidence: '27.5',
            raw_snippet: 'Tatum Over 27.5 Points',
          }),
          sampleVisionLeg({
            player_name: 'Jayson Tatum',
            player_evidence: 'Jayson Tatum',
            prop_kind: 'rebounds',
            market_evidence: 'Rebounds',
            side: 'over',
            side_evidence: 'Over',
            line: 7.5,
            line_evidence: '7.5',
            raw_snippet: 'Tatum Over 7.5 Rebounds',
          }),
        ],
      }),
      ids()
    );
    expect(contracted.ok).toBe(true);
    if (!contracted.ok) return;
    expect(contracted.result).toBe('SUCCESS');
    expect(contracted.legs[0]?.propKind).toEqual({ value: 'points', status: 'known' });
    expect(contracted.legs[1]?.propKind).toEqual({ value: 'rebounds', status: 'known' });
  });

  it('does not default an unevidenced market to points', () => {
    const contracted = applyXrayExtractionContract(
      sampleVision({
        legs: [
          sampleVisionLeg({
            prop_kind: 'points',
            market_evidence: null,
            raw_snippet: 'Tatum Over 27.5',
          }),
        ],
      }),
      ids()
    );
    expect(contracted.ok).toBe(true);
    if (!contracted.ok) return;
    expect(contracted.legs[0]?.propKind.status).toBe('unknown');
    expect(contracted.legs[0]?.propKind.value).toBeNull();
    expect(contracted.result).not.toBe('SUCCESS');
  });

  it('preserves visible Over and Under and does not infer an absent side', () => {
    const over = applyXrayExtractionContract(
      sampleVision({
        legs: [sampleVisionLeg({ side: 'over', side_evidence: 'Over', raw_snippet: 'Over 27.5 Points' })],
      }),
      ids()
    );
    const under = applyXrayExtractionContract(
      sampleVision({
        legs: [
          sampleVisionLeg({
            side: 'under',
            side_evidence: 'Under',
            raw_snippet: 'Under 27.5 Points',
            market_evidence: 'Points',
            prop_kind: 'points',
          }),
        ],
      }),
      ids()
    );
    const ambiguous = applyXrayExtractionContract(
      sampleVision({
        legs: [
          sampleVisionLeg({
            side: 'over',
            side_evidence: null,
            raw_snippet: 'Tatum 27.5 Points -110',
            market_evidence: 'Points',
            prop_kind: 'points',
          }),
        ],
      }),
      ids()
    );
    expect(over.ok && over.legs[0]?.side).toEqual({ value: 'over', status: 'known' });
    expect(under.ok && under.legs[0]?.side).toEqual({ value: 'under', status: 'known' });
    expect(ambiguous.ok && ambiguous.legs[0]?.side).toEqual({ value: null, status: 'unknown' });
  });

  it('keeps missing odds, sportsbook, matchup, and cropped line as unknown / needs_confirmation', () => {
    const contracted = applyXrayExtractionContract(
      sampleVision({
        sportsbook: null,
        legs: [
          sampleVisionLeg({
            opponent_abbr: null,
            matchup_label: null,
            odds_american: null,
            odds_evidence: null,
            line: null,
            line_evidence: null,
            sportsbook: null,
            raw_snippet: 'Tatum Over AST',
            side_evidence: 'Over',
            market_evidence: 'AST',
          }),
        ],
      }),
      ids()
    );
    expect(contracted.ok).toBe(true);
    if (!contracted.ok) return;
    expect(contracted.legs[0]?.oddsAmerican).toEqual({ value: null, status: 'unknown' });
    expect(contracted.legs[0]?.sportsbookText).toEqual({ value: null, status: 'unknown' });
    expect(contracted.legs[0]?.matchupLabel).toEqual({ value: null, status: 'unknown' });
    expect(contracted.legs[0]?.line).toEqual({ value: null, status: 'unknown' });
    expect(contracted.result).toBe('PARTIAL');
  });

  it('does not turn promo banner text into a betting leg', () => {
    const contracted = applyXrayExtractionContract(
      sampleVision({
        legs: [
          sampleVisionLeg({ player_name: 'BOOST', player_evidence: 'BOOST', raw_snippet: 'PROFIT BOOST' }),
          sampleVisionLeg({ player_name: 'PROMO', player_evidence: 'PROMO', raw_snippet: 'SPECIAL' }),
          sampleVisionLeg({ player_name: 'POPULAR', player_evidence: 'POPULAR', raw_snippet: 'TRENDING' }),
          sampleVisionLeg(),
        ],
      }),
      ids()
    );
    expect(contracted.ok).toBe(true);
    if (!contracted.ok) return;
    expect(contracted.legs).toHaveLength(1);
    expect(contracted.legs[0]?.playerDisplayName.value).toBe('Luka Doncic');
    expect(JSON.stringify(contracted.legs)).not.toMatch(/player_evidence|market_evidence|side_evidence/);
  });
});

describe('xray result categories', () => {
  it('maps a complete slip to SUCCESS', () => {
    const contracted = applyXrayExtractionContract(sampleVision(), ids());
    expect(contracted.ok).toBe(true);
    if (!contracted.ok) return;
    expect(contracted.result).toBe('SUCCESS');
    expect(contracted.legs).toHaveLength(1);
  });

  it('maps a valid slip with uncertain fields to PARTIAL or NEEDS_CONFIRMATION', () => {
    const contracted = applyXrayExtractionContract(
      sampleVision({
        legs: [
          sampleVisionLeg({
            player_name: 'L. Doncic',
            player_name_confidence: 'low',
            field_confidence: 'low',
            opponent_abbr: null,
            matchup_label: null,
            odds_american: null,
            odds_evidence: null,
          }),
        ],
      }),
      ids()
    );
    expect(contracted.ok).toBe(true);
    if (!contracted.ok) return;
    expect(['PARTIAL', 'NEEDS_CONFIRMATION']).toContain(contracted.result);
    expect(contracted.legs).toHaveLength(1);
  });
});
