/**
 * Display-only scoreboard collector cycle (one scheduler tick).
 *
 * Gates → per enabled season type: plan from stored state → /v1/games (explicit season_type) →
 * normalize + merge → display store → /v1/box_scores/live only when a game needs player lines.
 * Then, isolated from the scores path: /v2/odds for scheduled games, about every 15 minutes, only when
 * SCOREBOARD_COLLECT_ODDS=1. An odds failure never changes the games outcome or any games row.
 * Every BDL request goes through the shared acquiring fetch (rate limiter, ledger, S3 archive,
 * parse of archived bytes). A failed or unarchived request writes nothing from that request.
 * This module never touches analytics tables, raw game tables, or any model path.
 */

import { randomUUID } from 'node:crypto';
import type { AcquiringBdlFetch } from '@/lib/games/status-sync-acquisition';
import { shiftEtYmd, etYmd } from '@/lib/games/status-sync-query';
import type { ScoreboardPlayerLine, ScoreboardSeasonType, StoredScoreboardGame } from './contract';
import { parseScoreboardTargetSeason, resolveScoreboardCollection, resolveScoreboardOddsCollection } from './flags';
import { boxScoreCompleteness, carriedBoxCompleteness, verifyFinalBoxScore } from './box-verify';
import { normalizeOddsRows, oddsEligibleGames, SCOREBOARD_ODDS_POLICY } from './market';
import { matchLiveBoxScores, mergeObservation, normalizeGameRow } from './normalize';
import { needsLiveBox, nextPollingState, planScoreboardTick } from './planner';
import type { ScoreboardStore } from './store';

export const SCOREBOARD_COLLECTOR = { name: 'scoreboard-collector', version: 'scoreboard.v1' } as const;
export const SCOREBOARD_GAMES_FAMILY = 'scoreboard_games';
export const SCOREBOARD_LIVE_BOX_FAMILY = 'box_scores_live';
export const SCOREBOARD_ODDS_FAMILY = 'scoreboard_odds';
export const SCOREBOARD_WORKER = 'scoreboard-collector';
export const SCOREBOARD_GAMES_MAX_PAGES = 3;
const BDL_BASE = 'https://api.balldontlie.io';

export function scoreboardGamesUrl(args: {
  season: number;
  seasonType: ScoreboardSeasonType;
  startDate: string;
  endDate: string;
  cursor?: number | null;
}): string {
  const p = new URLSearchParams();
  p.set('seasons[]', String(args.season));
  p.set('season_type', args.seasonType);
  p.set('start_date', args.startDate);
  p.set('end_date', args.endDate);
  p.set('per_page', '100');
  if (args.cursor != null) p.set('cursor', String(args.cursor));
  return `${BDL_BASE}/v1/games?${p.toString()}`;
}

export function scoreboardLiveBoxUrl(seasonType: ScoreboardSeasonType): string {
  return `${BDL_BASE}/v1/box_scores/live?season_type=${encodeURIComponent(seasonType)}`;
}

/** /v2/odds filters only by game_ids[] or dates[]; there is no season type filter. */
export function scoreboardOddsUrl(gameIds: string[], cursor?: number | null): string {
  const p = new URLSearchParams();
  for (const id of gameIds) p.append('game_ids[]', id);
  p.set('per_page', '100');
  if (cursor != null) p.set('cursor', String(cursor));
  return `${BDL_BASE}/v2/odds?${p.toString()}`;
}

export type ScoreboardOddsResult = {
  status: 'disabled' | 'not_due' | 'no_eligible_games' | 'skipped' | 'success' | 'failed';
  reason: string | null;
  eligibleGames: number;
  requestedGames: number;
  pages: number;
  truncated: boolean;
  quotes: number;
  written: number;
  withdrawn: number;
  rejected: number;
  quarantinedFields: number;
  vendors: string[];
};

export type ScoreboardSeasonTypeResult = {
  seasonType: ScoreboardSeasonType;
  plan: string;
  gamesFetched: number;
  upserted: number;
  rejected: Array<{ gameId: string | null; reason: string }>;
  truncated: boolean;
  box: {
    requested: boolean;
    matched: number;
    unmatched: number;
    ambiguous: number;
    /** Final games whose box row failed verification this tick, with the first failed check. */
    unverified: Array<{ gameId: string; reason: string | null }>;
  };
};

export type ScoreboardCycleResult = {
  job: 'scoreboard_collector';
  status: 'skipped' | 'success' | 'failed';
  reason: string | null;
  bdlRequests: number;
  refused: Array<{ seasonType: ScoreboardSeasonType; reason: string }>;
  seasonTypes: ScoreboardSeasonTypeResult[];
  /** Separate from `status`: odds never make a scores cycle fail or succeed. */
  odds?: ScoreboardOddsResult;
  durationMs: number;
};

