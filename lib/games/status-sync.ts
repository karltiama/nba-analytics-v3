/**
 * Freeze-gated frequent /v1/games status sync domain.
 * Writes only analytics.games scoreboard/status/tip fields. No /v1/stats, SQS, or postgame.
 */

import { shouldPreserveCertifiedFinal } from '@/lib/betting/final-preserve';
import { isFinalStatus, normalizeGameStatus } from '@/lib/betting/normalize-game-status';
import { BdlRateLimitError, shouldSkipLiveBdlHttp } from '@/lib/balldontlie/live-rate-limit';
import { shouldSkipLiveMutations } from '@/lib/runtime/ingestion-mode';
import { randomUUID } from 'node:crypto';
import { canonicalStartTimeUtc, startTimeIsoUtc } from './canonical-start-time';
import {
  isPreseasonDiscoveryEnabled,
  planStatusSyncQueries,
  resolveStatusSyncTargetSeason,
  statusSyncRequestUrl,
  type StatusSyncQueryMode,
  type StatusSyncQueryPlan,
} from './status-sync-query';
import {
  classifySeasonPhase,
  SEASON_PHASES,
  strongerSeasonPhase,
  type SeasonPhase,
  type SeasonPhaseClassification,
} from './season-phase';
import { PINNED_ANALYTICS_SEASON } from '@/lib/season';
import {
  etDateOfInstant,
  etDateOfProviderGame,
  servingDateDecision,
} from '@/lib/games/season-eligibility';

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
  /** Season-phase hints only (DATA1 §8.4); never mapped into the scoreboard row. */
  ist_stage?: string | null;
  postseason?: boolean | null;
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
  /** True only when analytics.games can persist season_phase (prepared migration applied). */
  supportsSeasonPhase?(): Promise<boolean> | boolean;
  /** Sets a classified phase on an UNCLASSIFIED row; never downgrades an existing phase. */
  applySeasonPhase?(gameId: string, phase: SeasonPhaseClassification): Promise<void> | void;
};

export type StatusSyncPageContext = {
  plan: StatusSyncQueryPlan;
  pageIndex: number;
  cursor: number | null;
  /** Shared by every page of one query in one cycle. */
  pullRunId: string;
};

/** Per-page immutable-archive evidence (one entry per HTTP attempt). */
export type StatusSyncPageAcquisition = {
  requestIds: string[];
  archiveStatuses: Array<'ARCHIVED' | 'ARCHIVE_FAILED' | 'IMMUTABILITY_CONFLICT'>;
  s3Keys: string[];
  /** Non-null = archive or ledger did not permit serving; the cycle must write nothing. */
  blockedReason: string | null;
};

export type StatusSyncFetchPage = (
  url: string,
  ctx?: StatusSyncPageContext
) => Promise<{
  status: number;
  ok: boolean;
  json?: { data?: ProviderGame[]; meta?: { next_cursor?: number | null } };
  error?: string;
  timeout?: boolean;
  acquisition?: StatusSyncPageAcquisition;
  /** 2xx body archived but failed JSON/shape validation. */
  parseError?: string;
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
  preseasonDiscovery: boolean;
  queries: Array<{
    seasonTypeRequested: string | null;
    pullRunId: string;
    pages: number;
    truncated: boolean;
    requestIds: string[];
  }>;
  acquisition: {
    required: boolean;
    archivedRequests: number;
    blockedReason: string | null;
  };
  seasonPhases: Record<SeasonPhase, number>;
  /** PRESEASON games refused because season_phase cannot be persisted yet. */
  preseasonFenced: number;
  seasonPhaseWrites: number;
  reason?: string;
};

