/**
 * Today's Games list from a scoreboard.v1 payload.
 * One card per provider game id. A game is included only when its et_date is the payload date.
 * Betting rows are not a source for this list. This module does not write either store.
 */

import type { Game } from '@/components/betting/GameCard';
import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';
import { twoWayMarketDisplay } from '@/lib/betting/market-probability';
import type { ScoreboardGame, ScoreboardResponse } from './contract';
import { presentScoreboardGame, type PresentedGame } from './present';

const EMPTY_ODDS = { moneyline: null, spread: null, spreadOdds: null };

export function scoreboardToSlateGame(
  game: ScoreboardGame,
  generatedAt?: string | null
): (Game & { scoreboard: PresentedGame }) | null {
  const presented = presentScoreboardGame(game, generatedAt);
  if (!presented) return null;
  const homeScore = presented.showScores && presented.homeScore != null ? Number(presented.homeScore) : undefined;
  const awayScore = presented.showScores && presented.visitorScore != null ? Number(presented.visitorScore) : undefined;
  // One vendor's verified current quote, scheduled games only. Otherwise every odds field stays empty.
  const market = presented.lifecycle === 'scheduled' ? presented.market : null;
  const ml = market?.moneyline ?? null;
  const spread = market?.spread ?? null;
  const total = market?.total ?? null;
  const noVig = ml ? twoWayMarketDisplay(ml.away, ml.home) : null;
  return {
    id: presented.gameId,
    gameDate: game.et_date,
    homeTeam: {
      id: game.home.provider_team_id,
      name: presented.homeName,
      abbreviation: presented.homeAbbr,
      record: null,
    },
    awayTeam: {
      id: game.visitor.provider_team_id,
      name: presented.visitorName,
      abbreviation: presented.visitorAbbr,
      record: null,
    },
    startTime: formatTipoffEt(game.scheduled_tip),
    homeOdds: market
      ? { moneyline: ml?.home ?? null, spread: spread?.home ?? null, spreadOdds: spread?.home_odds ?? null }
      : EMPTY_ODDS,
    awayOdds: market
      ? { moneyline: ml?.away ?? null, spread: spread?.away ?? null, spreadOdds: spread?.away_odds ?? null }
      : EMPTY_ODDS,
    overUnder: total?.line ?? null,
    overOdds: total?.over_odds ?? null,
    underOdds: total?.under_odds ?? null,
    homeImpliedProb: noVig?.homePct ?? null,
    awayImpliedProb: noVig?.awayPct ?? null,
    isFavorite: noVig?.favorite ?? null,
    isClose: noVig?.isClose ?? false,
    hasOdds: market != null,
    marketCaption: market?.caption ?? null,
    researchAvailable: false,
    status: undefined,
    homeScore,
    awayScore,
    scoreboard: presented,
  };
}

export type ScoreboardSlateAvailability = 'loading' | 'ready' | 'disabled' | 'error';

/** Copy for a Today's Games section that has no cards. A ready empty date is a real empty slate. */
export function todaysGamesUnavailableCopy(availability: 'disabled' | 'error'): string {
  if (availability === 'disabled') return 'Scoreboard serving is turned off.';
  return 'The game schedule is temporarily unavailable.';
}

/**
 * Cards for the payload date only. Duplicate provider ids collapse to the later row.
 * A missing payload yields no cards. It does not invent a slate from another feed.
 */
export function mergeTodaysGames(scoreboard: ScoreboardResponse | null | undefined): Game[] {
  if (!scoreboard || !Array.isArray(scoreboard.games)) return [];
  const byId = new Map<string, Game>();
  for (const raw of scoreboard.games) {
    if (raw.et_date !== scoreboard.date) continue;
    const card = scoreboardToSlateGame(raw, scoreboard.generated_at);
    if (!card) continue;
    byId.set(card.id, card);
  }
  return [...byId.values()];
}
