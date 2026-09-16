import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpretXrayLeg } from '../interpret';
import { buildAjayMitchellContext, cloneContext } from '../ajay-context';
import { interpretXrayParlay } from '../parlay';
import { buildHistoricalParlayInterpretations } from '../parlay-fixture';
import type { XRayLegInterpretation } from '../types';

function cloneInterp(leg: XRayLegInterpretation): XRayLegInterpretation {
  return JSON.parse(JSON.stringify(leg)) as XRayLegInterpretation;
}

function ajay(): XRayLegInterpretation {
  return interpretXrayLeg(buildAjayMitchellContext());
}

function independentSecond(): XRayLegInterpretation {
  const ctx = cloneContext(buildAjayMitchellContext());
  ctx.identity.playerDisplayName = 'Jayson Tatum';
  ctx.identity.playerId = 'fixture-tatum';
  ctx.identity.gameId = '99900001';
  ctx.identity.teamAbbr = 'BOS';
  ctx.identity.opponentAbbr = 'NYK';
  ctx.identity.originalLeg.id = 'leg-tatum';
  ctx.identity.originalLeg.playerDisplayName = { value: 'Jayson Tatum', status: 'known' };
  ctx.identity.originalLeg.teamAbbr = { value: 'BOS', status: 'known' };
  ctx.identity.originalLeg.opponentAbbr = { value: 'NYK', status: 'known' };
  return interpretXrayLeg(ctx);
}

