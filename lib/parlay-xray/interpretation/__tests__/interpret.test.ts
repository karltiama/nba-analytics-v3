import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { interpretXrayLeg, marketPositionKind, summarizeInterpretations } from '../interpret';
import { buildAjayMitchellContext, cloneContext } from '../ajay-context';
import type { XRayLegContext } from '@/lib/parlay-xray/context/types';

function interpretSrc(): string {
  return readFileSync(join(__dirname, '../interpret.ts'), 'utf8');
}

describe('interpretXrayLeg Ajay Mitchell', () => {
  it('interprets the certified X3C packet without outcomes or probabilities', () => {
    const read = interpretXrayLeg(buildAjayMitchellContext());
    expect(read.identity.playerDisplayName).toBe('Ajay Mitchell');
    expect(read.identity.line).toBe(11.5);
    expect(read.marketPosition.kind).toBe('BETTER_NUMBER_THAN_CLOSE');
    expect(read.marketPosition.threeHourLine).toBe(11.5);
    expect(read.marketPosition.closeLine).toBe(12.5);
    expect(read.recentForm.seasonAverage).toBe(14);
    expect(read.recentForm.last10Average).toBe(13.5);
    expect(read.recentForm.above).toBe(6);
    expect(read.recentForm.below).toBe(4);
    expect(read.recentForm.lineRead).toBe('ABOVE_MORE_OFTEN_THAN_BELOW');
    expect(read.role.priorGameMinutes).toBe(36);
    expect(read.role.seasonMinutes).toBe(26.2);
    expect(read.summaryState).toBe('SUPPORTIVE_CONTEXT');
    expect(read.supportingContext.some((row) => row.code === 'MARKET_BETTER_NUMBER_THAN_CLOSE')).toBe(true);
    expect(read.supportingContext.some((row) => row.code === 'FORM_ABOVE_LINE_MORE_OFTEN')).toBe(true);
    expect(read.uncertainties.map((row) => row.code)).toEqual(
      expect.arrayContaining(['NO_AS_OF_SAFE_WOWY', 'NO_ARCHIVED_PROJECTION', 'NO_HISTORICAL_AVAILABILITY'])
    );
    expect(read.whyItCouldFail.some((row) => row.detail.includes('4 of his previous 10'))).toBe(true);
    expect(JSON.stringify(read)).not.toMatch(/60%|probability|lock|take the Over|final points|hit rate tonight/i);
  });
});

