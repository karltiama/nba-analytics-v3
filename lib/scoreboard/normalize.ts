/**
 * Provider rows → scoreboard observations. Pure functions only.
 *
 * Season type is taken from the request that produced the row. A row whose own payload contradicts
 * that request (a different season_type, or postseason=true under a preseason/regular request) is
 * rejected rather than relabelled.
 */

import { resolveGameLifecycle, type GameLifecycleState } from '@/lib/betting/normalize-game-status';
import { etYmd } from '@/lib/games/status-sync-query';
import type {
  BoxScoreCompleteness,
  ScoreboardPlayerLine,
  ScoreboardSeasonType,
  StoredScoreboardGame,
} from './contract';

type Obj = Record<string, unknown>;

const TERMINAL: ReadonlySet<GameLifecycleState> = new Set(['final', 'postponed', 'canceled']);
export const IN_GAME: ReadonlySet<GameLifecycleState> = new Set(['live', 'halftime', 'overtime']);

export function isTerminalLifecycle(l: GameLifecycleState): boolean {
  return TERMINAL.has(l);
}

function obj(v: unknown): Obj | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}
function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}
function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

export type ObservationContext = {
  requestSeasonType: ScoreboardSeasonType;
  targetSeason: number;
  requestId: string;
  observedAt: string;
};

export type GameObservation = Omit<
  StoredScoreboardGame,
  | 'firstObservedAt'
  | 'lastChangedAt'
  | 'terminalConfirmations'
  | 'finalObservedAt'
  | 'pollingState'
  | 'boxCompleteness'
  | 'boxRequestId'
  | 'boxObservedAt'
  | 'finalBoxAttempts'
>;

export type NormalizeResult = { ok: true; game: GameObservation } | { ok: false; reason: string; gameId: string | null };