describe('interpretXrayParlay', () => {
  it('treats independent legs as well covered without shared-game groups', () => {
    const read = interpretXrayParlay([ajay(), independentSecond()]);
    expect(read.legCount).toBe(2);
    expect(read.dependencyGroups.some((g) => g.kind === 'SHARED_GAME' || g.kind === 'SHARED_PLAYER')).toBe(false);
    expect(read.summaryState).toBe('WELL_COVERED');
    expect(JSON.stringify(read)).not.toMatch(/correlat|probability|lock|win%/i);
  });

  it('groups two markets for the same player', () => {
    const second = cloneInterp(ajay());
    second.identity.market = 'assists';
    second.identity.line = 3.5;
    const read = interpretXrayParlay([ajay(), second]);
    const player = read.dependencyGroups.find((g) => g.kind === 'SHARED_PLAYER');
    expect(player?.legIndexes).toEqual([0, 1]);
    expect(player?.detail).toMatch(/Ajay Mitchell/);
    expect(read.whyThisParlayCouldFail.some((row) => row.code === 'PARLAY_SHARED_PLAYER')).toBe(true);
  });

  it('groups legs that share a canonical game', () => {
    const other = cloneInterp(ajay());
    other.identity.playerDisplayName = 'Luguentz Dort';
    other.identity.line = 9.5;
    const read = interpretXrayParlay([ajay(), other]);
    expect(read.dependencyGroups.some((g) => g.kind === 'SHARED_GAME' && g.legIndexes.length === 2)).toBe(true);
    expect(read.whyThisParlayCouldFail.some((row) => row.detail.includes('same game environment'))).toBe(true);
  });

  it('groups distinct players on the same team', () => {
    const other = cloneInterp(ajay());
    other.identity.playerDisplayName = 'Luguentz Dort';
    other.identity.gameId = '18447999';
    const read = interpretXrayParlay([ajay(), other]);
    expect(read.dependencyGroups.some((g) => g.kind === 'SHARED_TEAM')).toBe(true);
    expect(JSON.stringify(read)).not.toMatch(/positively correlated|negative correlation/i);
  });

  it('flags a near-duplicate same-side different line', () => {
    const other = cloneInterp(ajay());
    other.identity.line = 13.5;
    const read = interpretXrayParlay([ajay(), other]);
    expect(read.dependencyGroups.some((g) => g.kind === 'NEAR_DUPLICATE_LEG')).toBe(true);
  });

  it('flags an exact duplicate without merging legs', () => {
    const read = interpretXrayParlay([ajay(), cloneInterp(ajay())]);
    expect(read.dependencyGroups.some((g) => g.kind === 'DUPLICATE_LEG')).toBe(true);
    expect(read.legCount).toBe(2);
    expect(read.whyThisParlayCouldFail.some((row) => row.code === 'PARLAY_DUPLICATE_LEG')).toBe(true);
  });

  it('does not call overlapping Over/Under ranges a logical conflict', () => {
    const over = cloneInterp(ajay());
    over.identity.line = 27.5;
    over.identity.side = 'over';
    const under = cloneInterp(ajay());
    under.identity.line = 30.5;
    under.identity.side = 'under';
    const read = interpretXrayParlay([over, under]);
    expect(read.dependencyGroups.some((g) => g.kind === 'OPPOSITE_SIDE_SAME_MARKET')).toBe(true);
    expect(read.dependencyGroups.some((g) => g.kind === 'LOGICAL_CONFLICT')).toBe(false);
  });

  it('flags a true Over/Under logical conflict', () => {
    const over = cloneInterp(ajay());
    over.identity.line = 27.5;
    over.identity.side = 'over';
    const under = cloneInterp(ajay());
    under.identity.line = 26.5;
    under.identity.side = 'under';
    const read = interpretXrayParlay([over, under]);
    const conflict = read.dependencyGroups.find((g) => g.kind === 'LOGICAL_CONFLICT');
    expect(conflict).toBeTruthy();
    expect(conflict?.detail).toMatch(/cannot both hit/);
  });

  it('surfaces partial market match as review-needed and a parlay uncertainty', () => {
    const partial = cloneInterp(ajay());
    partial.identity.playerDisplayName = 'Luguentz Dort';
    partial.dataAvailability.market = 'LIMITED';
    const read = interpretXrayParlay([ajay(), partial]);
    expect(read.reviewNeeded.some((row) => row.flags.includes('PARTIAL_MARKET_MATCH'))).toBe(true);
    expect(read.crossLegUncertainties.some((row) => row.code === 'PARLAY_PARTIAL_MARKET')).toBe(true);
  });

  it('aggregates missing WOWY/projection/availability across all legs', () => {
    const read = interpretXrayParlay(buildHistoricalParlayInterpretations());
    expect(read.crossLegUncertainties.map((row) => row.code)).toEqual(
      expect.arrayContaining([
        'PARLAY_SHARED_GAP_WOWY',
        'PARLAY_SHARED_GAP_PROJECTION',
        'PARLAY_SHARED_GAP_AVAILABILITY',
      ])
    );
    expect(read.whyThisParlayCouldFail.some((row) => row.detail.includes('all 4 legs'))).toBe(true);
  });

  it('aggregates mixed market-position states without a score', () => {
    const read = interpretXrayParlay(buildHistoricalParlayInterpretations());
    expect(read.marketPositionCounts.betterThanClose).toBeGreaterThanOrEqual(1);
    expect(read.marketPositionCounts.worseThanClose).toBeGreaterThanOrEqual(1);
    expect(read.marketPositionCounts.unknown).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(read.marketPositionCounts)).not.toMatch(/score|probability/);
  });

  it('sets review flags without ranking strongest/weakest', () => {
    const read = interpretXrayParlay(buildHistoricalParlayInterpretations());
    expect(read.reviewNeeded.length).toBeGreaterThan(0);
    expect(read.reviewNeeded.some((row) => row.flags.includes('LIMITED_SAMPLE'))).toBe(true);
    expect(read.reviewNeeded.some((row) => row.flags.includes('COUNTERSIGNALS_PRESENT'))).toBe(true);
    expect(JSON.stringify(read)).not.toMatch(/strongest|weakest/i);
  });

  it('is deterministic for the same interpretations', () => {
    const legs = buildHistoricalParlayInterpretations();
    expect(interpretXrayParlay(legs)).toEqual(interpretXrayParlay(JSON.parse(JSON.stringify(legs))));
  });

  it('does not change when unused outcome fields sit beside unchanged interpretations', () => {
    const legs = buildHistoricalParlayInterpretations();
    const before = interpretXrayParlay(legs);
    const poisoned = legs.map((leg) => ({ ...leg, finalPoints: 44, hit: true }));
    expect(interpretXrayParlay(poisoned as typeof legs)).toEqual(before);
  });

  it('does not query time, network, postgres, or LLMs', () => {
    const src = readFileSync(join(__dirname, '../parlay.ts'), 'utf8');
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/from 'pg'/);
    expect(src).not.toMatch(/openai|balldontlie/i);
    expect(src).not.toMatch(/correlat/i);
  });

  it('interprets the four-leg historical fixture as dependency concentration', () => {
    const legs = buildHistoricalParlayInterpretations();
    expect(legs).toHaveLength(4);
    const read = interpretXrayParlay(legs);
    expect(read.summaryState).toBe('DEPENDENCY_CONCENTRATION');
    expect(read.contextCoverage.legCount).toBe(4);
    expect(read.dependencyGroups.some((g) => g.kind === 'SHARED_PLAYER')).toBe(true);
    expect(read.dependencyGroups.some((g) => g.kind === 'SHARED_GAME')).toBe(true);
    expect(read.dependencyGroups.some((g) => g.kind === 'SHARED_TEAM')).toBe(true);
    expect(read.dataQuality.wowy.have).toBe(0);
    expect(read.whyThisParlayCouldFail.length).toBeGreaterThan(1);
  });
});
