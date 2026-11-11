/**
 * Client-side Quick Builds preview.
 * Formats and validates the existing API response. Does not rank or query.
 */

import { formatAmericanOdds, formatMarketLine } from '@/lib/betting/market-movement-format';
import type { PlayerPropV1Vendor } from '@/lib/betting/market-movement';
import { assessQuickBuildSelection, type QuickBuildHandoffLeg, type QuickBuildHandoffLegs } from '@/lib/parlay/adapt-quick-build';
import { XRAY_PROP_KIND_LABEL, type XrayPropKind } from '@/lib/parlay-xray/types';
import {
  QUICK_BUILD_DISPLAY_GAPS,
  type QuickBuildDisplayGap,
} from './display';
import {
  QUICK_BUILD_EMPTY_REASONS,
  QUICK_BUILD_PRESETS,
  QUICK_BUILD_SHORTLIST_CAP,
  QUICK_BUILD_SEARCH_BUDGET_NOTE,
  type BlockingAttemptKind,
  type QuickBuildEmptyReason,
  type QuickBuildPresetName,
  type QuickBuildThreeLegPresetName,
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

export const QUICK_BUILD_THREE_LEG_PAYOUT_OPTIONS = [
  { preset: 'shorter_payout', label: 'Shorter Payout', rangeLabel: '+200 to +399' },
  { preset: 'midrange', label: 'Midrange', rangeLabel: '+400 to +699' },
  { preset: 'longer_payout', label: 'Longer Payout', rangeLabel: '+700 to +999' },
] as const satisfies readonly {
  preset: QuickBuildThreeLegPresetName;
  label: string;
  rangeLabel: string;
}[];

export type QuickBuildLegCount = 2 | 3;
export type QuickBuildAnyPresetName = QuickBuildPresetName | QuickBuildThreeLegPresetName;

export const QUICK_BUILD_DEFAULT_BOOK: PlayerPropV1Vendor = 'draftkings';
export const QUICK_BUILD_DEFAULT_PRESET: QuickBuildPresetName = 'balanced';
export const QUICK_BUILD_DEFAULT_THREE_LEG_PRESET: QuickBuildThreeLegPresetName = 'midrange';

export function payoutOptionsFor(legCount: QuickBuildLegCount) {
  return legCount === 3 ? QUICK_BUILD_THREE_LEG_PAYOUT_OPTIONS : QUICK_BUILD_PAYOUT_OPTIONS;
}

export function defaultPresetFor(legCount: QuickBuildLegCount): QuickBuildAnyPresetName {
  return legCount === 3 ? QUICK_BUILD_DEFAULT_THREE_LEG_PRESET : QUICK_BUILD_DEFAULT_PRESET;
}

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
  NO_COMBINATIONS_IN_BAND: 'No observed three-leg combinations matched this payout range.',
  SEARCH_BUDGET_REACHED: 'The search stopped before it could confirm whether this payout range has a combination. This is not an empty market.',
};

export function emptyCopyFor(reason: QuickBuildEmptyReason, legCount: QuickBuildLegCount): string {
  if (reason === 'NO_CROSS_GAME' && legCount === 3) {
    return 'At least three eligible games are needed to construct a three-leg Quick Build.';
  }
  return QUICK_BUILD_EMPTY_COPY[reason];
}

/** Extra guidance for Lower Payout only. The empty reason itself stays unchanged. */
export function lowerPayoutEmptySuggestion(
  preset: QuickBuildAnyPresetName,
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
  legs: [QuickBuildPreviewLeg, QuickBuildPreviewLeg] | [QuickBuildPreviewLeg, QuickBuildPreviewLeg, QuickBuildPreviewLeg];
  /**
   * Present only when every leg passes canonical handoff validation.
   * Display-ready cards can still omit this when a market, book, or price cannot be transferred.
   * Not rendered as an id.
   */
  handoff: QuickBuildHandoffLegs | null;
};

