import 'dotenv/config';
import { readOwlsApiKey, OwlsInsightClient, extractRows } from '../../lib/providers/owls-insight/client';
import {
  buildOwlsArchiveKey,
  buildOwlsEnvelope,
  readOwlsEnvelope,
  writeOwlsArchiveObject,
} from '../../lib/providers/owls-insight/archive';
import { OWLS_PATHS } from '../../lib/providers/owls-insight/contract';
import { OwlsS3Store } from '../../lib/providers/owls-insight/s3-store';
import type { OwlsPage } from '../../lib/providers/owls-insight/types';

async function main() {
  const apiKey = readOwlsApiKey();
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!apiKey) throw new Error('OWLS_API_KEY required');
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');

  const client = new OwlsInsightClient({
    mode: 'execute',
    apiKey,
    historyConcurrency: 1,
  });
  const request = { method: 'GET' as const, path: OWLS_PATHS.historyCoverage, query: {} };
  const pageRes = await client.request(request);
  const rows = extractRows(pageRes.body);
  const page: OwlsPage = {
    request,
    url: pageRes.url,
    body: pageRes.body,
    metadata: pageRes.metadata,
    rowCount: rows.length,
    pageIndex: 1,
    offset: 0,
    limit: 1,
    exhausted: true,
  };
  const requestedAt = new Date().toISOString();
  const key = buildOwlsArchiveKey({
    season: 'all',
    entity: 'historical_coverage',
    gameDate: requestedAt.slice(0, 10),
    providerGameId: 'history-coverage',
    pageIndex: 1,
  });
  const envelope = buildOwlsEnvelope({
    page,
    backfillRunId: 'owls-2026-09-14-probe',
    requestedAt,
    providerGameId: null,
    season: null,
    gameDate: requestedAt.slice(0, 10),
    fixture: false,
    schema: 'owls_historical_coverage.v1',
  });
  const store = new OwlsS3Store(bucket);
  const write = await writeOwlsArchiveObject({ store, key, envelope });
  if (!write.ok) throw new Error(write.message);
  await readOwlsEnvelope(store, key);
  const headers = pageRes.metadata.headers;
  console.log(
    JSON.stringify(
      {
        httpStatus: pageRes.metadata.status,
        durationMs: pageRes.metadata.durationMs,
        s3Key: key,
        write: write.result,
        checksum: write.checksum,
        remainingMinute: headers['x-ratelimit-remaining-minute'],
        remainingMonth: headers['x-ratelimit-remaining-month'],
        remainingDay: headers['x-ratelimit-remaining-day'],
        payload: pageRes.body,
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
