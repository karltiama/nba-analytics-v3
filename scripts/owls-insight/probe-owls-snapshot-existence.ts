/**
 * Capped existence probes after the 2022–23 player-prop acquisition.
 *
 * Probe 1: /history/props FanDuel + Pinnacle (points, opening=true) on one control game.
 * Probe 2: /history/odds on the same game. One page only.
 *
 * Never crawls a season. Never launches a backfill.
 *
 *   npx tsx scripts/owls-insight/probe-owls-snapshot-existence.ts --execute --yes
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  buildOwlsArchiveKey,
  buildOwlsEnvelope,
  entityForEndpoint,
  gzipJson,
  writeOwlsArchiveObject,
} from '@/lib/providers/owls-insight/archive';
import { OwlsInsightClient, extractRows } from '@/lib/providers/owls-insight/client';
import { parseOwlsCliArgs, requireExecutePreconditions } from '@/lib/providers/owls-insight/cli';
import {
  OWLS_PAGE_LIMITS,
  OWLS_PATHS,
  OWLS_SNAPSHOT_ARCHIVE_SCHEMA,
} from '@/lib/providers/owls-insight/contract';
import { isOwlsAbortError } from '@/lib/providers/owls-insight/errors';
import { asRecord } from '@/lib/providers/owls-insight/normalize';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import { snapshotArchiveSlug } from '@/lib/providers/owls-insight/snapshot-probe';
import type { OwlsPage, OwlsRequest } from '@/lib/providers/owls-insight/types';

const RUN_ID = 'owls-2026-09-16-snapshot-existence';
const BOOKS = ['fanduel', 'pinnacle'] as const;
const CONTROL = {
  cc: '1037995',
  season: '2023',
  date: '2023-12-25',
  eventId: 'nba:Boston Celtics@Los Angeles Lakers-20231225',
  label: '2023-12-25 LAL vs BOS',
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
    rowCountExtracted: rows.length,
    firstRowKeys: first ? Object.keys(first) : [],
    firstRow: first,
  };
}

function unique(values: unknown[]): string[] {
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].sort();
}

async function archiveOne(args: {
  client: OwlsInsightClient;
  store: OwlsS3Store;
  request: OwlsRequest;
  providerGameId: string;
  entityPageSlug: string;
  pageIndex?: number;
}): Promise<{
  rows: unknown[];
  key: string;
  bytes: number;
  status: number;
  schema: Record<string, unknown>;
  remainingMonth: string | null;
}> {
  const res = await args.client.request(args.request);
  const rows = extractRows(res.body);
  const page: OwlsPage = {
    request: args.request,
    url: res.url,
    body: res.body,
    metadata: res.metadata,
    rowCount: rows.length,
    pageIndex: args.pageIndex ?? 1,
    offset: Number(args.request.query.offset ?? 0),
    limit: Number(args.request.query.limit ?? rows.length),
    exhausted: true,
  };
  const envelope = buildOwlsEnvelope({
    page,
    backfillRunId: RUN_ID,
    requestedAt: new Date().toISOString(),
    providerGameId: args.providerGameId,
    courtContextGameId: CONTROL.cc,
    season: CONTROL.season,
    gameDate: CONTROL.date,
    fixture: false,
    schema:
      args.request.path === OWLS_PATHS.historyOdds
        ? 'owls_historical_odds.v1'
        : OWLS_SNAPSHOT_ARCHIVE_SCHEMA,
  });
  const key = buildOwlsArchiveKey({
    season: CONTROL.season,
    entity: entityForEndpoint(args.request.path),
    gameDate: CONTROL.date,
    providerGameId: args.entityPageSlug,
    pageIndex: 1,
  });
  await writeOwlsArchiveObject({ store: args.store, key, envelope });
  return {
    rows,
    key,
    bytes: gzipJson(envelope).length,
    status: res.metadata.status,
    schema: schemaSketch(res.body),
    remainingMonth: res.metadata.headers['x-ratelimit-remaining-month'] ?? null,
  };
}

async function main() {
  const args = parseOwlsCliArgs(process.argv.slice(2));
  if (args.mode !== 'execute') {
    console.log('[dry-run] no Owls requests. Pass --execute --yes to probe.');
    console.log(`Control game: ${CONTROL.label} eventId=${CONTROL.eventId}`);
    console.log(`Probe 1 books: ${BOOKS.join(', ')} propType=points opening=true`);
    console.log('Probe 2: /history/odds one page, same eventId');
    return;
  }

  const creds = requireExecutePreconditions(args);
  const client = new OwlsInsightClient({
    mode: 'execute',
    apiKey: creds.apiKey,
    historyConcurrency: 1,
  });
  const store = new OwlsS3Store(creds.bucket);

  const propsResults: Array<{
    book: string;
    rows: number;
    key: string;
    status: number;
    schema: Record<string, unknown>;
  }> = [];

  try {
    for (const book of BOOKS) {
      const request: OwlsRequest = {
        method: 'GET',
        path: OWLS_PATHS.historyProps,
        query: {
          eventId: CONTROL.eventId,
          propType: 'points',
          book,
          opening: true,
          limit: OWLS_PAGE_LIMITS.historyProps.default,
          offset: 0,
        },
      };
      const page = await archiveOne({
        client,
        store,
        request,
        providerGameId: CONTROL.eventId,
        entityPageSlug: snapshotArchiveSlug({
          eventId: CONTROL.eventId,
          book,
          propType: 'points',
          opening: true,
        }),
      });
      propsResults.push({
        book,
        rows: page.rows.length,
        key: page.key,
        status: page.status,
        schema: page.schema,
      });
      console.log(`/history/props book=${book} status=${page.status} rows=${page.rows.length} key=${page.key}`);
    }

    const propsRows = propsResults.reduce((n, r) => n + r.rows, 0);
    if (propsRows === 0) {
      console.log('Probe 1: BOTH FanDuel and Pinnacle returned zero rows. Stopping additional props tests.');
    } else {
      console.log(`Probe 1: snapshot rows present (${propsRows}). Not launching a backfill.`);
      for (const r of propsResults) {
        if (r.rows > 0) console.log(JSON.stringify({ book: r.book, schema: r.schema }, null, 2));
      }
    }

    const oddsRequest: OwlsRequest = {
      method: 'GET',
      path: OWLS_PATHS.historyOdds,
      query: {
        eventId: CONTROL.eventId,
        sport: 'nba',
        limit: OWLS_PAGE_LIMITS.historyOdds.default,
        offset: 0,
      },
    };
    const odds = await archiveOne({
      client,
      store,
      request: oddsRequest,
      providerGameId: CONTROL.eventId,
      entityPageSlug: `${CONTROL.eventId.replace(/[^a-zA-Z0-9:@._-]+/g, '_')}__odds-existence`,
    });
    const oddsRows = odds.rows.map((r) => asRecord(r)).filter((r): r is Record<string, unknown> => r != null);
    const books = unique(oddsRows.map((r) => r.book ?? r.sportsbook ?? r.bookmaker));
    const markets = unique(oddsRows.map((r) => r.market ?? r.marketType ?? r.betType ?? r.propType));
    const timestamps = unique(
      oddsRows.map(
        (r) => r.snapshotAt ?? r.snapshot_at ?? r.timestamp ?? r.ts ?? r.createdAt ?? r.updatedAt ?? r.capturedAt
      )
    );
    console.log(
      `/history/odds status=${odds.status} rows=${odds.rows.length} books=${books.join(',') || '(none)'} markets=${markets.join(',') || '(none)'} timestamps=${timestamps.length} key=${odds.key}`
    );
    if (odds.rows.length === 0) {
      console.log('Probe 2: zero rows. Stopping. No additional games.');
    } else {
      console.log('Probe 2: populated. Not launching a season backfill.');
      console.log(JSON.stringify({ schema: odds.schema, books, markets, timestamps }, null, 2));
    }

    const out = {
      run_id: RUN_ID,
      control: CONTROL,
      history_props: {
        games_tested: 1,
        books: BOOKS,
        rows: propsRows,
        by_book: propsResults,
      },
      history_odds: {
        games_tested: 1,
        rows: odds.rows.length,
        books,
        markets,
        timestamps,
        chronological_observations: timestamps.length > 1,
        schema: odds.schema,
        key: odds.key,
      },
    };
    await mkdir('tmp', { recursive: true });
    await writeFile('tmp/owls-snapshot-existence-probe.json', `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    console.log('Wrote tmp/owls-snapshot-existence-probe.json');
  } catch (err) {
    if (isOwlsAbortError(err)) {
      console.error(`ABORT: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(3);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