export type QuickBuildPreviewView = {
  generatedAtLabel: string;
  sportsbookLabel: string;
  emptyReason: QuickBuildEmptyReason | null;
  emptyMessage: string | null;
  researchLimitation: string | null;
  boundedSearchNote: string | null;
  builds: QuickBuildPreviewCard[];
};

export type QuickBuildFetchResult =
  | { kind: 'ok'; view: QuickBuildPreviewView }
  | { kind: 'empty'; view: QuickBuildPreviewView }
  | { kind: 'unauthorized' }
  | { kind: 'invalid' }
  | { kind: 'need_two' }
  | { kind: 'need_three' }
  | { kind: 'ineligible' }
  | { kind: 'limit' }
  | { kind: 'server' }
  | { kind: 'network' }
  | { kind: 'malformed' }
  | { kind: 'aborted' };

export type PreviewPhase = 'idle' | 'loading' | 'ready' | 'error';

export type PreviewGameScope = 'all' | 'select';

export type SlateGameView = {
  gameId: string;
  startTime: string;
  label: string | null;
  startLabel: string;
};

export type PreviewModel = {
  sportsbook: PlayerPropV1Vendor;
  legCount: QuickBuildLegCount;
  preset: QuickBuildAnyPresetName;
  scope: PreviewGameScope;
  selectedGameIds: string[];
  slatePhase: 'idle' | 'loading' | 'ready' | 'error';
  slateGames: SlateGameView[];
  slateMessage: string | null;
  phase: PreviewPhase;
  requestId: number;
  view: QuickBuildPreviewView | null;
  message: string | null;
};

export function initialPreviewModel(): PreviewModel {
  return {
    sportsbook: QUICK_BUILD_DEFAULT_BOOK,
    legCount: 2,
    preset: QUICK_BUILD_DEFAULT_PRESET,
    scope: 'all',
    selectedGameIds: [],
    slatePhase: 'idle',
    slateGames: [],
    slateMessage: null,
    phase: 'idle',
    requestId: 0,
    view: null,
    message: null,
  };
}

export const QUICK_BUILD_GAMES_PATH = '/api/parlay-workspace/quick-builds/games';

export const QUICK_BUILD_SELECT_TWO_COPY = 'Select at least two matchups.';
export const QUICK_BUILD_SELECT_THREE_COPY = 'Select at least three matchups.';
export const QUICK_BUILD_ONE_GAME_COPY = 'Cross-game Quick Builds need at least two games.';
export const QUICK_BUILD_NEED_THREE_GAMES_COPY = 'Three-leg Quick Builds need at least three eligible games.';
export const QUICK_BUILD_NO_GAMES_COPY = 'There are no upcoming eligible NBA games in this slate.';
export const QUICK_BUILD_REFRESH_GAMES_COPY = 'A selected game is no longer eligible. Refresh the game list and choose again.';
export const QUICK_BUILD_MATCHUP_UNAVAILABLE = 'Matchup unavailable';

export function previewScopeKey(scope: PreviewGameScope, gameIds: readonly string[]): string {
  return scope === 'all' ? 'all' : gameIds.join(',');
}

export function toggleSelectedGame(ids: readonly string[], gameId: string): string[] {
  const next = ids.includes(gameId) ? ids.filter((id) => id !== gameId) : [...ids, gameId];
  return [...next].sort();
}

export function searchBlockReason(
  model: Pick<PreviewModel, 'scope' | 'selectedGameIds' | 'slatePhase' | 'slateGames' | 'legCount'>,
): string | null {
  const required = model.legCount === 3 ? 3 : 2;
  if (model.scope !== 'select') {
    if (model.legCount === 3 && model.slatePhase === 'ready' && model.slateGames.length > 0 && model.slateGames.length < 3) {
      return QUICK_BUILD_NEED_THREE_GAMES_COPY;
    }
    return null;
  }
  if (model.slatePhase === 'ready' && model.slateGames.length === 0) return QUICK_BUILD_NO_GAMES_COPY;
  if (model.slatePhase === 'ready' && model.slateGames.length < required) {
    return model.legCount === 3 ? QUICK_BUILD_NEED_THREE_GAMES_COPY : QUICK_BUILD_ONE_GAME_COPY;
  }
  if (model.selectedGameIds.length < required) {
    return model.legCount === 3 ? QUICK_BUILD_SELECT_THREE_COPY : QUICK_BUILD_SELECT_TWO_COPY;
  }
  return null;
}