type Env = Record<string, string | undefined>;

/** One acquiring fetch per endpoint family, so ledger rows and S3 keys name the right family. */
export type ScoreboardFetchers = { games: AcquiringBdlFetch; liveBox: AcquiringBdlFetch; odds?: AcquiringBdlFetch };

export async function runScoreboardCycle(input: {
  env: Env;
  store: ScoreboardStore;
  fetch?: ScoreboardFetchers;
  now?: Date;
  clock?: () => Date;
  newId?: () => string;
}): Promise<ScoreboardCycleResult> {
  const startedMs = Date.now();
  const now = input.now ?? new Date();
  const clock = input.clock ?? (() => new Date());
  const newId = input.newId ?? randomUUID;
  const decision = resolveScoreboardCollection(input.env);
  const seasonTypes: ScoreboardSeasonTypeResult[] = [];
  let bdlRequests = 0;
  let odds: ScoreboardOddsResult | undefined;
  const done = (status: ScoreboardCycleResult['status'], reason: string | null): ScoreboardCycleResult => ({
    job: 'scoreboard_collector',
    status,
    reason,
    bdlRequests,
    refused: decision.refused,
    seasonTypes,
    ...(odds ? { odds } : {}),
    durationMs: Date.now() - startedMs,
  });

  if (decision.seasonTypes.length === 0) return done('skipped', decision.reason);
  const target = parseScoreboardTargetSeason(input.env);
  if (!target.ok) return done('failed', target.reason);
  if (!input.fetch) return done('failed', 'no acquiring fetch configured');
  const fetchers = input.fetch;

  const today = etYmd(now);
  // A games failure stops the scores loop exactly as before; the odds step runs after it.
  let gamesFailure: string | null = null;
  games: for (const seasonType of decision.seasonTypes) {
    const stored = await input.store.loadGames(seasonType, shiftEtYmd(today, -1), shiftEtYmd(today, 1));
    const plan = planScoreboardTick({
      now,
      games: stored,
      lastGamesRequestAt: await input.store.loadLastGamesRequestAt(seasonType),
    });
    const result: ScoreboardSeasonTypeResult = {
      seasonType,
      plan: plan.reason,
      gamesFetched: 0,
      upserted: 0,
      rejected: [],
      truncated: false,
      box: { requested: false, matched: 0, unmatched: 0, ambiguous: 0, unverified: [] },
    };
    seasonTypes.push(result);
    if (!plan.gamesRequest) continue;

    // 1. /v1/games pages. Any failed, blocked or unparseable page: no writes for this season type.
    const pullRunId = newId();
    const pages: Array<{ rows: unknown[]; requestId: string }> = [];
    let cursor: number | null = null;
    // Order by when this cycle started, not by when its response is written.
    const observedAt = now.toISOString();
    for (let pageIndex = 0; pageIndex < SCOREBOARD_GAMES_MAX_PAGES; pageIndex += 1) {
      const url = scoreboardGamesUrl({
        season: target.season,
        seasonType,
        startDate: plan.gamesRequest.startDate,
        endDate: plan.gamesRequest.endDate,
        cursor,
      });
      const page = await fetchers.games(url, {
        plan: {
          targetSeason: target.season,
          seasonTypeRequested: seasonType,
          startDate: plan.gamesRequest.startDate,
          endDate: plan.gamesRequest.endDate,
        },
        pageIndex,
        cursor,
        pullRunId,
      });
      bdlRequests += page.acquisition?.requestIds.length ?? 1;
      const requestId = page.acquisition?.requestIds.at(-1);
      if (!page.acquisition || page.acquisition.blockedReason || !requestId) {
        gamesFailure = `games acquisition blocked: ${page.acquisition?.blockedReason ?? 'no evidence'}`;
        break games;
      }
      if (!page.ok || page.parseError || !page.json) {
        gamesFailure = `games request failed: ${page.parseError ?? page.error ?? `HTTP ${page.status}`}`;
        break games;
      }
      pages.push({ rows: page.json.data ?? [], requestId });
      cursor = page.json.meta?.next_cursor ?? null;
      if (cursor == null) break;
    }
    result.truncated = cursor != null;

    // 2. Normalize + merge. Season type comes from this request only.
    const byId = new Map(stored.map((g) => [g.gameId, g]));
    const touched = new Map<string, StoredScoreboardGame>();
    for (const { rows, requestId } of pages) {
      for (const raw of rows) {
        result.gamesFetched += 1;
        const n = normalizeGameRow(
          raw,
          { requestSeasonType: seasonType, targetSeason: target.season, requestId, observedAt },
          now
        );
        if (!n.ok) {
          result.rejected.push({ gameId: n.gameId, reason: n.reason });
          continue;
        }
        const prev = touched.get(n.game.gameId) ?? byId.get(n.game.gameId) ?? null;
        if (prev && prev.seasonType !== seasonType) {
          result.rejected.push({ gameId: n.game.gameId, reason: `provenance_conflict: stored as ${prev.seasonType}` });
          continue;
        }
        const merged = mergeObservation(prev, n.game);
        touched.set(merged.gameId, { ...merged, pollingState: nextPollingState(merged, now) });
      }
    }
    for (const g of stored) {
      if (touched.has(g.gameId)) continue;
      const state = nextPollingState(g, now);
      if (state !== g.pollingState) touched.set(g.gameId, { ...g, pollingState: state });
    }
    result.upserted = await input.store.upsertGames([...touched.values()]);
    await input.store.recordGamesRequest(seasonType, observedAt, pages.at(-1)!.requestId);

    // 3. Live box scores, only when a game is in progress or still needs final player lines.
    const current = new Map(stored.map((g) => [g.gameId, g]));
    for (const g of touched.values()) current.set(g.gameId, g);
    const boxGames = [...current.values()].filter(needsLiveBox);
    if (boxGames.length === 0) continue;
    result.box.requested = true;
    const boxPage = await fetchers.liveBox(scoreboardLiveBoxUrl(seasonType), {
      plan: { targetSeason: target.season, seasonTypeRequested: seasonType, startDate: null, endDate: null },
      pageIndex: 0,
      cursor: null,
      pullRunId: newId(),
    });
    bdlRequests += boxPage.acquisition?.requestIds.length ?? 1;
    const boxRequestId = boxPage.acquisition?.requestIds.at(-1);
    if (!boxPage.acquisition || boxPage.acquisition.blockedReason || !boxRequestId) {
      gamesFailure = `live box acquisition blocked: ${boxPage.acquisition?.blockedReason ?? 'no evidence'}`;
      break games;
    }
    if (!boxPage.ok || boxPage.parseError || !boxPage.json) {
      gamesFailure = `live box request failed: ${boxPage.parseError ?? boxPage.error ?? `HTTP ${boxPage.status}`}`;
      break games;
    }
    const boxObservedAt = clock().toISOString();
    const match = matchLiveBoxScores(boxPage.json.data ?? [], [...current.values()]);
    result.box.matched = match.byGame.size;
    result.box.unmatched = match.unmatched;
    result.box.ambiguous = match.ambiguous;

    const priorLines = await input.store.loadPlayerLines(boxGames.map((g) => g.gameId));
    for (const g of boxGames) {
      const box = match.byGame.get(g.gameId);
      let next: StoredScoreboardGame = {
        ...g,
        finalBoxAttempts: g.lifecycle === 'final' ? g.finalBoxAttempts + 1 : g.finalBoxAttempts,
      };
      let lines: ScoreboardPlayerLine[] | null = null;
      if (box && box.lines.length > 0) {
        lines = box.lines;
        next = { ...next, boxRequestId, boxObservedAt, boxCompleteness: boxScoreCompleteness(next, box, boxObservedAt) };
        if (next.lifecycle === 'final' && next.boxCompleteness !== 'verified_final') {
          result.box.unverified.push({ gameId: g.gameId, reason: verifyFinalBoxScore(next, box, boxObservedAt).failures[0] ?? null });
        }
      } else {
        const hasStored = priorLines.some((l) => l.gameId === g.gameId);
        next = { ...next, boxCompleteness: carriedBoxCompleteness(next, hasStored) };
      }
      const accepted = await input.store.applyObservation({ ...next, pollingState: nextPollingState(next, now) }, lines);
      if (!accepted) result.rejected.push({ gameId: g.gameId, reason: 'stale_observation' });
    }
  }

  const oddsDecision = resolveScoreboardOddsCollection(input.env, decision);
  if (oddsDecision.enabled) {
    if (gamesFailure) {
      // Same limiter, same provider: do not add an odds request to a tick whose scores request failed.
      odds = emptyOddsResult('skipped', 'games step failed this tick');
    } else if (!fetchers.odds) {
      odds = emptyOddsResult('failed', 'no odds fetch configured');
    } else {
      const oddsFetch = fetchers.odds;
      try {
        odds = await collectOdds({
          store: input.store,
          fetch: oddsFetch,
          seasonTypes: oddsDecision.seasonTypes,
          targetSeason: target.season,
          now,
          clock,
          newId,
          countRequests: (n) => {
            bdlRequests += n;
          },
        });
      } catch (err) {
        const reason = `odds step error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
        odds = emptyOddsResult('failed', reason);
        try {
          await input.store.recordOddsOutcome(now.toISOString(), { status: 'failed', error: reason });
        } catch {
          /* odds state is advisory; the scores outcome stands */
        }
      }
    }
  }
  return gamesFailure ? done('failed', gamesFailure) : done('success', null);
}

function emptyOddsResult(status: ScoreboardOddsResult['status'], reason: string | null): ScoreboardOddsResult {
  return {
    status,
    reason,
    eligibleGames: 0,
    requestedGames: 0,
    pages: 0,
    truncated: false,
    quotes: 0,
    written: 0,
    withdrawn: 0,
    rejected: 0,
    quarantinedFields: 0,
    vendors: [],
  };
}

/**
 * Current pre-game odds for scheduled games of season types already collecting. Requests only when an
 * eligible game exists and the separate odds interval is due (atomic claim). Any failed, blocked or
 * unparseable page: no odds writes this attempt; the games rows are never touched here.
 */
async function collectOdds(args: {
  store: ScoreboardStore;
  fetch: AcquiringBdlFetch;
  seasonTypes: ScoreboardSeasonType[];
  targetSeason: number;
  now: Date;
  clock: () => Date;
  newId: () => string;
  countRequests: (n: number) => void;
}): Promise<ScoreboardOddsResult> {
  const { store, now } = args;
  const today = etYmd(now);
  const tomorrow = shiftEtYmd(today, 1);
  const stored: StoredScoreboardGame[] = [];
  for (const seasonType of args.seasonTypes) stored.push(...(await store.loadGames(seasonType, today, tomorrow)));
  const eligible = oddsEligibleGames(stored, now);
  if (eligible.length === 0) return emptyOddsResult('no_eligible_games', null);
  const requested = eligible.slice(0, SCOREBOARD_ODDS_POLICY.MAX_GAMES_PER_REQUEST);
  const result: ScoreboardOddsResult = {
    ...emptyOddsResult('not_due', null),
    eligibleGames: eligible.length,
    requestedGames: requested.length,
  };

  const attemptAt = now.toISOString();
  if (!(await store.claimOddsAttempt(attemptAt))) return result;

  const fail = async (reason: string): Promise<ScoreboardOddsResult> => {
    await store.recordOddsOutcome(attemptAt, { status: 'failed', error: reason });
    return { ...result, status: 'failed', reason };
  };

  const gameIds = requested.map((g) => g.gameId);
  const pullRunId = args.newId();
  const pages: Array<{ rows: unknown[]; requestId: string }> = [];
  let cursor: number | null = null;
  for (let pageIndex = 0; pageIndex < SCOREBOARD_ODDS_POLICY.MAX_PAGES; pageIndex += 1) {
    const page = await args.fetch(scoreboardOddsUrl(gameIds, cursor), {
      plan: {
        targetSeason: args.targetSeason,
        seasonTypeRequested: null,
        startDate: requested[0].etDate,
        endDate: requested[requested.length - 1].etDate,
      },
      pageIndex,
      cursor,
      pullRunId,
    });
    args.countRequests(page.acquisition?.requestIds.length ?? 1);
    result.pages += 1;
    const requestId = page.acquisition?.requestIds.at(-1);
    if (!page.acquisition || page.acquisition.blockedReason || !requestId) {
      return fail(`odds acquisition blocked: ${page.acquisition?.blockedReason ?? 'no evidence'}`);
    }
    if (!page.ok || page.parseError || !page.json) {
      return fail(`odds request failed: ${page.parseError ?? page.error ?? `HTTP ${page.status}`}`);
    }
    const rows = page.json.data;
    if (rows != null && !Array.isArray(rows)) return fail('odds response data is not an array');
    pages.push({ rows: rows ?? [], requestId });
    cursor = page.json.meta?.next_cursor ?? null;
    if (cursor == null) break;
  }
  result.truncated = cursor != null;

  const observedAt = args.clock().toISOString();
  const normalized = normalizeOddsRows(pages, { eligibleGameIds: new Set(gameIds), observedAt });
  result.quotes = normalized.quotes.length;
  result.rejected = normalized.rejected.length;
  result.quarantinedFields = normalized.quarantinedFields;
  result.vendors = [...new Set(normalized.quotes.map((q) => q.vendor))].sort();
  const lastRequestId = pages.at(-1)!.requestId;
  const write = await store.applyOddsAcquisition({
    quotes: normalized.quotes,
    observedAt,
    requestId: lastRequestId,
    // A truncated read cannot prove a vendor is gone, so it withdraws nothing.
    withdrawGameIds: result.truncated ? [] : gameIds,
  });
  result.written = write.written;
  result.withdrawn = write.withdrawn;
  await store.recordOddsOutcome(attemptAt, { status: 'success', requestId: lastRequestId });
  return { ...result, status: 'success', reason: result.truncated ? 'odds pages truncated' : null };
}
