import { CC_SEASON_TO_OWLS, OWLS_PAGE_LIMITS, OWLS_PATHS } from './contract';
import { extractRows, OwlsInsightClient } from './client';
import {
  buildOwlsArchiveKey,
  buildOwlsEnvelope,
  entityForEndpoint,
  readOwlsEnvelope,
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
import { matchOwlsGameToCourtContext, owlsHistoryDateWindow } from './mapping';
import { asRecord, attachArchiveKey, normalizePayloadRows } from './normalize';
import { ProgressTracker } from './progress';
import { evaluateStopConditions, type StopEvaluation } from './validation';
import type { CourtContextGame, OwlsAcquisitionState, OwlsGameLike, OwlsMode, OwlsPage } from './types';
import { OwlsExecuteRequiredError } from './errors';

export type BackfillOpts = {
  runId: string;
  phase: number;
  mode: OwlsMode;
  games: CourtContextGame[];
  client: OwlsInsightClient;
  store: OwlsObjectStore;
  checkpoints: CheckpointStore;
  resume?: boolean;
  yes?: boolean;
  rawPrefix?: string;
  now?: () => string;
  logger?: (msg: string) => void;
  normalize?: boolean;
  stopOnProbeFailure?: boolean;
};

export type BackfillResult = {
  runId: string;
  mode: OwlsMode;
  gamesAttempted: number;
  gamesCompleted: number;
  pages: number;
  rows: number;
  skipped: number;
  failures: number;
  archivedKeys: string[];
  stop: StopEvaluation | null;
};

function gameDateUtc(iso: string): string {
  return iso.slice(0, 10);
}

function readOwlsGame(row: unknown): OwlsGameLike | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const providerGameId = String(
    rec.eventId ?? rec.event_id ?? rec.id ?? rec.gameId ?? rec.game_id ?? ''
  ).trim();
  if (!providerGameId) return null;
  return {
    providerGameId,
    season: typeof rec.season === 'string' ? rec.season : null,
    startTime:
      typeof rec.startTime === 'string'
        ? rec.startTime
        : typeof rec.start_time === 'string'
          ? rec.start_time
          : typeof rec.commence_time === 'string'
            ? rec.commence_time
            : typeof rec.gameDate === 'string'
              ? rec.gameDate
              : typeof rec.game_date === 'string'
                ? rec.game_date
                : null,
    homeTeam:
      typeof rec.homeTeam === 'string'
        ? rec.homeTeam
        : typeof rec.home_team === 'string'
          ? rec.home_team
          : null,
    awayTeam:
      typeof rec.awayTeam === 'string'
        ? rec.awayTeam
        : typeof rec.away_team === 'string'
          ? rec.away_team
          : null,
    raw: row,
  };
}

