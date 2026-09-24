/**
 * Map Court Context handoff providers → The Odds API bookmaker keys.
 */

import type { SportsbookHandoffProvider } from '@/lib/sportsbook-handoff/types';

export const HANDOFF_TO_ODDS_API_BOOKMAKER: Record<SportsbookHandoffProvider, string> = {
  draftkings: 'draftkings',
  fanduel: 'fanduel',
  caesars: 'williamhill_us',
  fanatics: 'fanatics',
  betmgm: 'betmgm',
};

export function oddsApiBookmakerKey(sportsbook: SportsbookHandoffProvider): string {
  return HANDOFF_TO_ODDS_API_BOOKMAKER[sportsbook];
}
