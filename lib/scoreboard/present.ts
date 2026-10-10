/**
 * Presentation for scoreboard.v1. Display only.
 * Lifecycle text comes from `lifecycle`. Scores never promote a game to Final.
 */

import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';
import { GAME_LIFECYCLE_STATES, type GameLifecycleState } from '@/lib/betting/normalize-game-status';
import {
  isScoreboardSeasonType,
  type BoxScoreCompleteness,
  type ScoreboardGame,
  type ScoreboardSeasonType,
} from './contract';

const ET = 'America/New_York';

const SEASON_LABEL: Record<ScoreboardSeasonType, string> = {
  preseason: 'Preseason',
  regular: 'Regular season',
  playin: 'Play-in',
  playoffs: 'Playoffs',
};

const LIFECYCLE_LABEL: Record<GameLifecycleState, string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  halftime: 'Halftime',
  overtime: 'Overtime',
  final: 'Final',
  postponed: 'Postponed',
  canceled: 'Canceled',
  unknown: 'Status unavailable',
};

const SCORE_LIFECYCLES: ReadonlySet<GameLifecycleState> = new Set(['live', 'halftime', 'overtime', 'final']);

export type PresentedPlayer = {
  playerId: string;
  name: string;
  min: string;
  pts: string;
  reb: string;
  ast: string;
  fg: string;
  fg3: string;
  ft: string;
};

export type PresentedBoxTeam = {
  teamId: string;
  label: string;
  players: PresentedPlayer[];
};

export type PresentedGame = {
  gameId: string;
  seasonType: ScoreboardSeasonType | null;
  seasonLabel: string;
  /** True only for season_type preseason. */
  preseason: boolean;
  lifecycle: GameLifecycleState | null;
  lifecycleLabel: string;
  /** True only when the contract lifecycle is final. */
  isFinal: boolean;
  showScores: boolean;
  visitorAbbr: string;
  homeAbbr: string;
  visitorName: string;
  homeName: string;
  visitorScore: string | null;
  homeScore: string | null;
  tipoffLabel: string | null;
  periodClock: string | null;
  freshnessLabel: string;
  stale: boolean;
  staleLabel: string | null;
  /** Preseason projection and EV stay off. Null when this game is not preseason. */
  preseasonBettingNote: string | null;
  box: {
    completeness: BoxScoreCompleteness;
    label: string;
    showPlayers: boolean;
    acquiredLabel: string | null;
    teams: PresentedBoxTeam[];
  };
};

function isLifecycle(value: unknown): value is GameLifecycleState {
  return typeof value === 'string' && (GAME_LIFECYCLE_STATES as readonly string[]).includes(value);
}

function teamAbbr(abbr: string | null, name: string | null): string {
  const a = abbr?.trim();
  if (a) return a;
  const n = name?.trim();
  if (n) return n.slice(0, 3).toUpperCase();
  return '—';
}

function teamName(name: string | null, abbr: string): string {
  const n = name?.trim();
  return n || abbr;
}

export function formatObservedAt(iso: string | null | undefined): string {
  if (!iso) return 'Updated time unavailable';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Updated time unavailable';
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ET,
    timeZoneName: 'short',
  });
  return `Updated ${time}`;
}

export function seasonLabel(seasonType: ScoreboardSeasonType | null): string {
  if (!seasonType) return 'Season';
  return SEASON_LABEL[seasonType];
}

/** Status copy. Ignores scores, period, and clock. */
export function lifecycleLabel(lifecycle: GameLifecycleState | null): string {
  if (!lifecycle) return 'Status unavailable';
  return LIFECYCLE_LABEL[lifecycle];
}

const NOT_STARTED: ReadonlySet<GameLifecycleState> = new Set(['scheduled', 'postponed', 'canceled']);

export function staleWarning(game: Pick<ScoreboardGame, 'stale' | 'stale_reason' | 'lifecycle'>): string | null {
  if (!game.stale) return null;
  if (game.stale_reason === 'polling_safety_stopped') return 'Updates paused';
  if (NOT_STARTED.has(game.lifecycle)) return null;
  return 'Score may be out of date';
}

/**
 * Period and clock for in-progress games, plus an OT mark on a final overtime game.
 * Halftime, postponed, canceled, and scheduled keep the lifecycle badge as the status.
 */
export function formatPeriodClock(game: Pick<ScoreboardGame, 'lifecycle' | 'period' | 'clock' | 'overtime_periods'>): string | null {
  const clock = game.clock?.trim() || null;
  if (game.lifecycle === 'live') {
    const quarter = game.period != null && game.period > 0 && game.period <= 4 ? `Q${game.period}` : 'Live';
    return clock ? `${quarter} ${clock}` : quarter;
  }
  if (game.lifecycle === 'overtime') {
    const ot =
      game.overtime_periods > 0
        ? game.overtime_periods
        : game.period != null && game.period > 4
          ? game.period - 4
          : 1;
    const label = ot <= 1 ? 'OT' : `${ot}OT`;
    return clock ? `${label} ${clock}` : label;
  }
  if (game.lifecycle === 'final' && game.overtime_periods > 0) {
    return game.overtime_periods === 1 ? 'OT' : `${game.overtime_periods}OT`;
  }
  return null;
}

