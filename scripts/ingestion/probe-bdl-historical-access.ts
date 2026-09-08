/**
 * Smallest safe probe: one page of 2024 games and one page of 2024 player stats.
 * Never writes Postgres or S3. Does not print the API key.
 */
import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';
import { BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';

type ProbeRow = {
  name: string;
  ok: boolean;
  error?: string;
  pathname?: string;
  query?: string;
  recordCountOnPage?: number;
  hasMore?: boolean;
  next_cursor?: unknown;
  total_count?: unknown;
  per_page?: unknown;
  sampleSeason?: unknown;
  sampleDate?: unknown;
  sampleStatus?: unknown;
  samplePostseason?: unknown;
};

async function probeEndpoint(
  client: BdlArchiveClient,
  name: string,
  path: string,
  season = '2024'
): Promise<ProbeRow> {
  try {
    const it = client.paginate({
      path,
      params: { 'seasons[]': season },
      paginationStyle: 'cursor',
      perPage: 5,
    });
    const first = await it.next();
    if (first.done || !first.value) {
      return { name, ok: false, error: 'empty iterator' };
    }
    const page = first.value;
    const sample = page.body.data[0] as Record<string, unknown> | undefined;
    const game =
      sample?.game && typeof sample.game === 'object'
        ? (sample.game as Record<string, unknown>)
        : null;
    const meta = page.body.meta ?? {};
    const url = new URL(page.url);
    const query = [...url.searchParams.entries()]
      .filter(([k]) => k !== 'cursor')
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return {
      name,
      ok: true,
      pathname: url.pathname,
      query,
      recordCountOnPage: Array.isArray(page.body.data) ? page.body.data.length : 0,
      hasMore: page.hasMore,
      next_cursor: meta.next_cursor ?? null,
      total_count: meta.total_count ?? null,
      per_page: meta.per_page ?? null,
      sampleSeason: sample?.season ?? game?.season ?? null,
      sampleDate: sample?.date ?? game?.date ?? null,
      sampleStatus: sample?.status ?? game?.status ?? null,
      samplePostseason: sample?.postseason ?? game?.postseason ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { name, ok: false, error: msg.slice(0, 400) };
  }
}

async function probeS3() {
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) return { error: 'NBA_DATA_BUCKET missing' };
  const rawPrefix = (process.env.NBA_RAW_PREFIX ?? 'raw').replace(/^\/+|\/+$/g, '') || 'raw';
  const s3 = new S3Storage({ bucket, region: process.env.AWS_REGION?.trim() || 'us-east-1' });
  const prefixes = [
    `${rawPrefix}/source=balldontlie/league=nba/season=2024/entity=games`,
    `${rawPrefix}/source=balldontlie/league=nba/season=2024/entity=player_stats`,
  ];
  const runLogKey = `${rawPrefix}/source=balldontlie/league=nba/season=2024/_run_log.json`;
  const out: Array<Record<string, unknown>> = [];
  for (const p of prefixes) {
    let objects = 0;
    let pages = 0;
    let manifest = false;
    for await (const obj of s3.listByPrefix(`${p}/`)) {
      objects += 1;
      if (/\/page=\d+\.json$/.test(obj.key)) pages += 1;
      if (obj.key.endsWith('_manifest.json')) manifest = true;
    }
    out.push({ prefix: p, objects, pages, manifest });
  }
  out.push({ key: runLogKey, exists: await s3.objectExists(runLogKey) });
  return { bucket, objects: out };
}

async function main() {
  const client = new BdlArchiveClient({
    apiKey: readBdlApiKey(),
    requestDelayMs: 0,
    maxRetries: 1,
    retryBaseDelayMs: 1000,
  });
  const bdl = [
    await probeEndpoint(client, 'games_2024', '/games'),
    await probeEndpoint(client, 'player_stats_2024', '/stats'),
  ];
  // Contrast: does /stats work at all on the current key (2025 completed season)?
  try {
    const it = client.paginate({
      path: '/stats',
      params: { 'seasons[]': '2025' },
      paginationStyle: 'cursor',
      perPage: 1,
    });
    const first = await it.next();
    if (first.done || !first.value) {
      bdl.push({ name: 'player_stats_2025', ok: false, error: 'empty iterator' });
    } else {
      bdl.push({
        name: 'player_stats_2025',
        ok: true,
        pathname: '/v1/stats',
        query: 'seasons[]=2025&per_page=1',
        recordCountOnPage: first.value.body.data.length,
        hasMore: first.value.hasMore,
        sampleSeason:
          (first.value.body.data[0] as { game?: { season?: unknown } } | undefined)?.game?.season ??
          null,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    bdl.push({ name: 'player_stats_2025', ok: false, error: msg.slice(0, 400) });
  }
  const s3 = await probeS3();
  console.log(JSON.stringify({ bdl, s3 }, null, 2));
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : err);
  process.exit(1);
});
