/**
 * Build MarketObservation from a raw Odds API event payload for one book×market.
 */

import type { SportsbookHandoffProvider } from '@/lib/sportsbook-handoff/types';
import { oddsApiBookmakerKey } from '../odds-api/bookmaker-map';
import type { OddsApiEventRaw } from '../odds-api/types';
import { classifyDeeplinkCoverageState } from './coverage-state';
import { validateOutcomeLink } from './link-validity';
import type { CertMarketKey, MarketObservation, OutcomeObservation } from './types';

function parseSide(name: string): 'over' | 'under' | null {
  const n = name.trim().toLowerCase();
  if (n === 'over') return 'over';
  if (n === 'under') return 'under';
  return null;
}

export function observeBookMarket(input: {
  event: OddsApiEventRaw;
  sportsbook: SportsbookHandoffProvider;
  marketKey: CertMarketKey;
}): MarketObservation {
  const bookKey = oddsApiBookmakerKey(input.sportsbook);
  const book = input.event.bookmakers?.find((b) => b.key === bookKey) ?? null;
  const bookPresent = book != null;
  const market = book?.markets.find((m) => m.key === input.marketKey) ?? null;
  const marketPresent = market != null;

  const outcomes: OutcomeObservation[] = [];
  if (market) {
    for (const raw of market.outcomes) {
      const side = parseSide(raw.name);
      if (!side || raw.point == null || !Number.isFinite(raw.point)) continue;
      const playerName = raw.description?.trim() ?? '';
      if (!playerName) continue;
      const link = raw.link ?? null;
      const linkValidity = link ? validateOutcomeLink(link, input.sportsbook) : null;
      outcomes.push({
        playerName,
        side,
        line: raw.point,
        oddsAmerican: raw.price,
        selectionSid: raw.sid ?? null,
        hasLink: Boolean(link?.trim()),
        linkValidity,
      });
    }
  }

  const outcomesWithSid = outcomes.filter((o) => Boolean(o.selectionSid)).length;
  const outcomesWithLink = outcomes.filter((o) => o.hasLink).length;
  const outcomesAllowlisted = outcomes.filter((o) => o.linkValidity?.allowlisted).length;
  const linked = outcomes.filter((o) => o.hasLink);
  const allLinksAllowlistFailed =
    linked.length > 0 && linked.every((o) => o.linkValidity && !o.linkValidity.allowlisted);

  const state = classifyDeeplinkCoverageState({
    bookPresent,
    marketPresent,
    outcomeCount: outcomes.length,
    outcomesWithSid,
    outcomesWithLink,
    allLinksAllowlistFailed,
  });

  return {
    sportsbook: input.sportsbook,
    oddsApiBookmakerKey: bookKey,
    marketKey: input.marketKey,
    state,
    bookPresent,
    marketPresent,
    outcomeCount: outcomes.length,
    outcomesWithSid,
    outcomesWithLink,
    outcomesAllowlisted,
    eventSid: book?.sid ?? null,
    marketSid: market?.sid ?? null,
    outcomes,
  };
}
