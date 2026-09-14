/**
 * Strictly capped /history/public-betting feasibility probe.
 * Never calls /history/props, /history/odds, /history/player-props, or /history/closing-odds.
 *
 *   npx tsx scripts/owls-insight/probe-history-public-betting.ts --execute --yes
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
import {
  OWLS_PATHS,
  OWLS_PUBLIC_BETTING_ARCHIVE_SCHEMA,
  OWLS_PUBLIC_BETTING_PROBE_CAPS,
} from '@/lib/providers/owls-insight/contract';
import { asRecord } from '@/lib/providers/owls-insight/normalize';
import { researchTicketMoney, timestampKeysPresent } from '@/lib/providers/owls-insight/public-betting';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import { classifyGamePhase } from '@/lib/providers/owls-insight/universe';
import type { OwlsPage, OwlsRequest } from '@/lib/providers/owls-insight/types';

const RUN_ID = 'owls-2026-09-14-public-betting-probe';
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
};

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
    timestampKeys: first ? timestampKeysPresent(first) : [],
    researchSample: rows.slice(0, 8).map(researchTicketMoney),
  };
}

function paginationFrom(body: unknown) {
  const rec = asRecord(body);
  const nested = rec?.data && typeof rec.data === 'object' && !Array.isArray(rec.data) ? asRecord(rec.data) : null;
  const pagination = asRecord(nested?.pagination) ?? asRecord(rec?.pagination);
  return {
    total: typeof pagination?.total === 'number' ? pagination.total : typeof nested?.count === 'number' ? nested.count : null,
    hasMore: typeof pagination?.hasMore === 'boolean' ? pagination.hasMore : null,
    limit: typeof pagination?.limit === 'number' ? pagination.limit : typeof nested?.limit === 'number' ? nested.limit : null,
    offset:
      typeof pagination?.offset === 'number' ? pagination.offset : typeof nested?.offset === 'number' ? nested.offset : null,
  };
}

async function loadPreferred(season: string, runId: string, preferredId: string): Promise<Candidate> {
  const store = new FileCheckpointStore('data/owls-insight/runs');
  const state = await store.load(runId);
  if (!state) throw new Error(`missing checkpoint ${runId}`);
  const acq = state.game_acquisition?.[preferredId];
  if (!acq?.event_id) throw new Error(`preferred ${preferredId} has no eventId`);
  const gameDate =
    Object.values(state.units).find((u) => u.court_context_game_id === preferredId)?.game_date ??
    `${acq.event_id.slice(-8, -4)}-${acq.event_id.slice(-4, -2)}-${acq.event_id.slice(-2)}`;
  return {
    cc: preferredId,
    season,
    date: gameDate,
    eventId: acq.event_id,
    phase: classifyGamePhase(season, `${gameDate}T17:00:00.000Z`),
  };
}

async function main() {
  const args = parseOwlsCliArgs(process.argv.slice(2));
  const selected = [
    await loadPreferred('2023', 'owls-2026-09-14-season-2023', PREFERRED['2023']!),
    await loadPreferred('2024', 'owls-2026-09-14-season-2024', PREFERRED['2024']!),
    await loadPreferred('2025', 'owls-2026-09-14-season-2025', PREFERRED['2025']!),
  ];
  console.log(JSON.stringify({ selected, caps: OWLS_PUBLIC_BETTING_PROBE_CAPS }, null, 2));
  if (process.argv.includes('--select-only')) return;
  requireExecutePreconditions(args, process.env);
  const client = new OwlsInsightClient({
    mode: 'execute',
    apiKey: readOwlsApiKey(),
    historyConcurrency: 1,
  });
  const store = new OwlsS3Store(process.env.NBA_DATA_BUCKET?.trim() || '');
  const results = [];
  let requests = 0;
  let rows = 0;
  let compressedBytes = 0;
  for (const game of selected) {
    if (requests >= OWLS_PUBLIC_BETTING_PROBE_CAPS.maxRequests) break;
    const limit = OWLS_PUBLIC_BETTING_PROBE_CAPS.pageLimit;
    const request: OwlsRequest = {
      method: 'GET',
      path: OWLS_PATHS.historyPublicBetting,
      query: { eventId: game.eventId, limit, offset: 0 },
    };
    requests += 1;
    const res = await client.request(request);
    const extracted = extractRows(res.body);
    const page: OwlsPage = {
      request,
      url: res.url,
      body: res.body,
      metadata: res.metadata,
      rowCount: extracted.length,
      pageIndex: 1,
      offset: 0,
      limit,
      exhausted: true,
    };
    const envelope = buildOwlsEnvelope({
      page,
      backfillRunId: RUN_ID,
      requestedAt: new Date().toISOString(),
      providerGameId: game.eventId,
      courtContextGameId: game.cc,
      season: game.season,
      gameDate: game.date,
      fixture: false,
      schema: OWLS_PUBLIC_BETTING_ARCHIVE_SCHEMA,
    });
    const compressed = gzipJson(envelope);
    const key = buildOwlsArchiveKey({
      season: game.season,
      entity: entityForEndpoint('history_public_betting'),
      gameDate: game.date,
      providerGameId: game.eventId.replace(/\s+/g, '_'),
      pageIndex: 1,
    });
    await writeOwlsArchiveObject({ store, key, envelope });
    rows += extracted.length;
    compressedBytes += compressed.length;
    const paging = paginationFrom(res.body);
    if (paging.hasMore === true || (paging.total != null && paging.total > extracted.length)) {
      console.log('STOP: pagination would continue; not fetching further pages in the probe.');
    }
    results.push({
      game,
      status: res.metadata.status,
      durationMs: res.metadata.durationMs,
      remainingMonth: res.metadata.headers['x-ratelimit-remaining-month'] ?? null,
      rows: extracted.length,
      bytes: compressed.length,
      key,
      pagination: paging,
      schema: schemaSketch(res.body),
    });
  }
  const report = {
    runId: RUN_ID,
    budget: { requests, rows, compressedBytes, games: results.length },
    clientMetrics: client.getMetrics(),
    perGame: {
      requests: requests / results.length,
      rows: rows / results.length,
      bytes: compressedBytes / results.length,
    },
    projected3962: {
      requests: (requests / results.length) * 3962,
      rows: (rows / results.length) * 3962,
      bytes: (compressedBytes / results.length) * 3962,
    },
    results,
  };
  await mkdir('tmp/owls-probe', { recursive: true });
  await writeFile('tmp/owls-probe/history-public-betting-probe.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
