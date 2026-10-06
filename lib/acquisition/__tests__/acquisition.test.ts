import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  APPLICATION_RESPONSE_BODY_BYTES,
  type AcqEnvelopeV1,
  AcqArchiveError,
  InMemoryAcqArchiveStore,
  archiveEnvelope,
  assertArchived,
  buildAcquisitionKey,
  buildEnvelope,
  captureFetch,
  decodeBody,
  deriveDataMetaHints,
  describeRequest,
  encodeEnvelopeObject,
  filterResponseHeaders,
  isAllowlistedHeader,
  ledgerRowFromEnvelope,
  mayProceedAfterArchive,
  queryScopeId,
  readArchivedEnvelope,
  sanitizeScopeId,
  serializeEnvelope,
  sha256Hex,
  type CaptureResult,
  type FetchLike,
} from '@/lib/acquisition';

function clock(...isos: string[]): () => Date {
  let i = 0;
  return () => new Date(isos[Math.min(i++, isos.length - 1)]);
}

const T0 = '2026-10-21T22:01:13.412Z';
const T1 = '2026-10-21T22:01:13.977Z';
const T2 = '2026-10-21T22:01:14.020Z';

function fakeFetch(body: BodyInit | null, init: ResponseInit = {}): FetchLike & { calls: Array<[string, RequestInit?]> } {
  const calls: Array<[string, RequestInit?]> = [];
  const fn = (async (url: string, reqInit?: RequestInit) => {
    calls.push([url, reqInit]);
    return new Response(body, init);
  }) as FetchLike & { calls: Array<[string, RequestInit?]> };
  fn.calls = calls;
  return fn;
}

async function capture(body: BodyInit | null, init: ResponseInit = {}, url = 'https://api.example.test/v2/odds?dates[]=2026-10-21&per_page=100'): Promise<CaptureResult> {
  return captureFetch({ url, fetchImpl: fakeFetch(body, init), now: clock(T0, T1, T2) });
}

function envelopeFrom(cap: CaptureResult, overrides: { request_id?: string; season?: number | null; page_index?: number } = {}): AcqEnvelopeV1 {
  return buildEnvelope({
    collector: { name: 'unit-test', version: 'test-sha' },
    provider: 'balldontlie',
    league: 'nba',
    endpoint_family: 'odds',
    capture: cap,
    page_index: overrides.page_index ?? 0,
    identity: { request_id: overrides.request_id ?? '6f1c0d2e-0000-4000-8000-000000000001', pull_run_id: '771', attempt: 1 },
    scope: {
      kind: 'date',
      scope_id: '2026-10-21',
      season: overrides.season === undefined ? 2026 : overrides.season,
      date_window_et: ['2026-10-21', '2026-10-21'],
    },
    controller_enqueued_at: '2026-10-21T22:00:00.000Z',
    derived_hints: deriveDataMetaHints(cap.response),
  });
}

const JSON_BODY = '{"data":[{"id":1,"vendor":"kalshi"},{"id":2,"vendor":"draftkings"}],"meta":{"next_cursor":456,"per_page":100}}';

