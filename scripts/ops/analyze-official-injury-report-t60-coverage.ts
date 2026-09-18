/**
 * Phase 1B — read-only game-centric pre-T−60 source-timing coverage.
 *
 *   npx tsx scripts/ops/analyze-official-injury-report-t60-coverage.ts
 *
 * Uses existing inventory HEAD metadata + a READ ONLY Postgres query.
 * Does not download PDFs, write S3, write Postgres, or join parsed injury rows.
 */
import 'dotenv/config';
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { Pool } from 'pg';
import { etCalendarDate, isPostseasonGame } from '../../lib/wowy/calendar';

const TZ = 'America/New_York';
const INVENTORY_NDJSON = path.join(
  process.cwd(),
  'reports',
  'operations',
  'official-injury-report-existence-inventory-complete.records.ndjson'
);
const OUT_DIR = path.join(process.cwd(), 'reports', 'operations');
const EXPECTED_EXISTING_PDFS = 18271;
const CUTOFF_MINUTES = 60;
const FRESH_HOURS = 48;

type FilenameFamily = 'hourly' | 'minute' | 'quarter';

type InventoryRow = {
  report_date: string;
  requested_token: string;
  filename_family: FilenameFamily;
  url: string;
  http_status: number | null;
  exists: boolean;
};

type Candidate = {
  report_date: string;
  requested_token: string;
  filename_family: FilenameFamily;
  url: string;
  inferred_report_published_at: string;
  inferred_ms: number;
  naive_plus30_at: string;
};

type Bucket =
  | 'LE_15_MIN'
  | 'GT_15_LE_30_MIN'
  | 'GT_30_LE_60_MIN'
  | 'GT_60_LE_120_MIN'
  | 'GT_2H_LE_6H'
  | 'GT_6H_LE_12H'
  | 'GT_12H_LE_24H'
  | 'GT_24H_LE_48H'
  | 'STALE_GT_48H'
  | 'NO_PRE_CUTOFF_CANDIDATE';

const BUCKETS: Bucket[] = [
  'LE_15_MIN',
  'GT_15_LE_30_MIN',
  'GT_30_LE_60_MIN',
  'GT_60_LE_120_MIN',
  'GT_2H_LE_6H',
  'GT_6H_LE_12H',
  'GT_12H_LE_24H',
  'GT_24H_LE_48H',
  'STALE_GT_48H',
  'NO_PRE_CUTOFF_CANDIDATE',
];

const ET_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseTokenClock(token: string): { hour24: number; minute: number } | null {
  const hourly = token.match(/^(\d{2})(AM|PM)$/);
  const minute = token.match(/^(\d{2})_(\d{2})(AM|PM)$/);
  const m = hourly ?? minute;
  if (!m) return null;
  const h12 = Number(hourly ? m[1] : m[1]);
  const min = hourly ? 0 : Number(m[2]);
  const ap = hourly ? m[2] : m[3];
  if (!Number.isFinite(h12) || !Number.isFinite(min) || min < 0 || min > 59) return null;
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
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

/** Convert an America/New_York wall clock to a UTC instant. Handles DST. */
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
  throw new Error(`Could not resolve ET wall time ${ymd} ${pad2(hour24)}:${pad2(minute)}`);
}

function addMinutesEt(ymd: string, hour24: number, minute: number, add: number): { ymd: string; hour24: number; minute: number; ms: number } {
  const ms = etWallToMs(ymd, hour24, minute) + add * 60_000;
  const p = etParts(ms);
  return { ymd: p.date, hour24: p.hour, minute: p.minute, ms };
}

