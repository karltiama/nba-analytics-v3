/**
 * Strictly capped /history/closing-odds feasibility probe.
 * Never calls /history/props, /history/odds, /history/player-props, or /history/public-betting.
 *
 *   npx tsx scripts/owls-insight/probe-history-closing-odds.ts --select-only
 *   npx tsx scripts/owls-insight/probe-history-closing-odds.ts --execute --yes
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { FileCheckpointStore } from '@/lib/providers/owls-insight/checkpoint';
import {
  buildOwlsArchiveKey,
  buildOwlsEnvelope,
  entityForEndpoint,
  gzipJson,
  writeOwlsArchiveObject,
} from '@/lib/providers/owls-insight/archive';
import { OwlsInsightClient, extractRows, readOwlsApiKey } from '@/lib/providers/owls-insight/client';
import { parseOwlsCliArgs, requireExecutePreconditions } from '@/lib/providers/owls-insight/cli';
import { expandClosingOddsQuotes } from '@/lib/providers/owls-insight/closing-odds';
import {
  OWLS_CLOSING_ODDS_ARCHIVE_SCHEMA,
  OWLS_CLOSING_ODDS_PROBE_CAPS,
  OWLS_PATHS,
} from '@/lib/providers/owls-insight/contract';
import { asRecord } from '@/lib/providers/owls-insight/normalize';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import { classifyGamePhase } from '@/lib/providers/owls-insight/universe';
import type { OwlsPage, OwlsRequest } from '@/lib/providers/owls-insight/types';

const RUN_ID = 'owls-2026-09-14-closing-odds-probe';
const PREFERRED: Record<string, string> = {
  '2023': '1037995',
  '2024': '15907844',
  '2025': '18446819',
};

type Candidate = {
  cc: string;
  season: string;
  date: string;
  eventId: string;
  phase: 'regular' | 'play_in' | 'playoff';
  playerPropsState: string;
};

type ProbeBudget = {
  requests: number;
  rows: number;
  compressedBytes: number;
  games: number;
  stopReason: string | null;
};

function canStartRequest(b: ProbeBudget): boolean {
  return (
    !b.stopReason &&
    b.requests < OWLS_CLOSING_ODDS_PROBE_CAPS.maxRequests &&
    b.rows < OWLS_CLOSING_ODDS_PROBE_CAPS.maxRows &&
    b.compressedBytes < OWLS_CLOSING_ODDS_PROBE_CAPS.maxCompressedBytes
  );
}

function schemaSketch(body: unknown): Record<string, unknown> {
  const rec = asRecord(body);
  const nested = rec?.data && typeof rec.data === 'object' && !Array.isArray(rec.data) ? asRecord(rec.data) : null;
  const rows = extractRows(body);
  const first = asRecord(rows[0]);
  return {
    topKeys: rec ? Object.keys(rec) : [],
    dataIsArray: Array.isArray(rec?.data),
    nestedKeys: nested ? Object.keys(nested) : [],
    pagination: nested?.pagination ?? rec?.pagination ?? rec?.meta ?? null,
    count: nested?.count ?? rec?.count ?? null,
    rowCountExtracted: rows.length,
    firstRowKeys: first ? Object.keys(first) : [],
    firstRow: first,
  };
}

function paginationFrom(body: unknown): { total: number | null; hasMore: boolean | null; limit: number | null; offset: number | null } {
  const rec = asRecord(body);
  const nested = rec?.data && typeof rec.data === 'object' && !Array.isArray(rec.data) ? asRecord(rec.data) : null;
  const pagination = asRecord(nested?.pagination) ?? asRecord(rec?.pagination);
  const total =
    typeof pagination?.total === 'number'
      ? pagination.total
      : typeof nested?.count === 'number'
        ? nested.count
        : typeof rec?.count === 'number'
          ? rec.count
          : null;
  const hasMore = typeof pagination?.hasMore === 'boolean' ? pagination.hasMore : null;
  const limit =
    typeof pagination?.limit === 'number' ? pagination.limit : typeof nested?.limit === 'number' ? nested.limit : null;
  const offset =
    typeof pagination?.offset === 'number'
      ? pagination.offset
      : typeof nested?.offset === 'number'
        ? nested.offset
        : null;
  return { total, hasMore, limit, offset };
}

async function loadSeason(season: string, runId: string): Promise<Candidate[]> {
  const store = new FileCheckpointStore('data/owls-insight/runs');
  const state = await store.load(runId);
  if (!state) throw new Error(`missing checkpoint ${runId}`);
  const out: Candidate[] = [];
  for (const [cc, acq] of Object.entries(state.game_acquisition ?? {})) {
    if (!acq.event_id) continue;
    const date = acq.event_id.slice(-8);
    const gameDate =
      Object.values(state.units).find((u) => u.court_context_game_id === cc)?.game_date ??
      (date && date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : null);
    if (!gameDate) continue;
    const phase = classifyGamePhase(season, `${gameDate}T17:00:00.000Z`);
    out.push({
      cc,
      season,
      date: gameDate,
      eventId: acq.event_id,
      phase,
      playerPropsState: acq.state,
    });
  }
  return out;
}

function pickGame(list: Candidate[], preferredId: string): Candidate {
  const preferred = list.find((c) => c.cc === preferredId && c.phase === 'regular');
  if (preferred) return preferred;
  const populated = list
    .filter((c) => c.phase === 'regular' && c.playerPropsState === 'POPULATED')
    .sort((a, b) => a.date.localeCompare(b.date));
  if (populated[0]) return populated[0];
  const regular = list.filter((c) => c.phase === 'regular').sort((a, b) => a.date.localeCompare(b.date));
  if (!regular[0]) throw new Error(`no matched regular game for preferred ${preferredId}`);
  return regular[0];
}

async function selectGames(): Promise<Candidate[]> {
  const seasons = [
    { season: '2023', runId: 'owls-2026-09-14-season-2023' },
    { season: '2024', runId: 'owls-2026-09-14-season-2024' },
    { season: '2025', runId: 'owls-2026-09-14-season-2025' },
  ];
  const selected: Candidate[] = [];
  for (const { season, runId } of seasons) {
    const list = await loadSeason(season, runId);
    selected.push(pickGame(list, PREFERRED[season]!));
  }
  if (selected.length > OWLS_CLOSING_ODDS_PROBE_CAPS.maxGames) {
    return selected.slice(0, OWLS_CLOSING_ODDS_PROBE_CAPS.maxGames);
  }
  return selected;
}

function researchSummary(rows: unknown[]) {
  const classified = rows.flatMap(expandClosingOddsQuotes);
  const books = new Set<string>();
  const sources = new Set<string>();
  const markets = new Set<string>();
  const sides = new Set<string>();
  let twoWayMl = 0;
  let spreadSides = 0;
  let totalSides = 0;
  let withLine = 0;
  let withPrice = 0;
  let withTs = 0;
  for (const row of classified) {
    if (row.book) books.add(row.book);
    if (row.source) sources.add(row.source);
    markets.add(row.market);
    if (row.side) sides.add(row.side);
    if (row.line != null) withLine += 1;
    if (row.price != null) withPrice += 1;
    if (row.closeTimestamp != null) withTs += 1;
    const side = (row.side ?? '').toLowerCase();
    if (row.market === 'MONEYLINE' && (side === 'home' || side === 'away')) twoWayMl += 1;
    if (row.market === 'SPREAD' && (side === 'home' || side === 'away')) spreadSides += 1;
    if (row.market === 'TOTAL' && (side === 'over' || side === 'under')) totalSides += 1;
  }
  return {
    rows: classified.length,
    books: [...books].sort(),
    sources: [...sources].sort(),
    markets: [...markets].sort(),
    sides: [...sides].sort(),
    withLine,
    withPrice,
    withTimestamp: withTs,
    moneylineHomeOrAwayRows: twoWayMl,
    spreadHomeOrAwayRows: spreadSides,
    totalOverOrUnderRows: totalSides,
    sample: classified.slice(0, 6),
  };
}

async function probeGame(args: {
  client: OwlsInsightClient;
  store: OwlsS3Store;
  budget: ProbeBudget;
  game: Candidate;
}) {
  const pages: Array<Record<string, unknown>> = [];
  const allRows: unknown[] = [];
  let remainingMonth: string | null = null;
  let lastSchema: Record<string, unknown> | null = null;
  let status: number | null = null;
  let durationMs = 0;
  const limit = OWLS_CLOSING_ODDS_PROBE_CAPS.pageLimit;
  for (let pageIndex = 1; pageIndex <= OWLS_CLOSING_ODDS_PROBE_CAPS.maxPagesPerGame; pageIndex += 1) {
    if (!canStartRequest(args.budget)) {
      args.budget.stopReason = args.budget.stopReason ?? 'cap_reached';
      break;
    }
    const offset = (pageIndex - 1) * limit;
    const request: OwlsRequest = {
      method: 'GET',
      path: OWLS_PATHS.historyClosingOdds,
      query: {
        eventId: args.game.eventId,
        limit,
        offset,
      },
    };
    args.budget.requests += 1;
    const res = await args.client.request(request);
    status = res.metadata.status;
    durationMs += res.metadata.durationMs;
    remainingMonth = res.metadata.headers['x-ratelimit-remaining-month'] ?? remainingMonth;
    lastSchema = schemaSketch(res.body);
    const rows = extractRows(res.body);
    const page: OwlsPage = {
      request,
      url: res.url,
      body: res.body,
      metadata: res.metadata,
      rowCount: rows.length,
      pageIndex,
      offset,
      limit,
      exhausted: true,
    };
    const envelope = buildOwlsEnvelope({
      page,
      backfillRunId: RUN_ID,
      requestedAt: new Date().toISOString(),
      providerGameId: args.game.eventId,
      season: args.game.season,
      gameDate: args.game.date,
      fixture: false,
      schema: OWLS_CLOSING_ODDS_ARCHIVE_SCHEMA,
    });
    const compressed = gzipJson(envelope);
    const key = buildOwlsArchiveKey({
      season: args.game.season,
      entity: entityForEndpoint('history_closing_odds'),
      gameDate: args.game.date,
      providerGameId: args.game.eventId.replace(/\s+/g, '_'),
      pageIndex,
    });
    await writeOwlsArchiveObject({ store: args.store, key, envelope });
    args.budget.rows += rows.length;
    args.budget.compressedBytes += compressed.length;
    allRows.push(...rows);
    const paging = paginationFrom(res.body);
    pages.push({
      pageIndex,
      status: res.metadata.status,
      durationMs: res.metadata.durationMs,
      rows: rows.length,
      bytes: compressed.length,
      key,
      pagination: paging,
    });
    const shortPage = rows.length < limit;
    const noMore = paging.hasMore === false;
    const knownDone = paging.total != null && offset + rows.length >= paging.total;
    if (shortPage || noMore || knownDone || rows.length === 0) break;
  }
  args.budget.games += 1;
  return {
    game: args.game,
    status,
    durationMs,
    remainingMonth,
    pages,
    rowCount: allRows.length,
    compressedBytes: pages.reduce((n, p) => n + Number(p.bytes ?? 0), 0),
    schema: lastSchema,
    research: researchSummary(allRows),
  };
}

async function main() {
  const args = parseOwlsCliArgs(process.argv.slice(2));
  const selected = await selectGames();
  console.log(
    JSON.stringify(
      {
        selected: selected.map((g) => ({
          cc: g.cc,
          season: g.season,
          date: g.date,
          eventId: g.eventId,
          phase: g.phase,
          playerPropsState: g.playerPropsState,
        })),
        caps: OWLS_CLOSING_ODDS_PROBE_CAPS,
      },
      null,
      2
    )
  );
  if (process.argv.includes('--select-only')) return;
  requireExecutePreconditions(args, process.env);
  const client = new OwlsInsightClient({
    mode: 'execute',
    apiKey: readOwlsApiKey(),
    historyConcurrency: OWLS_CLOSING_ODDS_PROBE_CAPS.maxConcurrency,
  });
  const store = new OwlsS3Store(process.env.NBA_DATA_BUCKET?.trim() || '');
  const budget: ProbeBudget = { requests: 0, rows: 0, compressedBytes: 0, games: 0, stopReason: null };
  const results = [];
  for (const game of selected) {
    if (!canStartRequest(budget)) break;
    results.push(await probeGame({ client, store, budget, game }));
  }
  const report = {
    runId: RUN_ID,
    caps: OWLS_CLOSING_ODDS_PROBE_CAPS,
    budget,
    clientMetrics: client.getMetrics(),
    results,
  };
  await mkdir('tmp/owls-probe', { recursive: true });
  await writeFile('tmp/owls-probe/history-closing-odds-probe.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