describe('response capture', () => {
  it('captures UTF-8 JSON before any parsing, with three clocks and checksum', async () => {
    const cap = await capture(JSON_BODY, { status: 200, headers: { 'content-type': 'application/json' } });
    expect(cap.transport_error).toBeNull();
    expect(cap.times).toEqual({ request_started_at: T0, response_received_at: T1, body_completed_at: T2 });
    expect(cap.response!.body_semantics).toBe(APPLICATION_RESPONSE_BODY_BYTES);
    expect(cap.response!.body_encoding).toBe('utf8');
    expect(cap.response!.body).toBe(JSON_BODY);
    expect(cap.response!.body_bytes).toBe(Buffer.byteLength(JSON_BODY));
    expect(cap.response!.body_sha256).toBe(sha256Hex(Buffer.from(JSON_BODY, 'utf8')));
  });

  it('keeps multi-byte UTF-8 exactly (including BOM)', async () => {
    const text = '\uFEFF{"name":"Nikola Jokić","note":"Dončić — 🏀"}';
    const cap = await capture(text, { status: 200 });
    expect(cap.response!.body_encoding).toBe('utf8');
    expect(decodeBody(cap.response!).equals(Buffer.from(text, 'utf8'))).toBe(true);
    expect(cap.response!.body_sha256).toBe(sha256Hex(Buffer.from(text, 'utf8')));
  });

  it('falls back to base64 for non-UTF-8 bytes and round-trips exactly', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x41]);
    const cap = await capture(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    expect(cap.response!.body_encoding).toBe('base64');
    expect(decodeBody(cap.response!).equals(Buffer.from(bytes))).toBe(true);
    expect(cap.response!.body_sha256).toBe(sha256Hex(bytes));
  });

  it('captures invalid JSON verbatim and marks the non-authoritative hint', async () => {
    const cap = await capture('{"data": [1, 2,', { status: 200 });
    const env = envelopeFrom(cap);
    expect(env.response!.body).toBe('{"data": [1, 2,');
    expect(env.derived_hints).toEqual({ authoritative: false, json_parse_ok: false });
  });

  it('captures non-2xx responses as evidence', async () => {
    const cap = await capture('{"error":"rate limited"}', { status: 429, headers: { 'retry-after': '13' } });
    const env = envelopeFrom(cap);
    expect(env.response!.http_status).toBe(429);
    expect(env.response!.headers['retry-after']).toBe('13');
    expect(env.response!.body).toBe('{"error":"rate limited"}');
  });

  it('captures empty bodies', async () => {
    const cap = await capture(null, { status: 204 });
    expect(cap.response!.body_bytes).toBe(0);
    expect(cap.response!.body).toBe('');
    expect(cap.response!.body_sha256).toBe(sha256Hex(new Uint8Array()));
    expect(envelopeFrom(cap).derived_hints.json_parse_ok).toBeNull();
  });

  it('records transport errors without a response and without clock fallback', async () => {
    const url = 'https://api.example.test/v1/games?api_key=SECRET123&seasons[]=2026';
    const cap = await captureFetch({
      url,
      fetchImpl: async () => {
        throw new TypeError(`fetch failed for ${url}`);
      },
      now: clock(T0),
    });
    expect(cap.response).toBeNull();
    expect(cap.times).toEqual({ request_started_at: T0, response_received_at: null, body_completed_at: null });
    expect(cap.transport_error!.message).not.toContain('SECRET123');
    expect(JSON.stringify(cap)).not.toContain('SECRET123');
  });

  it('never persists Authorization, API keys, cookies, or URL credentials', async () => {
    const url = 'https://user:pass@api.example.test/v1/games?seasons[]=2026&api_key=SECRET123&access_token=TOK&cursor=5';
    const fetchImpl = fakeFetch('{}', { status: 200, headers: { 'set-cookie': 'sid=abc', 'content-type': 'application/json' } });
    const cap = await captureFetch({
      url,
      init: { headers: { Authorization: 'BDL-KEY-XYZ', Cookie: 'a=b' } },
      fetchImpl,
      now: clock(T0, T1, T2),
    });
    expect(fetchImpl.calls[0][1]?.headers).toBeDefined();
    const env = envelopeFrom(cap);
    const serialized = serializeEnvelope(env);
    for (const secret of ['BDL-KEY-XYZ', 'SECRET123', 'TOK', 'sid=abc', 'user:pass', 'a=b']) {
      expect(serialized).not.toContain(secret);
    }
    expect(env.request.params).toEqual([
      ['seasons[]', '2026'],
      ['cursor', '5'],
    ]);
    expect(env.request.redacted_param_names).toEqual(['api_key', 'access_token']);
    expect(env.request.base_url).toBe('https://api.example.test');
  });
});

