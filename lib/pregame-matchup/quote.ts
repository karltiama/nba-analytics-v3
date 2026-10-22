/**
 * The same pregame quote the GameCard shows. selectMarket is the only selector.
 * A missing, stale, withdrawn, disabled, or post-tip quote becomes a sentence, never a price.
 */

import { twoWayMarketDisplay } from '@/lib/betting/market-probability';
import type { StoredOddsQuote, StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { isScoreboardMarketServingEnabled } from '@/lib/scoreboard/flags';
import { marketSourceCaption, selectMarket, type MarketSelection } from '@/lib/scoreboard/market';
import { staleness } from '@/lib/scoreboard/response';

export type MatchupQuote = {
  vendorLabel: string;
  caption: string | null;
  awayAbbr: string;
  homeAbbr: string;
  spreadAway: string;
  spreadHome: string;
  total: string;
  totalPrices: string;
  moneylineAway: string;
  moneylineHome: string;
  implied: string | null;
};

export type MatchupQuoteResult = {
  quote: MatchupQuote | null;
  note: string | null;
};

function signedLine(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value > 0) return `+${value}`;
  return String(value);
}

function american(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value > 0 ? `+${value}` : String(value);
}

function noteFor(selection: MarketSelection, enabled: boolean): string {
  if (!enabled) return 'Sportsbook markets are not being shown.';
  if (selection.status === 'not_pregame') return 'Pregame prices stay off once the game has tipped or is no longer scheduled.';
  if (selection.status === 'stale') return 'The stored pregame quote is too old to show.';
  return 'No verified pregame price is available.';
}

export function resolveMatchupQuote(input: {
  game: StoredScoreboardGame;
  quotes: StoredOddsQuote[];
  now: Date;
  env: Record<string, string | undefined>;
  awayAbbr: string;
  homeAbbr: string;
}): MatchupQuoteResult {
  const enabled = isScoreboardMarketServingEnabled(input.env);
  if (!enabled) return { quote: null, note: noteFor({ status: 'unavailable', market: null, reason: 'disabled' }, false) };
  const gameStale = staleness(input.game, input.now).stale;
  const selection = selectMarket({
    game: input.game,
    quotes: input.quotes,
    now: input.now,
    gameStale,
  });
  if (selection.market == null) return { quote: null, note: noteFor(selection, true) };
  const market = selection.market;
  const noVig = twoWayMarketDisplay(market.moneyline?.away ?? null, market.moneyline?.home ?? null);
  return {
    quote: {
      vendorLabel: market.vendor_label,
      caption: marketSourceCaption(market, input.now.getTime()),
      awayAbbr: input.awayAbbr,
      homeAbbr: input.homeAbbr,
      spreadAway: `${input.awayAbbr} ${signedLine(market.spread?.away ?? null)}`,
      spreadHome: `${input.homeAbbr} ${signedLine(market.spread?.home ?? null)}`,
      total: market.total?.line != null ? `O/U ${market.total.line}` : '—',
      totalPrices: `O ${american(market.total?.over_odds ?? null)} / U ${american(market.total?.under_odds ?? null)}`,
      moneylineAway: `${input.awayAbbr} ${american(market.moneyline?.away ?? null)}`,
      moneylineHome: `${input.homeAbbr} ${american(market.moneyline?.home ?? null)}`,
      implied: noVig ? `No-vig implied probability: ${input.awayAbbr} ${noVig.awayPct}%, ${input.homeAbbr} ${noVig.homePct}%` : null,
    },
    note: null,
  };
}
