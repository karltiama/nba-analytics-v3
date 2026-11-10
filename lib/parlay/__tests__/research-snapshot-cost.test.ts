import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceTrueCost } from '@/components/parlay/WorkspaceTrueCost';
import { formatAmericanOdds } from '@/lib/betting/market-movement-format';
import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import { adaptPropsExplorerOffer } from '../adapt-props-explorer-offer';
import { handoffQuickBuild, type QuickBuildHandoffLeg } from '../adapt-quick-build';
import {
  RESEARCH_SNAPSHOT_BREAK_EVEN_COPY,
  RESEARCH_SNAPSHOT_COST_COPY,
  buildResearchSnapshotCost,
  shouldRequestCurrentParlayPrices,
} from '../research-snapshot-cost';
import type { SelectedParlayLeg } from '../selection';
import { computeParlayTrueCost, formatPercent } from '../true-cost';

const OBSERVED = '2026-11-09T21:00:00.000Z';

function handoffLeg(overrides: Partial<QuickBuildHandoffLeg> = {}): QuickBuildHandoffLeg {
  return {
    displayReady: true,
    playerId: '11',
    playerName: 'Jayson Tatum',
    gameId: 'g1',
    market: 'points',
    side: 'over',
    line: 22.5,
    sportsbook: 'draftkings',
    oddsAmerican: -115,
    observedAt: OBSERVED,
    gameStartTime: '2026-11-10T00:30:00.000Z',
    gameStatus: 'Scheduled',
    ...overrides,
  };
}

function researchPair(): SelectedParlayLeg[] {
  const result = handoffQuickBuild({
    current: [],
    legs: [handoffLeg(), handoffLeg({ playerId: '22', playerName: 'Jaylen Brown', gameId: 'g2', side: 'under', line: 8.5, oddsAmerican: -110 })],
    nowMs: Date.parse('2026-11-09T18:00:00.000Z'),
    confirmed: false,
  });
  if (result.status !== 'replaced') throw new Error(result.status);
  return result.legs;
}

function explorerLeg(marketContext: 'live' | 'historical'): SelectedParlayLeg {
  const adapted = adaptPropsExplorerOffer({
    playerId: '203999',
    playerName: 'Nikola Jokic',
    gameId: 'game-1',
    propType: 'points',
    side: 'over',
    lineValue: 27.5,
    sportsbook: 'DraftKings',
    oddsAmerican: -110,
    snapshotAt: OBSERVED,
    marketContext,
    sourceTable: marketContext === 'live' ? 'analytics.player_props_current' : 'research.prop_decision_lines',
  });
  if (!adapted.ok) throw new Error(adapted.code);
  return { offer: adapted.offer, gameLabel: 'OKC vs DEN' };
}

describe('research snapshot true cost', () => {
  it('does not request current prices and keeps the original prices', () => {
    const legs = researchPair();
    expect(shouldRequestCurrentParlayPrices(legs)).toBe(false);
    expect(shouldRequestCurrentParlayPrices([explorerLeg('live')])).toBe(true);
    expect(shouldRequestCurrentParlayPrices([explorerLeg('historical')])).toBe(true);
    expect(shouldRequestCurrentParlayPrices([])).toBe(false);
    const cost = buildResearchSnapshotCost(legs);
    const book = computeParlayTrueCost([
      { id: 'a', priceAmerican: -115, oppositeAmerican: null },
      { id: 'b', priceAmerican: -110, oppositeAmerican: null },
    ]).book;
    expect(book.status).toBe('known');
    if (book.status !== 'known') return;
    expect(cost.combinedOddsLabel).toBe(formatAmericanOdds(combinedAmericanOdds([-115, -110])));
    expect(cost.combinedOddsLabel).toBe(formatAmericanOdds(book.american));
    expect(cost.breakEvenLabel).toBe(formatPercent(book.breakEvenHitRate));
    expect(cost.legs.map((row) => row.oddsLabel)).toEqual(['-115', '-110']);
    expect(cost.legs[0]?.observedLabel).toBe('Nov 9, 4:00 PM EST');
    expect(JSON.stringify(cost)).not.toMatch(/house edge|fair|best book/i);
  });

  it('renders the snapshot disclosure and withholds current-quote comparisons', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceTrueCost, { legs: researchPair() }));
    expect(html).toContain('Research Snapshot');
    expect(html).toContain('Original observed price -115');
    expect(html).toContain('Original observed price -110');
    expect(html).toContain(RESEARCH_SNAPSHOT_COST_COPY);
    expect(html).toContain(RESEARCH_SNAPSHOT_BREAK_EVEN_COPY);
    expect(html.toLowerCase()).not.toContain('house edge');
    expect(html.toLowerCase()).not.toContain('expected loss');
    expect(html.toLowerCase()).not.toContain('best book');
    expect(html.toLowerCase()).not.toContain('fair');
    expect(html).not.toContain('current prices');
    expect(html).not.toContain('/api/betting/parlay-prices');
  });

  it('fails closed when a snapshot price is unusable', () => {
    const [first] = researchPair();
    const broken: SelectedParlayLeg = {
      ...first!,
      offer: { ...first!.offer, oddsAmerican: 50 },
    };
    const cost = buildResearchSnapshotCost([broken, researchPair()[1]!]);
    expect(cost.status).toBe('unknown');
    expect(cost.combinedOddsLabel).toBeNull();
    const html = renderToStaticMarkup(createElement(WorkspaceTrueCost, { legs: [broken, researchPair()[1]!] }));
    expect(html).toContain('These snapshot prices cannot be combined.');
    expect(html.toLowerCase()).not.toContain('house edge');
  });

  it('leaves live-current and Decision Close on the current-price panel', () => {
    const live = renderToStaticMarkup(createElement(WorkspaceTrueCost, { legs: [explorerLeg('live')] }));
    const decision = renderToStaticMarkup(createElement(WorkspaceTrueCost, { legs: [explorerLeg('historical')] }));
    expect(live).toContain('current prices');
    expect(decision).toContain('current prices');
    expect(live).not.toContain(RESEARCH_SNAPSHOT_COST_COPY);
    expect(decision).not.toContain(RESEARCH_SNAPSHOT_COST_COPY);
  });
});
