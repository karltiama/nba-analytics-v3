/** Stored rows → scoreboard.v1 response. Pure. */

import {
  SCOREBOARD_PROVIDER,
  SCOREBOARD_SCHEMA_VERSION,
  type ScoreboardGame,
  type ScoreboardPlayerLine,
  type ScoreboardResponse,
  type StoredOddsQuote,
  type StoredScoreboardGame,
} from './contract';
import { selectMarket } from './market';
import { IN_GAME } from './normalize';
import { SCOREBOARD_POLICY } from './planner';

/** In-game observation older than this is stale (collector targets 60 s). */
export const SCOREBOARD_LIVE_STALE_MS = 120_000;
/** Any not-yet-complete game not observed for this long is stale, unless a rule below applies. */
export const SCOREBOARD_IDLE_STALE_MS = 30 * 60_000;
/**
 * A scheduled game before its tip window is only rediscovered every DISCOVERY_INTERVAL_MS (a failed
 * games request retries on the next tick). Older than that plus this slack means a missed discovery.
 */
export const SCOREBOARD_DISCOVERY_STALE_SLACK_MS = 10 * 60_000;
/** Once the tip window opens the collector observes the game on its next tick; allow this long. */
export const SCOREBOARD_TIP_WINDOW_GRACE_MS = 5 * 60_000;

const NO_RECENT = { stale: true, reason: 'no_recent_observation' } as const;

export function staleness(g: StoredScoreboardGame, now: Date): { stale: boolean; reason: string | null } {
  if (g.pollingState === 'safety_stopped') return { stale: true, reason: 'polling_safety_stopped' };
  if (g.pollingState === 'complete') return { stale: false, reason: null };
  const t = now.getTime();
  const observed = Date.parse(g.lastObservedAt);
  if (!Number.isFinite(observed)) return NO_RECENT;
  const age = t - observed;
  if ((IN_GAME.has(g.lifecycle) || g.lifecycle === 'unknown') && age > SCOREBOARD_LIVE_STALE_MS) return NO_RECENT;
  const tip = g.scheduledTip ? Date.parse(g.scheduledTip) : NaN;
  if (g.lifecycle === 'scheduled' && Number.isFinite(tip)) {
    const windowOpens = tip - SCOREBOARD_POLICY.PRE_TIP_WINDOW_MS;
    if (observed < windowOpens) {
      if (t >= windowOpens + SCOREBOARD_TIP_WINDOW_GRACE_MS) return NO_RECENT;
      return age > SCOREBOARD_POLICY.DISCOVERY_INTERVAL_MS + SCOREBOARD_DISCOVERY_STALE_SLACK_MS
        ? NO_RECENT
        : { stale: false, reason: null };
    }
  }
  if (age > SCOREBOARD_IDLE_STALE_MS) return NO_RECENT;
  return { stale: false, reason: null };
}

export function buildScoreboardResponse(input: {
  date: string;
  now: Date;
  games: StoredScoreboardGame[];
  lines: ScoreboardPlayerLine[];
  /** Stored current quotes; omitted when the odds read failed or is not configured. */
  odds?: StoredOddsQuote[];
}): ScoreboardResponse {
  const games: ScoreboardGame[] = input.games.map((g) => {
    const s = staleness(g, input.now);
    const market = input.odds
      ? selectMarket({ game: g, quotes: input.odds, now: input.now, gameStale: s.stale }).market
      : null;
    return {
      game_id: g.gameId,
      provider: SCOREBOARD_PROVIDER,
      season: g.season,
      season_type: g.seasonType,
      season_type_source: g.seasonTypeSource,
      model_eligible: false,
      et_date: g.etDate,
      scheduled_tip: g.scheduledTip,
      lifecycle: g.lifecycle,
      provider_status: g.providerStatus,
      period: g.period,
      clock: g.clock,
      overtime_periods: g.overtimePeriods,
      home: { provider_team_id: g.homeTeamId, abbreviation: g.homeAbbr, name: g.homeName, score: g.homeScore },
      visitor: {
        provider_team_id: g.visitorTeamId,
        abbreviation: g.visitorAbbr,
        name: g.visitorName,
        score: g.visitorScore,
      },
      acquired_at: g.lastObservedAt,
      last_changed_at: g.lastChangedAt,
      stale: s.stale,
      stale_reason: s.reason,
      polling_state: g.pollingState,
      box_score: {
        completeness: g.boxCompleteness,
        acquired_at: g.boxObservedAt,
        players: input.lines
          .filter((l) => l.gameId === g.gameId)
          .map(({ gameId: _gameId, ...rest }) => rest),
      },
      ...(market ? { market } : {}),
    };
  });
  return {
    schema_version: SCOREBOARD_SCHEMA_VERSION,
    date: input.date,
    generated_at: input.now.toISOString(),
    source: { provider: SCOREBOARD_PROVIDER, coverage: 'display_only' },
    stale: games.some((g) => g.stale),
    games,
  };
}
