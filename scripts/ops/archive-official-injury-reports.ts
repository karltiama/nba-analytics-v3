/**
 * Phase 2 — immutable raw archive of official NBA injury-report PDFs.
 *
 *   npx tsx scripts/ops/archive-official-injury-reports.ts --canary-only
 *   npx tsx scripts/ops/archive-official-injury-reports.ts
 *
 * GET + S3 only. No parser, no Postgres writes, no WOWY/model/BDL changes.
 * Skip-if-checksum-match. Never silent overwrite.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { S3Storage } from '@/lib/aws/s3';
import { normalizeRawPrefix } from '@/lib/providers/owls-insight/archive';

const INVENTORY_NDJSON = path.join(
  process.cwd(),
  'reports',
  'operations',
  'official-injury-report-existence-inventory-complete.records.ndjson'
);
const OUT_DIR = path.join(process.cwd(), 'reports', 'operations');
const MANIFEST_NDJSON = path.join(OUT_DIR, 'official-injury-report-raw-archive.records.ndjson');
const EXPECTED_PDFS = 18271;
const SOURCE = 'nba_official';
const LEAGUE = 'nba';
const ENTITY = 'injury_report_pdf';
const ENVELOPE_VERSION = 'injury_report_pdf_v1';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.132 Safari/537.36';
const TIMEOUT_MS = 30_000;
const CONCURRENCY = 2;
const MIN_GAP_MS = 100;
const MAX_RETRIES = 2;
const STOP_AFTER_429 = 3;
const STOP_AFTER_CONSECUTIVE_NETWORK = 12;
const PDF_MAGIC = Buffer.from('%PDF-');

const CANARY = [
  { report_date: '2025-12-06', requested_token: '11AM' },
  { report_date: '2025-12-06', requested_token: '05PM' },
  { report_date: '2026-03-18', requested_token: '05_30PM' },
] as const;

type FilenameFamily = 'hourly' | 'minute' | 'quarter';
type ArchiveResult =
  | 'ARCHIVED'
  | 'ALREADY_ARCHIVED_CHECKSUM_MATCH'
  | 'HTTP_CHANGED_FROM_200'
  | 'INVALID_PDF_SIGNATURE'
  | 'CHECKSUM_CONFLICT'
  | 'NETWORK_FAILURE'
  | 'RETRY_EXHAUSTED'
  | 'OTHER_FAILURE';

type InventoryRow = {
  report_date: string;
  requested_token: string;
  filename_family: FilenameFamily;
  url: string;
  http_status: number | null;
  exists: boolean;
  content_type: string | null;
  content_length: number | null;
  etag: string | null;
  last_modified: string | null;
};

type ManifestRow = {
  report_date: string;
  requested_token: string;
  filename_family: FilenameFamily;
  season: string;
  source_url: string;
  s3_pdf_key: string;
  s3_metadata_key: string;
  result: ArchiveResult;
  http_status: number | null;
  expected_head_content_length: number | null;
  byte_length: number | null;
  sha256: string | null;
  fetched_at: string | null;
  retry_count: number;
  error: string | null;
  content_type: string | null;
  content_type_discrepancy: boolean;
  metadata_byte_length: number | null;
};

type MetadataEnvelope = {
  envelope_version: string;
  source: typeof SOURCE;
  league: typeof LEAGUE;
  season: string;
  report_date: string;
  requested_token: string;
  filename_family: FilenameFamily;
  source_url: string;
  http_status: number;
  fetched_at: string;
  byte_length: number;
  sha256: string;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  source_inventory: string;
  archive_key: string;
  metadata_key: string;
  report_published_at: null;
  inferred_report_published_at: string | null;
  inference_method: 'legacy_hourly_plus_30_minutes' | 'minute_family_clock_as_written' | null;
};

const ET_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

let lastStart = 0;
let count429 = 0;
let consecutiveNetwork = 0;
let stopReason: string | null = null;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Same July cutoff as Phase 1A inventory (`ccSeasonStartYear`). Do not invent a new algorithm. */
function seasonForReportDate(isoDate: string): string {
  const [yearStr, monthStr] = isoDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const start = month < 7 ? year - 1 : year;
  return String(start);
}

function officialFilename(date: string, token: string): string {
  return `Injury-Report_${date}_${token}.pdf`;
}

export function buildInjuryReportArchiveKeys(args: {
  rawPrefix?: string;
  season: string;
  reportDate: string;
  token: string;
}): { pdfKey: string; metadataKey: string; filename: string } {
  const raw = normalizeRawPrefix(args.rawPrefix);
  const filename = officialFilename(args.reportDate, args.token);
  const dir =
    `${raw}/source=${SOURCE}/league=${LEAGUE}/season=${args.season}` +
    `/entity=${ENTITY}/report_date=${args.reportDate}/report_time=${args.token}`;
  return {
    filename,
    pdfKey: `${dir}/${filename}`,
    metadataKey: `${dir}/${filename.replace(/\.pdf$/i, '.metadata.json')}`,
  };
}

function parseTokenClock(token: string): { hour24: number; minute: number } | null {
  const hourly = token.match(/^(\d{2})(AM|PM)$/);
  const minute = token.match(/^(\d{2})_(\d{2})(AM|PM)$/);
  const m = hourly ?? minute;
  if (!m) return null;
  const h12 = Number(hourly ? m[1] : m[1]);
  const min = hourly ? 0 : Number(m[2]);
  const ap = hourly ? m[2] : m[3];
  if (!Number.isFinite(h12) || !Number.isFinite(min)) return null;
  let hour24 = h12 % 12;
  if (ap === 'PM') hour24 += 12;
  if (ap === 'AM' && h12 === 12) hour24 = 0;
  return { hour24, minute: min };
}