function inferredFromToken(reportDate: string, token: string): {
  naivePlus30Ms: number;
  controlValidatedMs: number;
  familyKind: 'hourly' | 'minute_clock';
} | null {
  const clock = parseTokenClock(token);
  if (!clock) return null;
  const naive = addMinutesEt(reportDate, clock.hour24, clock.minute, 30);
  const isHourly = !token.includes('_');
  const validated = isHourly
    ? naive
    : { ms: etWallToMs(reportDate, clock.hour24, clock.minute), ymd: reportDate, hour24: clock.hour24, minute: clock.minute };
  return {
    naivePlus30Ms: naive.ms,
    controlValidatedMs: validated.ms,
    familyKind: isHourly ? 'hourly' : 'minute_clock',
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function classifyAge(ageMin: number | null): Bucket {
  if (ageMin == null) return 'NO_PRE_CUTOFF_CANDIDATE';
  if (ageMin <= 15) return 'LE_15_MIN';
  if (ageMin <= 30) return 'GT_15_LE_30_MIN';
  if (ageMin <= 60) return 'GT_30_LE_60_MIN';
  if (ageMin <= 120) return 'GT_60_LE_120_MIN';
  if (ageMin <= 360) return 'GT_2H_LE_6H';
  if (ageMin <= 720) return 'GT_6H_LE_12H';
  if (ageMin <= 1440) return 'GT_12H_LE_24H';
  if (ageMin <= 2880) return 'GT_24H_LE_48H';
  return 'STALE_GT_48H';
}

function tipBand(hour: number): string {
  if (hour < 18) return 'before_18_et';
  if (hour < 20) return '18_to_19_et';
  if (hour < 22) return '20_to_21_et';
  return '22_plus_et';
}

function filenameRegime(etDate: string): 'legacy_hourly' | 'transition_2025_12_22' | 'minute_family' {
  if (etDate < '2025-12-22') return 'legacy_hourly';
  if (etDate === '2025-12-22') return 'transition_2025_12_22';
  return 'minute_family';
}

function fmtPct(n: number, d: number): string {
  if (!d) return 'n/a';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function fmtMin(n: number | null): string {
  if (n == null) return 'n/a';
  if (n < 60) return `${Math.round(n * 10) / 10} min`;
  return `${(n / 60).toFixed(1)} h`;
}

const TITLE_CONTROLS: Array<{
  file: string;
  report_date: string;
  token: string;
  title_et: string;
  note: string;
}> = [
  { file: 'Injury-Report_2023-10-24_05PM.pdf', report_date: '2023-10-24', token: '05PM', title_et: '2023-10-24 17:30', note: 'probe cache first_25_lines' },
  { file: 'Injury-Report_2024-10-22_05PM.pdf', report_date: '2024-10-22', token: '05PM', title_et: '2024-10-22 17:30', note: 'probe cache first_25_lines' },
  { file: 'Injury-Report_2025-12-06_11AM.pdf', report_date: '2025-12-06', token: '11AM', title_et: '2025-12-06 11:30', note: 'required control' },
  { file: 'Injury-Report_2025-12-06_05PM.pdf', report_date: '2025-12-06', token: '05PM', title_et: '2025-12-06 17:30', note: 'required control' },
  { file: 'Injury-Report_2026-03-18_05_30PM.pdf', report_date: '2026-03-18', token: '05_30PM', title_et: '2026-03-18 17:30', note: 'required control' },
  { file: 'Injury-Report_2026-04-08_05_30PM.pdf', report_date: '2026-04-08', token: '05_30PM', title_et: '2026-04-08 17:30', note: 'probe cache first_25_lines' },
];

function runControls() {
  return TITLE_CONTROLS.map((c) => {
    const inf = inferredFromToken(c.report_date, c.token);
    if (!inf) throw new Error(`unparseable control token ${c.token}`);
    const [td, tt] = c.title_et.split(' ');
    const [th, tm] = tt!.split(':').map(Number);
    const titleMs = etWallToMs(td!, th!, tm!);
    const plus30Delta = inf.naivePlus30Ms - titleMs;
    const validatedDelta = inf.controlValidatedMs - titleMs;
    return {
      file: c.file,
      token: c.token,
      family: inf.familyKind,
      title_et: c.title_et,
      inferred_plus30: iso(inf.naivePlus30Ms),
      inferred_control_validated: iso(inf.controlValidatedMs),
      plus30_minus_title_minutes: plus30Delta / 60_000,
      validated_minus_title_minutes: validatedDelta / 60_000,
      plus30_matches: plus30Delta === 0,
      validated_matches: validatedDelta === 0,
      note: c.note,
    };
  });
}

async function loadCandidates(): Promise<{ candidates: Candidate[]; existingCount: number; parseFailures: number }> {
  const stream = createReadStream(INVENTORY_NDJSON, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const candidates: Candidate[] = [];
  let existingCount = 0;
  let parseFailures = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as InventoryRow;
    if (row.http_status === 200 && row.exists === true) existingCount += 1;
    if (!(row.http_status === 200 && row.exists === true)) continue;
    const inf = inferredFromToken(row.report_date, row.requested_token);
    if (!inf) {
      parseFailures += 1;
      continue;
    }
    candidates.push({
      report_date: row.report_date,
      requested_token: row.requested_token,
      filename_family: row.filename_family,
      url: row.url,
      inferred_report_published_at: iso(inf.controlValidatedMs),
      inferred_ms: inf.controlValidatedMs,
      naive_plus30_at: iso(inf.naivePlus30Ms),
    });
  }
  candidates.sort((a, b) => a.inferred_ms - b.inferred_ms || a.report_date.localeCompare(b.report_date));
  return { candidates, existingCount, parseFailures };
}

function latestBefore(sorted: Candidate[], cutoffMs: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.inferred_ms < cutoffMs) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function countInWindow(sorted: Candidate[], startMs: number, cutoffMs: number): number {
  const hi = latestBefore(sorted, cutoffMs);
  if (hi < 0) return 0;
  let n = 0;
  for (let i = hi; i >= 0; i -= 1) {
    if (sorted[i]!.inferred_ms < startMs) break;
    n += 1;
  }
  return n;
}

type GameRow = {
  game_id: string;
  season: string;
  start_time: Date | string | null;
  status: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  home_abbr: string | null;
  away_abbr: string | null;
};

async function loadGames(): Promise<GameRow[]> {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL missing');
  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase.co') || url.includes('pooler.supabase.com') ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const res = await client.query<GameRow>(
      `SELECT g.game_id::text AS game_id,
              g.season,
              g.start_time,
              g.status,
              g.home_team_id::text AS home_team_id,
              g.away_team_id::text AS away_team_id,
              g.home_score,
              g.away_score,
              ht.abbreviation AS home_abbr,
              at.abbreviation AS away_abbr
         FROM analytics.games g
         JOIN analytics.teams ht ON ht.team_id = g.home_team_id
         JOIN analytics.teams at ON at.team_id = g.away_team_id
        WHERE g.season IN ('2023', '2024', '2025')`
    );
    await client.query('COMMIT');
    return res.rows;
  } finally {
    client.release();
    await pool.end();
  }
}

type GameCoverage = {
  game_id: string;
  season: string;
  season_type: 'regular' | 'playoffs';
  tip_at: string;
  et_game_date: string;
  cutoff_at: string;
  home_team_id: string;
  away_team_id: string;
  home_abbr: string;
  away_abbr: string;
  et_tip_hour: number;
  filename_regime: ReturnType<typeof filenameRegime>;
  selected_report_date: string | null;
  selected_token: string | null;
  selected_inferred_report_published_at: string | null;
  selected_family: FilenameFamily | null;
  snapshot_age_minutes: number | null;
  candidates_in_prior_48h: number;
  pre_cutoff_candidate_count: number;
  calendar_relation: 'same_et_date' | 'previous_et_date' | 'older' | 'none';
  bucket: Bucket;
};

function summarizeGroup(rows: GameCoverage[]) {
  const n = rows.length;
  const withCand = rows.filter((r) => r.bucket !== 'NO_PRE_CUTOFF_CANDIDATE');
  const fresh = rows.filter((r) => r.bucket !== 'NO_PRE_CUTOFF_CANDIDATE' && r.bucket !== 'STALE_GT_48H');
  const ages = fresh.map((r) => r.snapshot_age_minutes!).sort((a, b) => a - b);
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, rows.filter((r) => r.bucket === b).length]));
  const cum = (maxMin: number) => fresh.filter((r) => r.snapshot_age_minutes! <= maxMin).length;
  return {
    n,
    pre_cutoff_any: withCand.length,
    pre_cutoff_pct: n ? withCand.length / n : 0,
    fresh_le_48h: fresh.length,
    stale: rows.filter((r) => r.bucket === 'STALE_GT_48H').length,
    no_candidate: rows.filter((r) => r.bucket === 'NO_PRE_CUTOFF_CANDIDATE').length,
    buckets,
    cumulative_of_eligible: {
      le_15m: cum(15) / (n || 1),
      le_30m: cum(30) / (n || 1),
      le_60m: cum(60) / (n || 1),
      le_2h: cum(120) / (n || 1),
      le_6h: cum(360) / (n || 1),
      le_24h: cum(1440) / (n || 1),
      le_48h: fresh.length / (n || 1),
    },
    age_minutes_fresh: {
      median: median(ages),
      mean: mean(ages),
      p75: percentile(ages, 75),
      p90: percentile(ages, 90),
      p95: percentile(ages, 95),
      max: ages.length ? ages[ages.length - 1] : null,
    },
  };
}

