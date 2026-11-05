import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { chartPoints, MarketMovement } from '@/components/matchup/MarketMovement';
import type { MatchupQuote } from '@/lib/pregame-matchup/quote';

const quote = (over: Partial<MatchupQuote>): MatchupQuote => ({
  vendorLabel: 'Consensus of 3 sportsbooks',
  caption: null,
  awayAbbr: 'ORL',
  homeAbbr: 'PHX',
  spreadAway: 'ORL +1.5',
  spreadHome: 'PHX −1.5',
  total: 'O/U 223.5',
  totalPrices: 'O −110 / U −110',
  moneylineAway: 'ORL −106',
  moneylineHome: 'PHX −114',
  implied: null,
  ...over,
});

const point = (at: string, spread: number | null, total: number) => ({ at, spread, total, homeProb: 51, books: 3 });

describe('MarketMovement', () => {
  it('labels one chart point per pull in ET and skips missing values', () => {
    const series = [point('2026-11-04T05:02:00Z', -2.5, 224.5), point('2026-11-04T18:00:00Z', null, 224.5)];
    expect(chartPoints(series, (p) => p.spread)).toEqual([{ time: 'Nov 4, 12 AM', value: -2.5 }]);
    expect(chartPoints(series, (p) => p.total)).toHaveLength(2);
  });

  it('uses the shared line movement chart once there are three pulls', () => {
    const html = renderToStaticMarkup(
      createElement(MarketMovement, {
        homeAbbr: 'PHX',
        quote: quote({
          movement: 'Since Nov 4, 12:02 AM ET: spread PHX −2.5 → PHX −1.5. Books that moved: DraftKings PHX −2.5 → PHX −1.5.',
          best: 'Best price: ORL ML −102 (BetMGM)',
          series: [point('2026-11-04T05:02:00Z', -2.5, 224.5), point('2026-11-04T18:00:00Z', -2, 224.5), point('2026-11-05T14:00:00Z', -1.5, 223.5)],
        }),
      })
    );
    expect(html).toContain('data-market-chart');
    expect(html).toContain('Spread (PHX)');
    expect(html).toContain('Total (O/U)');
    expect(html).toContain('Spread: PHX');
    expect(html).toContain('First pull');
    expect(html).toContain('Books that moved</summary>');
    expect(html).toContain('Best price: ORL ML −102 (BetMGM)');
  });

  it('shows text only before three pulls, and nothing without data', () => {
    const html = renderToStaticMarkup(
      createElement(MarketMovement, { homeAbbr: 'PHX', quote: quote({ movement: 'Since Nov 5: spread steady.', series: [point('2026-11-05T14:00:00Z', -1.5, 223.5)] }) })
    );
    expect(html).not.toContain('<svg');
    expect(html).toContain('Chart appears after 3 odds pulls; this game has 1.');
    expect(renderToStaticMarkup(createElement(MarketMovement, { homeAbbr: 'PHX', quote: quote({}) }))).toBe('');
  });
});
