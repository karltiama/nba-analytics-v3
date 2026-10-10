/**
 * Today's Games list from a scoreboard.v1 payload.
 * One card per provider game id. A game is included only when its et_date is the payload date.
 * Betting rows are not a source for this list. This module does not write either store.
 */

import type { Game } from '@/components/betting/GameCard';
import type { ScoreboardGame, ScoreboardResponse } from './contract';
import { presentScoreboardGame, type PresentedGame } from './present';

const EMPTY_ODDS = { moneyline: null, spread: null, spreadOdds: null };

export function scoreboardToSlateGame(game: ScoreboardGame): (Game & { scoreboard: PresentedGame }) | null {
  const presented = presentScoreboardGame(game);
  if (!presented) return null;
  const homeScore = presented.showScores && presented.homeScore != null ? Number(presented.homeScore) : undefined;
  const awayScore = presented.showScores && presented.visitorScore != null ? Number(presented.visitorScore) : undefined;
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
    startTime: presented.periodClock || presented.tipoffLabel || '',
    homeOdds: EMPTY_ODDS,
    awayOdds: EMPTY_ODDS,
    overUnder: null,
    overOdds: null,
    underOdds: null,
    homeImpliedProb: null,
    awayImpliedProb: null,
    isFavorite: null,
    isClose: false,
    hasOdds: false,
    status: presented.lifecycleLabel,
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
    const card = scoreboardToSlateGame(raw);
    if (!card) continue;
    byId.set(card.id, card);
  }
  return [...byId.values()];
}