describe('header allowlist', () => {
  it('keeps only allowlisted headers, case-insensitively', () => {
    const out = filterResponseHeaders({
      'Content-Type': 'application/json',
      'X-RateLimit-Remaining': '599',
      'RateLimit-Reset': '30',
      'Retry-After': '13',
      Link: '<x>; rel="next"',
      Date: 'Wed, 21 Oct 2026 22:01:13 GMT',
      ETag: '"abc"',
      'Last-Modified': 'x',
      Age: '3',
      'Cache-Control': 'no-cache',
      Expires: '0',
      'Content-Length': '120',
      'Content-Encoding': 'gzip',
      'X-Request-Id': 'r1',
      'CF-Ray': 'ray',
      'CF-Cache-Status': 'MISS',
      Server: 'cloudflare',
      Authorization: 'secret',
      'Set-Cookie': 'sid=1',
      Cookie: 'a=b',
      'X-Api-Key': 'k',
      'X-Powered-By': 'Express',
      Vary: 'Accept',
      'Strict-Transport-Security': 'max-age=1',
    });
    expect(Object.keys(out)).toEqual([
      'age',
      'cache-control',
      'cf-cache-status',
      'cf-ray',
      'content-encoding',
      'content-length',
      'content-type',
      'date',
      'etag',
      'expires',
      'last-modified',
      'link',
      'ratelimit-reset',
      'retry-after',
      'server',
      'x-ratelimit-remaining',
      'x-request-id',
    ]);
  });

  it('rejects sensitive and unlisted names and bare prefixes', () => {
    for (const name of ['authorization', 'AUTHORIZATION', 'set-cookie', 'cookie', 'x-api-key', 'proxy-authorization', 'x-ratelimit-', 'vary', 'x-amz-id-2']) {
      expect(isAllowlistedHeader(name)).toBe(false);
    }
    for (const name of ['X-RATELIMIT-LIMIT', 'ratelimit-policy', 'Retry-After', 'ETAG']) {
      expect(isAllowlistedHeader(name)).toBe(true);
    }
  });

  it('works with a real Headers object from fetch', () => {
    const h = new Headers({ 'x-ratelimit-limit': '600', 'set-cookie': 'sid=1', 'x-custom': 'no' });
    expect(filterResponseHeaders(h)).toEqual({ 'x-ratelimit-limit': '600' });
  });
});

describe('acq_envelope.v1', () => {
  it('has the DATA1 sections, non-authoritative hints, and no provider_updated_at', async () => {
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }));
    expect(Object.keys(env).sort()).toEqual(
      ['collector', 'derived_hints', 'endpoint_family', 'envelope_version', 'identity', 'league', 'provider', 'request', 'response', 'scope', 'times', 'transport_error'].sort()
    );
    expect(env.envelope_version).toBe('acq_envelope.v1');
    expect(env.derived_hints).toEqual({ authoritative: false, json_parse_ok: true, row_count: 2, next_cursor: 456 });
    expect(Object.keys(env.times)).toEqual(['controller_enqueued_at', 'request_started_at', 'response_received_at', 'body_completed_at']);
    expect(serializeEnvelope(env)).not.toContain('provider_updated_at');
  });

  it('keeps controller_enqueued_at null when missing (no fallback to another clock)', async () => {
    const cap = await capture(JSON_BODY, { status: 200 });
    const env = buildEnvelope({
      collector: { name: 'unit-test', version: 'v' },
      provider: 'kalshi',
      league: 'nba',
      endpoint_family: 'markets',
      capture: cap,
      page_index: 0,
      identity: { request_id: 'req-1', pull_run_id: 'run-1', attempt: 1 },
      scope: { kind: 'global', scope_id: 'all', season: null },
    });
    expect(env.times.controller_enqueued_at).toBeNull();
    expect(env.scope.season).toBeNull();
  });

  it('cannot be marked authoritative by caller hints', async () => {
    const cap = await capture(JSON_BODY, { status: 200 });
    const env = buildEnvelope({
      collector: { name: 'unit-test', version: 'v' },
      provider: 'polymarket',
      league: 'nba',
      endpoint_family: 'markets',
      capture: cap,
      page_index: 0,
      identity: { request_id: 'req-1', pull_run_id: 'run-1', attempt: 1 },
      scope: { kind: 'global', scope_id: 'all', season: null },
      derived_hints: { authoritative: true, json_parse_ok: false },
    });
    expect(env.derived_hints.authoritative).toBe(false);
    expect(env.derived_hints.json_parse_ok).toBe(true);
  });

  it('rejects invalid identity, page, season and timestamps', async () => {
    const cap = await capture(JSON_BODY, { status: 200 });
    const base = {
      collector: { name: 'unit-test', version: 'v' },
      provider: 'balldontlie',
      league: 'nba',
      endpoint_family: 'odds',
      capture: cap,
      page_index: 0,
      identity: { request_id: 'req-1', pull_run_id: 'run-1', attempt: 1 },
      scope: { kind: 'global' as const, scope_id: 'all', season: 2026 },
    };
    expect(() => buildEnvelope({ ...base, identity: { ...base.identity, request_id: '../etc' } })).toThrow(/request_id/);
    expect(() => buildEnvelope({ ...base, identity: { ...base.identity, attempt: 0 } })).toThrow(/attempt/);
    expect(() => buildEnvelope({ ...base, page_index: -1 })).toThrow(/page_index/);
    expect(() => buildEnvelope({ ...base, scope: { ...base.scope, season: 26 } })).toThrow(/season/);
    expect(() => buildEnvelope({ ...base, controller_enqueued_at: '2026-10-21 22:00' })).toThrow(/controller_enqueued_at/);
  });
});

