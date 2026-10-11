/**
 * scoreboard.v1: display-only live scoreboard contract.
 *
 * Scoreboard rows live in the `display` schema and are never model inputs. Season type always comes
 * from the provider request that produced the observation (season_type_source), never from the
 * season year, the date, or `postseason=false`.
 */

import type { GameLifecycleState } from '@/lib/betting/normalize-game-status';

export const SCOREBOARD_SCHEMA_VERSION = 'scoreboard.v1' as const;
export const SCOREBOARD_PROVIDER = 'balldontlie' as const;

/** BDL `season_type` request values the scoreboard understands. */
export const SCOREBOARD_SEASON_TYPES = ['preseason', 'regular', 'playin', 'playoffs'] as const;
export type ScoreboardSeasonType = (typeof SCOREBOARD_SEASON_TYPES)[number];

/**
 * Season types whose live acquisition may be switched on by configuration. Adding a type here is a
 * code change that needs its own approval; a flag alone can never enable regular season or playoffs.
 */
export const ACTIVATABLE_SCOREBOARD_SEASON_TYPES: ReadonlySet<ScoreboardSeasonType> = new Set(['preseason']);

export function isScoreboardSeasonType(value: unknown): value is ScoreboardSeasonType {
  return typeof value === 'string' && (SCOREBOARD_SEASON_TYPES as readonly string[]).includes(value);
}

/**
 * none: no box score observed.
 * live_partial: player lines observed while the game was not final.
 * final_unverified: game final, but the box score has not passed every check in box-verify.ts.
 * verified_final: provider-final evidence (confirmed /games final, box row itself final with the same
 * scores, observed after final) and every per-player and per-team statistical check passes.
 */
export const BOX_SCORE_COMPLETENESS = ['none', 'live_partial', 'final_unverified', 'verified_final'] as const;
export type BoxScoreCompleteness = (typeof BOX_SCORE_COMPLETENESS)[number];

/**
 * pending: discovered, not yet in its polling window.
 * active: being polled.
 * complete: terminal state (final/postponed/canceled) confirmed by two observations.
 * safety_stopped: bounded safeguard stopped polling without a confirmed terminal state; shown stale.
 */
export const SCOREBOARD_POLLING_STATES = ['pending', 'active', 'complete', 'safety_stopped'] as const;
export type ScoreboardPollingState = (typeof SCOREBOARD_POLLING_STATES)[number];

/** Flat row persisted in display.scoreboard_games. */
export type StoredScoreboardGame = {
  gameId: string;
  season: number;
  seasonType: ScoreboardSeasonType;
  seasonTypeSource: 'request_season_type';
  etDate: string;
  scheduledTip: string | null;
  homeTeamId: string;
  homeAbbr: string | null;
  homeName: string | null;
  homeScore: number | null;
  visitorTeamId: string;
  visitorAbbr: string | null;
  visitorName: string | null;
  visitorScore: number | null;
  providerStatus: string | null;
  providerStatusState: string | null;
  period: number | null;
  clock: string | null;
  overtimePeriods: number;
  lifecycle: GameLifecycleState;
  /** ledger request_id of the /games response that produced this observation. */
  gamesRequestId: string;
  firstObservedAt: string;
  lastObservedAt: string;
  /** Last time score, period, clock, status or lifecycle changed. */
  lastChangedAt: string;
  /** Consecutive observations in a terminal lifecycle (final/postponed/canceled). */
  terminalConfirmations: number;
  /** When the lifecycle first became final in this collector's observations. */
  finalObservedAt: string | null;
  pollingState: ScoreboardPollingState;
  boxCompleteness: BoxScoreCompleteness;
  boxRequestId: string | null;
  boxObservedAt: string | null;
  /** Live box-score attempts made after the game became final (bounded). */
  finalBoxAttempts: number;
};