export function selectLegCount(state: PreviewModel, legCount: QuickBuildLegCount): PreviewModel {
  if (state.legCount === legCount) return state;
  return invalidatePreview(state, { legCount, preset: defaultPresetFor(legCount) });
}

export function previewRequestPath(
  sportsbook: PlayerPropV1Vendor,
  preset: QuickBuildAnyPresetName,
  gameIds?: readonly string[],
  legCount: QuickBuildLegCount = 2,
): string {
  const base = `/api/parlay-workspace/quick-builds?sportsbook=${encodeURIComponent(sportsbook)}&preset=${encodeURIComponent(preset)}`;
  const withLegs = legCount === 3 ? `${base}&legs=3` : base;
  if (gameIds == null) return withLegs;
  return `${withLegs}&games=${encodeURIComponent(gameIds.join(','))}`;
}

export function parseSlateGames(data: unknown): SlateGameView[] | null {
  if (!isRecord(data) || !Array.isArray(data.games)) return null;
  const games: SlateGameView[] = [];
  const seen = new Set<string>();
  for (const raw of data.games) {
    if (!isRecord(raw) || typeof raw.gameId !== 'string' || !/^\d{1,10}$/.test(raw.gameId)) return null;
    if (typeof raw.startTime !== 'string') return null;
    const startLabel = formatEtTimestamp(raw.startTime);
    if (startLabel == null || seen.has(raw.gameId)) return null;
    seen.add(raw.gameId);
    const label = typeof raw.label === 'string' && raw.label.trim() !== '' ? raw.label : null;
    games.push({ gameId: raw.gameId, startTime: raw.startTime, label, startLabel });
  }
  return games;
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
  const limitations = Array.isArray(data.limitations)
    ? data.limitations.filter((item): item is string => typeof item === 'string')
    : [];
  const limitation = limitations[0] ?? null;
  return {
    generatedAtLabel: formatEtTimestamp(data.generatedAt) as string,
    sportsbookLabel: bookLabel(sportsbook),
    emptyReason: data.status === 'empty' ? (emptyReason as QuickBuildEmptyReason) : null,
    emptyMessage: data.status === 'empty' ? emptyCopyFor(emptyReason as QuickBuildEmptyReason, 2) : null,
    researchLimitation: limitation,
    boundedSearchNote: limitations.includes(QUICK_BUILD_SEARCH_BUDGET_NOTE) ? QUICK_BUILD_SEARCH_BUDGET_NOTE : null,
    builds,
  };
}