describe('S3 key builder', () => {
  it('builds the DATA1 acq_* key deterministically', async () => {
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }), { page_index: 1 });
    const key = buildAcquisitionKey(env);
    expect(key).toBe(
      'raw/source=balldontlie/league=nba/season=2026/entity=acq_odds/obs_date=2026-10-21/scope=date/scope_id=2026-10-21/' +
        'obs=20261021T220113977Z__run=771__req=6f1c0d2e-0000-4000-8000-000000000001__p=0001.json.gz'
    );
    expect(buildAcquisitionKey(env)).toBe(key);
    expect(buildAcquisitionKey(JSON.parse(JSON.stringify(env)))).toBe(key);
  });

  it('different request_id → different object key', async () => {
    const cap = await capture(JSON_BODY, { status: 200 });
    const a = buildAcquisitionKey(envelopeFrom(cap, { request_id: 'req-a' }));
    const b = buildAcquisitionKey(envelopeFrom(cap, { request_id: 'req-b' }));
    expect(a).not.toBe(b);
  });

  it('uses season=unknown when unknown and never guesses', async () => {
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }), { season: null });
    expect(buildAcquisitionKey(env)).toContain('/season=unknown/');
  });

  it('uses att= for transport errors (no observation claimed)', async () => {
    const cap = await captureFetch({
      url: 'https://api.example.test/v2/odds?dates[]=2026-10-21',
      fetchImpl: async () => {
        throw new Error('timeout');
      },
      now: clock(T0),
    });
    const key = buildAcquisitionKey(envelopeFrom(cap));
    expect(key).toContain('/att=20261021T220113412Z__run=771__');
    expect(key).not.toContain('/obs=');
  });

  it('sanitizes scope ids and never embeds query params or secrets', async () => {
    expect(sanitizeScopeId('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizeScopeId('a/b c')).toBe('a_b_c');
    expect(() => sanitizeScopeId('///')).toThrow();
    const cap = await capture(JSON_BODY, { status: 200 }, 'https://api.example.test/v2/odds?dates[]=2026-10-21&api_key=SECRET123');
    const key = buildAcquisitionKey(envelopeFrom(cap));
    expect(key).not.toContain('SECRET123');
    expect(key).not.toContain('dates');
  });

  it('rejects unsafe provider/family tokens and a raw prefix with traversal', async () => {
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }));
    expect(() => buildAcquisitionKey({ ...env, provider: 'ball/dontlie' })).toThrow(/provider/);
    expect(() => buildAcquisitionKey({ ...env, endpoint_family: 'acq_odds' })).toThrow(/acq_/);
    expect(() => buildAcquisitionKey(env, { rawPrefix: 'raw/../x' })).toThrow(/prefix/);
    expect(buildAcquisitionKey(env, { rawPrefix: '/raw/' }).startsWith('raw/source=')).toBe(true);
  });

  it('query scope id is stable, order-independent, and ignores cursor', () => {
    const a = queryScopeId('/v1/games', [['seasons[]', '2026'], ['start_date', '2026-10-01'], ['cursor', '1']]);
    const b = queryScopeId('/v1/games', [['start_date', '2026-10-01'], ['seasons[]', '2026'], ['cursor', '9']]);
    const c = queryScopeId('/v1/games', [['seasons[]', '2026'], ['season_type', 'preseason']]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).not.toBe(c);
  });
});