function etParts(ms: number): { date: string; hour: number; minute: number } {
  const map: Record<string, string> = {};
  for (const p of ET_PARTS.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return { date: `${map.year}-${map.month}-${map.day}`, hour: Number(map.hour), minute: Number(map.minute) };
}

function etWallToMs(ymd: string, hour24: number, minute: number): number {
  const [ys, ms, ds] = ymd.split('-').map(Number);
  const wantUtc = Date.UTC(ys!, ms! - 1, ds!, hour24, minute, 0);
  let guess = wantUtc;
  for (let i = 0; i < 8; i += 1) {
    const got = etParts(guess);
    const gotUtc = Date.UTC(
      Number(got.date.slice(0, 4)),
      Number(got.date.slice(5, 7)) - 1,
      Number(got.date.slice(8, 10)),
      got.hour,
      got.minute,
      0
    );
    const delta = wantUtc - gotUtc;
    if (delta === 0) return guess;
    guess += delta;
  }
  throw new Error(`ET wall unresolved ${ymd} ${pad2(hour24)}:${pad2(minute)}`);
}

function inferredPublishedAt(date: string, token: string): {
  iso: string;
  method: 'legacy_hourly_plus_30_minutes' | 'minute_family_clock_as_written';
} | null {
  const clock = parseTokenClock(token);
  if (!clock) return null;
  if (!token.includes('_')) {
    const ms = etWallToMs(date, clock.hour24, clock.minute) + 30 * 60_000;
    return { iso: new Date(ms).toISOString(), method: 'legacy_hourly_plus_30_minutes' };
  }
  const ms = etWallToMs(date, clock.hour24, clock.minute);
  return { iso: new Date(ms).toISOString(), method: 'minute_family_clock_as_written' };
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function looksLikePdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).equals(PDF_MAGIC);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function throttle(): Promise<void> {
  const wait = MIN_GAP_MS - (Date.now() - lastStart);
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length && !stopReason) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out.filter((row) => row != null);
}

async function getPdf(url: string): Promise<{
  status: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  body: Buffer | null;
  error: string | null;
  retries: number;
}> {
  let retries = 0;
  let last: {
    status: number | null;
    contentType: string | null;
    etag: string | null;
    lastModified: string | null;
    body: Buffer | null;
    error: string | null;
  } = { status: null, contentType: null, etag: null, lastModified: null, body: null, error: 'unset' };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      retries += 1;
      await sleep(500 * 2 ** (attempt - 1));
    }
    await throttle();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf,*/*' },
      });
      const buf = Buffer.from(await res.arrayBuffer());
      last = {
        status: res.status,
        contentType: res.headers.get('content-type'),
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        body: buf,
        error: null,
      };
      if (res.status === 429) {
        count429 += 1;
        if (count429 >= STOP_AFTER_429) stopReason = `systemic_429 after ${count429}`;
        else await sleep(5_000 * count429);
      }
      if (res.status >= 500) {
        consecutiveNetwork += 1;
        if (consecutiveNetwork >= STOP_AFTER_CONSECUTIVE_NETWORK) {
          stopReason = `consecutive_5xx=${consecutiveNetwork}`;
        }
        last.error = `http_${res.status}`;
        continue;
      }
      consecutiveNetwork = 0;
      return { ...last, retries };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const timeout = /abort/i.test(msg);
      last = {
        status: null,
        contentType: null,
        etag: null,
        lastModified: null,
        body: null,
        error: timeout ? 'timeout' : `network:${msg}`,
      };
      consecutiveNetwork += 1;
      if (consecutiveNetwork >= STOP_AFTER_CONSECUTIVE_NETWORK) {
        stopReason = `consecutive_network_failures=${consecutiveNetwork}`;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { ...last, retries };
}

async function loadInventory(): Promise<InventoryRow[]> {
  const rl = createInterface({ input: createReadStream(INVENTORY_NDJSON, 'utf8'), crlfDelay: Infinity });
  const out: InventoryRow[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as InventoryRow;
    if (row.http_status === 200 && row.exists === true) out.push(row);
  }
  out.sort((a, b) => a.report_date.localeCompare(b.report_date) || a.requested_token.localeCompare(b.requested_token));
  return out;
}

function loadManifest(): Map<string, ManifestRow> {
  const map = new Map<string, ManifestRow>();
  if (!existsSync(MANIFEST_NDJSON)) return map;
  const text = readFileSync(MANIFEST_NDJSON, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as ManifestRow;
      const key = `${row.report_date}|${row.requested_token}`;
      const prev = map.get(key);
      const success = row.result === 'ARCHIVED' || row.result === 'ALREADY_ARCHIVED_CHECKSUM_MATCH';
      const prevOk = prev && (prev.result === 'ARCHIVED' || prev.result === 'ALREADY_ARCHIVED_CHECKSUM_MATCH');
      if (!prev || (success && !prevOk) || (!prevOk && !success)) map.set(key, row);
    } catch {
      /* skip */
    }
  }
  return map;
}