function zeroSeasonPhaseCounts(): Record<SeasonPhase, number> {
  return Object.fromEntries(SEASON_PHASES.map((p) => [p, 0])) as Record<SeasonPhase, number>;
}

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
  /** Production adapters set this: a page without archive evidence fails the cycle. */
  requireAcquisition?: boolean;
  /** pull_run_id generator (tests). */
  newId?: () => string;
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
  const preseasonDiscovery = isPreseasonDiscoveryEnabled(env);
  const requireAcquisition = input.requireAcquisition === true;
  const newId = input.newId ?? randomUUID;
  const plans = planStatusSyncQueries({
    mode: input.mode ?? 'frequent',
    targetSeason: targetSeasonNum,
    now: started,
    startDate: input.startDate,
    endDate: input.endDate,
    preseasonDiscovery,
  });
  const plan = plans[0];
  const queries: GameStatusSyncResult['queries'] = [];
  let archivedRequests = 0;

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
    preseasonDiscovery,
    queries,
    acquisition: { required: requireAcquisition, archivedRequests, blockedReason: null },
    seasonPhases: zeroSeasonPhaseCounts(),
    preseasonFenced: 0,
    seasonPhaseWrites: 0,
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

  // Every page of every query is fetched (and, in production, archived) before any write.
  // Any failed or blocked page fails the whole cycle with zero analytics.games writes.
  type Entry = { raw: ProviderGame; phase: SeasonPhaseClassification };
  const byId = new Map<string, Entry>();
  const entries: Entry[] = [];
  let gamesFetched = 0;
  let bdlHttp = 0;
  let providerStatus: number | null = null;
  let truncated = false;
  for (const queryPlan of plans) {
    const query = {
      seasonTypeRequested: queryPlan.seasonTypeRequested,
      pullRunId: newId(),
      pages: 0,
      truncated: false,
      requestIds: [] as string[],
    };
    queries.push(query);
    let cursor: number | null = null;
    while (query.pages < queryPlan.maxPages) {
      const url = statusSyncRequestUrl(queryPlan, cursor);
      let page;
      try {
        page = await input.fetchPage(url, {
          plan: queryPlan,
          pageIndex: query.pages,
          cursor,
          pullRunId: query.pullRunId,
        });
      } catch (err) {
        const timeout = err instanceof BdlRateLimitError && err.code === 'timeout';
        const classified = classifyStatusSyncProviderError({
          timeout,
          code: err instanceof BdlRateLimitError ? err.code : undefined,
        });
        emit({ event: 'game_status_sync_failed', reason: classified.reason });
        return empty('failed', classified.reason, { providerErrors: 1, bdlHttp });
      }
      const acquisition = page.acquisition;
      bdlHttp += acquisition ? acquisition.requestIds.length : 1;
      if (acquisition) {
        query.requestIds.push(...acquisition.requestIds);
        archivedRequests += acquisition.archiveStatuses.filter((s) => s === 'ARCHIVED').length;
      }
      providerStatus = page.status;
      const blockedReason = acquisition
        ? acquisition.blockedReason
        : requireAcquisition
          ? 'acquisition evidence missing for page'
          : null;
      if (blockedReason) {
        const reason = `acquisition blocked: ${blockedReason}; no analytics.games writes`;
        emit({ event: 'game_status_sync_failed', reason, provider_status: page.status });
        return empty('failed', reason, {
          providerStatus: page.status,
          bdlHttp,
          acquisition: { required: requireAcquisition, archivedRequests, blockedReason },
        });
      }
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
      if (page.parseError) {
        const reason = `provider body failed validation after archive: ${page.parseError}`;
        emit({ event: 'game_status_sync_failed', reason, provider_status: page.status });
        return empty('failed', reason, { providerErrors: 1, providerStatus: page.status, bdlHttp });
      }
      for (const raw of page.json?.data ?? []) {
        gamesFetched += 1;
        const phase = classifySeasonPhase({
          requestSeasonType: queryPlan.seasonTypeRequested,
          game: raw && typeof raw === 'object' ? raw : null,
        });
        const id = raw && typeof raw === 'object' ? sid(raw.id) : '';
        const seen = id ? byId.get(id) : undefined;
        if (seen) {
          seen.phase = strongerSeasonPhase(seen.phase, phase);
          continue;
        }
        const entry = { raw, phase };
        if (id) byId.set(id, entry);
        entries.push(entry);
      }
      query.pages += 1;
      cursor = page.json?.meta?.next_cursor ?? null;
      if (cursor == null) break;
    }
    query.truncated = cursor != null && query.pages >= queryPlan.maxPages;
    if (query.truncated) truncated = true;
  }

  const seasonPhases = zeroSeasonPhaseCounts();
  for (const e of entries) seasonPhases[e.phase.phase] += 1;
  const phaseSupported =
    entries.some((e) => e.phase.phase !== 'UNCLASSIFIED') &&
    input.store.supportsSeasonPhase != null &&
    input.store.applySeasonPhase != null
      ? (await input.store.supportsSeasonPhase()) === true
      : false;
  let preseasonFenced = 0;
  let seasonPhaseWrites = 0;

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let rejected = 0;
  let statusChanges = 0;
  let becameFinal = 0;
  let finalPreserved = 0;
  const transitions: GameStatusSyncResult['transitions'] = [];
  const wroteDb = !dryRun && (!shouldSkipGameStatusSync(env) || manualCanary);

  const applyPhase = async (gameId: string, phase: SeasonPhaseClassification) => {
    if (!wroteDb || !phaseSupported || phase.phase === 'UNCLASSIFIED' || !input.store.applySeasonPhase) return;
    await input.store.applySeasonPhase(gameId, phase);
    seasonPhaseWrites += 1;
  };

  for (const { raw, phase } of entries) {
    const incoming = raw && typeof raw === 'object' ? mapProviderGame(raw, targetSeason) : null;
    if (!incoming) {
      rejected += 1;
      continue;
    }
    // PRESEASON must never land as an unlabeled row that downstream could read as regular season.
    if (phase.phase === 'PRESEASON' && !phaseSupported) {
      rejected += 1;
      preseasonFenced += 1;
      continue;
    }
    if (phase.phase === 'UNCLASSIFIED') {
      rejected += 1;
      continue;
    }
    if (phase.phase !== 'PRESEASON') {
      const etDate = etDateOfProviderGame(raw) ?? etDateOfInstant(incoming.startTime);
      if (!servingDateDecision(targetSeason, etDate).eligible) {
        rejected += 1;
        preseasonFenced += 1;
        continue;
      }
    }
    const local = await input.store.getById(incoming.gameId);
    const planned = planGameStatusWrite({ local, incoming, targetSeason });
    if (planned.action === 'reject') {
      rejected += 1;
      continue;
    }
    if (planned.action === 'unchanged') {
      unchanged += 1;
      await applyPhase(planned.gameId, phase);
      continue;
    }
    if (planned.action === 'final_preserved') {
      finalPreserved += 1;
      await applyPhase(planned.gameId, phase);
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
    await applyPhase(planned.gameId, phase);
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
    gamesFetched,
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
    preseasonDiscovery,
    queries,
    acquisition: { required: requireAcquisition, archivedRequests, blockedReason: null },
    seasonPhases,
    preseasonFenced,
    seasonPhaseWrites,
    reason: truncated ? 'frequent page cap reached; not a full-season scan' : undefined,
  };
  emit({
    event: 'game_status_sync_completed',
    counts: {
      fetched: gamesFetched,
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

export function createMemoryGameStore(
  seed: LocalGameRow[] = [],
  options: { seasonPhase?: boolean } = {}
): GameStatusStore & { rows: Map<string, LocalGameRow>; phases: Map<string, SeasonPhaseClassification> } {
  const rows = new Map(seed.map((row) => [row.gameId, { ...row }]));
  const phases = new Map<string, SeasonPhaseClassification>();
  const store: GameStatusStore & { rows: typeof rows; phases: typeof phases } = {
    rows,
    phases,
    getById(gameId) {
      const row = rows.get(gameId);
      return row ? { ...row } : null;
    },
    upsert(row) {
      rows.set(row.gameId, { ...row });
    },
  };
  if (options.seasonPhase) {
    store.supportsSeasonPhase = () => true;
    store.applySeasonPhase = (gameId, phase) => {
      const existing = phases.get(gameId);
      if (rows.has(gameId) && phase.phase !== 'UNCLASSIFIED' && (!existing || existing.phase === 'UNCLASSIFIED')) {
        phases.set(gameId, { ...phase });
      }
    };
  }
  return store;
}

export function createFixtureFetchPage(games: ProviderGame[]): StatusSyncFetchPage {
  return async () => ({
    status: 200,
    ok: true,
    json: { data: games, meta: { next_cursor: null } },
  });
}
