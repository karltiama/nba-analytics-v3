import {
  OWLS_CLOSING_ODDS_ARCHIVE_SCHEMA,
  OWLS_CLOSING_ODDS_BACKFILL_CAPS,
  OWLS_PAGE_LIMITS,
  OWLS_PATHS,
} from './contract';
import { OwlsInsightClient } from './client';
import {
  buildOwlsArchiveKey,
  buildOwlsEnvelope,
  entityForEndpoint,
  gzipJson,
  readOwlsEnvelope,
  sanitizeProviderGameId,
  writeOwlsArchiveObject,
  type OwlsObjectStore,
} from './archive';
import {
  emptyRun,
  isArchived,
  makeUnit,
  unitId,
  upsertUnit,
  type CheckpointState,
  type CheckpointStore,
} from './checkpoint';
import { ProgressTracker } from './progress';
import { classifyGamePhase } from './universe';
import type {
  CourtContextGame,
  OwlsAcquisitionState,
  OwlsEndpointName,
  OwlsGameAcquisition,
  OwlsMode,
  OwlsPage,
} from './types';
import { OwlsExecuteRequiredError } from './errors';

export type EventIdMapping = {
  eventId: string | null;
  fromState: OwlsAcquisitionState | null;
};

export type MappedHistoryTarget = {
  endpoint: OwlsEndpointName;
  path: string;
  schema: string;
  maxProjectedRequests: number;
  maxPagesPerGame: number;
  maxConcurrency: number;
  pageLimit: number;
};

const DEFAULT_CLOSING_TARGET: MappedHistoryTarget = {
  endpoint: 'history_closing_odds',
  path: OWLS_PATHS.historyClosingOdds,
  schema: OWLS_CLOSING_ODDS_ARCHIVE_SCHEMA,
  maxProjectedRequests: OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxProjectedRequests,
  maxPagesPerGame: OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxPagesPerGame,
  maxConcurrency: OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxConcurrency,
  pageLimit: OWLS_PAGE_LIMITS.historyClosingOdds.max,
};

export type ClosingOddsBackfillOpts = {
  runId: string;
  phase: number;
  mode: OwlsMode;
  games: CourtContextGame[];
  eventIds: Record<string, EventIdMapping>;
  client: OwlsInsightClient;
  store: OwlsObjectStore;
  checkpoints: CheckpointStore;
  resume?: boolean;
  yes?: boolean;
  rawPrefix?: string;
  now?: () => string;
  logger?: (msg: string) => void;
  gameConcurrency?: number;
  target?: MappedHistoryTarget;
};

export type ClosingOddsBackfillResult = {
  runId: string;
  mode: OwlsMode;
  gamesAttempted: number;
  gamesCompleted: number;
  pages: number;
  rows: number;
  skipped: number;
  failures: number;
  compressedBytes: number;
  archivedKeys: string[];
  lastRemainingMonth: string | null;
  stopReason: string | null;
};

class Mutex {
  private chain = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function gameDateUtc(iso: string): string {
  return iso.slice(0, 10);
}

function terminalSkip(state: OwlsAcquisitionState | undefined): boolean {
  return state === 'POPULATED' || state === 'EMPTY_PROVIDER_HISTORY' || state === 'GAME_MAPPING_FAILED';
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item);
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  await Promise.all([...executing]);
}