function appendManifest(row: ManifestRow): void {
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(MANIFEST_NDJSON, JSON.stringify(row) + '\n', 'utf8');
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 100) / 100;
}

function fmtBytes(n: number | null): string {
  if (n == null) return 'n/a';
  const kib = 1024;
  const mib = kib * 1024;
  const gib = mib * 1024;
  const tib = gib * 1024;
  if (n < kib) return `${n} B`;
  if (n < mib) return `${(n / kib).toFixed(1)} KiB`;
  if (n < gib) return `${(n / mib).toFixed(2)} MiB`;
  if (n < tib) return `${(n / gib).toFixed(3)} GiB`;
  return `${(n / tib).toFixed(3)} TiB`;
}

async function archiveOne(
  store: S3Storage,
  rawPrefix: string,
  row: InventoryRow,
  opts: { readBack: boolean }
): Promise<ManifestRow> {
  const season = seasonForReportDate(row.report_date);
  const keys = buildInjuryReportArchiveKeys({
    rawPrefix,
    season,
    reportDate: row.report_date,
    token: row.requested_token,
  });
  const base: ManifestRow = {
    report_date: row.report_date,
    requested_token: row.requested_token,
    filename_family: row.filename_family,
    season,
    source_url: row.url,
    s3_pdf_key: keys.pdfKey,
    s3_metadata_key: keys.metadataKey,
    result: 'OTHER_FAILURE',
    http_status: null,
    expected_head_content_length: row.content_length,
    byte_length: null,
    sha256: null,
    fetched_at: null,
    retry_count: 0,
    error: null,
    content_type: null,
    content_type_discrepancy: false,
    metadata_byte_length: null,
  };

  const existingMeta = await store.getJson<MetadataEnvelope>(keys.metadataKey);
  const pdfExists = await store.objectExists(keys.pdfKey);
  if (existingMeta?.sha256 && pdfExists && !opts.readBack) {
    return {
      ...base,
      result: 'ALREADY_ARCHIVED_CHECKSUM_MATCH',
      http_status: existingMeta.http_status,
      byte_length: existingMeta.byte_length,
      sha256: existingMeta.sha256,
      fetched_at: existingMeta.fetched_at,
      content_type: existingMeta.content_type,
      metadata_byte_length: Buffer.byteLength(JSON.stringify(existingMeta, null, 2) + '\n'),
    };
  }

  const got = await getPdf(row.url);
  base.retry_count = got.retries;
  base.http_status = got.status;
  base.content_type = got.contentType;
  base.fetched_at = new Date().toISOString();
  if (got.error && !got.body) {
    base.result = got.error === 'timeout' || got.error.startsWith('network:') ? 'NETWORK_FAILURE' : 'RETRY_EXHAUSTED';
    base.error = got.error;
    return base;
  }
  if (got.status !== 200 || !got.body) {
    base.result = 'HTTP_CHANGED_FROM_200';
    base.error = `GET ${got.status}`;
    return base;
  }
  if (!looksLikePdf(got.body)) {
    base.result = 'INVALID_PDF_SIGNATURE';
    base.byte_length = got.body.length;
    base.error = 'body does not start with %PDF-';
    return base;
  }
  const digest = sha256(got.body);
  const ct = (got.contentType ?? '').toLowerCase();
  const ctOk = !ct || ct.includes('pdf') || ct.includes('octet-stream');
  base.content_type_discrepancy = !ctOk;
  base.byte_length = got.body.length;
  base.sha256 = digest;

  if (pdfExists) {
    const prev = await store.getBytes(keys.pdfKey);
    if (!prev) {
      base.result = 'OTHER_FAILURE';
      base.error = 'S3 PDF exists but could not be read';
      return base;
    }
    const prevHash = sha256(Buffer.from(prev));
    if (prevHash !== digest) {
      base.result = 'CHECKSUM_CONFLICT';
      base.error = `existing=${prevHash} new=${digest} existing_bytes=${prev.byteLength} new_bytes=${got.body.length}`;
      stopReason = stopReason ?? `checksum_conflict ${keys.pdfKey}`;
      return base;
    }
    if (!existingMeta) {
      const envelope = buildEnvelope(row, keys, got, digest, season, inferredPublishedAt(row.report_date, row.requested_token));
      await store.putJson(keys.metadataKey, envelope, { overwrite: false });
      base.metadata_byte_length = Buffer.byteLength(JSON.stringify(envelope, null, 2) + '\n');
    } else {
      base.metadata_byte_length = Buffer.byteLength(JSON.stringify(existingMeta, null, 2) + '\n');
    }
    if (opts.readBack) {
      const back = await store.getBytes(keys.pdfKey);
      if (!back || sha256(Buffer.from(back)) !== digest || back.byteLength !== got.body.length) {
        base.result = 'OTHER_FAILURE';
        base.error = 'read-back checksum/length mismatch';
        return base;
      }
    }
    base.result = 'ALREADY_ARCHIVED_CHECKSUM_MATCH';
    return base;
  }

  const put = await store.putBytes(keys.pdfKey, got.body, { contentType: 'application/pdf', overwrite: false });
  if (!put.written && put.reason === 'exists') {
    const prev = await store.getBytes(keys.pdfKey);
    const prevHash = prev ? sha256(Buffer.from(prev)) : null;
    if (prevHash && prevHash !== digest) {
      base.result = 'CHECKSUM_CONFLICT';
      base.error = `lost-race existing=${prevHash} new=${digest}`;
      stopReason = stopReason ?? `checksum_conflict ${keys.pdfKey}`;
      return base;
    }
    const raceEnvelope = buildEnvelope(
      row,
      keys,
      got,
      digest,
      season,
      inferredPublishedAt(row.report_date, row.requested_token)
    );
    await store.putJson(keys.metadataKey, raceEnvelope, { overwrite: false });
    base.metadata_byte_length = Buffer.byteLength(JSON.stringify(raceEnvelope, null, 2) + '\n');
    base.result = 'ALREADY_ARCHIVED_CHECKSUM_MATCH';
  } else {
    const envelope = buildEnvelope(
      row,
      keys,
      got,
      digest,
      season,
      inferredPublishedAt(row.report_date, row.requested_token)
    );
    await store.putJson(keys.metadataKey, envelope, { overwrite: false });
    base.metadata_byte_length = Buffer.byteLength(JSON.stringify(envelope, null, 2) + '\n');
    base.result = 'ARCHIVED';
  }

  if (opts.readBack) {
    const back = await store.getBytes(keys.pdfKey);
    if (!back || sha256(Buffer.from(back)) !== digest || back.byteLength !== got.body.length) {
      base.result = 'OTHER_FAILURE';
      base.error = 'read-back checksum/length mismatch after PUT';
      return base;
    }
    const metaBack = await store.getJson<MetadataEnvelope>(keys.metadataKey);
    if (!metaBack || metaBack.sha256 !== digest) {
      base.result = 'OTHER_FAILURE';
      base.error = 'metadata read-back sha256 mismatch';
      return base;
    }
  }
  return base;
}

