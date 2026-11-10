/**
 * Client-side Quick Builds preview.
 * Formats and validates the existing API response. Does not rank or query.
 */

import { formatAmericanOdds, formatMarketLine } from '@/lib/betting/market-movement-format';
import type { PlayerPropV1Vendor } from '@/lib/betting/market-movement';
import { assessQuickBuildPair, type QuickBuildHandoffLeg } from '@/lib/parlay/adapt-quick-build';
import { XRAY_PROP_KIND_LABEL, type XrayPropKind } from '@/lib/parlay-xray/types';
import {
  QUICK_BUILD_DISPLAY_GAPS,
  type QuickBuildDisplayGap,
} from './display';
import {
  QUICK_BUILD_EMPTY_REASONS,
  QUICK_BUILD_PRESETS,
  QUICK_BUILD_SHORTLIST_CAP,
  type BlockingAttemptKind,
  type QuickBuildEmptyReason,
  type QuickBuildPresetName,
} from './types';

export const QUICK_BUILD_BOOK_OPTIONS = [
  { vendor: 'draftkings', label: 'DraftKings' },
  { vendor: 'fanduel', label: 'FanDuel' },
  { vendor: 'betmgm', label: 'BetMGM' },
  { vendor: 'caesars', label: 'Caesars' },
] as const satisfies readonly { vendor: PlayerPropV1Vendor; label: string }[];

export const QUICK_BUILD_PAYOUT_OPTIONS = [
  { preset: 'higher_hit_chance', label: 'Lower Payout', rangeLabel: '−200 to −110' },
  { preset: 'balanced', label: 'Balanced', rangeLabel: '−110 to +125' },
  { preset: 'higher_payout', label: 'Higher Payout', rangeLabel: '+125 to +200' },
] as const satisfies readonly {
  preset: QuickBuildPresetName;
  label: string;
  rangeLabel: string;
}[];

export const QUICK_BUILD_DEFAULT_BOOK: PlayerPropV1Vendor = 'draftkings';
export const QUICK_BUILD_DEFAULT_PRESET: QuickBuildPresetName = 'balanced';

export const QUICK_BUILD_RESEARCH_SNAPSHOT_COPY =
  'Based on previously observed sportsbook prices. Lines may have changed.';
export const QUICK_BUILD_COMBINED_ODDS_COPY =
  'Combined odds are calculated from individual leg prices, not a confirmed sportsbook parlay quote.';
export const QUICK_BUILD_BREAK_EVEN_COPY =
  'The hit rate required to break even at this calculated price. Not a predicted chance of winning.';
export const QUICK_BUILD_PRESET_EXPLANATION =
  'These presets are combined payout targets, not a validated chance of winning. A selected range is not guaranteed to contain a combination.';

export const QUICK_BUILD_LOWER_PAYOUT_EMPTY_SUGGESTION = 'Try Balanced or another sportsbook.';

export const QUICK_BUILD_AGE_AT_SEARCH_NOTE =
  'Age at search was calculated when this search was generated. It does not update while the result stays open.';

export const QUICK_BUILD_EMPTY_COPY: Record<QuickBuildEmptyReason, string> = {
  NO_UPCOMING_GAMES: 'There are no upcoming eligible NBA games in this slate.',
  NO_SUCCESSFUL_PULL: 'No usable recent game-level prop snapshot is available for this selection.',
  NO_ELIGIBLE_MARKETS: "We couldn't find enough eligible two-sided player prop markets for this sportsbook.",
  NO_CROSS_GAME: 'At least two eligible games are needed to construct a Quick Build.',
  NO_PAIRS_IN_BAND: 'No observed two-leg combinations matched this payout range.',
};

/** Extra guidance for Lower Payout only. The empty reason itself stays unchanged. */
export function lowerPayoutEmptySuggestion(
  preset: QuickBuildPresetName,
  reason: QuickBuildEmptyReason | null,
): string | null {
  if (preset === 'higher_hit_chance' && reason === 'NO_PAIRS_IN_BAND') {
    return QUICK_BUILD_LOWER_PAYOUT_EMPTY_SUGGESTION;
  }
  return null;
}

const BLOCKING_KIND_LABEL: Record<BlockingAttemptKind, string> = {
  failed: 'failed',
  zero_row: 'zero-row',
  invalid_clock: 'invalid-clock',
  in_progress: 'in-progress',
  incomplete: 'incomplete',
};

