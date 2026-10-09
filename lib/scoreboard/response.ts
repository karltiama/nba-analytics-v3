/** Stored rows → scoreboard.v1 response. Pure. */

import {
  SCOREBOARD_PROVIDER,
  SCOREBOARD_SCHEMA_VERSION,
  type ScoreboardGame,
  type ScoreboardPlayerLine,
  type ScoreboardResponse,
  type StoredScoreboardGame,
} from './contract';
import { IN_GAME } from './normalize';

/** In-game observation older than this is stale (collector targets 60 s). */
export const SCOREBOARD_LIVE_STALE_MS = 120_000;
/** Any not-yet-complete game not observed for this long is stale. */
export const SCOREBOARD_IDLE_STALE_MS = 30 * 60_000;

export function staleness(g: StoredScoreboardGame, now: Date): { stale: boolean; reason: string | null } {
  if (g.pollingState === 'safety_stopped') return { stale: true, reason: 'polling_safety_stopped' };
  if (g.pollingState === 'complete') return { stale: false, reason: null };
  const age = now.getTime() - Date.parse(g.lastObservedAt);
  if ((IN_GAME.has(g.lifecycle) || g.lifecycle === 'unknown') && age > SCOREBOARD_LIVE_STALE_MS) {
    return { stale: true, reason: 'no_recent_observation' };
  }
  if (age > SCOREBOARD_IDLE_STALE_MS) return { stale: true, reason: 'no_recent_observation' };
  return { stale: false, reason: null };
}

export function buildScoreboardResponse(input: {
  date: string;
  now: Date;
  games: StoredScoreboardGame[];
  lines: ScoreboardPlayerLine[];
}): ScoreboardResponse {
  const games: ScoreboardGame[] = input.games.map((g) => {
    const s = staleness(g, input.now);
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
