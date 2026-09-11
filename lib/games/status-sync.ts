/**
 * Freeze-gated frequent /v1/games status sync domain.
 * Writes only analytics.games scoreboard/status/tip fields. No /v1/stats, SQS, or postgame.
 */

import { shouldPreserveCertifiedFinal } from '@/lib/betting/final-preserve';
import { isFinalStatus, normalizeGameStatus } from '@/lib/betting/normalize-game-status';
import { BdlRateLimitError, shouldSkipLiveBdlHttp } from '@/lib/balldontlie/live-rate-limit';
import { shouldSkipLiveMutations } from '@/lib/runtime/ingestion-mode';
import { canonicalStartTimeUtc, startTimeIsoUtc } from './canonical-start-time';
import {
  planStatusSyncQuery,
  resolveStatusSyncTargetSeason,
  statusSyncRequestUrl,
  type StatusSyncQueryMode,
  type StatusSyncQueryPlan,
} from './status-sync-query';
import { PINNED_ANALYTICS_SEASON } from '@/lib/season';

export const STATUS_SYNC_JOB = 'game_status_sync';
export const PROTECTED_HISTORY_SEASONS = new Set(['2023', '2024', '2025']);
export const STATUS_SYNC_CADENCE_MINUTES = 15;
export const STATUS_SYNC_GRACE_MINUTES = 15;

export type GameStatusSyncEventName =
  | 'game_status_sync_started'
  | 'game_status_changed'
  | 'game_became_final'
  | 'game_final_preserved'
  | 'game_status_sync_completed'
  | 'game_status_sync_failed';

export type GameStatusSyncEvent = {
  event: GameStatusSyncEventName;
  game_id?: string;
  previous_status?: string | null;
  new_status?: string | null;
  counts?: Record<string, number>;
  duration_ms?: number;
  reason?: string;
  provider_status?: number | null;
};

export type LocalGameRow = {
  gameId: string;
  season: string;
  status: string | null;
  startTime: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
};

export type ProviderGame = {
  id: number | string;
  season?: number | string | null;
  status?: string | null;
  datetime?: string | null;
  date?: string | null;
  home_team_score?: number | null;
  visitor_team_score?: number | null;
  home_team?: { id?: number | string | null } | null;
  visitor_team?: { id?: number | string | null } | null;
};

export type GameStatusWriteAction =
  | 'insert'
  | 'update'
  | 'unchanged'
  | 'final_preserved'
  | 'reject';

export type GameStatusWritePlan = {
  action: GameStatusWriteAction;
  gameId: string;
  previousStatus: string | null;
  newStatus: string | null;
  becameFinal: boolean;
  reason: string;
  row?: LocalGameRow;
};

export type GameStatusStore = {
  getById(gameId: string): Promise<LocalGameRow | null> | LocalGameRow | null;
  upsert(row: LocalGameRow): Promise<void> | void;
};

export type StatusSyncFetchPage = (url: string) => Promise<{
  status: number;
  ok: boolean;
  json?: { data?: ProviderGame[]; meta?: { next_cursor?: number | null } };
  error?: string;
  timeout?: boolean;
}>;

function sid(value: number | string | null | undefined): string {
  if (value == null) return '';
  return String(value);
}

export function isLiveIngestionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.LIVE_INGESTION_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export function shouldSkipGameStatusSync(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    !isLiveIngestionEnabled(env) ||
    shouldSkipLiveMutations(env) ||
    shouldSkipLiveBdlHttp(env)
  );
}

export function mapProviderGame(g: ProviderGame, targetSeason: string): LocalGameRow | null {
  const gameId = sid(g.id);
  const homeId = sid(g.home_team && typeof g.home_team === 'object' ? g.home_team.id : null);
  const awayId = sid(g.visitor_team && typeof g.visitor_team === 'object' ? g.visitor_team.id : null);
  if (!gameId || !homeId || !awayId) return null;
  const season = g.season != null ? String(g.season) : targetSeason;
  return {
    gameId,
    season,
    status: g.status ?? null,
    startTime: startTimeIsoUtc(canonicalStartTimeUtc(g.datetime, g.date)),
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeScore: g.home_team_score ?? null,
    awayScore: g.visitor_team_score ?? null,
    venue: null,
  };
}

