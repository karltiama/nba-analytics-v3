import { PLAYER_PROPS_MAX_HTTP_ATTEMPTS } from './attempt-budget';
import { PLAYER_PROPS_MAX_PAGES } from './fetch';

/**
 * P6 measured cost for game 21717922: one HTTP page returned 2613 provider rows.
 * A later game can take more than one page. The allowance below is the planning
 * cost of a successful collection, not a promise that every game is one page.
 */
export const PROPS_MEASURED_PAGES_PER_GAME = 1;
export const PROPS_MEASURED_PROVIDER_ROWS = 2613;
export const PROPS_PAGES_ALLOWANCE_PER_COLLECTION = 3;

/** Live broad schedules: 08:00, 12:00, and 14:00 America/New_York. */
export const PROPS_BROAD_WAVES_PER_DAY = 3;

/**
 * Near-tip polls every 15 minutes across a 15-minute window.
 * The 10-minute claim dedupe does not collapse two polls that are 15 minutes apart,
 * so one game can be collected twice on the way to tip.
 */
export const PROPS_NEAR_TIP_COLLECTIONS_PER_GAME = 2;

/** Redrive maxReceiveCount. Those receives share one pull's attempt counter. */
export const PROPS_SQS_MAX_RECEIVES = 4;

/** NBA regular-season slate size. The controller will not queue more than this in one wave. */
export const PROPS_WAVE_MAX_GAMES_CEILING = 15;

export type PropsRequestBudget = {
  games: number;
  collectionsPerGame: number;
  pagesAllowance: number;
  attemptsPerPull: number;
  expectedRequests: number;
  hardRequests: number;
};

/**
 * Expected requests use the page allowance. Hard requests use the per-pull attempt
 * cap once per broad wave and near-tip collection. SQS receives are inside that cap.
 */
export function propsRequestBudget(games: number): PropsRequestBudget {
  const slate = Number.isInteger(games) && games > 0 ? games : 0;
  const collectionsPerGame = PROPS_BROAD_WAVES_PER_DAY + PROPS_NEAR_TIP_COLLECTIONS_PER_GAME;
  return {
    games: slate,
    collectionsPerGame,
    pagesAllowance: PROPS_PAGES_ALLOWANCE_PER_COLLECTION,
    attemptsPerPull: PLAYER_PROPS_MAX_HTTP_ATTEMPTS,
    expectedRequests: slate * collectionsPerGame * PROPS_PAGES_ALLOWANCE_PER_COLLECTION,
    hardRequests: slate * collectionsPerGame * PLAYER_PROPS_MAX_HTTP_ATTEMPTS,
  };
}

export function propsFullSlateBudget(): PropsRequestBudget {
  return propsRequestBudget(PROPS_WAVE_MAX_GAMES_CEILING);
}

export function propsAttemptCapCoversPageWalk(): boolean {
  return PLAYER_PROPS_MAX_HTTP_ATTEMPTS >= PLAYER_PROPS_MAX_PAGES && PROPS_SQS_MAX_RECEIVES >= 1;
}