function markdownReport(args: {
  finishedAt: string;
  controls: ReturnType<typeof runControls>;
  plus30Failed: boolean;
  inferenceRule: string;
  eligibility: string;
  inventoryExisting: number;
  parseFailures: number;
  exclusions: Record<string, number>;
  sanity: Record<string, unknown>;
  rows: GameCoverage[];
  f3Timing: string;
  recommendation: string;
}): string {
  const s = summarizeGroup(args.rows);
  const lines: string[] = [];
  lines.push('# Official NBA injury-report T−60 source-timing coverage (Phase 1B)');
  lines.push('');
  lines.push(`Generated: **${args.finishedAt}**`);
  lines.push('Method: read-only `analytics.games` + completed HEAD inventory. **No PDF bodies downloaded.**');
  lines.push('');
  lines.push('This measures **candidate report-path timing availability** only.');
  lines.push('It does **not** prove the game is in the PDF, that the team submitted, that a player appears, or that the title clock equals the inference.');
  lines.push('');
  lines.push('## Finding status');
  lines.push('');
  lines.push('| Question | Status | Note |');
  lines.push('| --- | --- | --- |');
  lines.push(`| F3 source-timing (candidate path before T−60) | **${args.f3Timing}** | Inventory path timing vs \`start_time - 60m\`, inferred publication |`);
  lines.push('| Actual as-of injury tape | **UNVERIFIED** | No download, title read, team submission, parse, or player resolve |');
  lines.push('');
  lines.push('## E. +30-minute inference control');
  lines.push('');
  lines.push('Observed titles come only from existing `tmp/injury-report-samples/characterization.json` first lines. Nothing new was downloaded.');
  lines.push('');
  lines.push('| File | Token | Title ET | Unified +30 | Control-validated | +30 Δ min | Validated Δ min | +30 match | Validated match |');
  lines.push('| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |');
  for (const c of args.controls) {
    lines.push(
      `| \`${c.file}\` | \`${c.token}\` | ${c.title_et} | ${c.inferred_plus30} | ${c.inferred_control_validated} | ${c.plus30_minus_title_minutes} | ${c.validated_minus_title_minutes} | ${c.plus30_matches ? 'yes' : 'NO'} | ${c.validated_matches ? 'yes' : 'NO'} |`
    );
  }
  lines.push('');
  if (args.plus30Failed) {
    lines.push(
      '**Unified +30 failed minute-family controls.** `05_30PM` titles are 5:30 PM, not 6:00 PM. Hourly tokens still match filename clock + 30 minutes (`11AM` → 11:30 AM).'
    );
    lines.push('');
    lines.push(`Season-wide T−60 analysis uses the **control-validated** rule, not unified +30: ${args.inferenceRule}`);
  } else {
    lines.push(`Unified +30 matched every control. Inference: ${args.inferenceRule}`);
  }
  lines.push('');
  lines.push('Field name: `inferred_report_published_at` (provisional). Not canonical `report_published_at`.');
  lines.push('');
  lines.push('## Eligibility predicate');
  lines.push('');
  lines.push(args.eligibility);
  lines.push('');
  lines.push(`Inventory HTTP-200 ` + `exists=true` + ` rows used: **${args.inventoryExisting}** (expected ${EXPECTED_EXISTING_PDFS}). Token parse failures: ${args.parseFailures}.`);
  lines.push('');
  lines.push('## N. Schedule sanity (read-only, no repairs)');
  lines.push('');
  for (const [k, v] of Object.entries(args.exclusions)) lines.push(`- ${k}: **${v}**`);
  lines.push('');
  for (const [k, v] of Object.entries(args.sanity)) {
    lines.push(`- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  lines.push('');
  lines.push('## Primary coverage');
  lines.push('');
  lines.push(`Eligible complete Final games: **${s.n}**`);
  lines.push(`Any pre-T−60 candidate path: **${s.pre_cutoff_any}** (${fmtPct(s.pre_cutoff_any, s.n)})`);
  lines.push(`No pre-cutoff candidate: **${s.no_candidate}**`);
  lines.push(`Stale >48h only: **${s.stale}**`);
  lines.push('');
  lines.push('Cumulative share of eligible games whose **latest** strictly-before-cutoff candidate is at most:');
  lines.push('');
  lines.push('| Threshold | Count | % of eligible |');
  lines.push('| --- | ---: | ---: |');
  const cumRows: Array<[string, number]> = [
    ['<=15 min', s.cumulative_of_eligible.le_15m],
    ['<=30 min', s.cumulative_of_eligible.le_30m],
    ['<=60 min', s.cumulative_of_eligible.le_60m],
    ['<=2 h', s.cumulative_of_eligible.le_2h],
    ['<=6 h', s.cumulative_of_eligible.le_6h],
    ['<=24 h', s.cumulative_of_eligible.le_24h],
    ['<=48 h', s.cumulative_of_eligible.le_48h],
  ];
  for (const [label, frac] of cumRows) {
    lines.push(`| ${label} | ${Math.round(frac * s.n)} | ${(frac * 100).toFixed(1)}% |`);
  }
  lines.push('');
  lines.push('Mutually exclusive buckets:');
  lines.push('');
  lines.push('| Bucket | Count | % |');
  lines.push('| --- | ---: | ---: |');
  for (const b of BUCKETS) {
    const n = (s.buckets as Record<string, number>)[b] ?? 0;
    lines.push(`| ${b} | ${n} | ${fmtPct(n, s.n)} |`);
  }
  lines.push('');
  lines.push('Snapshot age among **non-stale** (≤48h) selected candidates:');
  lines.push('');
  lines.push(`- median: **${fmtMin(s.age_minutes_fresh.median)}**`);
  lines.push(`- mean: **${fmtMin(s.age_minutes_fresh.mean)}**`);
  lines.push(`- p75: **${fmtMin(s.age_minutes_fresh.p75)}**`);
  lines.push(`- p90: **${fmtMin(s.age_minutes_fresh.p90)}**`);
  lines.push(`- p95: **${fmtMin(s.age_minutes_fresh.p95)}**`);
  lines.push(`- max: **${fmtMin(s.age_minutes_fresh.max)}**`);
  lines.push('');

  const bySeason = ['2023', '2024', '2025'].map((season) => ({
    season,
    ...summarizeGroup(args.rows.filter((r) => r.season === season)),
  }));
  lines.push('## By season');
  lines.push('');
  lines.push('| Season | Eligible | Pre-T−60 % | ≤15m % | ≤30m % | ≤60m % | ≤2h % | ≤48h % | Stale | None | Median age |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const x of bySeason) {
    lines.push(
      `| ${x.season} | ${x.n} | ${fmtPct(x.pre_cutoff_any, x.n)} | ${(x.cumulative_of_eligible.le_15m * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_30m * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_60m * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_2h * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_48h * 100).toFixed(1)}% | ${x.stale} | ${x.no_candidate} | ${fmtMin(x.age_minutes_fresh.median)} |`
    );
  }
  lines.push('');

  const regimes: Array<GameCoverage['filename_regime']> = ['legacy_hourly', 'transition_2025_12_22', 'minute_family'];
  lines.push('## By filename regime (game ET date)');
  lines.push('');
  lines.push('| Regime | Eligible | Pre-T−60 % | ≤15m % | ≤30m % | ≤60m % | Median age | None |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |');
  for (const regime of regimes) {
    const x = summarizeGroup(args.rows.filter((r) => r.filename_regime === regime));
    lines.push(
      `| ${regime} | ${x.n} | ${fmtPct(x.pre_cutoff_any, x.n)} | ${(x.cumulative_of_eligible.le_15m * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_30m * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_60m * 100).toFixed(1)}% | ${fmtMin(x.age_minutes_fresh.median)} | ${x.no_candidate} |`
    );
  }
  lines.push('');
  const legacy = summarizeGroup(args.rows.filter((r) => r.filename_regime === 'legacy_hourly'));
  const minute = summarizeGroup(args.rows.filter((r) => r.filename_regime === 'minute_family'));
  lines.push(
    `Minute-family vs legacy hourly median fresh age: **${fmtMin(minute.age_minutes_fresh.median)}** vs **${fmtMin(legacy.age_minutes_fresh.median)}**. ≤15m: ${(minute.cumulative_of_eligible.le_15m * 100).toFixed(1)}% vs ${(legacy.cumulative_of_eligible.le_15m * 100).toFixed(1)}%.`
  );
  lines.push('');

  const bands = ['before_18_et', '18_to_19_et', '20_to_21_et', '22_plus_et'];
  lines.push('## By ET tip hour (not a West Coast team classifier)');
  lines.push('');
  lines.push('| Tip band | Eligible | Pre-T−60 % | ≤15m % | ≤30m % | ≤60m % | Median age | None |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |');
  for (const band of bands) {
    const x = summarizeGroup(args.rows.filter((r) => tipBand(r.et_tip_hour) === band));
    lines.push(
      `| ${band} | ${x.n} | ${fmtPct(x.pre_cutoff_any, x.n)} | ${(x.cumulative_of_eligible.le_15m * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_30m * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_60m * 100).toFixed(1)}% | ${fmtMin(x.age_minutes_fresh.median)} | ${x.no_candidate} |`
    );
  }
  lines.push('');
  const early = args.rows.filter((r) => r.et_tip_hour < 18);
  const late = args.rows.filter((r) => r.et_tip_hour >= 22);
  lines.push(
    `Early tips (<18:00 ET) none/stale: ${summarizeGroup(early).no_candidate}/${summarizeGroup(early).stale} of ${early.length}. Late tips (≥22:00 ET) ≤15m: ${(summarizeGroup(late).cumulative_of_eligible.le_15m * 100).toFixed(1)}% of ${late.length}.`
  );
  lines.push('');

  lines.push('## Regular vs postseason');
  lines.push('');
  lines.push('Postseason uses existing `isPostseasonGame` / `WOWY_POSTSEASON_START_ET` (play-in inclusive).');
  lines.push('');
  lines.push('| Type | Eligible | Pre-T−60 % | ≤15m % | ≤30m % | Median age | None |');
  lines.push('| --- | ---: | ---: | ---: | ---: | --- | ---: |');
  for (const typ of ['regular', 'playoffs'] as const) {
    const x = summarizeGroup(args.rows.filter((r) => r.season_type === typ));
    lines.push(
      `| ${typ} | ${x.n} | ${fmtPct(x.pre_cutoff_any, x.n)} | ${(x.cumulative_of_eligible.le_15m * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_30m * 100).toFixed(1)}% | ${fmtMin(x.age_minutes_fresh.median)} | ${x.no_candidate} |`
    );
  }
  lines.push('');

  const familyCounts: Record<string, number> = {};
  for (const r of args.rows) {
    const k = r.selected_family ?? 'none';
    familyCounts[k] = (familyCounts[k] ?? 0) + 1;
  }
  lines.push('## Selected snapshot family');
  lines.push('');
  for (const [k, n] of Object.entries(familyCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`- \`${k}\`: ${n} (${fmtPct(n, s.n)})`);
  }
  lines.push('');

  const rel = {
    same_et_date: args.rows.filter((r) => r.calendar_relation === 'same_et_date').length,
    previous_et_date: args.rows.filter((r) => r.calendar_relation === 'previous_et_date').length,
    older: args.rows.filter((r) => r.calendar_relation === 'older').length,
    none: args.rows.filter((r) => r.calendar_relation === 'none').length,
  };
  lines.push('## Same-day vs previous-day selected path');
  lines.push('');
  lines.push(`- same ET date: **${rel.same_et_date}** (${fmtPct(rel.same_et_date, s.n)})`);
  lines.push(`- previous ET date: **${rel.previous_et_date}** (${fmtPct(rel.previous_et_date, s.n)})`);
  lines.push(`- older: **${rel.older}** (${fmtPct(rel.older, s.n)})`);
  lines.push(`- none: **${rel.none}**`);
  lines.push('');
  const prev = args.rows.filter((r) => r.calendar_relation === 'previous_et_date');
  const prevSum = summarizeGroup(prev);
  lines.push(
    `Previous-ET-date selections: n=${prev.length}, median age ${fmtMin(prevSum.age_minutes_fresh.median)}, none ${prevSum.no_candidate}.`
  );
  const earlyNone = early.filter((r) => r.bucket === 'NO_PRE_CUTOFF_CANDIDATE' || r.bucket === 'STALE_GT_48H');
  lines.push(`Early-tip (<18:00 ET) games with no fresh ≤48h candidate: **${earlyNone.length}**.`);
  lines.push('');

  const homeRows = new Map<string, GameCoverage[]>();
  for (const r of args.rows) {
    const list = homeRows.get(r.home_abbr) ?? [];
    list.push(r);
    homeRows.set(r.home_abbr, list);
  }
  lines.push('## By home team (schedule/time pattern, not geography)');
  lines.push('');
  lines.push('| Home | Eligible | ≤15m % | ≤60m % | Median age | None |');
  lines.push('| --- | ---: | ---: | ---: | --- | ---: |');
  const homeSorted = [...homeRows.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [abbr, list] of homeSorted) {
    const x = summarizeGroup(list);
    lines.push(
      `| ${abbr} | ${x.n} | ${(x.cumulative_of_eligible.le_15m * 100).toFixed(1)}% | ${(x.cumulative_of_eligible.le_60m * 100).toFixed(1)}% | ${fmtMin(x.age_minutes_fresh.median)} | ${x.no_candidate} |`
    );
  }
  lines.push('');

  lines.push('## Phase 2 gate');
  lines.push('');
  lines.push(`**${args.recommendation}**`);
  lines.push('');
  lines.push('Phase 2 (raw PDF archive) was **not** started.');
  lines.push('');
  lines.push('## Verification');
  lines.push('');
  lines.push('1. No NBA PDF GET / body download in this slice.');
  lines.push('2. Postgres `BEGIN READ ONLY`.');
  lines.push('3. No S3 write, schema, migration, parser, identity, `/wowy`, model, or BDL change.');
  lines.push(`4. Inventory source is the complete 1A+1A.2 ndjson (${args.inventoryExisting} existing PDFs).`);
  lines.push('5. Candidate rule is strictly `inferred_report_published_at < cutoff_at`.');
  lines.push('6. 48h freshness classified; stale recorded separately.');
  lines.push('7. `America/New_York` via `etCalendarDate` + DST-aware wall-clock conversion.');
  lines.push('8. PDF title clocks remain unverified outside the listed controls.');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const startedAt = new Date().toISOString();
  const controls = runControls();
  const plus30Failed = controls.some((c) => !c.plus30_matches);
  const validatedFailed = controls.some((c) => !c.validated_matches);
  if (validatedFailed) {
    const payload = {
      probe: 'official-injury-report-t60-source-coverage',
      phase: '1B',
      stopped: true,
      reason: 'control-validated inference failed a known PDF title',
      controls,
      f3_source_timing: 'BLOCKED',
      as_of_tape: 'UNVERIFIED',
      recommendation: 'STOP_AND_INVESTIGATE',
      started_at: startedAt,
    };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, 'official-injury-report-t60-source-coverage.json'), JSON.stringify(payload, null, 2) + '\n');
    writeFileSync(
      path.join(OUT_DIR, 'official-injury-report-t60-source-coverage.md'),
      `# T−60 coverage BLOCKED\n\nControl-validated inference missed a known title. Season-wide analysis was not run.\n\n${JSON.stringify(controls, null, 2)}\n`
    );
    console.log(JSON.stringify({ blocked: true, controls }, null, 2));
    return;
  }

  const inferenceRule =
    'Hourly filename (no underscore): America/New_York clock from token + 30 minutes. Minute-family HH_MM token: America/New_York clock as written (no extra +30). DST via timezone conversion, not a fixed UTC offset.';

  console.error('loading inventory ndjson…');
  const { candidates, existingCount, parseFailures } = await loadCandidates();
  if (existingCount !== EXPECTED_EXISTING_PDFS) {
    console.error(`warning: existing PDF count ${existingCount} != ${EXPECTED_EXISTING_PDFS}`);
  }

  console.error(`candidates=${candidates.length}; querying analytics.games READ ONLY…`);
  const rawGames = await loadGames();

  const exclusions = {
    season_rows: rawGames.length,
    not_final: rawGames.filter((g) => g.status !== 'Final').length,
    final_null_start_time: rawGames.filter((g) => g.status === 'Final' && !g.start_time).length,
    final_null_home_or_away: rawGames.filter((g) => g.status === 'Final' && (!g.home_team_id || !g.away_team_id)).length,
    final_null_score: rawGames.filter(
      (g) => g.status === 'Final' && g.start_time && g.home_team_id && g.away_team_id && (g.home_score == null || g.away_score == null)
    ).length,
  };

  const eligibleRaw = rawGames.filter(
    (g) =>
      g.status === 'Final' &&
      g.start_time != null &&
      Number.isFinite(Date.parse(String(g.start_time))) &&
      g.home_team_id &&
      g.away_team_id &&
      g.home_score != null &&
      g.away_score != null
  );

  const coverage: GameCoverage[] = [];
  const unusualTips: Array<{ game_id: string; et_hour: number; tip_at: string }> = [];
  const pairDate = new Map<string, string[]>();
  const teamDate = new Map<string, string[]>();

  for (const g of eligibleRaw) {
    const tipMs = new Date(g.start_time as string | Date).getTime();
    const tipIso = iso(tipMs);
    const etDate = etCalendarDate(tipIso);
    if (!etDate) continue;
    const cutoffMs = tipMs - CUTOFF_MINUTES * 60_000;
    const et = etParts(tipMs);
    if (et.hour < 10 || et.hour > 23) unusualTips.push({ game_id: g.game_id, et_hour: et.hour, tip_at: tipIso });
    const pk = `${g.home_team_id}|${g.away_team_id}|${etDate}`;
    pairDate.set(pk, [...(pairDate.get(pk) ?? []), g.game_id]);
    teamDate.set(`${g.home_team_id}|${etDate}`, [...(teamDate.get(`${g.home_team_id}|${etDate}`) ?? []), g.game_id]);
    teamDate.set(`${g.away_team_id}|${etDate}`, [...(teamDate.get(`${g.away_team_id}|${etDate}`) ?? []), g.game_id]);

    const idx = latestBefore(candidates, cutoffMs);
    const selected = idx >= 0 ? candidates[idx]! : null;
    const ageMin = selected ? (cutoffMs - selected.inferred_ms) / 60_000 : null;
    const windowStart = cutoffMs - FRESH_HOURS * 3600_000;
    const in48 = selected ? countInWindow(candidates, windowStart, cutoffMs) : 0;
    let relation: GameCoverage['calendar_relation'] = 'none';
    if (selected) {
      if (selected.report_date === etDate) relation = 'same_et_date';
      else {
        const prevDate = etParts(etWallToMs(etDate, 12, 0) - 24 * 3600_000).date;
        relation = selected.report_date === prevDate ? 'previous_et_date' : 'older';
      }
    }
    const bucket = classifyAge(ageMin);
    coverage.push({
      game_id: g.game_id,
      season: g.season,
      season_type: isPostseasonGame(g.season, tipIso) ? 'playoffs' : 'regular',
      tip_at: tipIso,
      et_game_date: etDate,
      cutoff_at: iso(cutoffMs),
      home_team_id: g.home_team_id!,
      away_team_id: g.away_team_id!,
      home_abbr: g.home_abbr ?? '?',
      away_abbr: g.away_abbr ?? '?',
      et_tip_hour: et.hour,
      filename_regime: filenameRegime(etDate),
      selected_report_date: selected?.report_date ?? null,
      selected_token: selected?.requested_token ?? null,
      selected_inferred_report_published_at: selected?.inferred_report_published_at ?? null,
      selected_family: selected?.filename_family ?? null,
      snapshot_age_minutes: ageMin,
      candidates_in_prior_48h: in48,
      pre_cutoff_candidate_count: idx >= 0 ? idx + 1 : 0,
      calendar_relation: relation,
      bucket,
    });
  }

  const dupPairs = [...pairDate.entries()].filter(([, ids]) => ids.length > 1);
  const dupTeams = [...teamDate.entries()].filter(([, ids]) => new Set(ids).size > 1);
  const sanity = {
    unusual_et_tip_hour_lt10_or_gt23: unusualTips.slice(0, 20),
    unusual_tip_count: unusualTips.length,
    duplicate_home_away_et_date_finals: dupPairs.slice(0, 20).map(([k, ids]) => ({ key: k, ids })),
    duplicate_pair_count: dupPairs.length,
    same_team_same_et_date_final_collisions: dupTeams.length,
    collision_examples: dupTeams.slice(0, 15).map(([k, ids]) => ({ key: k, ids: [...new Set(ids)] })),
  };

  const summary = summarizeGroup(coverage);
  const scheduleOk = dupPairs.length === 0 && unusualTips.length < summary.n * 0.02;
  const coverageBroad = summary.cumulative_of_eligible.le_48h >= 0.95 && summary.no_candidate / (summary.n || 1) <= 0.03;
  const recommendation = scheduleOk && coverageBroad && !validatedFailed ? 'PROCEED_TO_RAW_ARCHIVE' : 'STOP_AND_INVESTIGATE';
  const f3Timing =
    summary.no_candidate === 0 && summary.cumulative_of_eligible.le_48h >= 0.98
      ? 'CLOSED'
      : summary.cumulative_of_eligible.le_48h >= 0.9
        ? 'PARTIAL'
        : 'BLOCKED';

  const finishedAt = new Date().toISOString();
  const eligibility =
    "`analytics.games` seasons 2023/2024/2025; `status = 'Final'`; non-null `start_time` parseable; non-null `home_team_id` and `away_team_id`; non-null `home_score` and `away_score`. Matches WOWY `isCompleteFinalGame` in `lib/wowy/eligibility.ts` plus the team-id presence required by this slice. Basketball date = `etCalendarDate(start_time)` from `lib/wowy/calendar.ts`. Postseason = `isPostseasonGame` / `WOWY_POSTSEASON_START_ET`.";

  const payload = {
    probe: 'official-injury-report-t60-source-coverage',
    phase: '1B',
    method: 'read_only_games_plus_head_inventory',
    downloaded_pdf_bodies: false,
    postgres: 'BEGIN READ ONLY',
    started_at: startedAt,
    finished_at: finishedAt,
    inference_rule: inferenceRule,
    unified_plus30_failed_controls: plus30Failed,
    controls,
    eligibility_predicate: eligibility,
    inventory_existing_pdfs: existingCount,
    token_parse_failures: parseFailures,
    exclusions,
    sanity,
    aggregates: summary,
    by_season: Object.fromEntries(['2023', '2024', '2025'].map((season) => [season, summarizeGroup(coverage.filter((r) => r.season === season))])),
    by_regime: Object.fromEntries(
      (['legacy_hourly', 'transition_2025_12_22', 'minute_family'] as const).map((r) => [
        r,
        summarizeGroup(coverage.filter((x) => x.filename_regime === r)),
      ])
    ),
    by_tip_band: Object.fromEntries(
      ['before_18_et', '18_to_19_et', '20_to_21_et', '22_plus_et'].map((b) => [
        b,
        summarizeGroup(coverage.filter((x) => tipBand(x.et_tip_hour) === b)),
      ])
    ),
    by_season_type: {
      regular: summarizeGroup(coverage.filter((r) => r.season_type === 'regular')),
      playoffs: summarizeGroup(coverage.filter((r) => r.season_type === 'playoffs')),
    },
    f3_source_timing: f3Timing,
    as_of_injury_tape: 'UNVERIFIED',
    recommendation,
    records_ndjson: 'reports/operations/official-injury-report-t60-source-coverage.records.ndjson',
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, 'official-injury-report-t60-source-coverage.json');
  const mdPath = path.join(OUT_DIR, 'official-injury-report-t60-source-coverage.md');
  const ndjsonPath = path.join(OUT_DIR, 'official-injury-report-t60-source-coverage.records.ndjson');
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  writeFileSync(
    mdPath,
    markdownReport({
      finishedAt,
      controls,
      plus30Failed,
      inferenceRule,
      eligibility,
      inventoryExisting: existingCount,
      parseFailures,
      exclusions,
      sanity,
      rows: coverage,
      f3Timing,
      recommendation,
    }),
    'utf8'
  );
  writeFileSync(ndjsonPath, coverage.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  console.error(`wrote ${jsonPath}`);
  console.error(`wrote ${mdPath}`);
  console.error(`wrote ${ndjsonPath}`);
  console.log(
    JSON.stringify(
      {
        eligible: summary.n,
        pre_t60_pct: summary.pre_cutoff_pct,
        le_15m: summary.cumulative_of_eligible.le_15m,
        le_30m: summary.cumulative_of_eligible.le_30m,
        le_60m: summary.cumulative_of_eligible.le_60m,
        le_2h: summary.cumulative_of_eligible.le_2h,
        stale: summary.stale,
        none: summary.no_candidate,
        median_age_min: summary.age_minutes_fresh.median,
        plus30_failed: plus30Failed,
        f3_source_timing: f3Timing,
        as_of_tape: 'UNVERIFIED',
        recommendation,
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