const GAP_COPY: Record<QuickBuildDisplayGap, string> = {
  MISSING_PLAYER: 'Player name unavailable',
  INVALID_PLAYER_NAME: 'Player name unavailable',
  AMBIGUOUS_PLAYER: 'Player name unavailable',
  MISSING_GAME_START: 'Game start time unavailable',
};

export type QuickBuildPreviewLeg = {
  playerName: string | null;
  unavailable: string | null;
  marketLabel: string;
  sideLabel: string;
  lineLabel: string;
  oddsLabel: string;
  gameStartLabel: string | null;
  gameStatus: string | null;
  observedLabel: string;
  noVigLabel: string | null;
};

export type QuickBuildPreviewCard = {
  id: string;
  number: number;
  displayReady: boolean;
  combinedOddsLabel: string;
  breakEvenLabel: string;
  oldestObservedLabel: string;
  newestObservedLabel: string;
  oldestAgeLabel: string;
  warning: string | null;
  legs: [QuickBuildPreviewLeg, QuickBuildPreviewLeg];
  /**
   * Present only when both legs pass canonical handoff validation.
   * Display-ready cards can still omit this when a market, book, or price cannot be transferred.
   * Not rendered as an id.
   */
  handoff: [QuickBuildHandoffLeg, QuickBuildHandoffLeg] | null;
};

export type QuickBuildPreviewView = {
  generatedAtLabel: string;
  sportsbookLabel: string;
  emptyReason: QuickBuildEmptyReason | null;
  emptyMessage: string | null;
  researchLimitation: string | null;
  builds: QuickBuildPreviewCard[];
};

export type QuickBuildFetchResult =
  | { kind: 'ok'; view: QuickBuildPreviewView }
  | { kind: 'empty'; view: QuickBuildPreviewView }
  | { kind: 'unauthorized' }
  | { kind: 'invalid' }
  | { kind: 'limit' }
  | { kind: 'server' }
  | { kind: 'network' }
  | { kind: 'malformed' }
  | { kind: 'aborted' };

export type PreviewPhase = 'idle' | 'loading' | 'ready' | 'error';

export type PreviewModel = {
  sportsbook: PlayerPropV1Vendor;
  preset: QuickBuildPresetName;
  phase: PreviewPhase;
  requestId: number;
  view: QuickBuildPreviewView | null;
  message: string | null;
};

export function initialPreviewModel(): PreviewModel {
  return {
    sportsbook: QUICK_BUILD_DEFAULT_BOOK,
    preset: QUICK_BUILD_DEFAULT_PRESET,
    phase: 'idle',
    requestId: 0,
    view: null,
    message: null,
  };
}

export function previewRequestPath(sportsbook: PlayerPropV1Vendor, preset: QuickBuildPresetName): string {
  return `/api/parlay-workspace/quick-builds?sportsbook=${encodeURIComponent(sportsbook)}&preset=${encodeURIComponent(preset)}`;
}

export function bookLabel(vendor: string): string {
  return QUICK_BUILD_BOOK_OPTIONS.find((book) => book.vendor === vendor)?.label ?? vendor;
}

export function formatEtTimestamp(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const dayPeriod = get('dayPeriod');
  const zone = get('timeZoneName');
  if (!month || !day || !hour || !minute || !dayPeriod || !zone) return null;
  return `${month} ${day}, ${hour}:${minute} ${dayPeriod} ${zone}`;
}

/** Age of the stored observation at the time the API built the result. */
export function formatObservationAge(ageMs: number): string | null {
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'under 1 minute';
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourLabel = hours === 1 ? '1 hour' : `${hours} hours`;
  if (remainder === 0) return hourLabel;
  const minuteLabel = remainder === 1 ? '1 minute' : `${remainder} minutes`;
  return `${hourLabel} ${minuteLabel}`;
}

