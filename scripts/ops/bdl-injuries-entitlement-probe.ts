/**
 * Minimal BallDontLie injuries entitlement probe.
 *
 * Default is dry-run. Authorized execution:
 *
 *   npx tsx scripts/ops/bdl-injuries-entitlement-probe.ts --execute
 *
 * One bounded GET. No pagination, no ingestion, no database writes.
 * Never prints the credential or player-level payload.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { bdlAuthorizationHeader } from '../../lib/balldontlie/credential-fingerprint';

loadEnv({ path: path.join(process.cwd(), '.env') });

const ENDPOINT = 'https://api.balldontlie.io/nba/v1/player_injuries';
const URL = `${ENDPOINT}?per_page=1`;

const RATE_LIMIT_HEADER_NAMES = [
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
];

function dryRun(): void {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        method: 'GET',
        url: URL,
        headers: { Authorization: '<BALLDONTLIE_API_KEY>' },
        expected: {
          entitled: 'HTTP 200 with JSON { data: array, meta?: object }',
          empty_success:
            'HTTP 200 with data=[] — access confirmed; not Available; not full-feed completeness',
          not_entitled: 'HTTP 401 or 403',
          inconclusive: 'HTTP 429, 5xx, or network error',
        },
        note: 'Dry-run only. No provider call.',
      },
      null,
      2
    )
  );
}

function rateLimitHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of RATE_LIMIT_HEADER_NAMES) {
    const value = res.headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

function interpret(args: {
  requestedAt: string;
  status: number;
  ok: boolean;
  dataIsArray: boolean;
  recordCount: number | null;
  hasMetaObject: boolean;
  parseError: string | null;
  rateLimit: Record<string, string>;
}): {
  access: 'confirmed' | 'denied' | 'inconclusive';
  structureMatchesExpected: boolean;
  note: string;
} {
  const structureMatchesExpected =
    args.status === 200 && args.dataIsArray && args.parseError == null;
  if (args.status === 401 || args.status === 403) {
    return {
      access: 'denied',
      structureMatchesExpected: false,
      note: 'Request denied. Do not infer the precise subscription or credential cause from status alone.',
    };
  }
  if (args.status === 429 || args.status >= 500 || args.status === 0) {
    return {
      access: 'inconclusive',
      structureMatchesExpected: false,
      note: 'Transient or rate-limited response. Access is not confirmed or denied.',
    };
  }
  if (structureMatchesExpected) {
    const empty = args.recordCount === 0;
    return {
      access: 'confirmed',
      structureMatchesExpected: true,
      note: empty
        ? 'HTTP 200 empty data array confirms endpoint access. It does not prove full-feed completeness or collector behavior. Empty is not Available.'
        : 'HTTP 200 with an injuries data array confirms endpoint access for this credential. per_page=1 does not prove full-feed completeness or collector behavior.',
    };
  }
  return {
    access: 'inconclusive',
    structureMatchesExpected: false,
    note: args.parseError
      ? `Unexpected body shape: ${args.parseError}`
      : `Unexpected HTTP ${args.status}.`,
  };
}

async function execute(): Promise<void> {
  const key =
    process.env.BALLDONTLIE_API_KEY?.trim() || process.env.BALDONTLIE_API_KEY?.trim();
  if (!key) {
    throw new Error('BALLDONTLIE_API_KEY missing in local .env (value not printed)');
  }
  const requestedAt = new Date().toISOString();
  const res = await fetch(URL, { headers: bdlAuthorizationHeader(key) });
  const raw = await res.text();
  let dataIsArray = false;
  let recordCount: number | null = null;
  let hasMetaObject = false;
  let parseError: string | null = null;
  try {
    const json: unknown = JSON.parse(raw);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      parseError = 'top-level JSON is not an object';
    } else {
      const rec = json as Record<string, unknown>;
      dataIsArray = Array.isArray(rec.data);
      recordCount = dataIsArray ? rec.data.length : null;
      hasMetaObject = rec.meta != null && typeof rec.meta === 'object' && !Array.isArray(rec.meta);
      if (!dataIsArray) parseError = 'missing data array';
    }
  } catch {
    parseError = 'body is not JSON';
  }

  const verdict = interpret({
    requestedAt,
    status: res.status,
    ok: res.ok,
    dataIsArray,
    recordCount,
    hasMetaObject,
    parseError,
    rateLimit: rateLimitHeaders(res),
  });

  console.log(
    JSON.stringify(
      {
        dryRun: false,
        requestedAt,
        method: 'GET',
        url: URL,
        status: res.status,
        ok: res.ok,
        structureMatchesExpected: verdict.structureMatchesExpected,
        dataIsArray,
        recordCount,
        hasMetaObject,
        parseError,
        rateLimit: rateLimitHeaders(res),
        access: verdict.access,
        note: verdict.note,
      },
      null,
      2
    )
  );
}

const executeFlag = process.argv.includes('--execute');
if (executeFlag) {
  execute().catch((err) => {
    const message = err instanceof Error ? err.message : 'probe failed';
    console.error(message);
    process.exit(1);
  });
} else {
  dryRun();
}