describe('market position symmetry', () => {
  it('treats Over below close as a better number and Under above close as a better number', () => {
    expect(marketPositionKind('over', 11.5, 12.5)).toBe('BETTER_NUMBER_THAN_CLOSE');
    expect(marketPositionKind('under', 12.5, 11.5)).toBe('BETTER_NUMBER_THAN_CLOSE');
    expect(marketPositionKind('over', 12.5, 11.5)).toBe('WORSE_NUMBER_THAN_CLOSE');
    expect(marketPositionKind('under', 11.5, 12.5)).toBe('WORSE_NUMBER_THAN_CLOSE');
    expect(marketPositionKind('over', 11.5, 11.5)).toBe('SAME_AS_CLOSE');
    expect(marketPositionKind('under', 11.5, 11.5)).toBe('SAME_AS_CLOSE');
    expect(marketPositionKind('over', 11.5, null)).toBe('UNKNOWN');
  });

  it('interprets an Under that captured above Decision Close as a better number', () => {
    const ctx = cloneContext(buildAjayMitchellContext());
    ctx.identity.side = 'under';
    ctx.identity.line = 12.5;
    ctx.market.requestedLine = 12.5;
    ctx.market.closeLine = 11.5;
    const read = interpretXrayLeg(ctx);
    expect(read.marketPosition.kind).toBe('BETTER_NUMBER_THAN_CLOSE');
    expect(read.supportingContext.some((row) => row.code === 'MARKET_BETTER_NUMBER_THAN_CLOSE')).toBe(true);
    expect(read.supportingContext[0]?.detail).toMatch(/1(\.0)? above/);
  });

  it('classifies the same line at close without inventing movement', () => {
    const ctx = cloneContext(buildAjayMitchellContext());
    ctx.identity.line = 12.5;
    ctx.market.requestedLine = 12.5;
    ctx.market.closeLine = 12.5;
    const read = interpretXrayLeg(ctx);
    expect(read.marketPosition.kind).toBe('SAME_AS_CLOSE');
    expect(read.supportingContext.some((row) => row.code === 'MARKET_BETTER_NUMBER_THAN_CLOSE')).toBe(false);
    expect(read.counterContext.some((row) => row.code === 'MARKET_WORSE_NUMBER_THAN_CLOSE')).toBe(false);
  });

  it('classifies worse-than-close Overs as countersignals', () => {
    const ctx = cloneContext(buildAjayMitchellContext());
    ctx.identity.line = 13.5;
    ctx.market.requestedLine = 13.5;
    ctx.market.closeLine = 12.5;
    const read = interpretXrayLeg(ctx);
    expect(read.marketPosition.kind).toBe('WORSE_NUMBER_THAN_CLOSE');
    expect(read.counterContext.some((row) => row.code === 'MARKET_WORSE_NUMBER_THAN_CLOSE')).toBe(true);
  });

  it('keeps missing close as UNKNOWN without inventing a number', () => {
    const ctx = cloneContext(buildAjayMitchellContext());
    ctx.market.closeLine = null;
    ctx.market.closeOdds = null;
    ctx.market.snapshotAvailable.decisionClose = false;
    const read = interpretXrayLeg(ctx);
    expect(read.marketPosition.kind).toBe('UNKNOWN');
    expect(read.uncertainties.some((row) => row.code === 'MARKET_CLOSE_UNKNOWN')).toBe(true);
  });

  it('records a partial historical market match as an uncertainty', () => {
    const ctx = cloneContext(buildAjayMitchellContext());
    ctx.market.status = 'LIMITED';
    ctx.market.matchStatus = 'PARTIAL_MATCH';
    ctx.market.reason = 'BOOK_UNAVAILABLE';
    ctx.market.matchedBook = null;
    const read = interpretXrayLeg(ctx);
    expect(read.uncertainties.some((row) => row.code === 'MARKET_BOOK_UNAVAILABLE')).toBe(true);
    expect(read.whyItCouldFail.some((row) => row.code === 'MARKET_BOOK_UNAVAILABLE')).toBe(true);
  });
});