function buildEnvelope(
  row: InventoryRow,
  keys: { pdfKey: string; metadataKey: string },
  got: { status: number | null; contentType: string | null; etag: string | null; lastModified: string | null; body: Buffer | null },
  digest: string,
  season: string,
  inference: ReturnType<typeof inferredPublishedAt>
): MetadataEnvelope {
  return {
    envelope_version: ENVELOPE_VERSION,
    source: SOURCE,
    league: LEAGUE,
    season,
    report_date: row.report_date,
    requested_token: row.requested_token,
    filename_family: row.filename_family,
    source_url: row.url,
    http_status: got.status ?? 200,
    fetched_at: new Date().toISOString(),
    byte_length: got.body?.length ?? 0,
    sha256: digest,
    content_type: got.contentType,
    etag: got.etag ?? row.etag,
    last_modified: got.lastModified ?? row.last_modified,
    source_inventory: 'reports/operations/official-injury-report-existence-inventory-complete.records.ndjson',
    archive_key: keys.pdfKey,
    metadata_key: keys.metadataKey,
    report_published_at: null,
    inferred_report_published_at: inference?.iso ?? null,
    inference_method: inference?.method ?? null,
  };
}

function pickVerificationSample(rows: InventoryRow[], done: ManifestRow[]): InventoryRow[] {
  const ok = new Set(
    done
      .filter((r) => r.result === 'ARCHIVED' || r.result === 'ALREADY_ARCHIVED_CHECKSUM_MATCH')
      .map((r) => `${r.report_date}|${r.requested_token}`)
  );
  const pool = rows.filter((r) => ok.has(`${r.report_date}|${r.requested_token}`));
  const byLen = [...pool].sort((a, b) => (a.content_length ?? 0) - (b.content_length ?? 0));
  const pick = (pred: (r: InventoryRow) => boolean): InventoryRow | null => pool.find(pred) ?? null;
  const out: InventoryRow[] = [];
  const add = (r: InventoryRow | null) => {
    if (r && !out.some((x) => x.url === r.url)) out.push(r);
  };
  add(pick((r) => r.report_date.startsWith('2023') && r.filename_family === 'hourly'));
  add(pick((r) => r.report_date.startsWith('2024') && r.filename_family === 'hourly'));
  add(pick((r) => r.report_date >= '2025-12-22' && r.filename_family === 'minute'));
  add(pick((r) => r.filename_family === 'quarter'));
  add(byLen[0] ?? null);
  add(byLen[Math.floor(byLen.length / 2)] ?? null);
  add(byLen[byLen.length - 1] ?? null);
  add(pick((r) => r.report_date === '2023-10-24'));
  add(pick((r) => r.report_date >= '2026-06-01'));
  return out.slice(0, 12);
}

async function verifySample(store: S3Storage, sample: ManifestRow[]): Promise<{ ok: boolean; checked: number; failures: string[] }> {
  const failures: string[] = [];
  let checked = 0;
  for (const row of sample) {
    if (!row.sha256 || !row.byte_length) continue;
    checked += 1;
    const body = await store.getBytes(row.s3_pdf_key);
    if (!body) {
      failures.push(`missing ${row.s3_pdf_key}`);
      continue;
    }
    const hash = sha256(Buffer.from(body));
    if (hash !== row.sha256 || body.byteLength !== row.byte_length) {
      failures.push(`mismatch ${row.s3_pdf_key} hash=${hash} len=${body.byteLength}`);
    }
    const meta = await store.getJson<MetadataEnvelope>(row.s3_metadata_key);
    if (!meta || meta.sha256 !== row.sha256) failures.push(`metadata mismatch ${row.s3_metadata_key}`);
  }
  return { ok: failures.length === 0, checked, failures };
}