describe('immutable archive writer', () => {
  it('first archive creates a gzip object with required metadata', async () => {
    const store = new InMemoryAcqArchiveStore();
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }));
    const out = await archiveEnvelope({ store, envelope: env, now: clock('2026-10-21T22:01:14.100Z') });
    expect(out.status).toBe('ARCHIVED');
    if (out.status !== 'ARCHIVED') return;
    expect(out.write).toBe('CREATED');
    expect(out.archived_at).toBe('2026-10-21T22:01:14.100Z');
    const obj = store.objects.get(out.key)!;
    expect(obj.contentEncoding).toBe('gzip');
    expect(obj.contentType).toBe('application/json');
    expect(obj.metadata).toMatchObject({
      'body-sha256': env.response!.body_sha256,
      'request-id': env.identity.request_id,
      'pull-run-id': '771',
      'envelope-version': 'acq_envelope.v1',
      'body-semantics': APPLICATION_RESPONSE_BODY_BYTES,
    });
    expect(mayProceedAfterArchive(out)).toBe(true);
  });

  it('gzip and checksum round-trip back to the exact application body bytes', async () => {
    const store = new InMemoryAcqArchiveStore();
    const env = envelopeFrom(await capture(new Uint8Array([0xff, 0x00, 0x7b]), { status: 200 }));
    const out = await archiveEnvelope({ store, envelope: env });
    assertArchived(out);
    const raw = JSON.parse(gunzipSync(store.objects.get(out.key)!.body).toString('utf8'));
    expect(raw).toEqual(JSON.parse(serializeEnvelope(env)));
    const back = await readArchivedEnvelope(store, out.key);
    expect(decodeBody(back.response!).equals(Buffer.from([0xff, 0x00, 0x7b]))).toBe(true);
    expect(sha256Hex(decodeBody(back.response!))).toBe(env.response!.body_sha256);
  });

  it('same-envelope retry is IDEMPOTENT_SUCCESS and does not overwrite', async () => {
    const store = new InMemoryAcqArchiveStore();
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }));
    const first = await archiveEnvelope({ store, envelope: env });
    const before = Buffer.from(store.objects.get((first as { key: string }).key)!.body);
    const second = await archiveEnvelope({ store, envelope: env });
    expect(second.status).toBe('ARCHIVED');
    expect(second.status === 'ARCHIVED' && second.write).toBe('IDEMPOTENT_SUCCESS');
    expect(store.objects.size).toBe(1);
    expect(store.objects.get((second as { key: string }).key)!.body.equals(before)).toBe(true);
  });

  it('conflicting payload at the same key is IMMUTABILITY_CONFLICT, loud, and not overwritten', async () => {
    const store = new InMemoryAcqArchiveStore();
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }));
    const first = await archiveEnvelope({ store, envelope: env });
    assertArchived(first);
    const original = Buffer.from(store.objects.get(first.key)!.body);

    const tampered = envelopeFrom(await capture('{"data":[]}', { status: 200 }));
    expect(buildAcquisitionKey(tampered)).toBe(first.key);
    const logger = { error: vi.fn() };
    const out = await archiveEnvelope({ store, envelope: tampered, logger });
    expect(out.status).toBe('IMMUTABILITY_CONFLICT');
    if (out.status !== 'IMMUTABILITY_CONFLICT') return;
    expect(out.existing_body_sha256).toBe(env.response!.body_sha256);
    expect(out.expected_body_sha256).toBe(tampered.response!.body_sha256);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(store.objects.get(first.key)!.body.equals(original)).toBe(true);
    expect(mayProceedAfterArchive(out)).toBe(false);
    expect(() => assertArchived(out)).toThrow(AcqArchiveError);
  });

  it('archives non-2xx and invalid-JSON envelopes', async () => {
    const store = new InMemoryAcqArchiveStore();
    const a = await archiveEnvelope({ store, envelope: envelopeFrom(await capture('upstream error', { status: 503 }), { request_id: 'r-503' }) });
    const b = await archiveEnvelope({ store, envelope: envelopeFrom(await capture('{bad', { status: 200 }), { request_id: 'r-bad' }) });
    expect(a.status).toBe('ARCHIVED');
    expect(b.status).toBe('ARCHIVED');
    const back = await readArchivedEnvelope(store, (b as { key: string }).key);
    expect(back.response!.body).toBe('{bad');
    expect(back.derived_hints.json_parse_ok).toBe(false);
  });

  it('archives transport-error envelopes with the no-body sentinel', async () => {
    const store = new InMemoryAcqArchiveStore();
    const cap = await captureFetch({
      url: 'https://api.example.test/v2/odds',
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
      now: clock(T0),
    });
    const env = envelopeFrom(cap);
    const out = await archiveEnvelope({ store, envelope: env });
    assertArchived(out);
    expect(store.objects.get(out.key)!.metadata['body-sha256']).toBe('none');
    expect((await archiveEnvelope({ store, envelope: env })).status).toBe('ARCHIVED');
    const back = await readArchivedEnvelope(store, out.key);
    expect(back.transport_error!.message).toBe('ECONNRESET');
  });

  it('maps store failures to ARCHIVE_FAILED and never proceeds', async () => {
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }));
    const putFails = new InMemoryAcqArchiveStore();
    putFails.putIfAbsent = async () => {
      throw new Error('AccessDenied');
    };
    const a = await archiveEnvelope({ store: putFails, envelope: env });
    expect(a).toMatchObject({ status: 'ARCHIVE_FAILED', reason: 'put_failed' });
    expect(mayProceedAfterArchive(a)).toBe(false);

    const lostObject = new InMemoryAcqArchiveStore();
    lostObject.head = async () => null;
    expect(await archiveEnvelope({ store: lostObject, envelope: env })).toMatchObject({ status: 'ARCHIVE_FAILED', reason: 'readback_missing' });

    const invalid = await archiveEnvelope({ store: new InMemoryAcqArchiveStore(), envelope: { ...env, provider: 'bad provider' } });
    expect(invalid).toMatchObject({ status: 'ARCHIVE_FAILED', reason: 'invalid_envelope', key: null });
  });

  it('readArchivedEnvelope detects tampered stored bodies', async () => {
    const store = new InMemoryAcqArchiveStore();
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }));
    const out = await archiveEnvelope({ store, envelope: env });
    assertArchived(out);
    const stored = store.objects.get(out.key)!;
    stored.body = encodeEnvelopeObject(envelopeFrom(await capture('{}', { status: 200 })));
    await expect(readArchivedEnvelope(store, out.key)).rejects.toThrow(/checksum mismatch/);
  });
});

