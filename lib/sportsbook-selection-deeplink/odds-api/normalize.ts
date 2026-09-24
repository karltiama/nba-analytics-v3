/**
 * Maps private Odds API bookmaker payloads → domain NormalizedMarketSnapshot.
 */

import type { NormalizedMarketSnapshot, NormalizedOutcome } from '../match-selection';
import type { OddsApiBookmakerRaw, OddsApiEventRaw, OddsApiMarketRaw } from './types';

function parseSide(name: string): 'over' | 'under' | null {
  const n = name.trim().toLowerCase();
  if (n === 'over') return 'over';
  if (n === 'under') return 'under';
  return null;
}

export function normalizeBookmakerMarket(input: {
  event: Pick<OddsApiEventRaw, 'id' | 'bookmakers'> & {
    bookmakers?: OddsApiBookmakerRaw[];
  };
  bookmakerKey: string;
  marketKey: string;
}): NormalizedMarketSnapshot | null {
  const book = input.event.bookmakers?.find((b) => b.key === input.bookmakerKey);
  if (!book) return null;

  const market: OddsApiMarketRaw | undefined = book.markets.find((m) => m.key === input.marketKey);
  if (!market) return null;

  const outcomes: NormalizedOutcome[] = [];
  for (const raw of market.outcomes) {
    const side = parseSide(raw.name);
    if (!side) continue;
    if (raw.point == null || !Number.isFinite(raw.point)) continue;
    const playerName = raw.description?.trim() ?? '';
    if (!playerName) continue;

    outcomes.push({
      side,
      line: raw.point,
      oddsAmerican: raw.price,
      playerName,
      selectionSid: raw.sid ?? null,
      link: raw.link ?? null,
    });
  }

  return {
    marketKey: market.key,
    marketSid: market.sid ?? null,
    eventSid: book.sid ?? null,
    outcomes,
  };
}
