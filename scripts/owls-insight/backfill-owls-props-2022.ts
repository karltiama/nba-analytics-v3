/**
 * Final 2022–23 Owls /history/player-props acquisition.
 *
 * Uses runOwlsPropBackfill + existing archive/checkpoint/S3 infrastructure.
 * Court Context has no 2022 Final games; the game universe is loaded from
 * Owls /history/games (regular|playin|playoff) and converted in-memory.
 *
 *   npx tsx scripts/owls-insight/backfill-owls-props-2022.ts --preflight-only
 *   npx tsx scripts/owls-insight/backfill-owls-props-2022.ts --execute --yes
 *   npx tsx scripts/owls-insight/backfill-owls-props-2022.ts --verify-only
 */
import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { FileCheckpointStore } from '@/lib/providers/owls-insight/checkpoint';
import { extractRows, OwlsInsightClient } from '@/lib/providers/owls-insight/client';
import {
  assertRequestedSeasonScope,
  buildExecuteSummary,
  formatExecuteSummary,
  parseOwlsCliArgs,
  requireExecutePreconditions,
} from '@/lib/providers/owls-insight/cli';
import {
  CC_SEASON_TO_OWLS,
  OWLS_DEFAULT_HISTORY_CONCURRENCY,
  OWLS_ENTITY_GAMES,
  OWLS_ENTITY_PLAYER_PROPS,
  OWLS_PAGE_LIMITS,
  OWLS_PATHS,
} from '@/lib/providers/owls-insight/contract';
import { runOwlsPropBackfill } from '@/lib/providers/owls-insight/backfill';
import { verifyEnvelopeChecksum } from '@/lib/providers/owls-insight/archive';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import { isOwlsAbortError } from '@/lib/providers/owls-insight/errors';
import { normalizeTeamKey } from '@/lib/providers/owls-insight/mapping';
import { asRecord } from '@/lib/providers/owls-insight/normalize';
import { loadCourtContextGames, summarizeUniverse } from '@/lib/providers/owls-insight/universe';
import type {
  CourtContextGame,
  OwlsAcquisitionState,
  OwlsArchiveEnvelope,
} from '@/lib/providers/owls-insight/types';

const SEASON = '2022';
const RUN_ID = 'owls-2026-09-16-season-2022';
const PHASE = 4;
const CHECKPOINT_ROOT = 'data/owls-insight/runs';
const UNIVERSE_PATH = path.join(CHECKPOINT_ROOT, RUN_ID, 'universe.json');
const GAME_TYPES = ['regular', 'playin', 'playoff'] as const;
const PRIOR_SEASON_OBJECTS = { '2023': 1968, '2024': 3467, '2025': 1706 } as const;

type QuoteShape = 'FULL_TWO_WAY' | 'SINGLE_PRICE' | 'PARTIAL' | 'MISSING_PRICE';

function present(v: unknown): boolean {
  return v != null && v !== '';
}

function classifyQuote(row: Record<string, unknown>): QuoteShape {
  const opening = asRecord(row.opening);
  const closing = asRecord(row.closing);
  const openLine = present(opening?.line);
  const openOver = present(opening?.overPrice);
  const openUnder = present(opening?.underPrice);
  const closeLine = present(closing?.line);
  const closeOver = present(closing?.overPrice);
  const closeUnder = present(closing?.underPrice);
  const american =
    present(opening?.americanPrice) || present(closing?.americanPrice) || present(row.americanPrice);
  const twoWayCount = [openLine, openOver, openUnder, closeLine, closeOver, closeUnder].filter(Boolean).length;
  if (twoWayCount === 6) return 'FULL_TWO_WAY';
  if (twoWayCount === 0 && american) return 'SINGLE_PRICE';
  if (twoWayCount === 0 && !american) return 'MISSING_PRICE';
  return 'PARTIAL';
}

function prefixFor(season: string, entity: string): string {
  return `raw/source=owls_insight/league=nba/season=${season}/entity=${entity}/`;
}