describe('ledger row mapping', () => {
  it('maps envelope + outcome to raw.acquisition_requests columns', async () => {
    const store = new InMemoryAcqArchiveStore();
    const env = envelopeFrom(await capture(JSON_BODY, { status: 200 }));
    const out = await archiveEnvelope({ store, envelope: env, now: clock('2026-10-21T22:01:14.100Z') });
    const row = ledgerRowFromEnvelope(env, out);
    expect(row).toMatchObject({
      request_id: env.identity.request_id,
      pull_run_id: '771',
      provider: 'balldontlie',
      endpoint_family: 'odds',
      endpoint_path: '/v2/odds',
      scope_kind: 'date',
      scope_id: '2026-10-21',
      season: 2026,
      season_type_requested: null,
      page_index: 0,
      attempt: 1,
      controller_enqueued_at: '2026-10-21T22:00:00.000Z',
      request_started_at: T0,
      response_received_at: T1,
      body_completed_at: T2,
      http_status: 200,
      body_sha256: env.response!.body_sha256,
      body_bytes: Buffer.byteLength(JSON_BODY),
      archive_status: 'archived',
      archived_at: '2026-10-21T22:01:14.100Z',
      parse_ok: null,
      collector_version: 'test-sha',
    });
    expect(row.s3_key).toBe(buildAcquisitionKey(env));
    expect(ledgerRowFromEnvelope(env, null).archive_status).toBe('pending');
  });
});

describe('describeRequest', () => {
  it('preserves param order and repeated keys', () => {
    const r = describeRequest('https://api.example.test/v1/stats?game_ids[]=1&game_ids[]=2&per_page=100');
    expect(r.params).toEqual([
      ['game_ids[]', '1'],
      ['game_ids[]', '2'],
      ['per_page', '100'],
    ]);
  });
});
