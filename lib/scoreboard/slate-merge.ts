/**
 * Presentation merge for Today's Games.
 * Reads scoreboard.v1 beside the existing betting slate. Does not write either store.
 * Dedup is an exact provider game id match (analytics.games.game_id and scoreboard game_id
 * are both the provider id stored as text).
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

function overlayRegular(betting: Game, board: PresentedGame): Game {
  return {
    ...betting,
    status: board.lifecycleLabel,
    startTime: board.periodClock || betting.startTime,
    homeScore: board.showScores && board.homeScore != null ? Number(board.homeScore) : betting.homeScore,
    awayScore: board.showScores && board.visitorScore != null ? Number(board.visitorScore) : betting.awayScore,
    scoreboard: board,
  };
}

/**
 * Betting games stay in place when the scoreboard is missing.
 * A matching provider id overlays live fields. Preseason overlays drop odds and model context.
 * Scoreboard-only games are appended.
 */
export function mergeTodaysGames(betting: Game[], scoreboard: ScoreboardResponse | null | undefined): Game[] {
  if (!scoreboard) return betting;
  const overlaid = new Map<string, Game>();
  const extras: Game[] = [];
  for (const raw of scoreboard.games) {
    const card = scoreboardToSlateGame(raw);
    if (!card) continue;
    const existing = betting.find((game) => game.id === card.id);
    if (!existing) {
      extras.push(card);
      continue;
    }
    overlaid.set(
      card.id,
      card.scoreboard.preseason ? { ...card, gameDate: existing.gameDate || card.gameDate } : overlayRegular(existing, card.scoreboard)
    );
  }
  return [...betting.map((game) => overlaid.get(game.id) ?? game), ...extras];
}