async function loadPostgresFinalGames(): Promise<CourtContextGame[]> {
  try {
    const db = await import('@/lib/db');
    const games = await loadCourtContextGames(db.query, [SEASON]);
    await db.default.end().catch(() => undefined);
    return games;
  } catch {
    return [];
  }
}

async function loadCachedUniverse(): Promise<CourtContextGame[] | null> {
  try {
    const text = await readFile(UNIVERSE_PATH, 'utf8');
    const parsed = JSON.parse(text) as CourtContextGame[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveUniverse(games: CourtContextGame[]): Promise<void> {
  await mkdir(path.dirname(UNIVERSE_PATH), { recursive: true });
  await writeFile(UNIVERSE_PATH, `${JSON.stringify(games, null, 2)}\n`, 'utf8');
}

function toCourtContextGame(row: unknown, gameType: (typeof GAME_TYPES)[number]): CourtContextGame | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const eventId = String(rec.eventId ?? rec.event_id ?? rec.id ?? rec.gameId ?? rec.game_id ?? '').trim();
  if (!eventId) return null;
  const homeName = String(rec.homeTeam ?? rec.home_team ?? '').trim();
  const awayName = String(rec.awayTeam ?? rec.away_team ?? '').trim();
  if (!homeName || !awayName) return null;
  const rawStart = String(
    rec.startTime ?? rec.start_time ?? rec.commence_time ?? rec.gameDate ?? rec.game_date ?? ''
  ).trim();
  if (!rawStart) return null;
  const startTime = rawStart.includes('T') ? rawStart : `${rawStart.slice(0, 10)}T00:00:00.000Z`;
  const phase = gameType === 'playin' ? 'play_in' : gameType === 'playoff' ? 'playoff' : 'regular';
  return {
    courtContextGameId: eventId,
    season: SEASON,
    startTime,
    homeTeam: normalizeTeamKey(homeName) ?? homeName,
    awayTeam: normalizeTeamKey(awayName) ?? awayName,
    homeTeamName: homeName,
    awayTeamName: awayName,
    status: 'Final',
    phase,
  };
}

async function loadOwlsSeasonUniverse(client: OwlsInsightClient): Promise<CourtContextGame[]> {
  const byId = new Map<string, CourtContextGame>();
  for (const gameType of GAME_TYPES) {
    const iter = client.paginate({
      path: OWLS_PATHS.historyGames,
      query: { sport: 'nba', season: CC_SEASON_TO_OWLS[SEASON], gameType },
      limit: OWLS_PAGE_LIMITS.historyGames.max,
      startOffset: 0,
      startPageIndex: 1,
    });
    for await (const page of iter) {
      for (const row of extractRows(page.body)) {
        const game = toCourtContextGame(row, gameType);
        if (game) byId.set(game.courtContextGameId, game);
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.courtContextGameId.localeCompare(b.courtContextGameId)
  );
}

async function resolveUniverse(args: {
  postgresGames: CourtContextGame[];
  client: OwlsInsightClient | null;
  allowOwls: boolean;
}): Promise<{ games: CourtContextGame[]; source: string }> {
  if (args.postgresGames.length > 0) {
    return { games: args.postgresGames, source: 'analytics.games status=Final' };
  }
  const cached = await loadCachedUniverse();
  if (cached && cached.length > 0) {
    return { games: cached, source: `cached Owls /history/games (${UNIVERSE_PATH})` };
  }
  if (!args.allowOwls || !args.client) {
    return { games: [], source: 'none (Owls /history/games not called yet)' };
  }
  const games = await loadOwlsSeasonUniverse(args.client);
  await saveUniverse(games);
  return { games, source: 'Owls /history/games season=2022-23 gameType=regular|playin|playoff' };
}

type VerifyResult = {
  season: typeof SEASON;
  eligible_games: number;
  mapped_games: number;
  mapping_failures: number;
  populated_games: number;
  empty_provider_history_games: number;
  request_failed_games: number;
  archive_failed_games: number;
  archive_objects: number;
  games_archive_objects: number;
  rows: number;
  unique_player_names: number;
  books: string[];
  markets: string[];
  full_two_way_rows: number;
  partial_rows: number;
  single_price_rows: number;
  missing_price_rows: number;
  opening_line_rows: number;
  closing_line_rows: number;
  opening_over_rows: number;
  opening_under_rows: number;
  closing_over_rows: number;
  closing_under_rows: number;
  checksum_failures: number;
  checksum_verified: number;
  missing_archive_units: number;
  coverage: number;
  earliest_game_date: string | null;
  latest_game_date: string | null;
  prior_archive_unchanged: Record<string, { expected_objects: number; actual_objects: number; unchanged: boolean }>;
  universe_source: string;
};

async function verifyFromArchive(args: {
  store: OwlsS3Store;
  games: CourtContextGame[];
  universeSource: string;
}): Promise<VerifyResult> {
  const checkpoints = new FileCheckpointStore(CHECKPOINT_ROOT);
  const state = await checkpoints.load(RUN_ID);
  const propKeys = (await args.store.listKeys(prefixFor(SEASON, OWLS_ENTITY_PLAYER_PROPS))).filter((k) =>
    k.endsWith('.json.gz')
  );
  const gameKeys = (await args.store.listKeys(prefixFor(SEASON, OWLS_ENTITY_GAMES))).filter((k) =>
    k.endsWith('.json.gz')
  );

  const books = new Map<string, number>();
  const markets = new Map<string, number>();
  const players = new Set<string>();
  const quotes = { FULL_TWO_WAY: 0, SINGLE_PRICE: 0, PARTIAL: 0, MISSING_PRICE: 0 };
  const quoteFields = {
    openingLine: 0,
    openingOver: 0,
    openingUnder: 0,
    closingLine: 0,
    closingOver: 0,
    closingUnder: 0,
  };
  let rows = 0;
  let checksumFailures = 0;
  let checksumVerified = 0;
  const rowsByProvider = new Map<string, number>();
  const dates: string[] = [];

  for (const key of propKeys) {
    const obj = await args.store.get(key);
    if (!obj) {
      checksumFailures += 1;
      continue;
    }
    const env = JSON.parse(gunzipSync(obj.body).toString('utf8')) as OwlsArchiveEnvelope;
    if (!verifyEnvelopeChecksum(env)) checksumFailures += 1;
    else checksumVerified += 1;
    if (env.game_date) dates.push(env.game_date);
    const providerId = env.provider_game_id ?? key;
    let pageRows = 0;
    for (const raw of extractRows(env.payload)) {
      const rec = asRecord(raw);
      if (!rec) continue;
      pageRows += 1;
      const book = String(rec.book ?? '').trim();
      const market = String(rec.propType ?? rec.prop_type ?? '').trim();
      const player = String(rec.playerName ?? rec.player ?? rec.name ?? '').trim();
      if (book) books.set(book, (books.get(book) ?? 0) + 1);
      if (market) markets.set(market, (markets.get(market) ?? 0) + 1);
      if (player) players.add(player);
      quotes[classifyQuote(rec)] += 1;
      const opening = asRecord(rec.opening);
      const closing = asRecord(rec.closing);
      if (present(opening?.line)) quoteFields.openingLine += 1;
      if (present(opening?.overPrice)) quoteFields.openingOver += 1;
      if (present(opening?.underPrice)) quoteFields.openingUnder += 1;
      if (present(closing?.line)) quoteFields.closingLine += 1;
      if (present(closing?.overPrice)) quoteFields.closingOver += 1;
      if (present(closing?.underPrice)) quoteFields.closingUnder += 1;
    }
    rows += pageRows;
    rowsByProvider.set(providerId, (rowsByProvider.get(providerId) ?? 0) + pageRows);
  }

  const acq = state?.game_acquisition ?? {};
  const countState = (s: OwlsAcquisitionState) =>
    Object.values(acq).filter((row) => row.state === s).length;
  let populated = countState('POPULATED');
  let empty = countState('EMPTY_PROVIDER_HISTORY');
  let mappingFailed = countState('GAME_MAPPING_FAILED');
  const requestFailed = countState('REQUEST_FAILED');
  const archiveFailed = countState('ARCHIVE_FAILED');

  if (Object.keys(acq).length === 0) {
    populated = [...rowsByProvider.values()].filter((n) => n > 0).length;
    empty = [...rowsByProvider.values()].filter((n) => n === 0).length;
    mappingFailed = 0;
  }

  const mapped = args.games.length - mappingFailed;
  const missingArchiveUnits = args.games.filter((g) => {
    const recorded = acq[g.courtContextGameId];
    if (recorded?.state === 'GAME_MAPPING_FAILED') return false;
    const eventId = recorded?.event_id ?? g.courtContextGameId;
    return !propKeys.some((k) => k.includes(`provider_game_id=${eventId}`));
  }).length;

  const prior: VerifyResult['prior_archive_unchanged'] = {};
  for (const season of ['2023', '2024', '2025'] as const) {
    const keys = (await args.store.listKeys(prefixFor(season, OWLS_ENTITY_PLAYER_PROPS))).filter((k) =>
      k.endsWith('.json.gz')
    );
    const expected = PRIOR_SEASON_OBJECTS[season];
    prior[season] = {
      expected_objects: expected,
      actual_objects: keys.length,
      unchanged: keys.length === expected,
    };
  }

  dates.sort();
  const coverage = args.games.length > 0 ? populated / args.games.length : 0;
  return {
    season: SEASON,
    eligible_games: args.games.length,
    mapped_games: mapped,
    mapping_failures: mappingFailed,
    populated_games: populated,
    empty_provider_history_games: empty,
    request_failed_games: requestFailed,
    archive_failed_games: archiveFailed,
    archive_objects: propKeys.length,
    games_archive_objects: gameKeys.length,
    rows,
    unique_player_names: players.size,
    books: [...books.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b),
    markets: [...markets.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
    full_two_way_rows: quotes.FULL_TWO_WAY,
    partial_rows: quotes.PARTIAL,
    single_price_rows: quotes.SINGLE_PRICE,
    missing_price_rows: quotes.MISSING_PRICE,
    opening_line_rows: quoteFields.openingLine,
    closing_line_rows: quoteFields.closingLine,
    opening_over_rows: quoteFields.openingOver,
    opening_under_rows: quoteFields.openingUnder,
    closing_over_rows: quoteFields.closingOver,
    closing_under_rows: quoteFields.closingUnder,
    checksum_failures: checksumFailures,
    checksum_verified: checksumVerified,
    missing_archive_units: missingArchiveUnits,
    coverage,
    earliest_game_date: dates[0] ?? null,
    latest_game_date: dates[dates.length - 1] ?? null,
    prior_archive_unchanged: prior,
    universe_source: args.universeSource,
  };
}

function printVerify(v: VerifyResult): void {
  const pct = (v.coverage * 100).toFixed(1);
  console.log('\n=== 2022–23 archive verification (from S3) ===');
  console.log(`Universe source: ${v.universe_source}`);
  console.log(`Eligible games: ${v.eligible_games}`);
  console.log(`Mapped games: ${v.mapped_games}`);
  console.log(`Mapping failures: ${v.mapping_failures}`);
  console.log(`Populated games: ${v.populated_games}`);
  console.log(`EMPTY_PROVIDER_HISTORY games: ${v.empty_provider_history_games}`);
  console.log(`REQUEST_FAILED: ${v.request_failed_games}`);
  console.log(`ARCHIVE_FAILED: ${v.archive_failed_games}`);
  console.log(`Archive objects (player-props): ${v.archive_objects}`);
  console.log(`Archive objects (games): ${v.games_archive_objects}`);
  console.log(`Rows: ${v.rows}`);
  console.log(`Unique player names: ${v.unique_player_names}`);
  console.log(`Books: ${v.books.join(', ') || '(none)'}`);
  console.log(`Markets: ${v.markets.join(', ') || '(none)'}`);
  console.log(`FULL_TWO_WAY: ${v.full_two_way_rows}`);
  console.log(`PARTIAL: ${v.partial_rows}`);
  console.log(`SINGLE_PRICE: ${v.single_price_rows}`);
  console.log(`MISSING_PRICE: ${v.missing_price_rows}`);
  console.log(`Open line rows: ${v.opening_line_rows}`);
  console.log(`Close line rows: ${v.closing_line_rows}`);
  console.log(`Open over/under rows: ${v.opening_over_rows} / ${v.opening_under_rows}`);
  console.log(`Close over/under rows: ${v.closing_over_rows} / ${v.closing_under_rows}`);
  console.log(`Checksum verified: ${v.checksum_verified}`);
  console.log(`Checksum failures: ${v.checksum_failures}`);
  console.log(`Missing expected archive units: ${v.missing_archive_units}`);
  console.log(`Earliest game date: ${v.earliest_game_date}`);
  console.log(`Latest game date: ${v.latest_game_date}`);
  console.log(`populated_games / eligible_final_games: ${v.populated_games}/${v.eligible_games} = ${pct}%`);
  console.log('Empty HTTP 200 is EMPTY_PROVIDER_HISTORY, not proof that no sportsbook market existed.');
  console.log('\nPrior player-prop archive object counts:');
  for (const [season, row] of Object.entries(v.prior_archive_unchanged)) {
    console.log(
      `  ${season}: expected ${row.expected_objects} actual ${row.actual_objects} ${row.unchanged ? 'UNCHANGED' : 'CHANGED'}`
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const preflightOnly = argv.includes('--preflight-only');
  const verifyOnly = argv.includes('--verify-only');
  const args = parseOwlsCliArgs(argv);
  const runId = RUN_ID;
  const checkpoints = new FileCheckpointStore(CHECKPOINT_ROOT);
  const bucket = process.env.NBA_DATA_BUCKET?.trim() || '';
  const store = bucket ? new OwlsS3Store(bucket) : null;

  const postgresGames = await loadPostgresFinalGames();
  const existingPropKeys = store
    ? (await store.listKeys(prefixFor(SEASON, OWLS_ENTITY_PLAYER_PROPS))).filter((k) => k.endsWith('.json.gz'))
    : [];
  const existingGameKeys = store
    ? (await store.listKeys(prefixFor(SEASON, OWLS_ENTITY_GAMES))).filter((k) => k.endsWith('.json.gz'))
    : [];
  const checkpoint = await checkpoints.load(runId);
  const destination = prefixFor(SEASON, OWLS_ENTITY_PLAYER_PROPS);
  const cachedUniverse = await loadCachedUniverse();

  console.log('=== PREFLIGHT (no credentials printed) ===');
  console.log(`Season: ${SEASON} (Owls ${CC_SEASON_TO_OWLS[SEASON]}, Court Context 2022–23)`);
  console.log(`Eligible 2022–23 Final games in analytics.games: ${postgresGames.length}`);
  console.log(`Existing season=2022 player-prop S3 objects: ${existingPropKeys.length}`);
  console.log(`Existing season=2022 historical_games S3 objects: ${existingGameKeys.length}`);
  console.log(`Cached Owls universe games: ${cachedUniverse?.length ?? 0}`);
  console.log(`Destination S3 prefix: ${destination}`);
  console.log(`Checkpoint run id: ${runId}`);
  console.log(
    `Checkpoint state: ${
      checkpoint
        ? `present attempted=${checkpoint.run.games_attempted} completed=${checkpoint.run.games_completed} rows=${checkpoint.run.rows} failures=${checkpoint.run.failures} completed_at=${checkpoint.run.completed_at ?? 'in-progress'}`
        : 'none'
    }`
  );
  console.log(`Default history concurrency: ${OWLS_DEFAULT_HISTORY_CONCURRENCY}`);
  console.log(`Phase: ${PHASE} (season; not probe stop-conditions)`);

  if (existingPropKeys.length > 0 && !checkpoint) {
    console.error(
      `\nSTOP: ${existingPropKeys.length} season=2022 player-prop objects already exist and there is no checkpoint for ${runId}. Audit them instead of overwriting.`
    );
    process.exit(2);
  }

  if (preflightOnly) {
    const universeN = postgresGames.length || cachedUniverse?.length || 0;
    const expectedUnits = universeN > 0 ? universeN * 2 : 'unknown until Owls /history/games universe load';
    const planned =
      universeN > 0
        ? `${universeN} /history/games lookups + >=${universeN} /history/player-props pages`
        : 'unknown until universe load (CC Final games = 0; execute will list Owls 2022-23 games)';
    console.log(`Expected archive units (min 1 games + 1 props page/game): ${expectedUnits}`);
    console.log(`Planned request count: ${planned}`);
    if (postgresGames.length === 0) {
      console.log(
        'Assumption: analytics.games has no 2022 Final rows, so execute will use Owls /history/games as the 2022–23 universe (regular/playin/playoff only).'
      );
    }
    return;
  }

  if (verifyOnly) {
    if (!store) throw new Error('NBA_DATA_BUCKET is required for --verify-only.');
    const { games, source } = await resolveUniverse({
      postgresGames,
      client: null,
      allowOwls: false,
    });
    const verify = await verifyFromArchive({ store, games, universeSource: source });
    printVerify(verify);
    await mkdir('reports/operations', { recursive: true });
    await writeFile(
      'tmp/owls-2022-verify.json',
      `${JSON.stringify({ ...verify, games_with_props_object: existingPropKeys.length }, null, 2)}\n`
    );
    return;
  }

  if (args.mode !== 'execute') {
    console.log('[dry-run] no Owls requests. Pass --execute --yes to acquire.');
    return;
  }

  const creds = requireExecutePreconditions({ ...args, season: SEASON, phase: PHASE, runId, execute: true });
  const client = new OwlsInsightClient({
    mode: 'execute',
    apiKey: creds.apiKey,
    historyConcurrency: args.historyConcurrency ?? OWLS_DEFAULT_HISTORY_CONCURRENCY,
  });

  const { games, source } = await resolveUniverse({
    postgresGames,
    client,
    allowOwls: true,
  });
  assertRequestedSeasonScope(SEASON, games);
  const liveStore = new OwlsS3Store(creds.bucket);
  const summary = buildExecuteSummary({
    cli: { ...args, season: SEASON, phase: PHASE, runId, execute: true, yes: true },
    games,
    bucket: creds.bucket,
    estimatedHistoryRequests: `${games.length} game lookups + >=${games.length} player-prop pages`,
  });
  const universe = summarizeUniverse(games);
  console.log(`\nUniverse source: ${source}`);
  console.log(`Eligible 2022–23 games after universe resolve: ${games.length}`);
  console.log(`Expected units (min): ${games.length} games archives + ${games.length} player-prop pages`);
  console.log(
    `Planned request count: universe list (already fetched or cached) + ${games.length} /history/games + >=${games.length} /history/player-props`
  );
  for (const [season, u] of Object.entries(universe)) {
    console.log(
      `Universe ${season}: regular=${u.regularFinal} play-in=${u.playInFinal} playoff=${u.playoffFinal} total=${u.totalFinal} earliest=${u.earliestStartTime} latest=${u.latestStartTime}`
    );
  }
  console.log('\n' + formatExecuteSummary(summary));

  try {
    const result = await runOwlsPropBackfill({
      runId,
      phase: PHASE,
      mode: 'execute',
      games,
      client,
      store: liveStore,
      checkpoints,
      resume: args.resume,
      yes: true,
      logger: (msg) => console.log(msg),
      normalize: false,
      stopOnProbeFailure: false,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (isOwlsAbortError(err)) {
      console.error(`ABORT: ${err instanceof Error ? err.message : String(err)}`);
      console.error('Checkpoint preserved for resume.');
      process.exit(3);
    }
    throw err;
  }

  const verify = await verifyFromArchive({
    store: liveStore,
    games,
    universeSource: source,
  });
  printVerify(verify);
  await mkdir('tmp', { recursive: true });
  await writeFile('tmp/owls-2022-verify.json', `${JSON.stringify(verify, null, 2)}\n`, 'utf8');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