function summarize(rows: ManifestRow[], inventory: InventoryRow[]) {
  const success = rows.filter((r) => r.result === 'ARCHIVED' || r.result === 'ALREADY_ARCHIVED_CHECKSUM_MATCH');
  const archived = rows.filter((r) => r.result === 'ARCHIVED');
  const already = rows.filter((r) => r.result === 'ALREADY_ARCHIVED_CHECKSUM_MATCH');
  const failed = rows.filter((r) => r.result !== 'ARCHIVED' && r.result !== 'ALREADY_ARCHIVED_CHECKSUM_MATCH');
  const pdfBytes = success.map((r) => r.byte_length ?? 0).sort((a, b) => a - b);
  const headSum = inventory.reduce((n, r) => n + (r.content_length ?? 0), 0);
  const getSum = pdfBytes.reduce((a, b) => a + b, 0);
  const bySeason: Record<string, { n: number; ok: number }> = {};
  const byFamily: Record<string, { n: number; ok: number }> = {};
  const byDate = new Map<string, { n: number; ok: number }>();
  for (const r of inventory) {
    const season = seasonForReportDate(r.report_date);
    const fam = r.filename_family === 'hourly' ? 'hourly' : 'minute';
    bySeason[season] = bySeason[season] ?? { n: 0, ok: 0 };
    bySeason[season].n += 1;
    byFamily[fam] = byFamily[fam] ?? { n: 0, ok: 0 };
    byFamily[fam].n += 1;
    const d = byDate.get(r.report_date) ?? { n: 0, ok: 0 };
    d.n += 1;
    byDate.set(r.report_date, d);
  }
  const okSet = new Set(success.map((r) => `${r.report_date}|${r.requested_token}`));
  for (const r of inventory) {
    if (!okSet.has(`${r.report_date}|${r.requested_token}`)) continue;
    const season = seasonForReportDate(r.report_date);
    const fam = r.filename_family === 'hourly' ? 'hourly' : 'minute';
    bySeason[season].ok += 1;
    byFamily[fam].ok += 1;
    const d = byDate.get(r.report_date)!;
    d.ok += 1;
  }
  const incompleteDates = [...byDate.entries()]
    .filter(([, v]) => v.ok < v.n)
    .map(([date, v]) => ({ date, expected: v.n, archived: v.ok }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const resultCounts: Record<string, number> = {};
  for (const r of rows) resultCounts[r.result] = (resultCounts[r.result] ?? 0) + 1;
  return {
    expected: inventory.length,
    success: success.length,
    archived: archived.length,
    already: already.length,
    failed: failed.length,
    conflicts: rows.filter((r) => r.result === 'CHECKSUM_CONFLICT').length,
    http_changed: rows.filter((r) => r.result === 'HTTP_CHANGED_FROM_200').length,
    invalid_pdf: rows.filter((r) => r.result === 'INVALID_PDF_SIGNATURE').length,
    result_counts: resultCounts,
    pdf_bytes: getSum,
    head_content_length_sum: headSum,
    head_minus_get: headSum - getSum,
    pdf_size: {
      n: pdfBytes.length,
      min: pdfBytes[0] ?? null,
      median: median(pdfBytes),
      mean: pdfBytes.length ? Math.round(getSum / pdfBytes.length) : null,
      p95: percentile(pdfBytes, 95),
      max: pdfBytes[pdfBytes.length - 1] ?? null,
    },
    by_season: bySeason,
    by_family: byFamily,
    incomplete_dates: incompleteDates,
    metadata_bytes: success.reduce((n, r) => n + (r.metadata_byte_length ?? 0), 0),
  };
}

function writeReports(args: {
  startedAt: string;
  finishedAt: string;
  canary: ManifestRow[];
  canaryOk: boolean;
  canaryReadback: { ok: boolean; checked: number; failures: string[] };
  bulkReadback: { ok: boolean; checked: number; failures: string[] };
  inventory: InventoryRow[];
  rows: ManifestRow[];
  metadataBytesEstimate: number;
  s3Accounting?: { pdf_objects: number; pdf_bytes: number; metadata_objects: number; metadata_bytes: number };
}): void {
  const s = summarize(args.rows, args.inventory);
  const certified =
    args.canaryOk &&
    args.canaryReadback.ok &&
    args.bulkReadback.ok &&
    s.conflicts === 0 &&
    s.success === EXPECTED_PDFS &&
    args.inventory.length === EXPECTED_PDFS &&
    !stopReason;
  const payload = {
    probe: 'official-injury-report-raw-archive',
    phase: '2',
    downloaded_pdf_bodies: true,
    parsed_injury_rows: false,
    postgres_writes: false,
    started_at: args.startedAt,
    finished_at: args.finishedAt,
    expected_pdfs: EXPECTED_PDFS,
    stop_reason: stopReason,
    canary: { ok: args.canaryOk, readback: args.canaryReadback, records: args.canary },
    bulk_readback: args.bulkReadback,
    aggregates: s,
    metadata_bytes: args.s3Accounting?.metadata_bytes ?? args.metadataBytesEstimate,
    s3_accounting: args.s3Accounting ?? null,
    raw_archive_certified: certified ? 'YES' : 'NO',
    as_of_injury_tape_certified: false,
    parser_certified: false,
    recommendation: certified ? 'PROCEED_TO_PARSER_GOLD_FIXTURES' : 'STOP_AND_INVESTIGATE',
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'official-injury-report-raw-archive.json'), JSON.stringify(payload, null, 2) + '\n');
  const lines: string[] = [];
  lines.push('# Official NBA injury-report raw archive (Phase 2)');
  lines.push('');
  lines.push(`Generated: **${args.finishedAt}**`);
  lines.push('Immutable PDF preservation only. No parser. No Postgres writes. Canonical title time is **not** stored.');
  lines.push('');
  lines.push(`**RAW_ARCHIVE_CERTIFIED = ${certified ? 'YES' : 'NO'}**`);
  lines.push('');
  lines.push('AS_OF_INJURY_TAPE_CERTIFIED = NO');
  lines.push('PARSER_CERTIFIED = NO');
  lines.push('');
  lines.push('## 1. Canary');
  lines.push('');
  lines.push(args.canaryOk && args.canaryReadback.ok ? '**Passed.** First write: GET 200, `%PDF-`, checksum, S3 PDF + metadata, full read-back. Bulk re-check of the same three objects: skip-if-checksum-match (no overwrite).' : '**Failed.** Bulk archive did not proceed or finished after a canary issue.');
  lines.push('');
  lines.push('| Date | Token | Result | Bytes | SHA-256 prefix |');
  lines.push('| --- | --- | --- | ---: | --- |');
  for (const c of args.canary) {
    lines.push(`| ${c.report_date} | \`${c.requested_token}\` | ${c.result} | ${c.byte_length ?? ''} | ${c.sha256?.slice(0, 12) ?? ''} |`);
  }
  if (args.canaryReadback.failures.length) {
    for (const f of args.canaryReadback.failures) lines.push(`- Canary read-back: ${f}`);
  }
  lines.push('');
  lines.push('## 2. Population');
  lines.push('');
  lines.push(`Expected: **${EXPECTED_PDFS}**. Inventory 200s loaded: **${args.inventory.length}**.`);
  lines.push(`Successfully preserved (new + already): **${s.success}**.`);
  lines.push(`Newly archived (first write): **${s.archived}**. Checksum-match skip rows in this manifest snapshot: **${s.already}**. Failed: **${s.failed}**. Conflicts: **${s.conflicts}**.`);
  lines.push('The canary PDFs were first written as `ARCHIVED` before bulk; the bulk invocation then re-verified them as checksum matches without overwrite.');
  lines.push('');
  lines.push('| Result | Count |');
  lines.push('| --- | ---: |');
  for (const [k, n] of Object.entries(s.result_counts).sort()) lines.push(`| ${k} | ${n} |`);
  lines.push('');
  lines.push('## 3. HEAD-200 vs GET');
  lines.push('');
  lines.push(`GET no longer 200: **${s.http_changed}**. Invalid PDF signature: **${s.invalid_pdf}**.`);
  lines.push('');
  lines.push('## 4. Checksum conflicts');
  lines.push('');
  lines.push(s.conflicts === 0 ? 'None. No silent overwrites.' : `**${s.conflicts}** conflict(s). First copies were not destroyed.`);
  lines.push('');
  lines.push('## 5–7. Storage');
  lines.push('');
  lines.push('| Metric | Bytes | Display |');
  lines.push('| --- | ---: | --- |');
  const metaBytes = args.s3Accounting?.metadata_bytes ?? args.metadataBytesEstimate;
  const listedPdf = args.s3Accounting?.pdf_bytes ?? s.pdf_bytes;
  lines.push(`| Actual PDF bytes (GET / manifest) | ${s.pdf_bytes} | ${fmtBytes(s.pdf_bytes)} |`);
  lines.push(`| S3 listed PDF bytes | ${args.s3Accounting?.pdf_bytes ?? 'n/a'} | ${fmtBytes(args.s3Accounting?.pdf_bytes ?? null)} |`);
  lines.push(`| HEAD Content-Length sum | ${s.head_content_length_sum} | ${fmtBytes(s.head_content_length_sum)} |`);
  lines.push(`| HEAD − GET | ${s.head_minus_get} | ${fmtBytes(s.head_minus_get)} |`);
  lines.push(`| Metadata bytes | ${metaBytes} | ${fmtBytes(metaBytes)} |`);
  lines.push(`| Total archive (PDF + metadata) | ${listedPdf + metaBytes} | ${fmtBytes(listedPdf + metaBytes)} |`);
  lines.push(
    `| Min / median / mean / p95 / max PDF | ${s.pdf_size.min} / ${s.pdf_size.median} / ${s.pdf_size.mean} / ${s.pdf_size.p95} / ${s.pdf_size.max} | ${fmtBytes(s.pdf_size.min)} / ${fmtBytes(s.pdf_size.median)} / ${fmtBytes(s.pdf_size.mean)} / ${fmtBytes(s.pdf_size.p95)} / ${fmtBytes(s.pdf_size.max)} |`
  );
  lines.push('');
  if (s.head_minus_get === 0) {
    lines.push('HEAD Content-Length and GET byte length matched exactly across the preserved population.');
    lines.push('');
  } else if (Math.abs(s.head_minus_get) > 1024 * 1024) {
    lines.push('HEAD vs GET difference exceeds 1 MiB; see failed rows and any Content-Length mismatches in the manifest.');
    lines.push('');
  }
  lines.push('## 8. Read-back');
  lines.push('');
  lines.push(`Canary read-back: **${args.canaryReadback.ok ? 'pass' : 'fail'}** (${args.canaryReadback.checked} objects).`);
  lines.push(`Bulk sample read-back: **${args.bulkReadback.ok ? 'pass' : 'fail'}** (${args.bulkReadback.checked} objects).`);
  for (const f of args.bulkReadback.failures) lines.push(`- ${f}`);
  lines.push('');
  lines.push('## 9. Incomplete dates');
  lines.push('');
  if (!s.incomplete_dates.length) lines.push('None. Every inventory 200 date is fully archived.');
  else {
    lines.push(`${s.incomplete_dates.length} date(s) incomplete:`);
    for (const d of s.incomplete_dates.slice(0, 40)) {
      lines.push(`- ${d.date}: ${d.archived}/${d.expected}`);
    }
  }
  lines.push('');
  lines.push('## By season / family');
  lines.push('');
  lines.push('| Season | Expected | Archived |');
  lines.push('| --- | ---: | ---: |');
  for (const season of ['2023', '2024', '2025']) {
    const x = s.by_season[season] ?? { n: 0, ok: 0 };
    lines.push(`| ${season} | ${x.n} | ${x.ok} |`);
  }
  lines.push('');
  lines.push('| Family | Expected | Archived |');
  lines.push('| --- | ---: | ---: |');
  for (const fam of ['hourly', 'minute']) {
    const x = s.by_family[fam] ?? { n: 0, ok: 0 };
    lines.push(`| ${fam} | ${x.n} | ${x.ok} |`);
  }
  lines.push('');
  lines.push('## 10. Rate limiting');
  lines.push('');
  lines.push(stopReason ? `**Stopped:** ${stopReason}. 429 count=${count429}.` : `No stop condition. 429 count=${count429}.`);
  lines.push('');
  lines.push('## 11. Parser certification');
  lines.push('');
  lines.push(certified ? 'Raw tape is safe to use for **parser gold fixtures**. Do not treat it as a certified as-of injury tape.' : 'Do not begin parser certification until archive failures/conflicts are resolved.');
  lines.push('');
  lines.push(certified ? '**PROCEED_TO_PARSER_GOLD_FIXTURES** (not started).' : '**STOP_AND_INVESTIGATE**');
  lines.push('');
  lines.push('## Verification');
  lines.push('');
  lines.push('1. Manifest URLs came only from the 18,271-record 200 inventory.');
  lines.push('2. PDF bytes were not recompressed or rewritten.');
  lines.push('3. SHA-256 + metadata envelope for every successful PDF.');
  lines.push('4. `inferred_report_published_at` is labeled; `report_published_at` is null.');
  lines.push('5. No parsed rows, Postgres writes, WOWY/model/BDL/Terraform changes.');
  lines.push('');
  writeFileSync(path.join(OUT_DIR, 'official-injury-report-raw-archive.md'), lines.join('\n') + '\n');
}

function writeCanarySidecar(args: {
  startedAt: string;
  finishedAt: string;
  canary: ManifestRow[];
  canaryOk: boolean;
  canaryReadback: { ok: boolean; checked: number; failures: string[] };
}): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    probe: 'official-injury-report-raw-archive-canary',
    phase: '2-canary',
    started_at: args.startedAt,
    finished_at: args.finishedAt,
    ok: args.canaryOk && args.canaryReadback.ok,
    readback: args.canaryReadback,
    records: args.canary,
    stop_reason: stopReason,
  };
  writeFileSync(path.join(OUT_DIR, 'official-injury-report-raw-archive-canary.json'), JSON.stringify(payload, null, 2) + '\n');
  const lines = [
    '# Official NBA injury-report raw-archive canary',
    '',
    `Generated: **${args.finishedAt}**`,
    '',
    args.canaryOk && args.canaryReadback.ok ? '**Canary passed.**' : '**Canary failed. Bulk archive must not proceed.**',
    '',
    '| Date | Token | Result | Bytes | SHA-256 prefix |',
    '| --- | --- | --- | ---: | --- |',
    ...args.canary.map(
      (c) =>
        `| ${c.report_date} | \`${c.requested_token}\` | ${c.result} | ${c.byte_length ?? ''} | ${c.sha256?.slice(0, 12) ?? ''} |`
    ),
    '',
    `Read-back: **${args.canaryReadback.ok ? 'pass' : 'fail'}** (${args.canaryReadback.checked} objects).`,
    ...args.canaryReadback.failures.map((f) => `- ${f}`),
    '',
  ];
  writeFileSync(path.join(OUT_DIR, 'official-injury-report-raw-archive-canary.md'), lines.join('\n') + '\n');
}

