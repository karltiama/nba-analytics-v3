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
  type ScoreboardMarket,
  type ScoreboardSeasonType,
} from './contract';
import { checkMarkets, MARKET_VENDOR_ORDER, marketSourceCaption } from './market';
import {
  freshnessAgeLabel,
  gameContext,
  gamePhase,
  gamePulse,
  statLeaders,
  type GameContext,
  type GamePhase,
  type GamePulse,
  type StatLeaders,
} from './game-pulse';

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
  /** "Updated 2m ago": acquired_at measured against the response generated_at. Null when unknown or over an hour. */
  freshnessAge: string | null;
  phase: GamePhase;
  /** lifecycleLabel, or Delayed / Suspended from provider_status when the lifecycle is unknown. */
  statusLabel: string;
  /** Score leader or winner. Drives final-score emphasis; not shown as panel text. */
  pulse: GamePulse | null;
  /** Game Pulse / Game Recap panel text: a team-stat insight or a quiet fallback. Null before tip. */
  context: GameContext | null;
  /** Points / rebounds / assists leaders, or a player-data status. Null before tip and when stale. */
  leaders: StatLeaders | null;
  stale: boolean;
  staleLabel: string | null;
  /** Preseason projection and EV stay off. Null when this game is not preseason. */
  preseasonBettingNote: string | null;
  /** One sportsbook's verified current quote. Null unless the game is scheduled and the payload carries one. */
  market: PresentedMarket | null;
  box: {
    completeness: BoxScoreCompleteness;
    label: string;
    showPlayers: boolean;
    acquiredLabel: string | null;
    teams: PresentedBoxTeam[];
  };
};

export type PresentedMarket = {
  vendorLabel: string;
  moneyline: ScoreboardMarket['moneyline'];
  spread: ScoreboardMarket['spread'];
  total: ScoreboardMarket['total'];
  /** "DraftKings · BDL synced 3m ago", measured against the response generated_at. */
  caption: string;
};

/**
 * Re-checks the payload's market with the same per-market rules the server used, so a malformed or
 * hand-edited payload cannot put an unverified price on a card.
 */
export function presentMarket(game: ScoreboardGame, generatedAt?: string | null): PresentedMarket | null {
  const m = game.market;
  if (!m || typeof m !== 'object') return null;
  if (game.lifecycle !== 'scheduled' || game.stale === true) return null;
  if (m.kind !== 'current_pregame' || (m.freshness !== 'fresh' && m.freshness !== 'delayed')) return null;
  if (!(MARKET_VENDOR_ORDER as readonly string[]).includes(m.vendor)) return null;
  const checked = checkMarkets({
    gameId: game.game_id,
    vendor: m.vendor,
    quoteKind: 'current',
    moneylineHome: m.moneyline?.home ?? null,
    moneylineAway: m.moneyline?.away ?? null,
    spreadHome: m.spread?.home ?? null,
    spreadHomeOdds: m.spread?.home_odds ?? null,
    spreadAway: m.spread?.away ?? null,
    spreadAwayOdds: m.spread?.away_odds ?? null,
    total: m.total?.line ?? null,
    totalOverOdds: m.total?.over_odds ?? null,
    totalUnderOdds: m.total?.under_odds ?? null,
    providerUpdatedAt: m.provider_updated_at,
    vendorSyncedAt: null,
    openedAt: null,
    firstObservedAt: m.observed_at,
    observedAt: m.observed_at,
    requestId: '',
    withdrawnAt: null,
    withdrawnRequestId: null,
  });
  if (!checked.moneyline && !checked.spread && !checked.total) return null;
  const nowMs = generatedAt ? Date.parse(generatedAt) : NaN;
  const caption = marketSourceCaption(m, nowMs) ?? m.vendor_label;
  return { vendorLabel: m.vendor_label, ...checked, caption };
}

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

/**
 * Card status. Same as lifecycleLabel, except an unknown lifecycle whose provider status says
 * delayed or suspended shows that word. It never promotes a game to Live or Final.
 */