function scoresEqual(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

function rowsEquivalent(a: LocalGameRow, b: LocalGameRow): boolean {
  return (
    a.gameId === b.gameId &&
    a.season === b.season &&
    a.status === b.status &&
    a.startTime === b.startTime &&
    a.homeTeamId === b.homeTeamId &&
    a.awayTeamId === b.awayTeamId &&
    scoresEqual(a.homeScore, b.homeScore) &&
    scoresEqual(a.awayScore, b.awayScore)
  );
}

export function planGameStatusWrite(input: {
  local: LocalGameRow | null;
  incoming: LocalGameRow;
  targetSeason: string;
}): GameStatusWritePlan {
  const gameId = input.incoming.gameId;
  if (input.incoming.season !== input.targetSeason) {
    return {
      action: 'reject',
      gameId,
      previousStatus: input.local?.status ?? null,
      newStatus: input.incoming.status,
      becameFinal: false,
      reason: `season ${input.incoming.season} is not target ${input.targetSeason}`,
    };
  }
  if (PROTECTED_HISTORY_SEASONS.has(input.incoming.season)) {
    return {
      action: 'reject',
      gameId,
      previousStatus: input.local?.status ?? null,
      newStatus: input.incoming.status,
      becameFinal: false,
      reason: `historical season ${input.incoming.season} is protected`,
    };
  }
  if (input.local && PROTECTED_HISTORY_SEASONS.has(input.local.season)) {
    return {
      action: 'reject',
      gameId,
      previousStatus: input.local.status,
      newStatus: input.incoming.status,
      becameFinal: false,
      reason: `local season ${input.local.season} is protected history`,
    };
  }
  if (input.local && input.local.season !== input.targetSeason) {
    return {
      action: 'reject',
      gameId,
      previousStatus: input.local.status,
      newStatus: input.incoming.status,
      becameFinal: false,
      reason: `local season ${input.local.season} does not match target ${input.targetSeason}`,
    };
  }
  if (
    input.local &&
    (input.local.homeTeamId !== input.incoming.homeTeamId ||
      input.local.awayTeamId !== input.incoming.awayTeamId)
  ) {
    return {
      action: 'reject',
      gameId,
      previousStatus: input.local.status,
      newStatus: input.incoming.status,
      becameFinal: false,
      reason: 'team identity mismatch',
    };
  }

  if (!input.local) {
    const becameFinal = isFinalStatus(input.incoming.status);
    return {
      action: 'insert',
      gameId,
      previousStatus: null,
      newStatus: input.incoming.status,
      becameFinal,
      reason: 'new provider game',
      row: input.incoming,
    };
  }

  const incomingForWrite: LocalGameRow = {
    ...input.incoming,
    venue: input.incoming.venue ?? input.local.venue,
  };

  if (shouldPreserveCertifiedFinal({
    existingStatus: input.local.status,
    incomingStatus: input.incoming.status,
  })) {
    return {
      action: 'final_preserved',
      gameId,
      previousStatus: input.local.status,
      newStatus: input.local.status,
      becameFinal: false,
      reason: 'certified Final preserved; stale provider payload ignored',
      row: input.local,
    };
  }

  if (rowsEquivalent(input.local, incomingForWrite)) {
    return {
      action: 'unchanged',
      gameId,
      previousStatus: input.local.status,
      newStatus: input.incoming.status,
      becameFinal: false,
      reason: 'idempotent replay',
    };
  }

  const becameFinal =
    !isFinalStatus(input.local.status) && isFinalStatus(input.incoming.status);
  return {
    action: 'update',
    gameId,
    previousStatus: input.local.status,
    newStatus: input.incoming.status,
    becameFinal,
    reason: becameFinal ? 'became Final' : 'status/scoreboard update',
    row: incomingForWrite,
  };
}

export function classifyStatusSyncProviderError(input: {
  status?: number;
  timeout?: boolean;
  code?: string;
}): { kind: '401' | '403' | '429' | '5xx' | 'timeout' | 'other'; retry: boolean; reason: string } {
  if (input.timeout || input.code === 'timeout') {
    return { kind: 'timeout', retry: false, reason: 'provider timeout; next poll retries' };
  }
  if (input.status === 401) {
    return { kind: '401', retry: false, reason: '401 capability/credential; do not hammer' };
  }
  if (input.status === 403) {
    return { kind: '403', retry: false, reason: '403 capability/credential; do not hammer' };
  }
  if (input.status === 429) {
    return { kind: '429', retry: false, reason: '429 limiter cooldown; next poll retries' };
  }
  if (input.status != null && input.status >= 500) {
    return { kind: '5xx', retry: false, reason: `provider ${input.status}; next poll retries` };
  }
  return { kind: 'other', retry: false, reason: 'provider error; next poll retries' };
}

export type GameStatusSyncResult = {
  job: typeof STATUS_SYNC_JOB;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  targetSeason: string;
  productPin: string;
  queryMode: StatusSyncQueryMode;
  startDate: string | null;
  endDate: string | null;
  gamesFetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  statusChanges: number;
  becameFinal: number;
  finalPreserved: number;
  providerErrors: number;
  providerStatus: number | null;
  durationMs: number;
  dryRun: boolean;
  wroteDb: boolean;
  bdlHttp: number;
  events: GameStatusSyncEvent[];
  transitions: Array<{
    game_id: string;
    previous_status: string | null;
    new_status: string | null;
    became_final: boolean;
  }>;
  reason?: string;
};

export async function runGameStatusSync(input: {
  env?: Record<string, string | undefined>;
  now?: Date;
  mode?: StatusSyncQueryMode;
  targetSeason?: number;
  dryRun?: boolean;
  allowFrozenSimulation?: boolean;
  /** Explicit one-shot manual canary. Not a generic freeze bypass. */
  manualCanary?: boolean;
  startDate?: string;
  endDate?: string;
  store: GameStatusStore;
  fetchPage?: StatusSyncFetchPage;
  emit?: (event: GameStatusSyncEvent) => void;
}): Promise<GameStatusSyncResult> {
  const started = input.now ?? new Date();
  const startedMs = Date.now();
  const env = input.env ?? process.env;
  const manualCanary = input.manualCanary === true;
  const dryRun = manualCanary ? input.dryRun === true : input.dryRun !== false;
  const targetSeasonNum = resolveStatusSyncTargetSeason(env, input.targetSeason);
  const targetSeason = String(targetSeasonNum);
  const events: GameStatusSyncEvent[] = [];
  const emit = (event: GameStatusSyncEvent) => {
    events.push(event);
    input.emit?.(event);
  };
  const plan = planStatusSyncQuery({
    mode: input.mode ?? 'frequent',
    targetSeason: targetSeasonNum,
    now: started,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  emit({ event: 'game_status_sync_started', counts: { targetSeason: targetSeasonNum } });

  const empty = (status: GameStatusSyncResult['status'], reason: string, extra?: Partial<GameStatusSyncResult>): GameStatusSyncResult => ({
    job: STATUS_SYNC_JOB,
    status,
    targetSeason,
    productPin: PINNED_ANALYTICS_SEASON,
    queryMode: plan.mode,
    startDate: plan.startDate,
    endDate: plan.endDate,
    gamesFetched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    statusChanges: 0,
    becameFinal: 0,
    finalPreserved: 0,
    providerErrors: 0,
    providerStatus: null,
    durationMs: Date.now() - startedMs,
    dryRun,
    wroteDb: false,
    bdlHttp: 0,
    events,
    transitions: [],
    reason,
    ...extra,
  });

  if (shouldSkipGameStatusSync(env) && !input.allowFrozenSimulation && !manualCanary) {
    const result = empty('skipped', 'frozen: no BDL and no analytics.games writes');
    emit({ event: 'game_status_sync_completed', counts: { skipped: 1 }, duration_ms: result.durationMs });
    return result;
  }

  if (plan.mode === 'frequent' && (!plan.startDate || !plan.endDate)) {
    return empty('failed', 'frequent mode refused to run without a date window');
  }

  if (!input.fetchPage) {
    return empty('skipped', 'no provider adapter; fixture/dry-run required');
  }

  const games: ProviderGame[] = [];
  let pages = 0;
  let cursor: number | null = null;
  let bdlHttp = 0;
  let providerStatus: number | null = null;
  while (pages < plan.maxPages) {
    const url = statusSyncRequestUrl(plan, cursor);
    let page;
    try {
      page = await input.fetchPage(url);
    } catch (err) {
      const timeout = err instanceof BdlRateLimitError && err.code === 'timeout';
      const classified = classifyStatusSyncProviderError({
        timeout,
        code: err instanceof BdlRateLimitError ? err.code : undefined,
      });
      emit({ event: 'game_status_sync_failed', reason: classified.reason });
      return empty('failed', classified.reason, { providerErrors: 1, bdlHttp });
    }
    bdlHttp += 1;
    providerStatus = page.status;
    if (!page.ok) {
      const classified = classifyStatusSyncProviderError({
        status: page.status,
        timeout: page.timeout,
      });
      emit({
        event: 'game_status_sync_failed',
        reason: classified.reason,
        provider_status: page.status,
      });
      return empty('failed', classified.reason, {
        providerErrors: 1,
        providerStatus: page.status,
        bdlHttp,
      });
    }
    games.push(...(page.json?.data ?? []));
    pages += 1;
    cursor = page.json?.meta?.next_cursor ?? null;
    if (cursor == null) break;
  }

  const truncated = cursor != null && pages >= plan.maxPages;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let rejected = 0;
  let statusChanges = 0;
  let becameFinal = 0;
  let finalPreserved = 0;
  const transitions: GameStatusSyncResult['transitions'] = [];
  const wroteDb = !dryRun && (!shouldSkipGameStatusSync(env) || manualCanary);

  for (const raw of games) {
    const incoming = mapProviderGame(raw, targetSeason);
    if (!incoming) {
      rejected += 1;
      continue;
    }
    const local = await input.store.getById(incoming.gameId);
    const planned = planGameStatusWrite({ local, incoming, targetSeason });
    if (planned.action === 'reject') {
      rejected += 1;
      continue;
    }
    if (planned.action === 'unchanged') {
      unchanged += 1;
      continue;
    }
    if (planned.action === 'final_preserved') {
      finalPreserved += 1;
      emit({
        event: 'game_final_preserved',
        game_id: planned.gameId,
        previous_status: planned.previousStatus,
        new_status: planned.newStatus,
      });
      continue;
    }
    if (planned.previousStatus !== planned.newStatus) statusChanges += 1;
    if (planned.becameFinal) {
      becameFinal += 1;
      transitions.push({
        game_id: planned.gameId,
        previous_status: planned.previousStatus,
        new_status: planned.newStatus,
        became_final: true,
      });
      emit({
        event: 'game_became_final',
        game_id: planned.gameId,
        previous_status: planned.previousStatus,
        new_status: planned.newStatus,
      });
    } else if (planned.action === 'update') {
      emit({
        event: 'game_status_changed',
        game_id: planned.gameId,
        previous_status: planned.previousStatus,
        new_status: planned.newStatus,
      });
    }
    if (planned.action === 'insert') inserted += 1;
    if (planned.action === 'update') updated += 1;
    if (wroteDb && planned.row) await input.store.upsert(planned.row);
  }

  const durationMs = Date.now() - startedMs;
  const result: GameStatusSyncResult = {
    job: STATUS_SYNC_JOB,
    status: truncated ? 'partial' : 'success',
    targetSeason,
    productPin: PINNED_ANALYTICS_SEASON,
    queryMode: plan.mode,
    startDate: plan.startDate,
    endDate: plan.endDate,
    gamesFetched: games.length,
    inserted,
    updated,
    unchanged,
    rejected,
    statusChanges,
    becameFinal,
    finalPreserved,
    providerErrors: 0,
    providerStatus,
    durationMs,
    dryRun,
    wroteDb,
    bdlHttp,
    events,
    transitions,
    reason: truncated ? 'frequent page cap reached; not a full-season scan' : undefined,
  };
  emit({
    event: 'game_status_sync_completed',
    counts: {
      fetched: games.length,
      inserted,
      updated,
      unchanged,
      became_final: becameFinal,
      final_preserved: finalPreserved,
    },
    duration_ms: durationMs,
  });
  return result;
}

export function createMemoryGameStore(seed: LocalGameRow[] = []): GameStatusStore & { rows: Map<string, LocalGameRow> } {
  const rows = new Map(seed.map((row) => [row.gameId, { ...row }]));
  return {
    rows,
    getById(gameId) {
      const row = rows.get(gameId);
      return row ? { ...row } : null;
    },
    upsert(row) {
      rows.set(row.gameId, { ...row });
    },
  };
}

export function createFixtureFetchPage(games: ProviderGame[]): StatusSyncFetchPage {
  return async () => ({
    status: 200,
    ok: true,
    json: { data: games, meta: { next_cursor: null } },
  });
}