function etDateOf(raw: Obj): string | null {
  const d = str(raw.date);
  if (d && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const dt = str(raw.datetime);
  if (dt && Number.isFinite(Date.parse(dt))) return etYmd(new Date(dt));
  return null;
}

function overtimePeriods(raw: Obj, period: number | null): number {
  const fromFields = [1, 2, 3].filter((n) => raw[`home_ot${n}`] != null || raw[`visitor_ot${n}`] != null).length;
  const fromPeriod = period != null && period > 4 ? period - 4 : 0;
  return Math.max(fromFields, fromPeriod);
}

/** One /v1/games row → observation, or a rejection reason. */
export function normalizeGameRow(rawInput: unknown, ctx: ObservationContext, now: Date): NormalizeResult {
  const raw = obj(rawInput);
  if (!raw) return { ok: false, reason: 'row_not_object', gameId: null };
  const gameId = str(raw.id);
  const home = obj(raw.home_team);
  const visitor = obj(raw.visitor_team);
  const homeTeamId = str(home?.id);
  const visitorTeamId = str(visitor?.id);
  if (!gameId || !homeTeamId || !visitorTeamId) return { ok: false, reason: 'missing_identity', gameId };

  const declared = str(raw.season_type)?.toLowerCase() ?? null;
  if (declared && declared !== ctx.requestSeasonType) {
    return { ok: false, reason: `provenance_conflict: row season_type=${declared}`, gameId };
  }
  if (raw.postseason === true && (ctx.requestSeasonType === 'preseason' || ctx.requestSeasonType === 'regular')) {
    return { ok: false, reason: 'provenance_conflict: postseason=true', gameId };
  }
  const season = int(raw.season);
  if (season != null && season !== ctx.targetSeason) {
    return { ok: false, reason: `season_mismatch: ${season}`, gameId };
  }
  const etDate = etDateOf(raw);
  if (!etDate) return { ok: false, reason: 'missing_date', gameId };

  const period = int(raw.period);
  const homeScore = int(raw.home_team_score);
  const visitorScore = int(raw.visitor_team_score);
  const scheduledTip = str(raw.datetime);
  const providerStatus = str(raw.status);
  const providerStatusState = str(raw.status_state);
  const lifecycle = resolveGameLifecycle({
    statusRaw: providerStatus,
    statusState: providerStatusState,
    period,
    postponed: raw.postponed === true,
    startTime: scheduledTip,
    homeScore,
    awayScore: visitorScore,
    now,
  });

  return {
    ok: true,
    game: {
      gameId,
      season: ctx.targetSeason,
      seasonType: ctx.requestSeasonType,
      seasonTypeSource: 'request_season_type',
      etDate,
      scheduledTip,
      homeTeamId,
      homeAbbr: str(home?.abbreviation),
      homeName: str(home?.full_name),
      homeScore,
      visitorTeamId,
      visitorAbbr: str(visitor?.abbreviation),
      visitorName: str(visitor?.full_name),
      visitorScore,
      providerStatus,
      providerStatusState,
      period,
      clock: str(raw.time),
      overtimePeriods: overtimePeriods(raw, period),
      lifecycle,
      gamesRequestId: ctx.requestId,
      lastObservedAt: ctx.observedAt,
    },
  };
}

function changed(prev: StoredScoreboardGame, next: GameObservation): boolean {
  return (
    prev.homeScore !== next.homeScore ||
    prev.visitorScore !== next.visitorScore ||
    prev.period !== next.period ||
    prev.clock !== next.clock ||
    prev.providerStatus !== next.providerStatus ||
    prev.providerStatusState !== next.providerStatusState ||
    prev.lifecycle !== next.lifecycle
  );
}

/** Fold a new observation into the stored row. Polling state is decided by the planner. */
export function mergeObservation(prev: StoredScoreboardGame | null, next: GameObservation): StoredScoreboardGame {
  const at = next.lastObservedAt;
  const terminal = isTerminalLifecycle(next.lifecycle);
  if (!prev) {
    return {
      ...next,
      firstObservedAt: at,
      lastChangedAt: at,
      terminalConfirmations: terminal ? 1 : 0,
      finalObservedAt: next.lifecycle === 'final' ? at : null,
      pollingState: 'pending',
      boxCompleteness: 'none',
      boxRequestId: null,
      boxObservedAt: null,
      finalBoxAttempts: 0,
    };
  }
  const isChange = changed(prev, next);
  return {
    ...prev,
    ...next,
    firstObservedAt: prev.firstObservedAt,
    lastChangedAt: isChange ? at : prev.lastChangedAt,
    terminalConfirmations: terminal ? (isChange && prev.lifecycle !== next.lifecycle ? 1 : prev.terminalConfirmations + 1) : 0,
    finalObservedAt: next.lifecycle === 'final' ? (prev.finalObservedAt ?? at) : null,
    finalBoxAttempts: next.lifecycle === 'final' ? prev.finalBoxAttempts : 0,
  };
}

export type LiveBoxMatch = {
  byGame: Map<string, ScoreboardPlayerLine[]>;
  unmatched: number;
  ambiguous: number;
};

function playerLines(gameId: string, team: Obj | null): ScoreboardPlayerLine[] {
  const teamId = str(team?.id);
  const players = Array.isArray(team?.players) ? (team!.players as unknown[]) : [];
  const lines: ScoreboardPlayerLine[] = [];
  for (const p of players) {
    const row = obj(p);
    if (!row || !teamId) continue;
    const player = obj(row.player);
    const playerId = str(player?.id ?? row.id);
    if (!playerId) continue;
    const first = str(player?.first_name ?? row.first_name);
    const last = str(player?.last_name ?? row.last_name);
    lines.push({
      gameId,
      playerId,
      teamId,
      name: [first, last].filter(Boolean).join(' ') || null,
      min: str(row.min),
      pts: int(row.pts),
      reb: int(row.reb),
      ast: int(row.ast),
    });
  }
  return lines;
}

/**
 * /box_scores/live rows carry no game id; match on (ET date, home team, visitor team) against games
 * already observed from /games under the same season type. Unmatched or ambiguous rows are dropped.
 */
export function matchLiveBoxScores(rows: unknown[], games: StoredScoreboardGame[]): LiveBoxMatch {
  const index = new Map<string, StoredScoreboardGame[]>();
  for (const g of games) {
    const key = `${g.etDate}|${g.homeTeamId}|${g.visitorTeamId}`;
    index.set(key, [...(index.get(key) ?? []), g]);
  }
  const byGame = new Map<string, ScoreboardPlayerLine[]>();
  let unmatched = 0;
  let ambiguous = 0;
  for (const r of rows) {
    const row = obj(r);
    if (!row) {
      unmatched += 1;
      continue;
    }
    const home = obj(row.home_team);
    const visitor = obj(row.visitor_team);
    const date = etDateOf(row);
    const candidates = index.get(`${date}|${str(home?.id)}|${str(visitor?.id)}`) ?? [];
    if (candidates.length === 0) {
      unmatched += 1;
      continue;
    }
    if (candidates.length > 1) {
      ambiguous += 1;
      continue;
    }
    const gameId = candidates[0].gameId;
    byGame.set(gameId, [...playerLines(gameId, home), ...playerLines(gameId, visitor)]);
  }
  return { byGame, unmatched, ambiguous };
}

export function boxScoreCompleteness(
  game: Pick<StoredScoreboardGame, 'lifecycle' | 'finalObservedAt' | 'homeTeamId' | 'visitorTeamId' | 'homeScore' | 'visitorScore'>,
  lines: ScoreboardPlayerLine[],
  boxObservedAt: string | null
): BoxScoreCompleteness {
  if (lines.length === 0 || !boxObservedAt) return 'none';
  if (game.lifecycle !== 'final') return 'live_partial';
  const sum = (teamId: string) => lines.filter((l) => l.teamId === teamId).reduce((s, l) => s + (l.pts ?? 0), 0);
  const afterFinal = game.finalObservedAt != null && Date.parse(boxObservedAt) >= Date.parse(game.finalObservedAt);
  const reconciles =
    game.homeScore != null &&
    game.visitorScore != null &&
    sum(game.homeTeamId) === game.homeScore &&
    sum(game.visitorTeamId) === game.visitorScore;
  return afterFinal && reconciles ? 'verified_final' : 'final_unverified';
}
