import 'dotenv/config';
import { OwlsInsightClient, extractRows, readOwlsApiKey } from '../../lib/providers/owls-insight/client';
import {
  buildOwlsArchiveKey,
  buildOwlsEnvelope,
  entityForEndpoint,
  gzipJson,
  writeOwlsArchiveObject,
} from '../../lib/providers/owls-insight/archive';
import { OWLS_PATHS, OWLS_SNAPSHOT_ARCHIVE_SCHEMA } from '../../lib/providers/owls-insight/contract';
import { OwlsS3Store } from '../../lib/providers/owls-insight/s3-store';
import { asRecord } from '../../lib/providers/owls-insight/normalize';
import type { OwlsPage } from '../../lib/providers/owls-insight/types';

async function main() {
  const client = new OwlsInsightClient({
    mode: 'execute',
    apiKey: readOwlsApiKey(),
    historyConcurrency: 1,
  });
  const store = new OwlsS3Store(process.env.NBA_DATA_BUCKET?.trim() || '');
  const request = {
    method: 'GET' as const,
    path: OWLS_PATHS.historyProps,
    query: {
      eventId: 'nba:Boston Celtics@Los Angeles Lakers-20231225',
      propType: 'points',
      book: 'draftkings',
      limit: 1,
      offset: 0,
    },
  };
  const res = await client.request(request);
  const rows = extractRows(res.body);
  const page: OwlsPage = {
    request,
    url: res.url,
    body: res.body,
    metadata: res.metadata,
    rowCount: rows.length,
    pageIndex: 1,
    offset: 0,
    limit: 1,
    exhausted: true,
  };
  const envelope = buildOwlsEnvelope({
    page,
    backfillRunId: 'owls-2026-09-14-props-probe',
    requestedAt: new Date().toISOString(),
    providerGameId: 'nba:Boston Celtics@Los Angeles Lakers-20231225',
    season: '2023',
    gameDate: '2023-12-25',
    fixture: false,
    schema: OWLS_SNAPSHOT_ARCHIVE_SCHEMA,
  });
  const key = buildOwlsArchiveKey({
    season: '2023',
    entity: entityForEndpoint('history_props'),
    gameDate: '2023-12-25',
    providerGameId: 'nba:Boston_Celtics@Los_Angeles_Lakers-20231225__book=draftkings__prop=points__opening=0',
    pageIndex: 1,
  });
  const compressed = gzipJson(envelope);
  await writeOwlsArchiveObject({ store, key, envelope });
  const nested = asRecord(asRecord(res.body)?.data);
  const first = asRecord(rows[0]);
  console.log(
    JSON.stringify(
      {
        status: res.metadata.status,
        remainingMonth: res.metadata.headers['x-ratelimit-remaining-month'] ?? null,
        durationMs: res.metadata.durationMs,
        bytes: compressed.length,
        key,
        rowCount: rows.length,
        count: nested?.count ?? null,
        firstRow: first,
        metrics: client.getMetrics(),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