export async function runOwlsClosingOddsBackfill(
  opts: ClosingOddsBackfillOpts
): Promise<ClosingOddsBackfillResult> {
  if (opts.mode === 'dry-run') {
    throw new OwlsExecuteRequiredError('Use the planner for dry-run. Backfill fetch requires fixture or --execute.');
  }
  if (opts.mode === 'execute' && !opts.yes) {
    throw new Error('Execute mode requires --yes (or interactive confirmation in the CLI).');
  }

  const resume = opts.resume !== false;
  const fixture = opts.mode === 'fixture';
  const logger = opts.logger ?? (() => undefined);
  const isoNow = opts.now ?? (() => new Date().toISOString());
  const seasons = [...new Set(opts.games.map((g) => g.season))];
  const target = opts.target ?? DEFAULT_CLOSING_TARGET;
  const concurrency = Math.min(
    Math.max(1, opts.gameConcurrency ?? target.maxConcurrency),
    target.maxConcurrency
  );
  const limit = target.pageLimit;

  let state = resume ? await opts.checkpoints.load(opts.runId) : null;
  if (!state) {
    state = {
      run: emptyRun({
        runId: opts.runId,
        phase: opts.phase,
        mode: opts.mode,
        targetSeasons: seasons,
        endpoint: target.endpoint,
        startedAt: isoNow(),
      }),
      units: {},
      game_acquisition: {},
    };
  }
  const acquisition = (state.game_acquisition ??= {});

  const progress = new ProgressTracker();
  progress.gamesTotal = opts.games.length;
  progress.season = seasons.length === 1 ? seasons[0]! : 'mixed';

  const archivedKeys: string[] = [];
  const result: ClosingOddsBackfillResult = {
    runId: opts.runId,
    mode: opts.mode,
    gamesAttempted: 0,
    gamesCompleted: 0,
    pages: 0,
    rows: 0,
    skipped: 0,
    failures: 0,
    compressedBytes: 0,
    archivedKeys,
    lastRemainingMonth: null,
    stopReason: null,
  };

  const lock = new Mutex();
  let stop = false;

  const syncMetrics = () => {
    const metrics = opts.client.getMetrics();
    progress.requests = metrics.requestsAttempted;
    progress.requestsSuccessful = metrics.requestsSuccessful;
    progress.requestsRetried = metrics.requestsRetried;
    progress.status429 = metrics.status429;
    progress.status503 = metrics.status503;
    state.run.requests_attempted = metrics.requestsAttempted;
    state.run.requests_successful = metrics.requestsSuccessful;
    state.run.requests_retried = metrics.requestsRetried;
    state.run.status_429 = metrics.status429;
    state.run.status_503 = metrics.status503;
  };

  const wouldExceedCap = () => {
    const remaining = Math.max(0, progress.gamesTotal - progress.gamesComplete);
    const avgPages = result.pages > 0 && result.gamesCompleted > 0 ? result.pages / result.gamesCompleted : 1;
    const projected = opts.client.getMetrics().requestsAttempted + remaining * Math.max(1, avgPages);
    return projected > target.maxProjectedRequests;
  };

  await mapPool(opts.games, concurrency, async (game) => {
    const skip = await lock.run(async () => {
      if (stop) return true;
      result.gamesAttempted += 1;
      state.run.games_attempted = result.gamesAttempted;
      const prior = acquisition[game.courtContextGameId];
      if (resume && prior && terminalSkip(prior.state)) {
        if (prior.state === 'POPULATED') progress.populatedGames += 1;
        else if (prior.state === 'EMPTY_PROVIDER_HISTORY') progress.emptyProviderHistory += 1;
        else progress.mappingFailed += 1;
        result.gamesCompleted += 1;
        progress.gamesComplete += 1;
        result.skipped += 1;
        return true;
      }
      if (wouldExceedCap()) {
        stop = true;
        result.stopReason = `projected requests exceed ${target.maxProjectedRequests}`;
        return true;
      }
      return false;
    });
    if (skip || stop) return;

    const mapping = opts.eventIds[game.courtContextGameId];
    const eventId = mapping?.eventId ?? null;
    const gameDate = gameDateUtc(game.startTime);
    const gameType = game.phase ?? classifyGamePhase(game.season, game.startTime);

    const record = async (row: OwlsGameAcquisition) => {
      await lock.run(async () => {
        acquisition[row.court_context_game_id] = row;
        if (row.state === 'POPULATED') progress.populatedGames += 1;
        else if (row.state === 'EMPTY_PROVIDER_HISTORY') progress.emptyProviderHistory += 1;
        else if (row.state === 'GAME_MAPPING_FAILED') progress.mappingFailed += 1;
        else {
          result.failures += 1;
          state.run.failures += 1;
          progress.failures += 1;
        }
        result.gamesCompleted += 1;
        state.run.games_completed += 1;
        progress.gamesComplete += 1;
        syncMetrics();
        progress.maybeLog(logger);
        await opts.checkpoints.save(state);
      });
    };

    if (!eventId) {
      await record({
        court_context_game_id: game.courtContextGameId,
        state: 'GAME_MAPPING_FAILED',
        rows: 0,
        event_id: null,
        error: mapping?.fromState === 'GAME_MAPPING_FAILED' ? 'no eventId from prior games mapping' : 'no eventId',
        game_date: gameDate,
        game_type: gameType,
      });
      return;
    }

    try {
      let offset = 0;
      let pageIndex = 1;
      let gameRows = 0;
      let acquisition: OwlsAcquisitionState | null = null;
      let acquisitionError: string | null = null;

      while (pageIndex <= target.maxPagesPerGame) {
        const uid = unitId({
          endpoint: target.endpoint,
          providerGameId: eventId,
          pageIndex,
          offset,
        });

        const existingHandled = await lock.run(async () => {
          const existingUnit = state.units[uid];
          if (resume && isArchived(existingUnit) && existingUnit.archive_key) {
            const existingObj = await opts.store.head(existingUnit.archive_key);
            if (existingObj) {
              result.skipped += 1;
              result.pages += 1;
              result.rows += existingUnit.row_count;
              gameRows += existingUnit.row_count;
              archivedKeys.push(existingUnit.archive_key);
              return { skipFetch: true, exhausted: existingUnit.row_count < limit };
            }
          }
          upsertUnit(
            state,
            makeUnit({
              unit_id: uid,
              endpoint: target.endpoint,
              provider_game_id: eventId,
              court_context_game_id: game.courtContextGameId,
              season: game.season,
              game_date: gameDate,
              page_index: pageIndex,
              offset,
              limit,
              status: 'FETCHING',
              archive_key: null,
              checksum: null,
              row_count: 0,
              error: null,
              updatedAt: isoNow(),
            })
          );
          await opts.checkpoints.save(state);
          return { skipFetch: false, exhausted: false };
        });

        if (existingHandled.skipFetch) {
          if (existingHandled.exhausted) break;
          offset += limit;
          pageIndex += 1;
          continue;
        }

        const pages: OwlsPage[] = [];
        const iter = opts.client.paginate({
          path: target.path,
          query: { eventId },
          limit,
          startOffset: offset,
          startPageIndex: pageIndex,
        });
        const next = await iter.next();
        if (next.done || !next.value) break;
        pages.push(next.value);
        const page = next.value;
        const remaining = page.metadata.headers['x-ratelimit-remaining-month'];
        if (remaining) result.lastRemainingMonth = remaining;
        const requestedAt = isoNow();
        const key = buildOwlsArchiveKey({
          rawPrefix: opts.rawPrefix,
          fixture,
          season: game.season,
          entity: entityForEndpoint(target.endpoint),
          gameDate,
          providerGameId: sanitizeProviderGameId(eventId),
          pageIndex: page.pageIndex,
        });
        const envelope = buildOwlsEnvelope({
          page,
          backfillRunId: opts.runId,
          requestedAt,
          providerGameId: eventId,
          courtContextGameId: game.courtContextGameId,
          season: game.season,
          gameDate,
          fixture,
          schema: target.schema,
        });
        const compressed = gzipJson(envelope);
        const write = await writeOwlsArchiveObject({ store: opts.store, key, envelope });

        await lock.run(async () => {
          if (!write.ok) {
            upsertUnit(
              state,
              makeUnit({
                unit_id: uid,
                endpoint: target.endpoint,
                provider_game_id: eventId,
                court_context_game_id: game.courtContextGameId,
                season: game.season,
                game_date: gameDate,
                page_index: page.pageIndex,
                offset: page.offset,
                limit,
                status: 'FAILED',
                archive_key: key,
                checksum: null,
                row_count: page.rowCount,
                error: write.message,
                updatedAt: isoNow(),
              })
            );
            acquisition = 'ARCHIVE_FAILED';
            acquisitionError = write.message;
            return;
          }
          await readOwlsEnvelope(opts.store, key);
          upsertUnit(
            state,
            makeUnit({
              unit_id: uid,
              endpoint: target.endpoint,
              provider_game_id: eventId,
              court_context_game_id: game.courtContextGameId,
              season: game.season,
              game_date: gameDate,
              page_index: page.pageIndex,
              offset: page.offset,
              limit,
              status: 'ARCHIVED',
              archive_key: key,
              checksum: write.checksum,
              row_count: page.rowCount,
              error: null,
              updatedAt: isoNow(),
            })
          );
          archivedKeys.push(key);
          result.pages += 1;
          result.rows += page.rowCount;
          result.compressedBytes += compressed.length;
          gameRows += page.rowCount;
          state.run.rows += page.rowCount;
          state.run.s3_objects += write.result === 'written' ? 1 : 0;
          progress.pagesComplete += 1;
          progress.rowsArchived += page.rowCount;
          await opts.checkpoints.save(state);
        });

        if (acquisition === 'ARCHIVE_FAILED') break;
        if (page.exhausted) break;
        offset = page.offset + limit;
        pageIndex = page.pageIndex + 1;
        if (pageIndex > target.maxPagesPerGame) {
          stop = true;
          result.stopReason = `game ${game.courtContextGameId} exceeded ${target.maxPagesPerGame} pages`;
          acquisition = 'REQUEST_FAILED';
          acquisitionError = result.stopReason;
          break;
        }
      }

      if (!acquisition) acquisition = gameRows > 0 ? 'POPULATED' : 'EMPTY_PROVIDER_HISTORY';
      await record({
        court_context_game_id: game.courtContextGameId,
        state: acquisition,
        rows: gameRows,
        event_id: eventId,
        error: acquisitionError,
        game_date: gameDate,
        game_type: gameType,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger(message);
      await record({
        court_context_game_id: game.courtContextGameId,
        state: 'REQUEST_FAILED',
        rows: 0,
        event_id: eventId,
        error: message,
        game_date: gameDate,
        game_type: gameType,
      });
    }
  });

  syncMetrics();
  state.run.completed_at = isoNow();
  await opts.checkpoints.save(state);
  if (result.stopReason) logger(`STOP: ${result.stopReason}`);
  return result;
}

export function loadEventIdsFromCheckpoint(state: CheckpointState | null): Record<string, EventIdMapping> {
  const out: Record<string, EventIdMapping> = {};
  if (!state?.game_acquisition) return out;
  for (const [cc, acq] of Object.entries(state.game_acquisition)) {
    out[cc] = { eventId: acq.event_id, fromState: acq.state };
  }
  return out;
}
