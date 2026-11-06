/**
 * Bet feed rules (pure, no DB): post lock, supported markets, per-leg and parlay grading, record.
 * A post is self-reported. Single or parlay, it counts as ONE unit in the record.
 */

import { normalizeGameStatus, resolveGameLifecycle } from '@/lib/betting/normalize-game-status';
import {
  evaluateOverUnder,
  profitUnitsForSettlement,
  statActualForPropType,
  type PlayerGameOutcomeStats,
} from '@/lib/betting/paper-settlement';
import { summarizeSettledPaperPortfolio, type PaperPortfolioSummary } from '@/lib/betting/paper-portfolio';
import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import type { CanonicalBetLeg } from '@/lib/bet-slip/types';

export const FEED_DAILY_POST_CAP = 3;
export const FEED_NOTE_MAX = 280;

/** Markets research.v_player_game_outcomes can grade. Blocks and steals have no outcome column. */
export const FEED_SUPPORTED_MARKETS = new Set<string>([
  'points',
  'rebounds',
  'assists',
  'threes',
  'points_rebounds',
  'points_assists',
  'rebounds_assists',
  'points_rebounds_assists',
]);

export type FeedLegGrade = 'win' | 'loss' | 'push' | 'void';
export type FeedPostResult = 'win' | 'loss' | 'push';

export type FeedGameRow = {
  game_id: string;
  start_time: string | Date | null;
  status: string | null;
};

export type FeedLegValidationError =
  | { code: 'UNSUPPORTED_MARKET'; message: string }
  | { code: 'MISSING_ODDS'; message: string }
  | { code: 'DUPLICATE_LEG'; message: string };

/** Self-reported legs must be gradeable and priced, or the record would be meaningless. */
export function validateFeedLegs(legs: CanonicalBetLeg[]): FeedLegValidationError | null {
  const seen = new Set<string>();
  for (const leg of legs) {
    if (!FEED_SUPPORTED_MARKETS.has(leg.market)) {
      return {
        code: 'UNSUPPORTED_MARKET',
        message: `${leg.playerName || 'A leg'}: ${leg.market} can't be graded yet. Remove it to post.`,
      };
    }
    if (leg.selectedOdds == null || !Number.isFinite(leg.selectedOdds) || leg.selectedOdds === 0) {
      return {
        code: 'MISSING_ODDS',
        message: `${leg.playerName || 'A leg'} has no odds. Every leg needs a price to count toward a record.`,
      };
    }
    if (seen.has(leg.selectionKey)) {
      return { code: 'DUPLICATE_LEG', message: 'The same selection appears twice.' };
    }
    seen.add(leg.selectionKey);
  }
  return null;
}

export type FeedLockResult =
  | { ok: true; firstTipAt: Date }
  | { ok: false; code: 'GAME_NOT_FOUND' | 'GAME_STARTED'; gameId: string };

/**
 * A post is accepted only while every leg's game is still scheduled with a known future tip.
 * Unknown status or a missing start time fails closed.
 */
export function checkFeedPostLock(input: {
  gameIds: string[];
  games: FeedGameRow[];
  now?: Date;
}): FeedLockResult {
  const now = input.now ?? new Date();
  const byId = new Map(input.games.map((g) => [String(g.game_id), g]));
  let firstTip: Date | null = null;
  for (const gameId of new Set(input.gameIds)) {
    const game = byId.get(gameId);
    if (!game) return { ok: false, code: 'GAME_NOT_FOUND', gameId };
    const start = game.start_time == null ? null : new Date(game.start_time);
    if (!start || Number.isNaN(start.getTime()) || start.getTime() <= now.getTime()) {
      return { ok: false, code: 'GAME_STARTED', gameId };
    }
    const lifecycle = resolveGameLifecycle({ statusRaw: game.status, startTime: start, now });
    if (lifecycle !== 'scheduled') return { ok: false, code: 'GAME_STARTED', gameId };
    if (!firstTip || start < firstTip) firstTip = start;
  }
  if (!firstTip) return { ok: false, code: 'GAME_NOT_FOUND', gameId: '' };
  return { ok: true, firstTipAt: firstTip };
}

/** Grade one over/under leg from the player's box score. Null stat or bad line → void. */
export function gradeFeedLeg(
  leg: Pick<CanonicalBetLeg, 'market' | 'side' | 'line'>,
  stats: PlayerGameOutcomeStats
): FeedLegGrade {
  const actual = statActualForPropType(leg.market, stats);
  return evaluateOverUnder(leg.side, leg.line, actual) ?? 'void';
}

export type FeedLegState =
  | { kind: 'pending' }
  | { kind: 'graded'; grade: FeedLegGrade };

/**
 * Leg state from the game and its box score.
 * Postponed/canceled → void. Final with box score loaded but no player row → void (did not play).
 * Final with no box score at all yet → pending (ingestion lag).
 */
export function feedLegState(input: {
  leg: Pick<CanonicalBetLeg, 'market' | 'side' | 'line'>;
  gameStatus: string | null | undefined;
  gameHasBoxScore: boolean;
  outcome: PlayerGameOutcomeStats | null;
}): FeedLegState {
  const status = normalizeGameStatus(input.gameStatus);
  if (status === 'Postponed' || status === 'Canceled') return { kind: 'graded', grade: 'void' };
  if (status !== 'Final') return { kind: 'pending' };
  if (!input.gameHasBoxScore) return { kind: 'pending' };
  if (!input.outcome) return { kind: 'graded', grade: 'void' };
  return { kind: 'graded', grade: gradeFeedLeg(input.leg, input.outcome) };
}

export type FeedParlayGrade = {
  result: FeedPostResult;
  profitUnits: number;
  /** Price of the legs that stood after voids/pushes dropped out. Null when none stood. */
  effectiveOddsAmerican: number | null;
};

/**
 * One post = one record unit.
 * Any losing leg → loss. Void and push legs drop out and the price is recomputed from the rest.
 * Every leg void/push → push. Otherwise win at the recomputed price.
 */
export function gradeFeedParlay(input: {
  legGrades: FeedLegGrade[];
  legOdds: Array<number | null>;
  stakeUnits: number;
}): FeedParlayGrade {
  const { legGrades, legOdds, stakeUnits } = input;
  if (legGrades.some((g) => g === 'loss')) {
    return { result: 'loss', profitUnits: profitUnitsForSettlement('loss', null, stakeUnits), effectiveOddsAmerican: null };
  }
  const standing: Array<number | null> = [];
  legGrades.forEach((g, i) => {
    if (g === 'win') standing.push(legOdds[i] ?? null);
  });
  if (standing.length === 0) {
    return { result: 'push', profitUnits: 0, effectiveOddsAmerican: null };
  }
  const price = combinedAmericanOdds(standing);
  return {
    result: 'win',
    profitUnits: profitUnitsForSettlement('win', price, stakeUnits),
    effectiveOddsAmerican: price,
  };
}

export type FeedRecordRow = {
  result: string | null;
  profitUnits: number | null;
  stakeUnits: number;
};

/** Settled-only record. Same math as the paper portfolio, one row per post. */
export function summarizeFeedRecord(rows: FeedRecordRow[]): PaperPortfolioSummary {
  return summarizeSettledPaperPortfolio(rows);
}

export function formatFeedRecord(summary: Pick<PaperPortfolioSummary, 'wins' | 'losses' | 'pushes'>): string {
  return summary.pushes > 0
    ? `${summary.wins}-${summary.losses}-${summary.pushes}`
    : `${summary.wins}-${summary.losses}`;
}