export function parseQuickBuildResponse(data: unknown): QuickBuildPreviewView | null {
  if (!isRecord(data)) return null;
  if (data.status !== 'ok' && data.status !== 'empty') return null;
  if (data.snapshotClass !== 'research_snapshot') return null;
  if (typeof data.generatedAt !== 'string' || formatEtTimestamp(data.generatedAt) == null) return null;
  if (!Array.isArray(data.builds) || !Array.isArray(data.games)) return null;
  const emptyReason = data.emptyReason;
  if (data.status === 'empty') {
    if (!isEmptyReason(emptyReason) || data.builds.length > 0) return null;
  } else if (emptyReason !== null || data.builds.length === 0) {
    return null;
  }
  const sportsbook = typeof data.sportsbook === 'string' ? data.sportsbook : '';
  const games = parseGames(data.games);
  if (!games) return null;
  const builds: QuickBuildPreviewCard[] = [];
  for (const raw of data.builds.slice(0, QUICK_BUILD_SHORTLIST_CAP)) {
    const card = parseBuild(raw, builds.length + 1, games);
    if (!card) return null;
    builds.push(card);
  }
  const limitation = Array.isArray(data.limitations) && typeof data.limitations[0] === 'string' ? data.limitations[0] : null;
  return {
    generatedAtLabel: formatEtTimestamp(data.generatedAt) as string,
    sportsbookLabel: bookLabel(sportsbook),
    emptyReason: data.status === 'empty' ? (emptyReason as QuickBuildEmptyReason) : null,
    emptyMessage: data.status === 'empty' ? QUICK_BUILD_EMPTY_COPY[emptyReason as QuickBuildEmptyReason] : null,
    researchLimitation: limitation,
    builds,
  };
}

