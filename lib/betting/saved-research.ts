/**
 * Saved Research is a bookmark of the market the user saved — not a live offer
 * and not an active wager. Labels must not rewrite a historical closing line
 * into a current sportsbook offering after the source table changes.
 */

import {
  etCalendarDateFromInstant,
  resolvePropsMarketContext,
  type PropsMarketContext,
} from '@/lib/betting/props-market-context';
import { gameDetailHref, playerResearchHref, propsExplorerHref } from '@/lib/betting/research-journey';

export const SAVED_RESEARCH_DEFAULT_LIMIT = 100;
export const SAVED_RESEARCH_MAX_LIMIT = 200;

export function savedResearchHref(): string {
  return '/betting/saved';
}

export function savedBookmarkLabel(context: PropsMarketContext): string {
  return context === 'historical' ? 'Historical closing line' : 'Saved market snapshot';
}

export function savedResearchEmptyCopy(): { title: string; detail: string; cta: string } {
  return {
    title: 'No saved research yet',
    detail:
      'Save a prop while you research it in Props Explorer. Bookmarks stay here even after the live board changes.',
    cta: 'Open Props Explorer',
  };
}

export function resolveSavedMarketContext(input: {
  stored?: string | null;
  dateEt?: string | null;
  snapshotAt?: string | Date | null;
  gameStartTime?: string | Date | null;
  todayEt: string;
}): PropsMarketContext {
  const stored = (input.stored ?? '').trim().toLowerCase();
  if (stored === 'historical' || stored === 'live') return stored;

  const dateEt =
    input.dateEt?.trim() ||
    etCalendarDateFromInstant(input.gameStartTime) ||
    etCalendarDateFromInstant(input.snapshotAt);
  if (dateEt) {
    return resolvePropsMarketContext({ dateEt, todayEt: input.todayEt });
  }
  return 'historical';
}

export function savedResearchLinks(input: {
  playerId: number | string;
  gameId: string;
  dateEt: string | null;
  propType: string | null;
  side: string | null;
  sportsbook: string | null;
  lineValue: number | null;
}): {
  playerHref: string;
  gameHref: string;
  explorerHref: string;
} {
  return {
    playerHref: playerResearchHref({
      playerId: input.playerId,
      date: input.dateEt,
      gameId: input.gameId,
      propType: input.propType,
      side: input.side,
      sportsbook: input.sportsbook,
      lineValue: input.lineValue,
    }),
    gameHref: gameDetailHref(input.gameId),
    explorerHref: propsExplorerHref({ date: input.dateEt, gameId: input.gameId }),
  };
}

export function isSavedPaperAllowed(context: PropsMarketContext): boolean {
  return context !== 'historical';
}