function stat(value: number | null): string {
  return value == null ? '—' : String(value);
}

function madeAttempt(made: number | null, attempted: number | null): string {
  if (made == null && attempted == null) return '—';
  return `${made ?? '—'}–${attempted ?? '—'}`;
}

function presentPlayer(line: ScoreboardGame['box_score']['players'][number]): PresentedPlayer {
  return {
    playerId: line.playerId,
    name: line.name?.trim() || 'Unknown player',
    min: line.min?.trim() || '—',
    pts: stat(line.pts),
    reb: stat(line.reb),
    ast: stat(line.ast),
    fg: madeAttempt(line.fgm, line.fga),
    fg3: madeAttempt(line.fg3m, line.fg3a),
    ft: madeAttempt(line.ftm, line.fta),
  };
}

const BOX_LABEL: Record<BoxScoreCompleteness, string> = {
  none: 'Box score not available',
  live_partial: 'Partial box score',
  final_unverified: 'Box score not fully verified',
  verified_final: 'Final box score',
};

function presentBox(game: ScoreboardGame, visitorLabel: string, homeLabel: string): PresentedGame['box'] {
  const completeness = game.box_score?.completeness ?? 'none';
  const players = completeness === 'none' ? [] : (game.box_score?.players ?? []);
  const groups = new Map<string, PresentedBoxTeam>();
  const order = [game.visitor.provider_team_id, game.home.provider_team_id];
  for (const teamId of order) {
    groups.set(teamId, {
      teamId,
      label: teamId === game.visitor.provider_team_id ? visitorLabel : homeLabel,
      players: [],
    });
  }
  const ranked = [...players].sort((a, b) => {
    const ap = a.pts == null ? -1 : a.pts;
    const bp = b.pts == null ? -1 : b.pts;
    if (bp !== ap) return bp - ap;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
  for (const line of ranked) {
    let group = groups.get(line.teamId);
    if (!group) {
      group = { teamId: line.teamId, label: 'Other', players: [] };
      groups.set(line.teamId, group);
    }
    group.players.push(presentPlayer(line));
  }
  const teams = [...groups.values()].filter((team) => team.players.length > 0);
  return {
    completeness,
    label: BOX_LABEL[completeness] ?? 'Box score not available',
    showPlayers: teams.length > 0,
    acquiredLabel: game.box_score?.acquired_at ? formatObservedAt(game.box_score.acquired_at) : null,
    teams,
  };
}

export function presentScoreboardGame(game: ScoreboardGame): PresentedGame | null {
  if (!game || typeof game.game_id !== 'string' || !game.game_id) return null;
  const lifecycle = isLifecycle(game.lifecycle) ? game.lifecycle : null;
  const seasonType = isScoreboardSeasonType(game.season_type) ? game.season_type : null;
  const visitorAbbr = teamAbbr(game.visitor?.abbreviation ?? null, game.visitor?.name ?? null);
  const homeAbbr = teamAbbr(game.home?.abbreviation ?? null, game.home?.name ?? null);
  const showScores =
    lifecycle != null &&
    SCORE_LIFECYCLES.has(lifecycle) &&
    game.visitor?.score != null &&
    game.home?.score != null &&
    Number.isFinite(game.visitor.score) &&
    Number.isFinite(game.home.score);
  const preseason = seasonType === 'preseason';
  return {
    gameId: game.game_id,
    seasonType,
    seasonLabel: seasonLabel(seasonType),
    preseason,
    lifecycle,
    lifecycleLabel: lifecycleLabel(lifecycle),
    isFinal: lifecycle === 'final',
    showScores,
    visitorAbbr,
    homeAbbr,
    visitorName: teamName(game.visitor?.name ?? null, visitorAbbr),
    homeName: teamName(game.home?.name ?? null, homeAbbr),
    visitorScore: showScores ? String(game.visitor.score) : null,
    homeScore: showScores ? String(game.home.score) : null,
    tipoffLabel: lifecycle === 'scheduled' ? formatTipoffEt(game.scheduled_tip) || null : null,
    periodClock: lifecycle ? formatPeriodClock({ ...game, lifecycle }) : null,
    freshnessLabel: formatObservedAt(game.acquired_at),
    stale: game.stale === true,
    staleLabel: staleWarning(game),
    preseasonBettingNote: preseason
      ? 'Projections and expected value are unavailable for preseason.'
      : null,
    box: presentBox(game, visitorAbbr, homeAbbr),
  };
}

export function presentScoreboardGames(games: ScoreboardGame[]): PresentedGame[] {
  return games.flatMap((game) => {
    const presented = presentScoreboardGame(game);
    return presented ? [presented] : [];
  });
}