export function previewErrorMessage(kind: Exclude<QuickBuildFetchResult['kind'], 'ok' | 'empty' | 'aborted'>): string {
  switch (kind) {
    case 'unauthorized':
      return 'Your session expired. Sign in again to find Quick Builds.';
    case 'invalid':
      return 'That sportsbook or payout target is not supported.';
    case 'limit':
      return 'Too many eligible markets to build a shortlist safely. This is not an empty market.';
    case 'server':
      return 'Quick Builds could not be loaded. This is not an empty market.';
    case 'network':
      return 'Quick Builds could not be reached. This is not an empty market.';
    case 'malformed':
      return 'The Quick Builds response could not be read. This is not an empty market.';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export async function fetchQuickBuilds(args: {
  sportsbook: PlayerPropV1Vendor;
  preset: QuickBuildPresetName;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<QuickBuildFetchResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(previewRequestPath(args.sportsbook, args.preset), {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: args.signal,
    });
    if (response.status === 401) return { kind: 'unauthorized' };
    if (response.status === 400) return { kind: 'invalid' };
    if (response.status === 422) {
      const body = await readJson(response);
      return isRecord(body) && body.code === 'LIMIT_EXCEEDED' ? { kind: 'limit' } : { kind: 'server' };
    }
    if (!response.ok) return { kind: 'server' };
    const body = await readJson(response);
    if (body === undefined) return { kind: 'malformed' };
    const view = parseQuickBuildResponse(body);
    if (!view) return { kind: 'malformed' };
    return view.emptyReason ? { kind: 'empty', view } : { kind: 'ok', view };
  } catch (error: unknown) {
    if (isAbortError(error)) return { kind: 'aborted' };
    return { kind: 'network' };
  }
}

export function beginPreviewRequest(state: PreviewModel): { state: PreviewModel; requestId: number } {
  const requestId = state.requestId + 1;
  return {
    requestId,
    state: { ...state, requestId, phase: 'loading', view: null, message: null },
  };
}

export function invalidatePreview(state: PreviewModel, patch: { sportsbook?: PlayerPropV1Vendor; preset?: QuickBuildPresetName }): PreviewModel {
  return {
    ...state,
    sportsbook: patch.sportsbook ?? state.sportsbook,
    preset: patch.preset ?? state.preset,
    phase: 'idle',
    requestId: state.requestId + 1,
    view: null,
    message: null,
  };
}

export function acceptPreviewResult(
  state: PreviewModel,
  request: { requestId: number; sportsbook: PlayerPropV1Vendor; preset: QuickBuildPresetName },
  result: QuickBuildFetchResult,
): PreviewModel {
  if (state.requestId !== request.requestId) return state;
  if (state.sportsbook !== request.sportsbook || state.preset !== request.preset) return state;
  if (result.kind === 'aborted') return state;
  if (result.kind === 'ok' || result.kind === 'empty') {
    return { ...state, phase: 'ready', view: result.view, message: null };
  }
  return { ...state, phase: 'error', view: null, message: previewErrorMessage(result.kind) };
}

function parseBuild(raw: unknown, number: number, games: Map<string, NewerAttempt | null>): QuickBuildPreviewCard | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  if (!isFiniteNumber(raw.combinedAmerican) || !isFiniteNumber(raw.breakEvenProbability)) return null;
  if (typeof raw.oldestObservedAt !== 'string' || formatEtTimestamp(raw.oldestObservedAt) == null) return null;
  if (typeof raw.newestObservedAt !== 'string' || formatEtTimestamp(raw.newestObservedAt) == null) return null;
  if (!isFiniteNumber(raw.maxAgeMs) || raw.maxAgeMs < 0) return null;
  if (!Array.isArray(raw.legs) || raw.legs.length !== 2) return null;
  const first = parseLeg(raw.legs[0]);
  const second = parseLeg(raw.legs[1]);
  if (!first || !second) return null;
  const age = formatObservationAge(raw.maxAgeMs);
  if (!age) return null;
  const displayReady = first.ready && second.ready;
  const candidate = displayReady ? handoffPair(raw.legs[0], raw.legs[1]) : null;
  const handoff = candidate && assessQuickBuildPair(candidate).ok ? candidate : null;
  return {
    id: raw.id,
    number,
    displayReady,
    combinedOddsLabel: formatAmericanOdds(raw.combinedAmerican),
    breakEvenLabel: percentLabel(raw.breakEvenProbability),
    oldestObservedLabel: formatEtTimestamp(raw.oldestObservedAt) as string,
    newestObservedLabel: formatEtTimestamp(raw.newestObservedAt) as string,
    oldestAgeLabel: age,
    warning: warningFor([first.gameId, second.gameId], games),
    legs: [first.leg, second.leg],
    handoff,
  };
}

function handoffPair(first: unknown, second: unknown): [QuickBuildHandoffLeg, QuickBuildHandoffLeg] | null {
  const left = handoffLeg(first);
  const right = handoffLeg(second);
  if (!left || !right) return null;
  return [left, right];
}

function handoffLeg(raw: unknown): QuickBuildHandoffLeg | null {
  if (!isRecord(raw)) return null;
  const playerId = raw.playerId;
  const id = typeof playerId === 'number' && Number.isFinite(playerId) ? String(playerId) : typeof playerId === 'string' ? playerId.trim() : '';
  if (!id || typeof raw.gameId !== 'string' || typeof raw.market !== 'string') return null;
  if (raw.side !== 'over' && raw.side !== 'under') return null;
  if (!isFiniteNumber(raw.line) || !isFiniteNumber(raw.oddsAmerican)) return null;
  if (typeof raw.sportsbook !== 'string' || typeof raw.observedAt !== 'string') return null;
  if (!isRecord(raw.display) || raw.display.displayReady !== true) return null;
  const name = typeof raw.display.playerName === 'string' ? raw.display.playerName.trim() : '';
  const start = typeof raw.display.gameStartTime === 'string' ? raw.display.gameStartTime : '';
  if (!name || !start) return null;
  return {
    displayReady: true,
    playerId: id,
    playerName: name,
    gameId: raw.gameId,
    market: raw.market,
    side: raw.side,
    line: raw.line,
    sportsbook: raw.sportsbook,
    oddsAmerican: raw.oddsAmerican,
    observedAt: raw.observedAt,
    gameStartTime: start,
    gameStatus: typeof raw.display.gameStatus === 'string' ? raw.display.gameStatus : null,
  };
}

function parseLeg(raw: unknown): { leg: QuickBuildPreviewLeg; ready: boolean; gameId: string } | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.market !== 'string' || (raw.side !== 'over' && raw.side !== 'under')) return null;
  if (!isFiniteNumber(raw.line) || !isFiniteNumber(raw.oddsAmerican)) return null;
  if (typeof raw.gameId !== 'string' || typeof raw.observedAt !== 'string') return null;
  const observedLabel = formatEtTimestamp(raw.observedAt);
  if (!observedLabel) return null;
  if (!isRecord(raw.display) || typeof raw.display.displayReady !== 'boolean') return null;
  const unavailableReason = raw.display.unavailableReason;
  const gap = isGap(unavailableReason) ? unavailableReason : null;
  if (unavailableReason != null && gap == null) return null;
  const name = typeof raw.display.playerName === 'string' ? raw.display.playerName.trim() : '';
  const usableName = name.length > 0 && name !== raw.playerId && !/^\d+$/.test(name) ? name : null;
  const start = typeof raw.display.gameStartTime === 'string' ? formatEtTimestamp(raw.display.gameStartTime) : null;
  const ready = raw.display.displayReady === true && usableName != null && start != null;
  const status = typeof raw.display.gameStatus === 'string' && raw.display.gameStatus.trim() ? raw.display.gameStatus.trim() : null;
  return {
    gameId: raw.gameId,
    ready,
    leg: {
      playerName: ready ? usableName : null,
      unavailable: ready ? null : gapCopy(gap, usableName, start),
      marketLabel: marketLabel(raw.market),
      sideLabel: raw.side === 'over' ? 'Over' : 'Under',
      lineLabel: formatMarketLine(raw.line),
      oddsLabel: formatAmericanOdds(raw.oddsAmerican),
      gameStartLabel: start,
      gameStatus: status,
      observedLabel,
      noVigLabel: isFiniteNumber(raw.noVigProbability) ? `Market-derived no-vig estimate ${percentLabel(raw.noVigProbability)}` : null,
    },
  };
}