export function cardStatusLabel(lifecycle: GameLifecycleState | null, providerStatus: string | null | undefined): string {
  if (lifecycle == null || lifecycle === 'unknown') {
    const status = providerStatus?.toLowerCase() ?? '';
    if (status.includes('delay')) return 'Delayed';
    if (status.includes('suspend')) return 'Suspended';
  }
  return lifecycleLabel(lifecycle);
}

const NOT_STARTED: ReadonlySet<GameLifecycleState> = new Set(['scheduled', 'postponed', 'canceled']);

export function staleWarning(game: Pick<ScoreboardGame, 'stale' | 'stale_reason' | 'lifecycle'>): string | null {
  if (!game.stale) return null;
  if (game.stale_reason === 'polling_safety_stopped') return 'Updates paused';
  if (NOT_STARTED.has(game.lifecycle)) return null;
  return 'Score may be out of date';
}

const PERIOD_PREFIX = /^(?:Q(\d+)|(\d+)OT|OT(\d*))\b\s*/i;
const CLOCK_TIME = /^\d{1,2}(?::\d{2})?(?:\.\d+)?$/;

function otLabel(count: number): string {
  return count <= 1 ? 'OT' : `${count}OT`;
}

/**
 * Splits a provider clock such as "Q1 4:35", "2OT 0:48", "OT2 0:48", or "4:35" into its own
 * period label (if any) and the time. Text that is not a game clock is dropped.
 */
function splitProviderClock(raw: string | null | undefined): { label: string | null; time: string | null } {
  let rest = raw?.trim() ?? '';
  let label: string | null = null;
  const prefix = rest.match(PERIOD_PREFIX);
  if (prefix) {
    if (prefix[1]) label = `Q${Number(prefix[1])}`;
    else if (prefix[2]) label = otLabel(Number(prefix[2]));
    else label = otLabel(prefix[3] ? Number(prefix[3]) : 1);
    rest = rest.slice(prefix[0].length).trim();
  }
  return { label, time: CLOCK_TIME.test(rest) ? rest : null };
}

/**
 * Period and clock for in-progress games, plus an OT mark on a final overtime game.
 * The period label comes from the normalized period; the provider clock contributes only its time,
 * so a clock that already reads "Q1 4:35" is not prefixed twice.
 * Halftime, postponed, canceled, and scheduled keep the lifecycle badge as the status.
 */
export function formatPeriodClock(game: Pick<ScoreboardGame, 'lifecycle' | 'period' | 'clock' | 'overtime_periods'>): string | null {
  const provider = splitProviderClock(game.clock);
  if (game.lifecycle === 'live') {
    const quarter =
      game.period != null && game.period > 0 && game.period <= 4 ? `Q${game.period}` : provider.label ?? 'Live';
    return provider.time ? `${quarter} ${provider.time}` : quarter;
  }
  if (game.lifecycle === 'overtime') {
    const count =
      game.overtime_periods > 0
        ? game.overtime_periods
        : game.period != null && game.period > 4
          ? game.period - 4
          : null;
    const label = count != null ? otLabel(count) : provider.label?.includes('OT') ? provider.label : 'OT';
    return provider.time ? `${label} ${provider.time}` : label;
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

export function presentScoreboardGame(game: ScoreboardGame, generatedAt?: string | null): PresentedGame | null {
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
    freshnessAge: generatedAt ? freshnessAgeLabel(game.acquired_at, Date.parse(generatedAt)) : null,
    phase: gamePhase(lifecycle),
    statusLabel: cardStatusLabel(lifecycle, game.provider_status),
    pulse: lifecycle ? gamePulse({ ...game, lifecycle }) : null,
    context: lifecycle ? gameContext({ ...game, lifecycle }) : null,
    leaders: lifecycle ? statLeaders({ ...game, lifecycle }) : null,
    stale: game.stale === true,
    staleLabel: staleWarning(game),
    preseasonBettingNote: preseason
      ? 'Projections and expected value are unavailable for preseason.'
      : null,
    market: presentMarket(game, generatedAt),
    box: presentBox(game, visitorAbbr, homeAbbr),
  };
}

export function presentScoreboardGames(games: ScoreboardGame[]): PresentedGame[] {
  return games.flatMap((game) => {
    const presented = presentScoreboardGame(game);
    return presented ? [presented] : [];
  });
}