export async function runOwlsPropBackfill(opts: BackfillOpts): Promise<BackfillResult> {
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

  let state = resume ? await opts.checkpoints.load(opts.runId) : null;
  if (!state) {
    state = {
      run: emptyRun({
        runId: opts.runId,
        phase: opts.phase,
        mode: opts.mode,
        targetSeasons: seasons,
        endpoint: 'history_player_props',
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
  const result: BackfillResult = {
    runId: opts.runId,
    mode: opts.mode,
    gamesAttempted: 0,
    gamesCompleted: 0,
    pages: 0,
    rows: 0,
    skipped: 0,
    failures: 0,
    archivedKeys,
    stop: null,
  };

  for (const game of opts.games) {
    result.gamesAttempted += 1;
    state.run.games_attempted = result.gamesAttempted;
    const prior = acquisition[game.courtContextGameId];
    if (
      resume &&
      prior &&
      (prior.state === 'POPULATED' || prior.state === 'EMPTY_PROVIDER_HISTORY')
    ) {
      if (prior.state === 'POPULATED') progress.populatedGames += 1;
      else progress.emptyProviderHistory += 1;
      result.gamesCompleted += 1;
      progress.gamesComplete += 1;
      result.skipped += 1;
      continue;
    }
    try {
      const providerGame = await resolveProviderGame({
        game,
        client: opts.client,
        store: opts.store,
        state,
        fixture,
        rawPrefix: opts.rawPrefix,
        isoNow,
        runId: opts.runId,
        resume,
        archivedKeys,
      });
      if (!providerGame) {
        recordGameAcquisition(state, {
          court_context_game_id: game.courtContextGameId,
          state: 'GAME_MAPPING_FAILED',
          rows: 0,
          event_id: null,
          error: null,
        });
        result.failures += 1;
        state.run.mapping_unmatched += 1;
        state.run.failures += 1;
        progress.failures += 1;
        progress.mappingFailed += 1;
        progress.gamesComplete += 1;
        const metricsEarly = opts.client.getMetrics();
        state.run.requests_attempted = metricsEarly.requestsAttempted;
        state.run.requests_successful = metricsEarly.requestsSuccessful;
        state.run.requests_retried = metricsEarly.requestsRetried;
        state.run.status_429 = metricsEarly.status429;
        state.run.status_503 = metricsEarly.status503;
        await opts.checkpoints.save(state);
        continue;
      }
      const mapped = matchOwlsGameToCourtContext(providerGame.owls, opts.games);
      if (mapped.status === 'MATCHED') state.run.mapping_matched += 1;
      else if (mapped.status === 'AMBIGUOUS') state.run.mapping_ambiguous += 1;
      else state.run.mapping_unmatched += 1;

      const limit = OWLS_PAGE_LIMITS.historyPlayerProps.max;
      let offset = 0;
      let pageIndex = 1;
      let gameRows = 0;
      let acquisition: OwlsAcquisitionState | null = null;
      let acquisitionError: string | null = null;
      while (true) {
        const uid = unitId({
          endpoint: 'history_player_props',
          providerGameId: providerGame.owls.providerGameId,
          pageIndex,
          offset,
        });
        const existingUnit = state.units[uid];
        if (resume && isArchived(existingUnit) && existingUnit.archive_key) {
          const existingObj = await opts.store.head(existingUnit.archive_key);
          if (existingObj) {
            result.skipped += 1;
            result.pages += 1;
            result.rows += existingUnit.row_count;
            gameRows += existingUnit.row_count;
            archivedKeys.push(existingUnit.archive_key);
            if (existingUnit.status !== 'NORMALIZED' && opts.normalize) {
              await normalizeArchivedPage({
                store: opts.store,
                key: existingUnit.archive_key,
                courtContextGameId: game.courtContextGameId,
                gameMatch: mapped.status,
              });
              existingUnit.status = 'NORMALIZED';
              existingUnit.updated_at = isoNow();
            }
            if (existingUnit.row_count < limit) break;
            offset += limit;
            pageIndex += 1;
            continue;
          }
        }

        upsertUnit(
          state,
          makeUnit({
            unit_id: uid,
            endpoint: 'history_player_props',
            provider_game_id: providerGame.owls.providerGameId,
            court_context_game_id: game.courtContextGameId,
            season: game.season,
            game_date: gameDateUtc(game.startTime),
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

        const pages: OwlsPage[] = [];
        const iter = opts.client.paginate({
          path: OWLS_PATHS.historyPlayerProps,
          query: { eventId: providerGame.owls.providerGameId, sport: 'nba' },
          limit,
          startOffset: offset,
          startPageIndex: pageIndex,
        });
        const next = await iter.next();
        if (next.done || !next.value) break;
        pages.push(next.value);
        const page = next.value;
        const requestedAt = isoNow();
        const key = buildOwlsArchiveKey({
          rawPrefix: opts.rawPrefix,
          fixture,
          season: game.season,
          entity: entityForEndpoint('history_player_props'),
          gameDate: gameDateUtc(game.startTime),
          providerGameId: providerGame.owls.providerGameId,
          pageIndex: page.pageIndex,
        });
        const envelope = buildOwlsEnvelope({
          page,
          backfillRunId: opts.runId,
          requestedAt,
          providerGameId: providerGame.owls.providerGameId,
          season: game.season,
          gameDate: gameDateUtc(game.startTime),
          fixture,
        });
        const write = await writeOwlsArchiveObject({ store: opts.store, key, envelope });
        if (!write.ok) {
          upsertUnit(
            state,
            makeUnit({
              unit_id: uid,
              endpoint: 'history_player_props',
              provider_game_id: providerGame.owls.providerGameId,
              court_context_game_id: game.courtContextGameId,
              season: game.season,
              game_date: gameDateUtc(game.startTime),
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
          result.failures += 1;
          state.run.failures += 1;
          acquisition = 'ARCHIVE_FAILED';
          acquisitionError = write.message;
          break;
        }
        await readOwlsEnvelope(opts.store, key);
        upsertUnit(
          state,
          makeUnit({
            unit_id: uid,
            endpoint: 'history_player_props',
            provider_game_id: providerGame.owls.providerGameId,
            court_context_game_id: game.courtContextGameId,
            season: game.season,
            game_date: gameDateUtc(game.startTime),
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
        gameRows += page.rowCount;
        state.run.rows += page.rowCount;
        state.run.s3_objects += write.result === 'written' ? 1 : 0;
        progress.pagesComplete += 1;
        progress.rowsArchived += page.rowCount;

        if (opts.normalize) {
          await normalizeArchivedPage({
            store: opts.store,
            key,
            courtContextGameId: game.courtContextGameId,
            gameMatch: mapped.status,
          });
          state.units[uid]!.status = 'NORMALIZED';
        }

        await opts.checkpoints.save(state);
        if (page.exhausted) break;
        offset = page.offset + limit;
        pageIndex = page.pageIndex + 1;
      }
      if (!acquisition) {
        acquisition = gameRows > 0 ? 'POPULATED' : 'EMPTY_PROVIDER_HISTORY';
      }
      recordGameAcquisition(state, {
        court_context_game_id: game.courtContextGameId,
        state: acquisition,
        rows: gameRows,
        event_id: providerGame.owls.providerGameId,
        error: acquisitionError,
      });
      if (acquisition === 'POPULATED') progress.populatedGames += 1;
      else if (acquisition === 'EMPTY_PROVIDER_HISTORY') progress.emptyProviderHistory += 1;
      result.gamesCompleted += 1;
      state.run.games_completed += 1;
      progress.gamesComplete += 1;
    } catch (err) {
      recordGameAcquisition(state, {
        court_context_game_id: game.courtContextGameId,
        state: 'REQUEST_FAILED',
        rows: 0,
        event_id: null,
        error: err instanceof Error ? err.message : String(err),
      });
      result.failures += 1;
      state.run.failures += 1;
      progress.failures += 1;
      progress.gamesComplete += 1;
      logger(err instanceof Error ? err.message : String(err));
    }
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
    progress.maybeLog(logger);
    await opts.checkpoints.save(state);
  }

  if (opts.phase === 1 && opts.stopOnProbeFailure !== false) {
    result.stop = evaluateStopConditions({
      gamesRequested: result.gamesAttempted,
      gamesMatched: state.run.mapping_matched,
      gamesAmbiguous: state.run.mapping_ambiguous,
      playerMatchRate: 1,
      corePropsPresent: 8,
      pricesPresent: true,
      consecutive429: 0,
      consecutive503: 0,
      archiveFailures: result.failures,
      paginationAnomaly: false,
    });
  }

  state.run.completed_at = isoNow();
  await opts.checkpoints.save(state);
  return result;
}

async function resolveProviderGame(args: {
  game: CourtContextGame;
  client: OwlsInsightClient;
  store: OwlsObjectStore;
  state: CheckpointState;
  fixture: boolean;
  rawPrefix?: string;
  isoNow: () => string;
  runId: string;
  resume: boolean;
  archivedKeys: string[];
}): Promise<{ owls: OwlsGameLike } | null> {
  const owlsSeason = CC_SEASON_TO_OWLS[args.game.season];
  const startDate = gameDateUtc(args.game.startTime);
  const dateWindow = owlsHistoryDateWindow(args.game.startTime);
  const uid = unitId({
    endpoint: 'history_games',
    providerGameId: args.game.courtContextGameId,
    pageIndex: 1,
    offset: 0,
  });
  const existing = args.state.units[uid];
  if (args.resume && isArchived(existing) && existing.archive_key) {
    const env = await readOwlsEnvelope(args.store, existing.archive_key);
    const rows = extractRows(env.payload).map(readOwlsGame).filter((x): x is OwlsGameLike => x != null);
    const mapped = rows
      .map((owls) => ({ owls, match: matchOwlsGameToCourtContext(owls, [args.game]) }))
      .find((x) => x.match.status === 'MATCHED' && x.match.courtContextGameId === args.game.courtContextGameId);
    if (mapped) return { owls: mapped.owls };
  }

  const pageIter = args.client.paginate({
    path: OWLS_PATHS.historyGames,
    query: {
      sport: 'nba',
      season: owlsSeason,
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
    },
    limit: OWLS_PAGE_LIMITS.historyGames.max,
    startOffset: 0,
    startPageIndex: 1,
  });
  const first = await pageIter.next();
  if (first.done || !first.value) return null;
  const page = first.value;
  const key = buildOwlsArchiveKey({
    rawPrefix: args.rawPrefix,
    fixture: args.fixture,
    season: args.game.season,
    entity: entityForEndpoint('history_games'),
    gameDate: startDate,
    providerGameId: `cc-${args.game.courtContextGameId}`,
    pageIndex: 1,
  });
  const envelope = buildOwlsEnvelope({
    page,
    backfillRunId: args.runId,
    requestedAt: args.isoNow(),
    providerGameId: null,
    season: args.game.season,
    gameDate: startDate,
    fixture: args.fixture,
  });
  const write = await writeOwlsArchiveObject({ store: args.store, key, envelope });
  if (!write.ok) return null;
  await readOwlsEnvelope(args.store, key);
  args.archivedKeys.push(key);
  upsertUnit(
    args.state,
    makeUnit({
      unit_id: uid,
      endpoint: 'history_games',
      provider_game_id: null,
      court_context_game_id: args.game.courtContextGameId,
      season: args.game.season,
      game_date: startDate,
      page_index: 1,
      offset: 0,
      limit: OWLS_PAGE_LIMITS.historyGames.max,
      status: 'ARCHIVED',
      archive_key: key,
      checksum: write.checksum,
      row_count: page.rowCount,
      error: null,
      updatedAt: args.isoNow(),
    })
  );
  const rows = extractRows(page.body).map(readOwlsGame).filter((x): x is OwlsGameLike => x != null);
  const mapped = rows
    .map((owls) => ({ owls, match: matchOwlsGameToCourtContext(owls, [args.game]) }))
    .find((x) => x.match.status === 'MATCHED');
  return mapped ? { owls: mapped.owls } : null;
}

function recordGameAcquisition(
  state: CheckpointState,
  row: {
    court_context_game_id: string;
    state: OwlsAcquisitionState;
    rows: number;
    event_id: string | null;
    error: string | null;
  }
): void {
  const acquisition = (state.game_acquisition ??= {});
  acquisition[row.court_context_game_id] = row;
}

async function normalizeArchivedPage(args: {
  store: OwlsObjectStore;
  key: string;
  courtContextGameId: string;
  gameMatch: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';
}): Promise<void> {
  const envelope = await readOwlsEnvelope(args.store, args.key);
  attachArchiveKey(
    normalizePayloadRows({
      envelope,
      courtContextGameId: args.courtContextGameId,
      gameMatch: args.gameMatch,
    }),
    args.key
  );
}

export async function normalizeOwlsArchiveOffline(args: {
  store: OwlsObjectStore;
  prefix: string;
}): Promise<{ keys: string[]; rows: number }> {
  const keys = await args.store.listKeys(args.prefix);
  let rows = 0;
  for (const key of keys) {
    if (!key.endsWith('.json.gz')) continue;
    const envelope = await readOwlsEnvelope(args.store, key);
    const normalized = attachArchiveKey(normalizePayloadRows({ envelope }), key);
    rows += normalized.length;
  }
  return { keys, rows };
}
