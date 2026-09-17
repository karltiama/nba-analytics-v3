/**
 * Phase 1A — HEAD-only official NBA injury-report URL inventory.
 *
 * Investigation / ops only. Not a production collector.
 *
 *   npx tsx scripts/ops/official-injury-report-head-inventory.ts --control-only
 *   npx tsx scripts/ops/official-injury-report-head-inventory.ts
 *   npx tsx scripts/ops/official-injury-report-head-inventory.ts --quarter-hour-completion
 *
 * HEAD requests only. No PDF body download, no S3, no Postgres.
 * --quarter-hour-completion does not overwrite Phase 1A evidence files.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HOST = 'https://ak-static.cms.nba.com/referee/injury';
const RANGE_START = '2023-10-23';
const RANGE_END = '2026-06-14';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.132 Safari/537.36';
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 2;
const MIN_GAP_MS = 80;
const MAX_RETRIES = 2;
const STOP_AFTER_429 = 3;
const STOP_AFTER_CONSECUTIVE_NETWORK = 12;

const HOURLY_TOKENS = [
  '08AM',
  '09AM',
  '10AM',
  '11AM',
  '12PM',
  '01PM',
  '02PM',
  '03PM',
  '04PM',
  '05PM',
  '06PM',
  '07PM',
  '08PM',
  '09PM',
  '10PM',
  '11PM',
] as const;

const SENTINEL_HOURLY = ['08AM', '11AM', '01PM', '05PM', '08PM'] as const;
const SENTINEL_MINUTE = ['08_30AM', '11_30AM', '01_30PM', '05_30PM', '08_30PM'] as const;
const QUARTER_PROBE_TOKENS = ['05_15PM', '05_45PM'] as const;

const CONTROL_DATES = ['2023-10-24', '2024-10-22', '2025-12-06', '2026-03-18', '2026-06-14'] as const;
const OUT_DIR = path.join(process.cwd(), 'reports', 'operations');
const JSON_PATH = path.join(OUT_DIR, 'official-injury-report-existence-inventory.json');
const MD_PATH = path.join(OUT_DIR, 'official-injury-report-existence-inventory.md');
const NDJSON_PATH = path.join(OUT_DIR, 'official-injury-report-existence-inventory.records.ndjson');
const QH_START = '2025-12-22';
const QH_END = '2026-06-14';
const QH_NDJSON_PATH = path.join(OUT_DIR, 'official-injury-report-quarter-hour-completion.records.ndjson');
const QH_JSON_PATH = path.join(OUT_DIR, 'official-injury-report-quarter-hour-completion.json');
const QH_MD_PATH = path.join(OUT_DIR, 'official-injury-report-quarter-hour-completion.md');
const COMPLETE_NDJSON_PATH = path.join(OUT_DIR, 'official-injury-report-existence-inventory-complete.records.ndjson');
const COMPLETE_JSON_PATH = path.join(OUT_DIR, 'official-injury-report-existence-inventory-complete.json');
const COMPLETE_MD_PATH = path.join(OUT_DIR, 'official-injury-report-existence-inventory-complete.md');

const PRIOR_EXPECTATIONS: Array<{
  date: string;
  token: string;
  expected: string;
  note: string;
}> = [
  { date: '2025-12-06', token: '11AM', expected: '200', note: 'prior probe cache' },
  { date: '2025-12-06', token: '05PM', expected: '200', note: 'prior probe cache' },
  { date: '2026-03-18', token: '05PM', expected: '403', note: 'legacy 05PM in 2026' },
  { date: '2026-03-18', token: '05_30PM', expected: '200', note: 'minute-token family' },
];

type FilenameFamily = 'hourly' | 'minute' | 'quarter';

export type InventoryRecord = {
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
  redirect_location: string | null;
  checked_at: string;
  error: string | null;
};

type StopReason = string | null;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function minuteTokensForHours(fromHour: number, toHourInclusive: number): string[] {
  const out: string[] = [];
  for (let h = fromHour; h <= toHourInclusive; h += 1) {
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    out.push(`${pad2(h12)}_00${ampm}`);
    out.push(`${pad2(h12)}_30${ampm}`);
  }
  return out;
}

const MINUTE_TOKENS = minuteTokensForHours(8, 23);

function quarterHourTokensForHours(fromHour: number, toHourInclusive: number): string[] {
  const out: string[] = [];
  for (let h = fromHour; h <= toHourInclusive; h += 1) {
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    out.push(`${pad2(h12)}_15${ampm}`);
    out.push(`${pad2(h12)}_45${ampm}`);
  }
  return out;
}

const QUARTER_HOUR_TOKENS = quarterHourTokensForHours(8, 23);

function slotOrder(token: string): number {
  const m = token.match(/^(\d{2})(?:_(\d{2}))?(AM|PM)$/);
  if (!m) return 99_999;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (ap === 'AM') {
    if (h === 12) h = 0;
  } else if (h !== 12) h += 12;
  return h * 60 + min;
}

function familyFor(token: string): FilenameFamily {
  if (token.includes('_15') || token.includes('_45')) return 'quarter';
  if (token.includes('_')) return 'minute';
  return 'hourly';
}

function buildUrl(date: string, token: string): string {
  return `${HOST}/Injury-Report_${date}_${token}.pdf`;
}

function eachDateInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur.getTime() <= last.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Court Context start-year: Jan–Jun → previous year (matches lib/season calendarSeasonStartYear). */
function ccSeasonStartYear(isoDate: string): '2023' | '2024' | '2025' | 'other' {
  const [yearStr, monthStr] = isoDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const start = month < 7 ? year - 1 : year;
  if (start === 2023 || start === 2024 || start === 2025) return String(start) as '2023' | '2024' | '2025';
  return 'other';
}

function classifyHttp(status: number | null, error: string | null): string {
  if (error === 'timeout') return 'timeout';
  if (error && error.startsWith('network:')) return 'network';
  if (status == null) return 'unexpected';
  if (status === 200) return '200';
  if (status === 403) return '403';
  if (status === 404) return '404';
  if (status === 405) return '405';
  if (status === 429) return '429';
  if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) return 'redirect';
  if (status >= 500) return '5xx';
  return `http_${status}`;
}

function header(res: Response, name: string): string | null {
  return res.headers.get(name);
}