export type ScoreboardPlayerLine = {
  gameId: string;
  playerId: string;
  teamId: string;
  name: string | null;
  min: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fgm: number | null;
  fga: number | null;
  fg3m: number | null;
  fg3a: number | null;
  ftm: number | null;
  fta: number | null;
  oreb: number | null;
  dreb: number | null;
};

/** One /box_scores/live row matched to a game: the row's own status and scores plus player lines. */
export type LiveBoxObservation = {
  providerStatus: string | null;
  homeScore: number | null;
  visitorScore: number | null;
  lines: ScoreboardPlayerLine[];
};

export const ODDS_QUOTE_KINDS = ['current', 'opening'] as const;
export type OddsQuoteKind = (typeof ODDS_QUOTE_KINDS)[number];

/** Flat row persisted in display.scoreboard_game_odds: one vendor's latest accepted quote for one game. */
export type StoredOddsQuote = {
  gameId: string;
  vendor: string;
  quoteKind: OddsQuoteKind;
  moneylineHome: number | null;
  moneylineAway: number | null;
  spreadHome: number | null;
  spreadHomeOdds: number | null;
  spreadAway: number | null;
  spreadAwayOdds: number | null;
  total: number | null;
  totalOverOdds: number | null;
  totalUnderOdds: number | null;
  /** Provider sync time (BDL updated_at). Not a line-change time. */
  providerUpdatedAt: string | null;
  /** Newest provider sync time for this vendor in the same acquisition. */
  vendorSyncedAt: string | null;
  openedAt: string | null;
  firstObservedAt: string;
  /** Collection time of the acquisition that last contained this row. */
  observedAt: string;
  requestId: string;
  withdrawnAt: string | null;
  withdrawnRequestId: string | null;
};

/**
 * One sportsbook's current pre-game quote for a scheduled game. Present only when a single vendor
 * passed identity, freshness and price checks; never a blend of books, never an opening quote.
 */
export type ScoreboardMarket = {
  kind: 'current_pregame';
  vendor: string;
  vendor_label: string;
  /** fresh: collected within the refresh window; delayed: one refresh late. Stale quotes are omitted. */
  freshness: 'fresh' | 'delayed';
  /** Provider sync time. Not a line-change time. */
  provider_updated_at: string | null;
  observed_at: string;
  moneyline: { home: number; away: number } | null;
  spread: { home: number; away: number; home_odds: number | null; away_odds: number | null } | null;
  total: { line: number; over_odds: number | null; under_odds: number | null } | null;
};

export type ScoreboardTeam = {
  provider_team_id: string;
  abbreviation: string | null;
  name: string | null;
  score: number | null;
};

export type ScoreboardGame = {
  game_id: string;
  provider: typeof SCOREBOARD_PROVIDER;
  season: number;
  season_type: ScoreboardSeasonType;
  season_type_source: 'request_season_type';
  /** Always false: scoreboard data is display-only. */
  model_eligible: false;
  et_date: string;
  scheduled_tip: string | null;
  lifecycle: GameLifecycleState;
  provider_status: string | null;
  period: number | null;
  clock: string | null;
  overtime_periods: number;
  home: ScoreboardTeam;
  visitor: ScoreboardTeam;
  acquired_at: string;
  last_changed_at: string;
  stale: boolean;
  stale_reason: string | null;
  polling_state: ScoreboardPollingState;
  box_score: {
    completeness: BoxScoreCompleteness;
    acquired_at: string | null;
    players: Array<Omit<ScoreboardPlayerLine, 'gameId'>>;
  };
  /** Optional, additive: absent when the game is not scheduled or no verified current quote exists. */
  market?: ScoreboardMarket;
};

export type ScoreboardResponse = {
  schema_version: typeof SCOREBOARD_SCHEMA_VERSION;
  date: string;
  generated_at: string;
  source: { provider: typeof SCOREBOARD_PROVIDER; coverage: 'display_only' };
  stale: boolean;
  games: ScoreboardGame[];
};