export function previewErrorMessage(kind: Exclude<QuickBuildFetchResult['kind'], 'ok' | 'empty' | 'aborted'>): string {
  switch (kind) {
    case 'unauthorized':
      return 'Your session expired. Sign in again to find Quick Builds.';
    case 'invalid':
      return 'That sportsbook or payout target is not supported.';
    case 'need_two':
      return QUICK_BUILD_SELECT_TWO_COPY;
    case 'need_three':
      return QUICK_BUILD_SELECT_THREE_COPY;
    case 'ineligible':
      return QUICK_BUILD_REFRESH_GAMES_COPY;
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
  preset: QuickBuildAnyPresetName;
  legCount?: QuickBuildLegCount;
  gameIds?: readonly string[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<QuickBuildFetchResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const legCount = args.legCount ?? 2;
  try {
    const response = await fetchImpl(previewRequestPath(args.sportsbook, args.preset, args.gameIds, legCount), {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: args.signal,
    });
    if (response.status === 401) return { kind: 'unauthorized' };
    if (response.status === 409) {
      const body = await readJson(response);
      return isRecord(body) && body.code === 'INELIGIBLE_GAME' ? { kind: 'ineligible' } : { kind: 'server' };
    }
    if (response.status === 400) {
      const body = await readJson(response);
      if (isRecord(body) && body.code === 'NEED_THREE_GAMES') return { kind: 'need_three' };
      return isRecord(body) && body.code === 'NEED_TWO_GAMES' ? { kind: 'need_two' } : { kind: 'invalid' };
    }
    if (response.status === 422) {
      const body = await readJson(response);
      return isRecord(body) && body.code === 'LIMIT_EXCEEDED' ? { kind: 'limit' } : { kind: 'server' };
    }
    if (!response.ok) return { kind: 'server' };
    const body = await readJson(response);
    if (body === undefined) return { kind: 'malformed' };
    const view = parseQuickBuildResponse(body);
    if (!view) return { kind: 'malformed' };
    if (view.emptyReason) view.emptyMessage = emptyCopyFor(view.emptyReason, legCount);
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

export function invalidatePreview(
  state: PreviewModel,
  patch: {
    sportsbook?: PlayerPropV1Vendor;
    preset?: QuickBuildAnyPresetName;
    legCount?: QuickBuildLegCount;
    scope?: PreviewGameScope;
    selectedGameIds?: string[];
  },
): PreviewModel {
  return {
    ...state,
    sportsbook: patch.sportsbook ?? state.sportsbook,
    legCount: patch.legCount ?? state.legCount,
    preset: patch.preset ?? state.preset,
    scope: patch.scope ?? state.scope,
    selectedGameIds: patch.selectedGameIds ?? state.selectedGameIds,
    phase: 'idle',
    requestId: state.requestId + 1,
    view: null,
    message: null,
  };
}

export function acceptPreviewResult(
  state: PreviewModel,
  request: { requestId: number; sportsbook: PlayerPropV1Vendor; preset: QuickBuildAnyPresetName; legCount?: QuickBuildLegCount; scopeKey?: string },
  result: QuickBuildFetchResult,
): PreviewModel {
  if (state.requestId !== request.requestId) return state;
  if (state.sportsbook !== request.sportsbook || state.preset !== request.preset) return state;
  if (request.legCount != null && request.legCount !== state.legCount) return state;
  if (request.scopeKey != null && request.scopeKey !== previewScopeKey(state.scope, state.selectedGameIds)) return state;
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
  if (!Array.isArray(raw.legs) || (raw.legs.length !== 2 && raw.legs.length !== 3)) return null;
  const parsed = raw.legs.map((entry) => parseLeg(entry));
  if (parsed.some((entry) => entry == null)) return null;
  const readyLegs = parsed as NonNullable<(typeof parsed)[number]>[];
  const age = formatObservationAge(raw.maxAgeMs);
  if (!age) return null;
  const displayReady = readyLegs.every((entry) => entry.ready);
  const candidate = displayReady ? handoffLegs(raw.legs) : null;
  const handoff = candidate && assessQuickBuildSelection(candidate).ok ? candidate : null;
  const previewLegs = readyLegs.map((entry) => entry.leg);
  return {
    id: raw.id,
    number,
    displayReady,
    combinedOddsLabel: formatAmericanOdds(raw.combinedAmerican),
    breakEvenLabel: percentLabel(raw.breakEvenProbability),
    oldestObservedLabel: formatEtTimestamp(raw.oldestObservedAt) as string,
    newestObservedLabel: formatEtTimestamp(raw.newestObservedAt) as string,
    oldestAgeLabel: age,
    warning: warningFor(readyLegs.map((entry) => entry.gameId), games),
    legs: previewLegs.length === 3
      ? [previewLegs[0]!, previewLegs[1]!, previewLegs[2]!]
      : [previewLegs[0]!, previewLegs[1]!],
    handoff,
  };
}

function handoffLegs(rawLegs: unknown[]): QuickBuildHandoffLegs | null {
  const adapted = rawLegs.map((raw) => handoffLeg(raw));
  if (adapted.some((leg) => leg == null)) return null;
  const legs = adapted as QuickBuildHandoffLeg[];
  if (legs.length === 3) return [legs[0]!, legs[1]!, legs[2]!];
  if (legs.length === 2) return [legs[0]!, legs[1]!];
  return null;
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