function gapCopy(gap: QuickBuildDisplayGap | null, name: string | null, start: string | null): string {
  if (gap) return GAP_COPY[gap];
  if (!name) return 'Player name unavailable';
  if (!start) return 'Game start time unavailable';
  return 'Display data unavailable';
}

function warningFor(gameIds: string[], games: Map<string, NewerAttempt | null>): string | null {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const gameId of gameIds) {
    if (seen.has(gameId)) continue;
    seen.add(gameId);
    const attempt = games.get(gameId);
    if (!attempt) continue;
    const kind = BLOCKING_KIND_LABEL[attempt.kind];
    lines.push(`A later ${kind} pull (${attempt.pullRunId}) did not replace the prices used here.`);
  }
  return lines.length > 0 ? lines.join(' ') : null;
}

type NewerAttempt = { pullRunId: string; kind: BlockingAttemptKind };

function parseGames(raw: unknown[]): Map<string, NewerAttempt | null> | null {
  const games = new Map<string, NewerAttempt | null>();
  for (const row of raw) {
    if (!isRecord(row) || typeof row.gameId !== 'string') return null;
    if (row.newerUnsuccessfulAttempt == null) {
      games.set(row.gameId, null);
      continue;
    }
    if (!isRecord(row.newerUnsuccessfulAttempt)) return null;
    const attempt = row.newerUnsuccessfulAttempt;
    if (typeof attempt.pullRunId !== 'string' || !isBlockingKind(attempt.kind)) return null;
    games.set(row.gameId, { pullRunId: attempt.pullRunId, kind: attempt.kind });
  }
  return games;
}

function marketLabel(market: string): string {
  if (Object.prototype.hasOwnProperty.call(XRAY_PROP_KIND_LABEL, market)) {
    return XRAY_PROP_KIND_LABEL[market as XrayPropKind];
  }
  return market.replace(/_/g, ' ');
}

function percentLabel(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function isEmptyReason(value: unknown): value is QuickBuildEmptyReason {
  return typeof value === 'string' && (QUICK_BUILD_EMPTY_REASONS as readonly string[]).includes(value);
}

function isGap(value: unknown): value is QuickBuildDisplayGap {
  return typeof value === 'string' && (QUICK_BUILD_DISPLAY_GAPS as readonly string[]).includes(value);
}

function isBlockingKind(value: unknown): value is BlockingAttemptKind {
  return value === 'failed' || value === 'zero_row' || value === 'invalid_clock' || value === 'in_progress' || value === 'incomplete';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

export function presetApiKey(label: (typeof QUICK_BUILD_PAYOUT_OPTIONS)[number]['label']): QuickBuildPresetName {
  const match = QUICK_BUILD_PAYOUT_OPTIONS.find((option) => option.label === label);
  if (!match) throw new Error(`Unknown payout label ${label}`);
  return match.preset;
}

export function presetRange(preset: QuickBuildPresetName): { minAmerican: number; maxAmerican: number } {
  return QUICK_BUILD_PRESETS[preset];
}