async function listArchiveBytes(store: S3Storage, rawPrefix: string) {
  const prefix = `${rawPrefix}/source=${SOURCE}/league=${LEAGUE}/`;
  let pdf_objects = 0;
  let pdf_bytes = 0;
  let metadata_objects = 0;
  let metadata_bytes = 0;
  for await (const obj of store.listByPrefix(prefix)) {
    if (obj.key.endsWith('.pdf')) {
      pdf_objects += 1;
      pdf_bytes += obj.size;
    } else if (obj.key.endsWith('.metadata.json')) {
      metadata_objects += 1;
      metadata_bytes += obj.size;
    }
  }
  return { pdf_objects, pdf_bytes, metadata_objects, metadata_bytes };
}

async function main() {
  const canaryOnly = process.argv.includes('--canary-only');
  const startedAt = new Date().toISOString();
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET is required');
  const rawPrefix = normalizeRawPrefix(process.env.NBA_RAW_PREFIX);
  const store = new S3Storage({ bucket });

  console.error('loading inventory…');
  const inventory = await loadInventory();
  if (inventory.length !== EXPECTED_PDFS) {
    console.error(`warning: inventory 200s=${inventory.length} expected=${EXPECTED_PDFS}`);
  }
  const prior = loadManifest();

  const canaryRows = CANARY.map((c) => {
    const row = inventory.find((r) => r.report_date === c.report_date && r.requested_token === c.requested_token);
    if (!row) throw new Error(`canary missing from inventory: ${c.report_date} ${c.requested_token}`);
    return row;
  });

  console.error('canary archive…');
  const canaryResults: ManifestRow[] = [];
  for (const row of canaryRows) {
    const res = await archiveOne(store, rawPrefix, row, { readBack: true });
    canaryResults.push(res);
    appendManifest(res);
    console.error(`canary ${row.report_date} ${row.requested_token} ${res.result} ${res.sha256?.slice(0, 12)}`);
    if (res.result !== 'ARCHIVED' && res.result !== 'ALREADY_ARCHIVED_CHECKSUM_MATCH') {
      stopReason = stopReason ?? `canary_failed ${row.report_date} ${row.requested_token} ${res.result}`;
    }
  }
  const canaryOk = canaryResults.every((r) => r.result === 'ARCHIVED' || r.result === 'ALREADY_ARCHIVED_CHECKSUM_MATCH') && !stopReason;
  const canaryReadback = await verifySample(store, canaryResults);
  if (!canaryOk || !canaryReadback.ok) {
    writeCanarySidecar({
      startedAt,
      finishedAt: new Date().toISOString(),
      canary: canaryResults,
      canaryOk: false,
      canaryReadback,
    });
    writeReports({
      startedAt,
      finishedAt: new Date().toISOString(),
      canary: canaryResults,
      canaryOk: false,
      canaryReadback,
      bulkReadback: { ok: false, checked: 0, failures: ['canary failed; bulk not run'] },
      inventory,
      rows: canaryResults,
      metadataBytesEstimate: 0,
    });
    console.log(JSON.stringify({ canaryOk: false, canaryReadback, stopReason }, null, 2));
    return;
  }

  writeCanarySidecar({
    startedAt,
    finishedAt: new Date().toISOString(),
    canary: canaryResults,
    canaryOk: true,
    canaryReadback,
  });

  if (canaryOnly) {
    console.log(JSON.stringify({ canaryOk: true, canaryOnly: true, canaryReadback }, null, 2));
    return;
  }

  const doneKey = (r: InventoryRow) => `${r.report_date}|${r.requested_token}`;
  const skip = new Set<string>();
  for (const [k, row] of prior) {
    if (row.result === 'ARCHIVED' || row.result === 'ALREADY_ARCHIVED_CHECKSUM_MATCH') skip.add(k);
  }
  for (const c of canaryResults) skip.add(`${c.report_date}|${c.requested_token}`);

  const queue = inventory.filter((r) => !skip.has(doneKey(r)));
  console.error(`bulk queue ${queue.length} (skip ${skip.size})`);

  let processed = 0;
  await mapPool(queue, CONCURRENCY, async (row) => {
    if (stopReason) return;
    const res = await archiveOne(store, rawPrefix, row, { readBack: false });
    appendManifest(res);
    processed += 1;
    if (processed % 100 === 0) {
      console.error(`bulk ${processed}/${queue.length} last=${row.report_date} ${row.requested_token} ${res.result} 429=${count429}`);
    }
  });

  const allManifest = loadManifest();
  const rows = inventory.map((r) => allManifest.get(doneKey(r))).filter((r): r is ManifestRow => r != null);
  const sampleInv = pickVerificationSample(inventory, rows);
  const sampleManifest = sampleInv
    .map((r) => allManifest.get(doneKey(r)))
    .filter((r): r is ManifestRow => r != null);
  console.error(`bulk sample read-back n=${sampleManifest.length}`);
  const bulkReadback = await verifySample(store, sampleManifest);

  console.error('listing S3 archive prefix for storage accounting…');
  const s3Accounting = await listArchiveBytes(store, rawPrefix);
  const metadataBytesEstimate =
    s3Accounting.metadata_bytes ||
    rows.reduce((n, r) => n + (r.metadata_byte_length ?? 0), 0);

  const finishedAt = new Date().toISOString();
  writeReports({
    startedAt,
    finishedAt,
    canary: canaryResults,
    canaryOk: true,
    canaryReadback,
    bulkReadback,
    inventory,
    rows,
    metadataBytesEstimate,
    s3Accounting,
  });
  const s = summarize(rows, inventory);
  console.log(
    JSON.stringify(
      {
        canaryOk: true,
        expected: EXPECTED_PDFS,
        archived: s.archived,
        already: s.already,
        failed: s.failed,
        conflicts: s.conflicts,
        success: s.success,
        pdf_gib: (s3Accounting.pdf_bytes || s.pdf_bytes) / (1024 * 1024 * 1024),
        metadata_bytes: s3Accounting.metadata_bytes,
        http_changed: s.http_changed,
        bulkReadback,
        stopReason,
        raw_archive_certified:
          s.success === EXPECTED_PDFS &&
          s.conflicts === 0 &&
          bulkReadback.ok &&
          !stopReason &&
          inventory.length === EXPECTED_PDFS,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