function parseLength(res: Response): number | null {
  const raw = res.headers.get('content-length');
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isPdf200(status: number | null, contentType: string | null): boolean {
  if (status !== 200) return false;
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.includes('pdf') || ct.includes('octet-stream');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

let lastStart = 0;
let consecutiveNetwork = 0;
let count429 = 0;
let stopReason: StopReason = null;

async function throttle(): Promise<void> {
  const wait = MIN_GAP_MS - (Date.now() - lastStart);
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
}

async function headOnce(url: string): Promise<{
  status: number | null;
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
  lastModified: string | null;
  redirectLocation: string | null;
  error: string | null;
}> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: ac.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf,*/*' },
    });
    return {
      status: res.status,
      contentType: header(res, 'content-type'),
      contentLength: parseLength(res),
      etag: header(res, 'etag'),
      lastModified: header(res, 'last-modified'),
      redirectLocation: header(res, 'location'),
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timeout = /abort/i.test(msg);
    return {
      status: null,
      contentType: null,
      contentLength: null,
      etag: null,
      lastModified: null,
      redirectLocation: null,
      error: timeout ? 'timeout' : `network:${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function headUrl(date: string, token: string): Promise<InventoryRecord> {
  const url = buildUrl(date, token);
  const checkedAt = new Date().toISOString();
  let last = await (async () => {
    await throttle();
    return headOnce(url);
  })();

  const retryable = (row: typeof last) =>
    row.error === 'timeout' ||
    (row.error != null && row.error.startsWith('network:')) ||
    (row.status != null && row.status >= 500);

  for (let attempt = 0; attempt < MAX_RETRIES && retryable(last); attempt += 1) {
    await sleep(500 * 2 ** attempt);
    await throttle();
    last = await headOnce(url);
  }

  if (last.status === 429) {
    count429 += 1;
    const ra = 5_000 * count429;
    if (count429 >= STOP_AFTER_429) {
      stopReason = `systemic_429 after ${count429} HTTP 429 responses`;
    } else {
      await sleep(ra);
    }
  }

  if (last.error) {
    consecutiveNetwork += 1;
    if (consecutiveNetwork >= STOP_AFTER_CONSECUTIVE_NETWORK) {
      stopReason = `consecutive_network_failures=${consecutiveNetwork}`;
    }
  } else {
    consecutiveNetwork = 0;
  }

  return {
    report_date: date,
    requested_token: token,
    filename_family: familyFor(token),
    url,
    http_status: last.status,
    exists: isPdf200(last.status, last.contentType),
    content_type: last.contentType,
    content_length: last.contentLength,
    etag: last.etag,
    last_modified: last.lastModified,
    redirect_location: last.redirectLocation,
    checked_at: checkedAt,
    error: last.error,
  };
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

function controlTokenSet(): string[] {
  return uniqueTokens([...HOURLY_TOKENS, ...MINUTE_TOKENS, ...QUARTER_PROBE_TOKENS]);
}

function loadNdjson(filePath: string): InventoryRecord[] {
  if (!existsSync(filePath)) return [];
  const out: InventoryRecord[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as InventoryRecord;
      const key = `${row.report_date}|${row.requested_token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    } catch {
      // skip malformed checkpoint line
    }
  }
  return out;
}

function loadPriorControlRecords(): InventoryRecord[] | null {
  const fromNdjson = loadNdjson(NDJSON_PATH);
  const controlKeys = new Set<string>();
  for (const date of CONTROL_DATES) {
    for (const token of controlTokenSet()) controlKeys.add(`${date}|${token}`);
  }
  const fromCache = fromNdjson.filter((r) => controlKeys.has(`${r.report_date}|${r.requested_token}`));
  if (fromCache.length === controlKeys.size) return fromCache.sort(sortRec);
  if (!existsSync(JSON_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as { control?: { records?: InventoryRecord[] } };
    const rows = parsed.control?.records ?? [];
    const have = new Set(rows.map((r) => `${r.report_date}|${r.requested_token}`));
    if ([...controlKeys].every((k) => have.has(k))) return rows.slice().sort(sortRec);
  } catch {
    return null;
  }
  return fromCache.length ? fromCache.sort(sortRec) : null;
}

function appendRecords(rows: InventoryRecord[], filePath: string = NDJSON_PATH): void {
  if (!rows.length) return;
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

function uniqueTokens(tokens: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
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

function countBy<T extends string>(rows: InventoryRecord[], pred: (r: InventoryRecord) => T | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = pred(r);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function summarizeRecords(records: InventoryRecord[]) {
  const attempted = records.length;
  const ok = records.filter((r) => r.exists);
  const byClass = countBy(records, (r) => classifyHttp(r.http_status, r.error));
  const lengths = ok
    .map((r) => r.content_length)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const missingLen = ok.length - lengths.length;
  const sum = lengths.reduce((a, b) => a + b, 0);
  const mean = lengths.length ? sum / lengths.length : null;

  const dates = [...new Set(records.map((r) => r.report_date))].sort();
  const byDate = new Map<string, InventoryRecord[]>();
  for (const r of records) {
    const list = byDate.get(r.report_date) ?? [];
    list.push(r);
    byDate.set(r.report_date, list);
  }
  const successPerDate = dates.map((d) => ({
    date: d,
    n: (byDate.get(d) ?? []).filter((r) => r.exists).length,
  }));
  const withReports = successPerDate.filter((d) => d.n > 0);
  const perDateCounts = withReports.map((d) => d.n).sort((a, b) => a - b);

  const tokenStats = new Map<
    string,
    { family: FilenameFamily; n200: number; first: string | null; last: string | null }
  >();
  for (const r of ok) {
    const cur = tokenStats.get(r.requested_token) ?? {
      family: r.filename_family,
      n200: 0,
      first: null,
      last: null,
    };
    cur.n200 += 1;
    if (!cur.first || r.report_date < cur.first) cur.first = r.report_date;
    if (!cur.last || r.report_date > cur.last) cur.last = r.report_date;
    tokenStats.set(r.requested_token, cur);
  }

  const seasons = ['2023', '2024', '2025'] as const;
  const bySeason = Object.fromEntries(
    seasons.map((season) => {
      const seasonDates = dates.filter((d) => ccSeasonStartYear(d) === season);
      const seasonRows = records.filter((r) => ccSeasonStartYear(r.report_date) === season);
      const seasonOk = seasonRows.filter((r) => r.exists);
      const okDates = [...new Set(seasonOk.map((r) => r.report_date))].sort();
      return [
        season,
        {
          dates_scanned: seasonDates.length,
          successful_pdfs: seasonOk.length,
          http_403: seasonRows.filter((r) => r.http_status === 403).length,
          http_404: seasonRows.filter((r) => r.http_status === 404).length,
          other:
            seasonRows.length -
            seasonOk.length -
            seasonRows.filter((r) => r.http_status === 403).length -
            seasonRows.filter((r) => r.http_status === 404).length,
          first_successful_snapshot_date: okDates[0] ?? null,
          last_successful_snapshot_date: okDates[okDates.length - 1] ?? null,
        },
      ];
    })
  );

  const hourlyOk = ok.filter((r) => r.filename_family === 'hourly').sort((a, b) => a.report_date.localeCompare(b.report_date));
  const minuteOk = ok.filter((r) => r.filename_family === 'minute').sort((a, b) => a.report_date.localeCompare(b.report_date));
  const lastHourly = hourlyOk[hourlyOk.length - 1]?.report_date ?? null;
  const firstMinute = minuteOk[0]?.report_date ?? null;
  const overlapDates = [
    ...new Set(
      hourlyOk
        .map((r) => r.report_date)
        .filter((d) => minuteOk.some((m) => m.report_date === d))
    ),
  ].sort();

  const datesWithZero = successPerDate.filter((d) => d.n === 0).length;
  const datesWithOne = successPerDate.filter((d) => d.n === 1).length;
  const datesWithMultiple = successPerDate.filter((d) => d.n > 1).length;
  const inSeasonZero = successPerDate.filter((d) => {
    const month = Number(d.date.slice(5, 7));
    return d.n === 0 && (month >= 10 || month <= 6);
  });
  const nextUtc = (iso: string): string => {
    const dt = new Date(`${iso}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  };
  const inSeasonZeroStreaks: Array<{ start: string; end: string; days: number }> = [];
  let streakStart: string | null = null;
  let streakPrev: string | null = null;
  let streakLen = 0;
  for (const d of inSeasonZero) {
    if (streakStart && streakPrev && d.date === nextUtc(streakPrev)) {
      streakLen += 1;
      streakPrev = d.date;
    } else {
      if (streakStart && streakPrev && streakLen >= 3) {
        inSeasonZeroStreaks.push({ start: streakStart, end: streakPrev, days: streakLen });
      }
      streakStart = d.date;
      streakPrev = d.date;
      streakLen = 1;
    }
  }
  if (streakStart && streakPrev && streakLen >= 3) {
    inSeasonZeroStreaks.push({ start: streakStart, end: streakPrev, days: streakLen });
  }
  inSeasonZeroStreaks.sort((a, b) => b.days - a.days);

  const earliestLatest = withReports.map((d) => {
    const toks = (byDate.get(d.date) ?? []).filter((r) => r.exists).map((r) => r.requested_token);
    const sorted = [...toks].sort((a, b) => slotOrder(a) - slotOrder(b));
    return { date: d.date, earliest: sorted[0] ?? null, latest: sorted[sorted.length - 1] ?? null };
  });
  const latestCounts = countBy(
    earliestLatest.map((x) => ({ requested_token: x.latest ?? '', exists: true }) as InventoryRecord),
    (r) => (r.requested_token ? r.requested_token : null)
  );

  return {
    attempted,
    http: byClass,
    successful_pdfs: ok.length,
    by_season: bySeason,
    by_token: [...tokenStats.entries()]
      .map(([token, v]) => ({
        token,
        filename_family: v.family,
        n200: v.n200,
        first_observed_date: v.first,
        last_observed_date: v.last,
        pct_of_dates_with_any_report: withReports.length
          ? Math.round((v.n200 / withReports.length) * 1000) / 10
          : 0,
      }))
      .sort((a, b) => b.n200 - a.n200),
    by_date: {
      dates_scanned: dates.length,
      dates_with_zero_successful_reports: datesWithZero,
      dates_with_exactly_one: datesWithOne,
      dates_with_multiple: datesWithMultiple,
      max_reports_on_one_date: perDateCounts.length ? perDateCounts[perDateCounts.length - 1] : 0,
      median_reports_per_date_with_at_least_one: median(perDateCounts),
      in_season_oct_jun_zero_success_dates: inSeasonZero.length,
      in_season_zero_streaks_ge_3_days: inSeasonZeroStreaks.slice(0, 12),
    },
    by_time_of_day: {
      earliest_token_counts: countBy(
        earliestLatest.map((x) => ({ requested_token: x.earliest ?? '' }) as InventoryRecord),
        (r) => r.requested_token || null
      ),
      latest_token_counts: latestCounts,
      successful_slot_counts: countBy(ok, (r) => r.requested_token),
    },
    transition: {
      last_successful_hourly_date: lastHourly,
      first_successful_minute_date: firstMinute,
      overlap_dates: overlapDates,
      overlap_count: overlapDates.length,
      note: 'Dates are URL tokens, not PDF-title publication timestamps. PDFs were not downloaded.',
    },
    archive_size: {
      successful_with_content_length: lengths.length,
      successful_missing_content_length: missingLen,
      min_bytes: lengths[0] ?? null,
      median_bytes: median(lengths),
      mean_bytes: mean == null ? null : Math.round(mean),
      p95_bytes: percentile(lengths, 95),
      max_bytes: lengths[lengths.length - 1] ?? null,
      sum_observed_content_length: sum,
      estimated_raw_bytes: sum,
      plus_25_percent_bytes: Math.round(sum * 1.25),
      plus_100_percent_bytes: sum * 2,
    },
  };
}

function fmtBytes(n: number | null): string {
  if (n == null) return 'n/a';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function controlExpectations(records: InventoryRecord[]) {
  return PRIOR_EXPECTATIONS.map((exp) => {
    const row = records.find((r) => r.report_date === exp.date && r.requested_token === exp.token);
    const actual = row ? classifyHttp(row.http_status, row.error) : 'missing';
    return {
      ...exp,
      actual,
      exists: row?.exists ?? false,
      http_status: row?.http_status ?? null,
      content_length: row?.content_length ?? null,
      matched_prior: actual === exp.expected || (exp.expected === '200' && row?.exists === true),
    };
  });
}

function markdownReport(args: {
  startedAt: string;
  finishedAt: string;
  controlOnly: boolean;
  stopReason: StopReason;
  control: ReturnType<typeof controlExpectations>;
  controlRecords: InventoryRecord[];
  inventoryRecords: InventoryRecord[];
  quarterProbe: InventoryRecord[];
  warnings: string[];
  aggregates: ReturnType<typeof summarizeRecords>;
  f1: 'CLOSED' | 'PARTIAL' | 'BLOCKED';
  f2: 'CLOSED' | 'PARTIAL' | 'BLOCKED';
}): string {
  const a = args.aggregates;
  const controlPass = args.control.every((c) => c.matched_prior);
  const http200 = a.http['200'] ?? 0;
  const lines: string[] = [];
  lines.push('# Official NBA injury-report existence inventory (Phase 1A)');
  lines.push('');
  lines.push(`Generated: **${args.finishedAt}**`);
  lines.push(`Window: **${RANGE_START} → ${RANGE_END}** (inclusive).`);
  lines.push('Method: **HEAD only**. No PDF bodies downloaded. No S3. No Postgres.');
  lines.push('');
  lines.push('## Finding status');
  lines.push('');
  lines.push('| Finding | Status | Note |');
  lines.push('| --- | --- | --- |');
  const f1 = args.f1;
  const f2 = args.f2;
  lines.push(
    `| F1 snapshot count | **${f1}** | HTTP 200 PDF paths among probed tokens${args.stopReason ? `; stopped: ${args.stopReason}` : ''}${args.controlOnly ? '; control-only' : ''} |`
  );
  lines.push(`| F2 token / family density | **${f2}** | Tokens that returned at least one 200; :15/:45 mass-expand skipped |`);
  lines.push('| F3 T−60 vs `analytics.games.start_time` | **OPEN** | Not joined in this slice. Phase 1B. |');
  lines.push('');
  lines.push('## 1. Control cases');
  lines.push('');
  if (controlPass) {
    lines.push('Control anchors **matched** prior observations for the explicit 2025-12-06 and 2026-03-18 tokens.');
  } else {
    lines.push('Control anchors **differed** from prior observations. Discrepancies are listed; they were not rewritten.');
  }
  lines.push('');
  lines.push('| Date | Token | Prior expected | Actual | Exists | Bytes | Match |');
  lines.push('| --- | --- | --- | --- | --- | ---: | --- |');
  for (const c of args.control) {
    lines.push(
      `| ${c.date} | \`${c.token}\` | ${c.expected} | ${c.actual} | ${c.exists} | ${c.content_length ?? ''} | ${c.matched_prior ? 'yes' : 'NO'} |`
    );
  }
  lines.push('');
  const controlByDate = CONTROL_DATES.map((d) => {
    const rows = args.controlRecords.filter((r) => r.report_date === d && r.exists);
    return `${d}: ${rows.length} × 200 (${rows.map((r) => r.requested_token).join(', ') || 'none'})`;
  });
  lines.push('Control-date successful tokens:');
  for (const row of controlByDate) lines.push(`- ${row}`);
  lines.push('');
  lines.push('## 2. How many PDF paths returned HTTP 200?');
  lines.push('');
  lines.push(`**${a.successful_pdfs}** URLs classified as existing PDFs (HTTP 200 + PDF/octet-stream Content-Type).`);
  lines.push('');
  lines.push('| Result | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Attempted URLs | ${a.attempted} |`);
  lines.push(`| 200 (exists) | ${a.successful_pdfs} |`);
  lines.push(`| 403 | ${a.http['403'] ?? 0} |`);
  lines.push(`| 404 | ${a.http['404'] ?? 0} |`);
  lines.push(`| 429 | ${a.http['429'] ?? 0} |`);
  lines.push(`| redirect | ${a.http['redirect'] ?? 0} |`);
  lines.push(`| 5xx | ${a.http['5xx'] ?? 0} |`);
  lines.push(`| timeout | ${a.http['timeout'] ?? 0} |`);
  lines.push(`| network | ${a.http['network'] ?? 0} |`);
  const otherHttp = Object.entries(a.http)
    .filter(([k]) => !['200', '403', '404', '429', 'redirect', '5xx', 'timeout', 'network'].includes(k))
    .reduce((n, [, v]) => n + v, 0);
  lines.push(`| other | ${otherHttp} |`);
  lines.push('');
  lines.push('403 means the path was not served to this HEAD request. It is **not** “empty report” or “no injuries that day.”');
  lines.push('');
  lines.push('## 3. Successful PDFs by Court Context season');
  lines.push('');
  lines.push('Season labels use the July cutoff in `lib/season.ts` (`calendarSeasonStartYear`: Jan–Jun → previous start year).');
  lines.push('');
  lines.push('| Season | Dates scanned | 200 PDFs | 403 | 404 | Other | First 200 date | Last 200 date |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const season of ['2023', '2024', '2025'] as const) {
    const s = a.by_season[season];
    lines.push(
      `| ${season} | ${s.dates_scanned} | ${s.successful_pdfs} | ${s.http_403} | ${s.http_404} | ${s.other} | ${s.first_successful_snapshot_date ?? '—'} | ${s.last_successful_snapshot_date ?? '—'} |`
    );
  }
  lines.push('');
  lines.push('## 4. Tokens that returned at least one 200');
  lines.push('');
  lines.push('| Token | Family | n200 | First date | Last date | % of dates that had any report |');
  lines.push('| --- | --- | ---: | --- | --- | ---: |');
  for (const t of a.by_token) {
    lines.push(
      `| \`${t.token}\` | ${t.filename_family} | ${t.n200} | ${t.first_observed_date} | ${t.last_observed_date} | ${t.pct_of_dates_with_any_report} |`
    );
  }
  if (!a.by_token.length) lines.push('| — | — | 0 | — | — | — |');
  lines.push('');
  lines.push('## 5. Filename-family transition');
  lines.push('');
  lines.push(`- Last successful **hourly** token date: **${a.transition.last_successful_hourly_date ?? 'none'}**`);
  lines.push(`- First successful **minute** token date: **${a.transition.first_successful_minute_date ?? 'none'}**`);
  lines.push(`- Overlap dates (both families 200): **${a.transition.overlap_count}**`);
  if (a.transition.overlap_dates.length && a.transition.overlap_dates.length <= 20) {
    lines.push(`- Overlap list: ${a.transition.overlap_dates.join(', ')}`);
  } else if (a.transition.overlap_dates.length > 20) {
    lines.push(
      `- Overlap list (first/last): ${a.transition.overlap_dates[0]} … ${a.transition.overlap_dates[a.transition.overlap_dates.length - 1]}`
    );
  }
  lines.push('');
  lines.push(a.transition.note);
  lines.push('');
  if (args.quarterProbe.length) {
    const q200 = args.quarterProbe.filter((r) => r.exists).length;
    lines.push('### Quarter-hour probe (`:15` / `:45`)');
    lines.push('');
    lines.push(`Attempted ${args.quarterProbe.length} URLs; **${q200}** returned 200.`);
    lines.push(
      'Probed `05_15PM` / `05_45PM` on minute-family dates only. Mass `:15`/`:45` search across all hours was **not** expanded.'
    );
    lines.push('');
  }
  lines.push('## 6. Snapshots per active day');
  lines.push('');
  lines.push(`- Dates scanned: ${a.by_date.dates_scanned}`);
  lines.push(`- Dates with zero successful reports: ${a.by_date.dates_with_zero_successful_reports}`);
  lines.push(`- Dates with exactly one: ${a.by_date.dates_with_exactly_one}`);
  lines.push(`- Dates with multiple: ${a.by_date.dates_with_multiple}`);
  lines.push(`- Max reports on one date: ${a.by_date.max_reports_on_one_date}`);
  lines.push(`- Median reports among dates with ≥1: ${a.by_date.median_reports_per_date_with_at_least_one ?? 'n/a'}`);
  lines.push('');
  lines.push('## 7. How late in the day do successful paths appear?');
  lines.push('');
  lines.push('These are **URL tokens**, not PDF title clocks. Title timestamps were not read (no body download).');
  lines.push('');
  lines.push('Latest successful token counts (among dates with ≥1 report):');
  lines.push('');
  const latestEntries = Object.entries(a.by_time_of_day.latest_token_counts).sort((x, y) => y[1] - x[1]);
  for (const [tok, n] of latestEntries.slice(0, 16)) {
    lines.push(`- \`${tok}\`: ${n}`);
  }
  if (!latestEntries.length) lines.push('- none');
  lines.push('');
  lines.push('## 8. Suspicious gaps');
  lines.push('');
  lines.push(
    'Zero-success dates include offseasons, All-Star, and days the CDN returned only 403 for probed tokens. 403 is not proof a report never existed under an unprobed token.'
  );
  lines.push('');
  lines.push(
    `Oct–Jun dates with zero successful probed PDFs: **${a.by_date.in_season_oct_jun_zero_success_dates}**.`
  );
  const streaks = a.by_date.in_season_zero_streaks_ge_3_days;
  if (streaks.length) {
    lines.push('Longest Oct–Jun zero-success streaks (≥3 consecutive calendar days):');
    lines.push('');
    for (const s of streaks) lines.push(`- ${s.start} → ${s.end} (${s.days} days)`);
  } else {
    lines.push('No Oct–Jun zero-success streak of 3+ consecutive days in the probed window.');
  }
  lines.push('');
  lines.push('## 9. Rate limiting / host resistance');
  lines.push('');
  if (args.stopReason) {
    lines.push(`**Stopped early:** ${args.stopReason}`);
  } else {
    lines.push('No stop condition fired. 429 count is in the HTTP table above.');
  }
  for (const w of args.warnings) lines.push(`- Warning: ${w}`);
  if (!args.warnings.length && !args.stopReason) lines.push('No additional warnings.');
  lines.push('');
  lines.push('## 10. Estimated raw archive size');
  lines.push('');
  const sz = a.archive_size;
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| 200s with Content-Length | ${sz.successful_with_content_length} |`);
  lines.push(`| 200s missing Content-Length | ${sz.successful_missing_content_length} |`);
  lines.push(`| Min | ${fmtBytes(sz.min_bytes)} |`);
  lines.push(`| Median | ${fmtBytes(sz.median_bytes)} |`);
  lines.push(`| Mean | ${fmtBytes(sz.mean_bytes)} |`);
  lines.push(`| P95 | ${fmtBytes(sz.p95_bytes)} |`);
  lines.push(`| Max | ${fmtBytes(sz.max_bytes)} |`);
  lines.push(`| Sum observed | ${fmtBytes(sz.sum_observed_content_length)} |`);
  lines.push(`| +25% | ${fmtBytes(sz.plus_25_percent_bytes)} |`);
  lines.push(`| +100% | ${fmtBytes(sz.plus_100_percent_bytes)} |`);
  lines.push('');
  lines.push('HEAD Content-Length only. Files were not downloaded to validate.');
  lines.push('');
  lines.push('## 11. Sane enough for Phase 1B?');
  lines.push('');
  const sane =
    !args.stopReason &&
    a.successful_pdfs > 0 &&
    a.successful_pdfs < 100_000 &&
    controlPass;
  if (sane) {
    lines.push(
      '**Yes, with F3 still OPEN.** The 200 count is finite and season-shaped. Phase 1B should join these successful tokens to Final `analytics.games.start_time` and T−60. Do not claim 5:30 PM covers every tip.'
    );
  } else {
    lines.push(
      '**Not yet.** See stop reason / control mismatches. Do not start Phase 1B until HEAD evidence is interpretable.'
    );
  }
  lines.push('');
  lines.push('## 12. Still unknown');
  lines.push('');
  lines.push('- F3: whether the last successful token on a date is before each game’s T−60.');
  lines.push('- PDF title timestamps (not downloaded).');
  lines.push('- `:15`/`:45` tokens other than `05_15PM`/`05_45PM` (not mass-probed).');
  lines.push('- Hours before 08:00 ET.');
  lines.push('- Whether 403 on a token means the object is absent vs forbidden.');
  lines.push('');
  lines.push('## Verification');
  lines.push('');
  lines.push('1. No PDF body downloaded (HEAD only; `redirect: manual`).');
  lines.push('2. No S3 write.');
  lines.push('3. No Postgres write.');
  lines.push('4. No schema / migration / BDL injuries Lambda / `/wowy` / model change.');
  lines.push(`5. Date range exactly ${RANGE_START} through ${RANGE_END}.`);
  lines.push('6. F3 remains OPEN.');
  if (args.controlOnly) {
    lines.push('');
    lines.push('_This Markdown was emitted from `--control-only`; full-window aggregates may be control-only._');
  }
  lines.push('');
  return lines.join('\n');
}

async function runControl(): Promise<InventoryRecord[]> {
  const jobs: Array<{ date: string; token: string }> = [];
  for (const date of CONTROL_DATES) {
    for (const token of uniqueTokens([...HOURLY_TOKENS, ...MINUTE_TOKENS, ...QUARTER_PROBE_TOKENS])) {
      jobs.push({ date, token });
    }
  }
  console.error(`control: ${jobs.length} HEAD requests`);
  return mapPool(jobs, CONCURRENCY, (j) => headUrl(j.date, j.token));
}

async function runInventory(already: InventoryRecord[]): Promise<{
  records: InventoryRecord[];
  quarter: InventoryRecord[];
}> {
  const cache = new Map<string, InventoryRecord>();
  for (const r of already) cache.set(`${r.report_date}|${r.requested_token}`, r);

  async function cachedHead(date: string, token: string): Promise<InventoryRecord> {
    const key = `${date}|${token}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (stopReason) {
      return {
        report_date: date,
        requested_token: token,
        filename_family: familyFor(token),
        url: buildUrl(date, token),
        http_status: null,
        exists: false,
        content_type: null,
        content_length: null,
        etag: null,
        last_modified: null,
        redirect_location: null,
        checked_at: new Date().toISOString(),
        error: `skipped:${stopReason}`,
      };
    }
    const row = await headUrl(date, token);
    cache.set(key, row);
    appendRecords([row]);
    return row;
  }

  const dates = eachDateInclusive(RANGE_START, RANGE_END);
  const quarter: InventoryRecord[] = [];
  let quarterChecked = false;

  for (let di = 0; di < dates.length; di += 1) {
    if (stopReason) break;
    const date = dates[di]!;
    if (di % 30 === 0) {
      console.error(`inventory ${date} (${di + 1}/${dates.length}) cache=${cache.size} 429=${count429}`);
    }
    const sentinels = uniqueTokens([...SENTINEL_HOURLY, ...SENTINEL_MINUTE]);
    const sentinelRows = await mapPool(sentinels, CONCURRENCY, (token) => cachedHead(date, token));
    const hourlyHit = sentinelRows.some((r) => r.filename_family === 'hourly' && r.exists);
    const minuteHit = sentinelRows.some((r) => r.filename_family === 'minute' && r.exists);

    if (hourlyHit) {
      await mapPool(
        HOURLY_TOKENS.filter((t) => !sentinels.includes(t)),
        CONCURRENCY,
        (token) => cachedHead(date, token)
      );
    }
    if (minuteHit) {
      await mapPool(
        MINUTE_TOKENS.filter((t) => !sentinels.includes(t)),
        CONCURRENCY,
        (token) => cachedHead(date, token)
      );
      // Bounded :15/:45 sample: only the 5PM pair proven in control, on each minute-family date.
      // Do not expand 08_15–23_45 over the window.
      const qRows = await mapPool([...QUARTER_PROBE_TOKENS], CONCURRENCY, (token) => cachedHead(date, token));
      quarter.push(...qRows);
      if (!quarterChecked && qRows.some((r) => r.exists)) {
        quarterChecked = true;
        console.error(`quarter-hour 200 observed on ${date}; sampling 05_15PM/05_45PM on minute-family dates only`);
      }
    }
  }

  return { records: [...cache.values()].sort(sortRec), quarter };
}

function sortRec(a: InventoryRecord, b: InventoryRecord): number {
  return a.report_date.localeCompare(b.report_date) || a.requested_token.localeCompare(b.requested_token);
}

function controlReliable(records: InventoryRecord[], control: ReturnType<typeof controlExpectations>): string | null {
  const statuses = records.map((r) => r.http_status).filter((s): s is number => s != null);
  const all405 = statuses.length > 0 && statuses.every((s) => s === 405);
  if (all405) return 'HEAD appears unsupported (all control responses HTTP 405)';
  const net = records.filter((r) => r.error).length;
  if (net > records.length * 0.5) return 'control network failure rate > 50%';
  if (count429 >= STOP_AFTER_429) return stopReason;
  const explicit = control.filter((c) => c.date === '2025-12-06' || (c.date === '2026-03-18' && c.token === '05_30PM'));
  const anyExpected200 = explicit.some((c) => c.expected === '200');
  const noneExist = explicit.every((c) => !c.exists);
  if (anyExpected200 && noneExist) return 'control expected-200 anchors all failed exists=true';
  return null;
}

function isQuarterToken(token: string): boolean {
  return token.includes('_15') || token.includes('_45');
}

function mergeRecords(sets: InventoryRecord[][]): InventoryRecord[] {
  const map = new Map<string, InventoryRecord>();
  for (const set of sets) {
    for (const row of set) {
      const key = `${row.report_date}|${row.requested_token}`;
      if (!map.has(key)) map.set(key, row);
    }
  }
  return [...map.values()].sort(sortRec);
}

function hourCoverageTable(
  records: InventoryRecord[],
  eligibleDates: string[]
): Array<{
  hour: number;
  token_15: string;
  token_45: string;
  n200_15: number;
  n200_45: number;
  eligible_dates: number;
  coverage_pct: number;
}> {
  const eligible = new Set(eligibleDates);
  return QUARTER_HOUR_TOKENS.filter((t) => t.includes('_15')).map((token15) => {
    const hour = Math.floor(slotOrder(token15) / 60);
    const token45 = QUARTER_HOUR_TOKENS.find((t) => t.includes('_45') && Math.floor(slotOrder(t) / 60) === hour)!;
    const n15 = records.filter((r) => r.requested_token === token15 && r.exists && eligible.has(r.report_date)).length;
    const n45 = records.filter((r) => r.requested_token === token45 && r.exists && eligible.has(r.report_date)).length;
    const denom = eligible.size * 2;
    return {
      hour,
      token_15: token15,
      token_45: token45,
      n200_15: n15,
      n200_45: n45,
      eligible_dates: eligible.size,
      coverage_pct: denom ? Math.round(((n15 + n45) / denom) * 1000) / 10 : 0,
    };
  });
}

function cadenceAnalysis(merged: InventoryRecord[]) {
  const minutePeriod = merged.filter((r) => r.report_date >= QH_START && r.report_date <= QH_END);
  const byDate = new Map<string, InventoryRecord[]>();
  for (const r of minutePeriod) {
    const list = byDate.get(r.report_date) ?? [];
    list.push(r);
    byDate.set(r.report_date, list);
  }
  const expectedQuarter = [...QUARTER_HOUR_TOKENS];
  const expectedHalf = [...MINUTE_TOKENS];
  const expectedAll = uniqueTokens([...expectedHalf, ...expectedQuarter]);
  const activeDates = [...byDate.entries()]
    .filter(([, rows]) => rows.some((r) => r.exists && (r.filename_family === 'minute' || isQuarterToken(r.requested_token))))
    .map(([d]) => d)
    .sort();
  const perDate = activeDates.map((date) => {
    const rows = byDate.get(date) ?? [];
    const ok = new Set(rows.filter((r) => r.exists).map((r) => r.requested_token));
    const missingQuarter = expectedQuarter.filter((t) => !ok.has(t));
    const missingHalf = expectedHalf.filter((t) => !ok.has(t));
    const presentGrid = expectedAll.filter((t) => ok.has(t)).length;
    return {
      date,
      n200: rows.filter((r) => r.exists).length,
      grid_slots_present: presentGrid,
      grid_slots_expected: expectedAll.length,
      missing_quarter: missingQuarter,
      missing_half: missingHalf,
    };
  });
  const n200s = perDate.map((d) => d.n200).sort((a, b) => a - b);
  const breaks = perDate.filter((d) => d.missing_quarter.length > 0 || d.missing_half.length > 0);
  const completeCadence = perDate.filter((d) => d.missing_quarter.length === 0 && d.missing_half.length === 0).length;
  return {
    active_dates: activeDates.length,
    median_snapshots: median(n200s),
    max_snapshots: n200s.length ? n200s[n200s.length - 1] : 0,
    expected_grid_slots: expectedAll.length,
    dates_with_full_15min_grid: completeCadence,
    dates_missing_any_grid_slot: breaks.length,
    break_dates: breaks.slice(0, 40).map((d) => ({
      date: d.date,
      n200: d.n200,
      missing_quarter: d.missing_quarter,
      missing_half: d.missing_half,
    })),
    regular_15min_cadence:
      activeDates.length > 0 && completeCadence / activeDates.length >= 0.9
        ? 'yes_on_most_active_dates'
        : completeCadence > 0
          ? 'partial'
          : 'no',
  };
}

function quarterCompletionMarkdown(args: {
  startedAt: string;
  finishedAt: string;
  stopReason: StopReason;
  warnings: string[];
  control: Array<{ date: string; token: string; http_status: number | null; exists: boolean; reused: boolean }>;
  attempted: number;
  newHeads: number;
  reused: number;
  http: Record<string, number>;
  n200: number;
  n15: number;
  n45: number;
  byToken: Array<{ token: string; n200: number; first: string | null; last: string | null }>;
  byHour: ReturnType<typeof hourCoverageTable>;
  first200: string | null;
  last200: string | null;
  fivePmUnusual: boolean;
}): string {
  const lines: string[] = [];
  lines.push('# Official NBA injury-report quarter-hour completion (Phase 1A.2)');
  lines.push('');
  lines.push(`Generated: **${args.finishedAt}**`);
  lines.push(`Window: **${QH_START} → ${QH_END}** (inclusive).`);
  lines.push('Method: **HEAD only**. No PDF bodies downloaded. No S3. No Postgres.');
  lines.push('Original Phase 1A evidence was **not** overwritten.');
  lines.push('');
  lines.push('## Finding status');
  lines.push('');
  lines.push('| Finding | Status | Note |');
  lines.push('| --- | --- | --- |');
  const f12 = args.stopReason ? 'PARTIAL' : 'CLOSED';
  lines.push(
    `| F1 snapshot count | **${f12}** | 08:00-23:45 :00/:15/:30/:45 in this window; not exhaustive outside that policy |`
  );
  lines.push(`| F2 token / family density | **${f12}** | Quarter-hour slots 08-23 now inventoried |`);
  lines.push('| F3 T−60 vs `analytics.games.start_time` | **OPEN** | Not joined. Phase 1B. |');
  lines.push('');
  lines.push('## Control (non-5PM quarter-hour)');
  lines.push('');
  lines.push('| Date | Token | Status | Exists | Reused |');
  lines.push('| --- | --- | ---: | --- | --- |');
  for (const c of args.control) {
    lines.push(
      `| ${c.date} | \`${c.token}\` | ${c.http_status ?? 'n/a'} | ${c.exists} | ${c.reused ? 'yes' : 'no'} |`
    );
  }
  lines.push('');
  lines.push('## Request totals');
  lines.push('');
  lines.push('| Result | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Matrix URLs (date × :15/:45 token) | ${args.attempted} |`);
  lines.push(`| New HEAD requests this pass | ${args.newHeads} |`);
  lines.push(`| Reused Phase 1A (05_15PM / 05_45PM) | ${args.reused} |`);
  lines.push(`| 200 (exists) | ${args.n200} |`);
  lines.push(`| 403 | ${args.http['403'] ?? 0} |`);
  lines.push(`| 404 | ${args.http['404'] ?? 0} |`);
  lines.push(`| 429 | ${args.http['429'] ?? 0} |`);
  lines.push(`| redirect | ${args.http['redirect'] ?? 0} |`);
  lines.push(`| 5xx | ${args.http['5xx'] ?? 0} |`);
  lines.push(`| timeout | ${args.http['timeout'] ?? 0} |`);
  lines.push(`| network | ${args.http['network'] ?? 0} |`);
  const other = Object.entries(args.http)
    .filter(([k]) => !['200', '403', '404', '429', 'redirect', '5xx', 'timeout', 'network'].includes(k))
    .reduce((n, [, v]) => n + v, 0);
  lines.push(`| other | ${other} |`);
  lines.push('');
  lines.push(`First successful :15/:45 date: **${args.first200 ?? 'none'}**`);
  lines.push(`Last successful :15/:45 date: **${args.last200 ?? 'none'}**`);
  lines.push('');
  lines.push(`\`:15\` HTTP 200: **${args.n15}**`);
  lines.push(`\`:45\` HTTP 200: **${args.n45}**`);
  lines.push('');
  lines.push('## Are :15 / :45 generally part of the schedule, or was 5 PM unusual?');
  lines.push('');
  if (args.fivePmUnusual) {
    lines.push(
      '**5 PM was unusual.** Non-5PM `:15`/`:45` coverage is far below the 5PM pair. Do not treat every hour as a 15-minute cadence.'
    );
  } else {
    lines.push(
      '**Broadly confirmed.** `:15` and `:45` files appear across the 08:00–23:45 window on eligible minute-family dates, not only at 5 PM.'
    );
  }
  lines.push('');
  lines.push('Eligible dates = dates in this window with at least one Phase 1A `:00`/`:30` HTTP 200.');
  lines.push('');
  lines.push('| Hour | :15 200 count | :45 200 count | eligible dates | coverage % |');
  lines.push('| ---- | ------------: | ------------: | -------------: | ---------: |');
  for (const h of args.byHour) {
    lines.push(
      `| ${String(h.hour).padStart(2, '0')} | ${h.n200_15} | ${h.n200_45} | ${h.eligible_dates} | ${h.coverage_pct} |`
    );
  }
  lines.push('');
  lines.push('## Count by token');
  lines.push('');
  lines.push('| Token | n200 | First date | Last date |');
  lines.push('| --- | ---: | --- | --- |');
  for (const t of args.byToken) {
    lines.push(`| \`${t.token}\` | ${t.n200} | ${t.first ?? '—'} | ${t.last ?? '—'} |`);
  }
  lines.push('');
  lines.push('## Rate limiting');
  lines.push('');
  if (args.stopReason) lines.push(`**Stopped early:** ${args.stopReason}`);
  else lines.push('No stop condition fired. 429 count is in the table above.');
  for (const w of args.warnings) lines.push(`- Warning: ${w}`);
  lines.push('');
  lines.push('## Verification');
  lines.push('');
  lines.push('1. HEAD only; no PDF body download.');
  lines.push('2. No S3 / Postgres / schema / WOWY / BDL / Terraform change.');
  lines.push('3. Original Phase 1A JSON/MD/ndjson preserved.');
  lines.push('4. F3 remains OPEN.');
  lines.push('');
  return lines.join('\n');
}

function completeMarkdown(args: {
  finishedAt: string;
  stopReason: StopReason;
  warnings: string[];
  aggregates: ReturnType<typeof summarizeRecords>;
  cadence: ReturnType<typeof cadenceAnalysis>;
  n15: number;
  n45: number;
  f1: string;
  f2: string;
}): string {
  const a = args.aggregates;
  const sz = a.archive_size;
  const lines: string[] = [];
  lines.push('# Official NBA injury-report existence inventory (complete, Phase 1A + 1A.2)');
  lines.push('');
  lines.push(`Generated: **${args.finishedAt}**`);
  lines.push(`Window: **${RANGE_START} → ${RANGE_END}** (inclusive).`);
  lines.push('Method: **HEAD only**. Merges original Phase 1A records with the 2025-12-22–2026-06-14 `:15`/`:45` completion pass.');
  lines.push('Original Phase 1A files were not overwritten.');
  lines.push('');
  lines.push('## Finding status');
  lines.push('');
  lines.push('| Finding | Status | Note |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| F1 snapshot count | **${args.f1}** | Operationally closed for 08:00–23:45 filename policy in the certified window; other arbitrary names were not searched |`
  );
  lines.push(
    `| F2 token / family density | **${args.f2}** | Hourly + :00/:15/:30/:45 08-23 inventoried |`
  );
  lines.push('| F3 T−60 vs `analytics.games.start_time` | **OPEN** | Not joined. Phase 1B. |');
  lines.push('');
  lines.push('## Merged HTTP-200 count');
  lines.push('');
  lines.push(`**${a.successful_pdfs}** existing PDFs among **${a.attempted}** recorded HEAD results.`);
  lines.push('');
  lines.push('| Result | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Attempted URLs (unique date×token) | ${a.attempted} |`);
  lines.push(`| 200 (exists) | ${a.successful_pdfs} |`);
  lines.push(`| 403 | ${a.http['403'] ?? 0} |`);
  lines.push(`| 404 | ${a.http['404'] ?? 0} |`);
  lines.push(`| 429 | ${a.http['429'] ?? 0} |`);
  lines.push(`| other | ${(a.http['redirect'] ?? 0) + (a.http['5xx'] ?? 0) + (a.http['timeout'] ?? 0) + (a.http['network'] ?? 0)} |`);
  lines.push('');
  lines.push(`Completion-pass \`:15\` 200s: **${args.n15}**. \`:45\` 200s: **${args.n45}**.`);
  lines.push('');
  lines.push('## By Court Context season');
  lines.push('');
  lines.push('| Season | Dates scanned | 200 PDFs | 403 | 404 | Other | First 200 date | Last 200 date |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const season of ['2023', '2024', '2025'] as const) {
    const s = a.by_season[season];
    lines.push(
      `| ${season} | ${s.dates_scanned} | ${s.successful_pdfs} | ${s.http_403} | ${s.http_404} | ${s.other} | ${s.first_successful_snapshot_date ?? '—'} | ${s.last_successful_snapshot_date ?? '—'} |`
    );
  }
  lines.push('');
  lines.push('July-cutoff summer files (e.g. 2024-07-07, 2025-07-04) remain in the source inventory. Phase 1B is game-centric and will not use this list as a game universe.');
  lines.push('');
  lines.push('## Reports per active date (full window)');
  lines.push('');
  lines.push(`- Dates scanned: ${a.by_date.dates_scanned}`);
  lines.push(`- Dates with zero successful reports: ${a.by_date.dates_with_zero_successful_reports}`);
  lines.push(`- Dates with exactly one: ${a.by_date.dates_with_exactly_one}`);
  lines.push(`- Dates with multiple: ${a.by_date.dates_with_multiple}`);
  lines.push(`- Max reports on one date: ${a.by_date.max_reports_on_one_date}`);
  lines.push(`- Median reports among dates with ≥1: ${a.by_date.median_reports_per_date_with_at_least_one ?? 'n/a'}`);
  lines.push('');
  lines.push('Latest successful token counts (URL tokens, not PDF titles):');
  lines.push('');
  const latestEntries = Object.entries(a.by_time_of_day.latest_token_counts).sort((x, y) => y[1] - x[1]);
  for (const [tok, n] of latestEntries.slice(0, 12)) lines.push(`- \`${tok}\`: ${n}`);
  lines.push('');
  lines.push('Earliest successful token counts:');
  lines.push('');
  const earliestEntries = Object.entries(a.by_time_of_day.earliest_token_counts).sort((x, y) => y[1] - x[1]);
  for (const [tok, n] of earliestEntries.slice(0, 12)) lines.push(`- \`${tok}\`: ${n}`);
  lines.push('');
  lines.push('## Minute-family period (2025-12-22 → 2026-06-14)');
  lines.push('');
  const c = args.cadence;
  lines.push(`- Active dates (any :00/:15/:30/:45 200): **${c.active_dates}**`);
  lines.push(`- Median snapshots per active day: **${c.median_snapshots ?? 'n/a'}**`);
  lines.push(`- Max snapshots per active day: **${c.max_snapshots}**`);
  lines.push(`- Expected 08:00–23:45 grid slots: **${c.expected_grid_slots}** (16 hours × 4)`);
  lines.push(`- Dates with a complete 15-minute grid: **${c.dates_with_full_15min_grid}**`);
  lines.push(`- Dates missing any grid slot: **${c.dates_missing_any_grid_slot}**`);
  lines.push(`- Regular 15-minute cadence: **${c.regular_15min_cadence}**`);
  lines.push('');
  if (c.break_dates.length) {
    lines.push('Dates that break the expected cadence (first 40):');
    lines.push('');
    for (const d of c.break_dates) {
      const miss = [...d.missing_half, ...d.missing_quarter].join(', ') || 'none';
      lines.push(`- ${d.date}: ${d.n200} × 200; missing ${miss}`);
    }
    lines.push('');
  }
  lines.push('## Archive size');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Discovered PDFs (200) | ${a.successful_pdfs} |`);
  lines.push(`| With Content-Length | ${sz.successful_with_content_length} |`);
  lines.push(`| Missing Content-Length | ${sz.successful_missing_content_length} |`);
  lines.push(`| Min | ${fmtBytes(sz.min_bytes)} |`);
  lines.push(`| Median | ${fmtBytes(sz.median_bytes)} |`);
  lines.push(`| Mean | ${fmtBytes(sz.mean_bytes)} |`);
  lines.push(`| P95 | ${fmtBytes(sz.p95_bytes)} |`);
  lines.push(`| Max | ${fmtBytes(sz.max_bytes)} |`);
  lines.push(`| Sum observed | ${fmtBytes(sz.sum_observed_content_length)} |`);
  lines.push(`| +25% | ${fmtBytes(sz.plus_25_percent_bytes)} |`);
  lines.push(`| +100% | ${fmtBytes(sz.plus_100_percent_bytes)} |`);
  lines.push('');
  lines.push('HEAD Content-Length only. Files were not downloaded.');
  lines.push('');
  lines.push('## F1 / F2 / F3');
  lines.push('');
  lines.push(
    `**F1: ${args.f1}** — Operationally closed for the certified reporting window (hourly family through 2025-12-21, then 08:00-23:45 :00/:15/:30/:45 through 2026-06-14). Existence outside that filename policy was not exhaustively searched.`
  );
  lines.push('');
  lines.push(`**F2: ${args.f2}** — Token families and density measured for the probed slots.`);
  lines.push('');
  lines.push('**F3: OPEN** — No join to `analytics.games`. No T−60 coverage claim.');
  lines.push('');
  if (args.stopReason) lines.push(`Stopped early: ${args.stopReason}`);
  for (const w of args.warnings) lines.push(`- ${w}`);
  lines.push('');
  lines.push('## Verification');
  lines.push('');
  lines.push('1. Only HEAD was used.');
  lines.push('2. No PDF bodies downloaded.');
  lines.push('3. No S3 / Postgres / schema / migration / WOWY / BDL / Terraform change.');
  lines.push('4. Original Phase 1A evidence preserved.');
  lines.push('5. F3 remains OPEN.');
  lines.push('');
  return lines.join('\n');
}

async function runQuarterHourCompletionMain(): Promise<void> {
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const dates = eachDateInclusive(QH_START, QH_END);
  const original = loadNdjson(NDJSON_PATH);
  const priorCompletion = loadNdjson(QH_NDJSON_PATH);
  const cache = new Map<string, InventoryRecord>();
  for (const r of original) cache.set(`${r.report_date}|${r.requested_token}`, r);
  for (const r of priorCompletion) cache.set(`${r.report_date}|${r.requested_token}`, r);

  const eligibleDates = [
    ...new Set(
      original
        .filter(
          (r) =>
            r.report_date >= QH_START &&
            r.report_date <= QH_END &&
            r.exists &&
            r.filename_family === 'minute'
        )
        .map((r) => r.report_date)
    ),
  ].sort();

  const originalKeys = new Set(original.map((r) => `${r.report_date}|${r.requested_token}`));
  let newHeads = 0;
  let reused = 0;

  async function cachedHead(date: string, token: string): Promise<{ row: InventoryRecord; reused: boolean; fresh: boolean }> {
    const key = `${date}|${token}`;
    const hit = cache.get(key);
    if (hit) {
      const fromOriginal = originalKeys.has(key);
      return { row: hit, reused: fromOriginal, fresh: false };
    }
    if (stopReason) {
      return {
        row: {
          report_date: date,
          requested_token: token,
          filename_family: familyFor(token),
          url: buildUrl(date, token),
          http_status: null,
          exists: false,
          content_type: null,
          content_length: null,
          etag: null,
          last_modified: null,
          redirect_location: null,
          checked_at: new Date().toISOString(),
          error: `skipped:${stopReason}`,
        },
        reused: false,
        fresh: false,
      };
    }
    const row = await headUrl(date, token);
    cache.set(key, row);
    appendRecords([row], QH_NDJSON_PATH);
    newHeads += 1;
    return { row, reused: false, fresh: true };
  }

  const controlJobs = [
    { date: '2026-03-18', token: '08_15AM' },
    { date: '2026-03-18', token: '08_45AM' },
    { date: '2026-03-18', token: '12_15PM' },
    { date: '2026-03-18', token: '11_15PM' },
    { date: '2026-03-18', token: '11_45PM' },
    { date: '2025-12-22', token: '09_15AM' },
    { date: '2026-03-18', token: '05_15PM' },
  ];
  const controlOut: Array<{ date: string; token: string; http_status: number | null; exists: boolean; reused: boolean }> = [];
  for (const job of controlJobs) {
    const { row, reused } = await cachedHead(job.date, job.token);
    controlOut.push({
      date: job.date,
      token: job.token,
      http_status: row.http_status,
      exists: row.exists,
      reused,
    });
  }
  const non5pm = controlOut.filter((c) => c.token !== '05_15PM');
  if (non5pm.every((c) => c.http_status == null && c.exists === false) && non5pm.some((c) => true)) {
    const netFail = controlOut.filter((c) => c.http_status == null && !c.reused);
    if (netFail.length === non5pm.filter((c) => !c.reused).length && netFail.length) {
      stopReason = stopReason ?? 'control HEAD failed for non-5PM quarter-hour tokens';
      warnings.push(stopReason);
    }
  }

  let completionRows: InventoryRecord[] = [];

  if (!stopReason) {
    for (let di = 0; di < dates.length; di += 1) {
      if (stopReason) break;
      const date = dates[di]!;
      if (di % 15 === 0) {
        console.error(`quarter-completion ${date} (${di + 1}/${dates.length}) new=${newHeads} reused=${reused} 429=${count429}`);
      }
      const results = await mapPool(QUARTER_HOUR_TOKENS, CONCURRENCY, (token) => cachedHead(date, token));
      for (const r of results) {
        completionRows.push(r.row);
        if (r.reused) reused += 1;
      }
    }
  }

  const live = completionRows.filter((r) => !r.error?.startsWith('skipped:'));
  const ok = live.filter((r) => r.exists);
  const n15 = ok.filter((r) => r.requested_token.includes('_15')).length;
  const n45 = ok.filter((r) => r.requested_token.includes('_45')).length;
  const http = countBy(live, (r) => classifyHttp(r.http_status, r.error));
  const byTokenMap = new Map<string, { n200: number; first: string | null; last: string | null }>();
  for (const r of ok) {
    const cur = byTokenMap.get(r.requested_token) ?? { n200: 0, first: null, last: null };
    cur.n200 += 1;
    if (!cur.first || r.report_date < cur.first) cur.first = r.report_date;
    if (!cur.last || r.report_date > cur.last) cur.last = r.report_date;
    byTokenMap.set(r.requested_token, cur);
  }
  const byToken = [...byTokenMap.entries()]
    .map(([token, v]) => ({ token, ...v }))
    .sort((a, b) => slotOrder(a.token) - slotOrder(b.token));
  const byHour = hourCoverageTable(live, eligibleDates);
  const fivePm = byHour.find((h) => h.hour === 17);
  const otherHours = byHour.filter((h) => h.hour !== 17);
  const otherMean = otherHours.length
    ? otherHours.reduce((n, h) => n + h.n200_15 + h.n200_45, 0) / (otherHours.length * 2)
    : 0;
  const fivePmMean = fivePm ? (fivePm.n200_15 + fivePm.n200_45) / 2 : 0;
  const fivePmUnusual = fivePmMean > 0 && otherMean < fivePmMean * 0.4;
  const first200 = ok.map((r) => r.report_date).sort()[0] ?? null;
  const last200 = ok.map((r) => r.report_date).sort().at(-1) ?? null;
  const finishedAt = new Date().toISOString();

  const qhPayload = {
    probe: 'official-injury-report-quarter-hour-completion',
    phase: '1A.2',
    method: 'HEAD',
    downloaded_pdf_bodies: false,
    started_at: startedAt,
    finished_at: finishedAt,
    target: { start: QH_START, end: QH_END, inclusive: true },
    token_strategy: {
      tokens: QUARTER_HOUR_TOKENS,
      hours: '08 through 23 ET filename window',
      reused_phase_1a_tokens: ['05_15PM', '05_45PM'],
      concurrency: CONCURRENCY,
      min_gap_ms: MIN_GAP_MS,
      timeout_ms: TIMEOUT_MS,
    },
    control: controlOut,
    new_head_requests: newHeads,
    reused_phase_1a_records: reused,
    records: live,
    aggregates: {
      attempted: live.length,
      http,
      successful_pdfs: ok.length,
      n200_15: n15,
      n200_45: n45,
      first_successful_date: first200,
      last_successful_date: last200,
      by_token: byToken,
      by_hour: byHour,
      five_pm_unusual: fivePmUnusual,
      eligible_minute_family_dates: eligibleDates.length,
    },
    warnings,
    incomplete_run_reason: stopReason,
    f1_status: stopReason ? 'PARTIAL' : 'CLOSED',
    f2_status: stopReason ? 'PARTIAL' : 'CLOSED',
    f3_status: 'OPEN',
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(QH_JSON_PATH, JSON.stringify(qhPayload, null, 2) + '\n', 'utf8');
  writeFileSync(
    QH_MD_PATH,
    quarterCompletionMarkdown({
      startedAt,
      finishedAt,
      stopReason,
      warnings,
      control: controlOut,
      attempted: live.length,
      newHeads,
      reused,
      http,
      n200: ok.length,
      n15,
      n45,
      byToken,
      byHour,
      first200,
      last200,
      fivePmUnusual,
    }),
    'utf8'
  );

  const merged = mergeRecords([original, priorCompletion, live]);
  writeFileSync(COMPLETE_NDJSON_PATH, merged.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const aggregates = summarizeRecords(merged.filter((r) => !r.error?.startsWith('skipped:')));
  const cadence = cadenceAnalysis(merged);
  const f1 = stopReason ? 'PARTIAL' : 'CLOSED';
  const f2 = stopReason ? 'PARTIAL' : 'CLOSED';
  const completePayload = {
    probe: 'official-injury-report-existence-inventory-complete',
    phase: '1A+1A.2',
    method: 'HEAD',
    downloaded_pdf_bodies: false,
    started_at: startedAt,
    finished_at: finishedAt,
    target: { start: RANGE_START, end: RANGE_END, inclusive: true },
    sources: {
      phase_1a_records: 'reports/operations/official-injury-report-existence-inventory.records.ndjson',
      completion_records: 'reports/operations/official-injury-report-quarter-hour-completion.records.ndjson',
      merged_records: 'reports/operations/official-injury-report-existence-inventory-complete.records.ndjson',
    },
    token_strategy: {
      note: 'Phase 1A hourly + HH_00/HH_30 08–23, plus Phase 1A.2 HH_15/HH_45 08–23 from 2025-12-22 through 2026-06-14.',
    },
    record_count: merged.length,
    aggregates,
    minute_family_cadence: cadence,
    quarter_hour_completion: {
      n200_15: n15,
      n200_45: n45,
      five_pm_unusual: fivePmUnusual,
      by_hour: byHour,
    },
    warnings,
    incomplete_run_reason: stopReason,
    f1_status: f1,
    f2_status: f2,
    f3_status: 'OPEN',
    f1_scope:
      'Operationally closed for the certified reporting window; existence outside the 08:00–23:45 filename policy was not exhaustively searched.',
  };
  writeFileSync(COMPLETE_JSON_PATH, JSON.stringify(completePayload, null, 2) + '\n', 'utf8');
  writeFileSync(
    COMPLETE_MD_PATH,
    completeMarkdown({
      finishedAt,
      stopReason,
      warnings,
      aggregates,
      cadence,
      n15,
      n45,
      f1,
      f2,
    }),
    'utf8'
  );

  console.error(`wrote ${QH_JSON_PATH}`);
  console.error(`wrote ${QH_MD_PATH}`);
  console.error(`wrote ${COMPLETE_JSON_PATH}`);
  console.error(`wrote ${COMPLETE_MD_PATH}`);
  console.log(
    JSON.stringify(
      {
        n200_15: n15,
        n200_45: n45,
        five_pm_unusual: fivePmUnusual,
        merged_successful_pdfs: aggregates.successful_pdfs,
        newHeads,
        reused,
        stopReason,
        f1,
        f2,
        f3: 'OPEN',
      },
      null,
      2
    )
  );
}

async function main() {
  if (process.argv.includes('--quarter-hour-completion')) {
    await runQuarterHourCompletionMain();
    return;
  }
  const controlOnly = process.argv.includes('--control-only');
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];

  const checkpoint = loadNdjson(NDJSON_PATH);
  let controlRecords = loadPriorControlRecords();
  if (controlRecords) {
    warnings.push('reused prior HEAD control records; did not re-request control URLs');
    const missing = controlRecords.filter(
      (r) => !checkpoint.some((p) => p.report_date === r.report_date && p.requested_token === r.requested_token)
    );
    appendRecords(missing);
  } else {
    controlRecords = (await runControl()).sort(sortRec);
    const missing = controlRecords.filter(
      (r) => !checkpoint.some((p) => p.report_date === r.report_date && p.requested_token === r.requested_token)
    );
    appendRecords(missing);
  }
  const control = controlExpectations(controlRecords);
  const controlBlock = controlReliable(controlRecords, control);
  if (controlBlock) {
    stopReason = stopReason ?? controlBlock;
    warnings.push(controlBlock);
  }

  let inventoryRecords = controlRecords;
  let quarter: InventoryRecord[] = controlRecords.filter((r) => r.filename_family === 'quarter');

  if (!controlOnly && !stopReason) {
    const alreadyKeys = new Set<string>();
    const already: InventoryRecord[] = [];
    for (const row of [...checkpoint, ...controlRecords]) {
      const key = `${row.report_date}|${row.requested_token}`;
      if (alreadyKeys.has(key)) continue;
      alreadyKeys.add(key);
      already.push(row);
    }
    if (checkpoint.length) {
      warnings.push(`resumed ${checkpoint.length} checkpoint HEAD records from ndjson`);
    }
    const inv = await runInventory(already);
    inventoryRecords = inv.records;
    quarter = inventoryRecords.filter((r) => r.filename_family === 'quarter');
  } else if (controlOnly) {
    warnings.push('control-only run; full window not scanned');
  }

  const finishedAt = new Date().toISOString();
  const liveRecords = inventoryRecords.filter((r) => !r.error?.startsWith('skipped:'));
  const aggregates = summarizeRecords(liveRecords);
  const quarter200 = quarter.filter((r) => r.exists).length;
  const quarterIncomplete = quarter200 > 0;
  let f1: 'CLOSED' | 'PARTIAL' | 'BLOCKED' = 'CLOSED';
  let f2: 'CLOSED' | 'PARTIAL' | 'BLOCKED' = 'CLOSED';
  if (controlOnly) {
    f1 = 'PARTIAL';
    f2 = 'PARTIAL';
  } else if (stopReason) {
    f1 = /429|HEAD appears unsupported|network/i.test(stopReason) ? 'BLOCKED' : 'PARTIAL';
    f2 = f1;
  } else if (quarterIncomplete) {
    f1 = 'PARTIAL';
    f2 = 'PARTIAL';
    warnings.push(
      '05_15PM/05_45PM returned 200; other :15/:45 hours were not mass-probed, so snapshot count is a lower bound'
    );
  }

  const payload = {
    probe: 'official-injury-report-existence-inventory',
    phase: '1A',
    method: 'HEAD',
    downloaded_pdf_bodies: false,
    started_at: startedAt,
    finished_at: finishedAt,
    target: { start: RANGE_START, end: RANGE_END, inclusive: true },
    token_strategy: {
      hourly_tokens: [...HOURLY_TOKENS],
      minute_tokens: MINUTE_TOKENS,
      sentinel_hourly: [...SENTINEL_HOURLY],
      sentinel_minute: [...SENTINEL_MINUTE],
      quarter_probe_tokens: [...QUARTER_PROBE_TOKENS],
      expansion:
        'On each date, HEAD sentinels from both families. If any hourly 200, HEAD remaining hourly tokens that date. If any minute 200, HEAD remaining HH_00/HH_30 08–23 that date plus 05_15PM/05_45PM. Other :15/:45 hours not mass-expanded.',
      concurrency: CONCURRENCY,
      min_gap_ms: MIN_GAP_MS,
      timeout_ms: TIMEOUT_MS,
    },
    control: {
      dates: [...CONTROL_DATES],
      expectations: control,
      records: controlRecords,
    },
    records: liveRecords,
    records_ndjson: 'reports/operations/official-injury-report-existence-inventory.records.ndjson',
    aggregates,
    quarter_hour_probe: quarter,
    filename_family_transition: aggregates.transition,
    archive_size_estimates: aggregates.archive_size,
    warnings,
    incomplete_run_reason: stopReason,
    f1_status: f1,
    f2_status: f2,
    f3_status: 'OPEN',
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  writeFileSync(
    MD_PATH,
    markdownReport({
      startedAt,
      finishedAt,
      controlOnly,
      stopReason,
      control,
      controlRecords,
      inventoryRecords: liveRecords,
      quarterProbe: quarter,
      warnings,
      aggregates,
      f1,
      f2,
    }),
    'utf8'
  );
  console.error(`wrote ${JSON_PATH}`);
  console.error(`wrote ${MD_PATH}`);
  console.log(
    JSON.stringify(
      {
        control_matched: control.every((c) => c.matched_prior),
        successful_pdfs: aggregates.successful_pdfs,
        attempted: aggregates.attempted,
        stopReason,
        f1: payload.f1_status,
        f2: payload.f2_status,
        f3: 'OPEN',
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