describe('recent form', () => {
  function formContext(partial: Partial<XRayLegContext['playerForm']['lineRelative']> & { games?: number }): XRayLegContext {
    const ctx = cloneContext(buildAjayMitchellContext());
    ctx.playerForm.lineRelative = {
      sampleCount: partial.sampleCount ?? 10,
      aboveRequestedLine: partial.aboveRequestedLine ?? 0,
      belowRequestedLine: partial.belowRequestedLine ?? 0,
      equalRequestedLine: partial.equalRequestedLine ?? 0,
    };
    if (partial.games != null) ctx.playerForm.seasonToDate.gameCount = partial.games;
    return ctx;
  }

  it('reads mostly above / mostly below / even split without probability', () => {
    expect(interpretXrayLeg(formContext({ sampleCount: 10, aboveRequestedLine: 8, belowRequestedLine: 2 })).recentForm.lineRead).toBe(
      'ABOVE_MORE_OFTEN_THAN_BELOW'
    );
    expect(interpretXrayLeg(formContext({ sampleCount: 10, aboveRequestedLine: 2, belowRequestedLine: 8 })).recentForm.lineRead).toBe(
      'BELOW_MORE_OFTEN_THAN_ABOVE'
    );
    expect(interpretXrayLeg(formContext({ sampleCount: 10, aboveRequestedLine: 5, belowRequestedLine: 5 })).recentForm.lineRead).toBe(
      'EVEN_SPLIT'
    );
    expect(JSON.stringify(interpretXrayLeg(formContext({ sampleCount: 10, aboveRequestedLine: 8, belowRequestedLine: 2 })))).not.toMatch(
      /80%|probability/
    );
  });

  it('marks small and zero samples', () => {
    expect(interpretXrayLeg(formContext({ sampleCount: 3, aboveRequestedLine: 2, belowRequestedLine: 1 })).recentForm.sampleBand).toBe(
      'SMALL_SAMPLE'
    );
    const ctx = cloneContext(buildAjayMitchellContext());
    ctx.playerForm.seasonToDate = { gameCount: 0, average: null };
    ctx.playerForm.last5 = { gameCount: 0, average: null };
    ctx.playerForm.last10 = { gameCount: 0, average: null };
    ctx.playerForm.lineRelative = { sampleCount: 0, aboveRequestedLine: 0, belowRequestedLine: 0, equalRequestedLine: 0 };
    ctx.playerForm.status = 'UNAVAILABLE';
    const read = interpretXrayLeg(ctx);
    expect(read.recentForm.sampleBand).toBe('ZERO');
    expect(read.summaryState).toBe('LIMITED_DATA');
  });

  it('keeps combo-market form independent from market coverage', () => {
    const ctx = cloneContext(buildAjayMitchellContext());
    ctx.identity.market = 'rebounds_assists';
    ctx.playerForm.market = 'rebounds_assists';
    ctx.market.status = 'UNAVAILABLE';
    ctx.market.matchStatus = 'NO_MATCH';
    ctx.market.reason = 'UNSUPPORTED_MARKET';
    ctx.market.snapshotAvailable = { threeHourPreTip: false, decisionClose: false };
    ctx.market.closeLine = null;
    ctx.market.threeHourLine = null;
    const read = interpretXrayLeg(ctx);
    expect(read.identity.market).toBe('rebounds_assists');
    expect(read.recentForm.sampleCount).toBe(10);
    expect(read.dataAvailability.market).toBe('UNAVAILABLE');
    expect(read.dataAvailability.playerForm).toBe('AVAILABLE');
  });
});

describe('data gaps and determinism', () => {
  it('surfaces WOWY, projection, and availability gaps', () => {
    const read = interpretXrayLeg(buildAjayMitchellContext());
    expect(read.dataAvailability.wowy).toBe('UNAVAILABLE');
    expect(read.dataAvailability.projection).toBe('UNAVAILABLE');
    expect(read.dataAvailability.availability).toBe('UNAVAILABLE');
  });

  it('is deterministic for the same packet', () => {
    const ctx = buildAjayMitchellContext();
    expect(interpretXrayLeg(ctx)).toEqual(interpretXrayLeg(cloneContext(ctx)));
    expect(interpretXrayLeg(ctx)).toEqual(interpretXrayLeg(ctx));
  });

  it('does not change when unused outcome-like keys are added beside the packet', () => {
    const ctx = buildAjayMitchellContext();
    const before = interpretXrayLeg(ctx);
    const poisoned = { ...cloneContext(ctx), finalPoints: 44, hit: true } as XRayLegContext & {
      finalPoints: number;
      hit: boolean;
    };
    expect(interpretXrayLeg(poisoned)).toEqual(before);
  });

  it('does not query time, network, or postgres', () => {
    const src = interpretSrc();
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/from 'pg'/);
    expect(src).not.toMatch(/openai|balldontlie/i);
  });

  it('summarizes a multi-leg slip without a parlay score', () => {
    const a = interpretXrayLeg(buildAjayMitchellContext());
    const limitedCtx = cloneContext(buildAjayMitchellContext());
    limitedCtx.playerForm.lineRelative.sampleCount = 0;
    limitedCtx.playerForm.seasonToDate = { gameCount: 0, average: null };
    limitedCtx.playerForm.status = 'UNAVAILABLE';
    const b = interpretXrayLeg(limitedCtx);
    const summary = summarizeInterpretations([a, b]);
    expect(summary).toEqual({
      legCount: 2,
      fullContextCount: 1,
      limitedCount: 1,
      marketMatchCount: 2,
      partialMarketCount: 0,
    });
    expect(JSON.stringify(summary)).not.toMatch(/probability|score/);
  });
});
