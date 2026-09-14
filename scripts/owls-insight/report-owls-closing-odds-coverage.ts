/**
 * Build closing-odds coverage report from checkpoints + raw S3.
 * Never calls Owls. Does not rewrite archive objects.
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { FileCheckpointStore, type CheckpointState } from '@/lib/providers/owls-insight/checkpoint';
import { extractRows } from '@/lib/providers/owls-insight/client';
import { asRecord, pickNumber } from '@/lib/providers/owls-insight/normalize';
import { verifyEnvelopeChecksum } from '@/lib/providers/owls-insight/archive';
import {
  flagClosingOddsBookRow,
  flagDuplicateBookSource,
  isValidAmericanPrice,
  type ClosingOddsQualityFlag,
} from '@/lib/providers/owls-insight/closing-odds';
import { loadCourtContextGames, classifyGamePhase } from '@/lib/providers/owls-insight/universe';
import { reconcileOwlsClosingOddsBackfill } from '@/lib/providers/owls-insight/reconcile';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import type {
  CourtContextGame,
  OwlsAcquisitionState,
  OwlsArchiveEnvelope,
  OwlsGameAcquisition,
} from '@/lib/providers/owls-insight/types';

const BUCKET = process.env.NBA_DATA_BUCKET?.trim() || 'nba-analytics-data-260029269390';
const RUN_IDS = [
  'owls-2026-09-14-closing-2023',
  'owls-2026-09-14-closing-2024',
  'owls-2026-09-14-closing-2025',
];

type SeasonAgg = {
  season: string;
  gamesTotal: number;
  gamesMapped: number;
  populated: number;
  emptyProviderHistory: number;
  mappingFailed: number;
  requestFailed: number;
  archiveFailed: number;
  coveragePct: number;
  rows: number;
  books: Record<string, number>;
  sources: Record<string, number>;
  gamesWithMoneyline: number;
  gamesWithSpread: number;
  gamesWithTotal: number;
  gamesCompleteTwoSidedMl: number;
  gamesCompleteTwoSidedSpread: number;
  gamesCompleteTwoSidedTotal: number;
  suppressedFields: number;
  rowsExcluded: number;
  qualityFlags: Record<string, number>;
  byPhase: Record<string, { games: number; populated: number; empty: number; rows: number }>;
  byMonth: Record<string, { games: number; populated: number; empty: number; rows: number }>;
  requests: number;
  status429: number;
  status503: number;
  elapsedMs: number | null;
  s3Objects: number;
  checksumVerifiedPages: number;
  checksumFailedPages: number;
  lastRemainingMonth: string | null;
};

function emptySeason(season: string): SeasonAgg {
  return {
    season,
    gamesTotal: 0,
    gamesMapped: 0,
    populated: 0,
    emptyProviderHistory: 0,
    mappingFailed: 0,
    requestFailed: 0,
    archiveFailed: 0,
    coveragePct: 0,
    rows: 0,
    books: {},
    sources: {},
    gamesWithMoneyline: 0,
    gamesWithSpread: 0,
    gamesWithTotal: 0,
    gamesCompleteTwoSidedMl: 0,
    gamesCompleteTwoSidedSpread: 0,
    gamesCompleteTwoSidedTotal: 0,
    suppressedFields: 0,
    rowsExcluded: 0,
    qualityFlags: {},
    byPhase: {},
    byMonth: {},
    requests: 0,
    status429: 0,
    status503: 0,
    elapsedMs: null,
    s3Objects: 0,
    checksumVerifiedPages: 0,
    checksumFailedPages: 0,
    lastRemainingMonth: null,
  };
}

function deriveAcquisition(args: {
  gameId: string;
  recorded?: OwlsGameAcquisition;
  state: CheckpointState;
}): OwlsAcquisitionState {
  if (args.recorded) return args.recorded.state;
  const units = Object.values(args.state.units).filter((u) => u.court_context_game_id === args.gameId);
  if (units.some((u) => u.status === 'FAILED')) {
    return units.some((u) => (u.error ?? '').toLowerCase().includes('archive'))
      ? 'ARCHIVE_FAILED'
      : 'REQUEST_FAILED';
  }
  const odds = units.filter((u) => u.endpoint === 'history_closing_odds');
  if (odds.length === 0) return 'GAME_MAPPING_FAILED';
  const rows = odds.reduce((n, u) => n + (u.row_count ?? 0), 0);
  return rows > 0 ? 'POPULATED' : 'EMPTY_PROVIDER_HISTORY';
}

async function loadGames(): Promise<CourtContextGame[]> {
  const db = await import('@/lib/db');
  const games = await loadCourtContextGames(db.query, ['2023', '2024', '2025']);
  await db.default.end().catch(() => undefined);
  return games;
}

async function listPrefixBytes(
  s3: S3Client,
  prefixes: string[]
): Promise<{ objects: number; compressedBytes: number }> {
  let objects = 0;
  let compressedBytes = 0;
  for (const prefix of prefixes) {
    let token: string | undefined;
    do {
      const out = await s3.send(
        new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token })
      );
      for (const obj of out.Contents ?? []) {
        objects += 1;
        compressedBytes += obj.Size ?? 0;
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
  }
  return { objects, compressedBytes };
}

function marketCompleteness(rows: Record<string, unknown>[]) {
  let ml = false;
  let spread = false;
  let total = false;
  let twoMl = true;
  let twoSpread = true;
  let twoTotal = true;
  let anyMl = false;
  let anySpread = false;
  let anyTotal = false;
  for (const rec of rows) {
    const moneyline = asRecord(rec.moneyline);
    const sp = asRecord(rec.spread);
    const tot = asRecord(rec.total);
    if (moneyline) {
      anyMl = true;
      const home = pickNumber(moneyline, ['home']);
      const away = pickNumber(moneyline, ['away']);
      if (home != null && away != null && isValidAmericanPrice(home) && isValidAmericanPrice(away)) ml = true;
      else twoMl = false;
    }
    if (sp) {
      anySpread = true;
      const homeLine = pickNumber(sp, ['home']);
      const awayLine = pickNumber(sp, ['away']);
      const homePrice = pickNumber(sp, ['homePrice']);
      const awayPrice = pickNumber(sp, ['awayPrice']);
      if (
        homeLine != null &&
        awayLine != null &&
        homePrice != null &&
        awayPrice != null &&
        isValidAmericanPrice(homePrice) &&
        isValidAmericanPrice(awayPrice)
      ) {
        spread = true;
      } else twoSpread = false;
    }
    if (tot) {
      anyTotal = true;
      const line = pickNumber(tot, ['line']);
      const over = pickNumber(tot, ['overPrice']);
      const under = pickNumber(tot, ['underPrice']);
      if (line != null && over != null && under != null && isValidAmericanPrice(over) && isValidAmericanPrice(under)) {
        total = true;
      } else twoTotal = false;
    }
  }
  return {
    moneyline: anyMl,
    spread: anySpread,
    total: anyTotal,
    completeMl: ml && twoMl,
    completeSpread: spread && twoSpread,
    completeTotal: total && twoTotal,
  };
}

export async function buildClosingOddsCoverageReport(runIds = RUN_IDS) {
  const checkpoints = new FileCheckpointStore('data/owls-insight/runs');
  const store = new OwlsS3Store(BUCKET);
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const games = await loadGames();
  const gamesBySeason = new Map<string, CourtContextGame[]>();
  for (const g of games) {
    const list = gamesBySeason.get(g.season) ?? [];
    list.push(g);
    gamesBySeason.set(g.season, list);
  }

  const envCache = new Map<string, { env: OwlsArchiveEnvelope; bytes: number }>();
  async function getEnv(key: string) {
    const hit = envCache.get(key);
    if (hit) return hit;
    const obj = await store.get(key);
    if (!obj) throw new Error(`missing archive object ${key}`);
    const env = JSON.parse(gunzipSync(obj.body).toString('utf8')) as OwlsArchiveEnvelope;
    const packed = { env, bytes: obj.body.length };
    envCache.set(key, packed);
    return packed;
  }

  const seasonReports: Record<string, SeasonAgg> = {};
  const integrity: Record<string, Awaited<ReturnType<typeof reconcileOwlsClosingOddsBackfill>>> = {};
  const remainingHeaders: string[] = [];

  for (const runId of runIds) {
    const state = await checkpoints.load(runId);
    if (!state) throw new Error(`checkpoint missing for ${runId}`);
    const season = state.run.target_seasons[0] ?? runId;
    const universe = gamesBySeason.get(season) ?? [];
    const recon = await reconcileOwlsClosingOddsBackfill({
      runId,
      state,
      store,
      universeGameIds: universe.map((g) => g.courtContextGameId),
    });
    integrity[runId] = recon;
    const agg = (seasonReports[season] ??= emptySeason(season));
    agg.gamesTotal = universe.length;
    agg.requests += state.run.requests_successful;
    agg.status429 += state.run.status_429;
    agg.status503 += state.run.status_503;
    if (state.run.started_at && state.run.completed_at) {
      agg.elapsedMs =
        (agg.elapsedMs ?? 0) + (Date.parse(state.run.completed_at) - Date.parse(state.run.started_at));
    }
    agg.s3Objects += recon.expected_objects;

    for (const game of universe) {
      const recorded = state.game_acquisition?.[game.courtContextGameId];
      const acq = deriveAcquisition({ gameId: game.courtContextGameId, recorded, state });
      const phase = game.phase ?? classifyGamePhase(game.season, game.startTime);
      const month = game.startTime.slice(0, 7);
      const phaseSlot = (agg.byPhase[phase] ??= { games: 0, populated: 0, empty: 0, rows: 0 });
      const monthSlot = (agg.byMonth[month] ??= { games: 0, populated: 0, empty: 0, rows: 0 });
      phaseSlot.games += 1;
      monthSlot.games += 1;
      if (recorded?.event_id) agg.gamesMapped += 1;

      if (acq === 'POPULATED') {
        agg.populated += 1;
        phaseSlot.populated += 1;
        monthSlot.populated += 1;
      } else if (acq === 'EMPTY_PROVIDER_HISTORY') {
        agg.emptyProviderHistory += 1;
        phaseSlot.empty += 1;
        monthSlot.empty += 1;
      } else if (acq === 'GAME_MAPPING_FAILED') agg.mappingFailed += 1;
      else if (acq === 'REQUEST_FAILED') agg.requestFailed += 1;
      else agg.archiveFailed += 1;

      if (acq !== 'POPULATED') continue;

      const units = Object.values(state.units).filter(
        (u) =>
          u.court_context_game_id === game.courtContextGameId &&
          u.endpoint === 'history_closing_odds' &&
          u.archive_key
      );
      const gameRows: Record<string, unknown>[] = [];
      for (const unit of units) {
        const { env } = await getEnv(unit.archive_key!);
        if (verifyEnvelopeChecksum(env) && (!unit.checksum || unit.checksum === env.checksum)) {
          agg.checksumVerifiedPages += 1;
        } else {
          agg.checksumFailedPages += 1;
        }
        const remaining = env.response_metadata?.headers?.['x-ratelimit-remaining-month'];
        if (remaining) {
          remainingHeaders.push(remaining);
          agg.lastRemainingMonth = remaining;
        }
        const nested = asRecord(asRecord(env.payload)?.data);
        const dq = asRecord(nested?.dataQuality);
        if (typeof dq?.suppressedFields === 'number') agg.suppressedFields += dq.suppressedFields;
        if (typeof dq?.rowsExcluded === 'number') agg.rowsExcluded += dq.rowsExcluded;
        for (const raw of extractRows(env.payload)) {
          const rec = asRecord(raw);
          if (!rec) continue;
          gameRows.push(rec);
          agg.rows += 1;
          const book = String(rec.book ?? '');
          const source = String(rec.source ?? '');
          agg.books[book] = (agg.books[book] ?? 0) + 1;
          agg.sources[source] = (agg.sources[source] ?? 0) + 1;
          for (const flag of flagClosingOddsBookRow(rec)) {
            agg.qualityFlags[flag] = (agg.qualityFlags[flag] ?? 0) + 1;
          }
        }
        const dupes = flagDuplicateBookSource(gameRows);
        if (dupes) agg.qualityFlags.DUPLICATE_BOOK_SOURCE = (agg.qualityFlags.DUPLICATE_BOOK_SOURCE ?? 0) + dupes;
      }
      const complete = marketCompleteness(gameRows);
      if (complete.moneyline) agg.gamesWithMoneyline += 1;
      if (complete.spread) agg.gamesWithSpread += 1;
      if (complete.total) agg.gamesWithTotal += 1;
      if (complete.completeMl) agg.gamesCompleteTwoSidedMl += 1;
      if (complete.completeSpread) agg.gamesCompleteTwoSidedSpread += 1;
      if (complete.completeTotal) agg.gamesCompleteTwoSidedTotal += 1;
      phaseSlot.rows += gameRows.length;
      monthSlot.rows += gameRows.length;
    }
    agg.coveragePct = agg.gamesTotal ? agg.populated / agg.gamesTotal : 0;
  }

  const prefixes = ['2023', '2024', '2025'].map(
    (season) => `raw/source=owls_insight/league=nba/season=${season}/entity=historical_closing_odds/`
  );
  const storage = await listPrefixBytes(s3, prefixes);
  const storageBySeason: Record<string, { objects: number; compressedBytes: number }> = {};
  for (const season of ['2023', '2024', '2025']) {
    storageBySeason[season] = await listPrefixBytes(s3, [
      `raw/source=owls_insight/league=nba/season=${season}/entity=historical_closing_odds/`,
    ]);
  }

  const json = {
    generatedAt: new Date().toISOString(),
    missingness:
      'EMPTY_PROVIDER_HISTORY means Owls returned HTTP 200 with no retained closing-odds rows. It is not proof that a sportsbook offered no market.',
    terminology: {
      product: 'OWLS HISTORICAL CLOSING ODDS',
      consensusBook: 'OWLS_PROVIDER_CONSENSUS',
      sources: 'archive-1 and archive-2 are stored verbatim and are not mapped to yahoo/oddsshark/espn/live-derived',
      closeTimestamp: 'unavailable; gameDate is midnight UTC',
    },
    seasons: seasonReports,
    archiveIntegrity: {
      expectedUnits: Object.values(integrity).reduce((n, r) => n + r.expected_objects, 0),
      actualUnits: Object.values(integrity).reduce((n, r) => n + r.actual_objects, 0),
      missing: Object.values(integrity).flatMap((r) => r.missing),
      checksumMismatch: Object.values(integrity).flatMap((r) => r.checksum_mismatch),
      incompleteGames: Object.values(integrity).flatMap((r) => r.incomplete_games),
      failedPages: Object.values(integrity).flatMap((r) => r.failed_pages),
      ok: Object.values(integrity).every((r) => r.ok),
      byRun: integrity,
    },
    apiUsage: {
      requests: Object.values(seasonReports).reduce((n, s) => n + s.requests, 0),
      status429: Object.values(seasonReports).reduce((n, s) => n + s.status429, 0),
      status503: Object.values(seasonReports).reduce((n, s) => n + s.status503, 0),
      lastRemainingMonth: remainingHeaders.at(-1) ?? null,
      elapsedMs: Object.values(seasonReports).reduce((n, s) => n + (s.elapsedMs ?? 0), 0),
    },
    storage: { total: storage, bySeason: storageBySeason },
  };
  return { json, md: renderMarkdown(json) };
}

function pct(n: number, d: number): string {
  if (!d) return 'n/a';
  return `${((100 * n) / d).toFixed(1)}%`;
}

function renderMarkdown(json: Awaited<ReturnType<typeof buildClosingOddsCoverageReport>>['json']): string {
  const seasons = json.seasons;
  const lines: string[] = [];
  lines.push('# Owls `/history/closing-odds` full coverage');
  lines.push('');
  lines.push(`Generated: ${json.generatedAt}`);
  lines.push('');
  lines.push(json.missingness);
  lines.push('');
  lines.push('These rows are **OWLS HISTORICAL CLOSING ODDS**. They are not an exact pre-tip snapshot, last quote before tip, or a Court Context reconstructed close. `book=consensus` is **OWLS_PROVIDER_CONSENSUS** only.');
  lines.push('');
  for (const key of ['2023', '2024', '2025']) {
    const s = seasons[key];
    if (!s) continue;
    const label = key === '2023' ? '2023–24' : key === '2024' ? '2024–25' : '2025–26';
    lines.push(`# ${label}`);
    lines.push('');
    lines.push(`- Games total (Court Context Final): **${s.gamesTotal}**`);
    lines.push(`- Games mapped to Owls eventId: **${s.gamesMapped}**`);
    lines.push(`- POPULATED: **${s.populated}** (${pct(s.populated, s.gamesTotal)})`);
    lines.push(`- EMPTY_PROVIDER_HISTORY: **${s.emptyProviderHistory}**`);
    lines.push(`- GAME_MAPPING_FAILED: **${s.mappingFailed}**`);
    lines.push(`- REQUEST_FAILED: **${s.requestFailed}**`);
    lines.push(`- ARCHIVE_FAILED: **${s.archiveFailed}**`);
    lines.push(`- Rows: **${s.rows}**`);
    lines.push(`- Books: ${Object.keys(s.books).sort().join(', ') || '(none)'}`);
    lines.push(`- Sources: ${Object.keys(s.sources).sort().join(', ') || '(none)'}`);
    lines.push('');
  }
  lines.push('# Coverage by Game Type');
  lines.push('');
  lines.push('| Season | phase | games | populated | empty | rows | coverage |');
  lines.push('|---|---|---:|---:|---:|---:|---:|');
  for (const s of Object.values(seasons)) {
    for (const phase of ['regular', 'play_in', 'playoff']) {
      const slot = s.byPhase[phase] ?? { games: 0, populated: 0, empty: 0, rows: 0 };
      lines.push(
        `| ${s.season} | ${phase} | ${slot.games} | ${slot.populated} | ${slot.empty} | ${slot.rows} | ${pct(slot.populated, slot.games)} |`
      );
    }
  }
  lines.push('');
  lines.push('# Coverage by Month');
  lines.push('');
  for (const s of Object.values(seasons)) {
    lines.push(`## Season ${s.season}`);
    lines.push('');
    lines.push('| Month | games | populated | EMPTY_PROVIDER_HISTORY | rows | coverage |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    for (const [month, slot] of Object.entries(s.byMonth).sort()) {
      lines.push(
        `| ${month} | ${slot.games} | ${slot.populated} | ${slot.empty} | ${slot.rows} | ${pct(slot.populated, slot.games)} |`
      );
    }
    lines.push('');
  }
  lines.push('# Sportsbook Coverage');
  lines.push('');
  lines.push('| Season | book | rows |');
  lines.push('|---|---|---:|');
  for (const s of Object.values(seasons)) {
    for (const [book, n] of Object.entries(s.books).sort()) {
      const label = book === 'consensus' ? 'consensus (OWLS_PROVIDER_CONSENSUS)' : book;
      lines.push(`| ${s.season} | ${label} | ${n} |`);
    }
  }
  lines.push('');
  lines.push('# Source Coverage');
  lines.push('');
  lines.push('`archive-1` / `archive-2` are stored verbatim. They are not mapped to Yahoo, OddsShark, ESPN, or live-derived.');
  lines.push('');
  lines.push('| Season | source | rows |');
  lines.push('|---|---|---:|');
  for (const s of Object.values(seasons)) {
    for (const [source, n] of Object.entries(s.sources).sort()) {
      lines.push(`| ${s.season} | ${source} | ${n} |`);
    }
  }
  lines.push('');
  lines.push('# Moneyline Completeness');
  lines.push('');
  lines.push('| Season | populated games | with moneyline | complete two-sided ML |');
  lines.push('|---|---:|---:|---:|');
  for (const s of Object.values(seasons)) {
    lines.push(`| ${s.season} | ${s.populated} | ${s.gamesWithMoneyline} | ${s.gamesCompleteTwoSidedMl} |`);
  }
  lines.push('');
  lines.push('# Spread Completeness');
  lines.push('');
  lines.push('| Season | populated games | with spread | complete two-sided spread prices |');
  lines.push('|---|---:|---:|---:|');
  for (const s of Object.values(seasons)) {
    lines.push(`| ${s.season} | ${s.populated} | ${s.gamesWithSpread} | ${s.gamesCompleteTwoSidedSpread} |`);
  }
  lines.push('');
  lines.push('# Total Completeness');
  lines.push('');
  lines.push('| Season | populated games | with total | complete two-sided total prices |');
  lines.push('|---|---:|---:|---:|');
  for (const s of Object.values(seasons)) {
    lines.push(`| ${s.season} | ${s.populated} | ${s.gamesWithTotal} | ${s.gamesCompleteTwoSidedTotal} |`);
  }
  lines.push('');
  lines.push('# Data Quality');
  lines.push('');
  lines.push('| Season | suppressedFields | rowsExcluded | quality flags |');
  lines.push('|---|---:|---:|---|');
  for (const s of Object.values(seasons)) {
    const flags = Object.entries(s.qualityFlags)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ');
    lines.push(`| ${s.season} | ${s.suppressedFields} | ${s.rowsExcluded} | ${flags || '(none)'} |`);
  }
  lines.push('');
  lines.push('Flags are research diagnostics. Provider rows were not mutated.');
  lines.push('');
  lines.push('# Archive Integrity');
  lines.push('');
  const integ = json.archiveIntegrity;
  lines.push(`- expected archive units: **${integ.expectedUnits}**`);
  lines.push(`- actual archive units: **${integ.actualUnits}**`);
  lines.push(`- missing: **${integ.missing.length}**`);
  lines.push(`- checksum mismatch: **${integ.checksumMismatch.length}**`);
  lines.push(`- incomplete games: **${integ.incompleteGames.length}**`);
  lines.push(`- ok: **${integ.ok}**`);
  lines.push('');
  lines.push('# API Usage');
  lines.push('');
  lines.push(`- successful requests: **${json.apiUsage.requests}**`);
  lines.push(`- 429: **${json.apiUsage.status429}**`);
  lines.push(`- 503: **${json.apiUsage.status503}**`);
  lines.push(`- last remaining-month header: **${json.apiUsage.lastRemainingMonth ?? 'n/a'}**`);
  lines.push(`- elapsed: **${json.apiUsage.elapsedMs} ms**`);
  lines.push('');
  lines.push('# Storage');
  lines.push('');
  lines.push(`- total objects: **${json.storage.total.objects}**`);
  lines.push(`- total compressed bytes: **${json.storage.total.compressedBytes}**`);
  for (const [season, slot] of Object.entries(json.storage.bySeason)) {
    lines.push(`- ${season}: ${slot.objects} objects, ${slot.compressedBytes} bytes`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const { json, md } = await buildClosingOddsCoverageReport();
  await mkdir('reports/data-infrastructure', { recursive: true });
  await writeFile('reports/data-infrastructure/owls-closing-odds-full-coverage.json', `${JSON.stringify(json, null, 2)}\n`);
  await writeFile('reports/data-infrastructure/owls-closing-odds-full-coverage.md', md);
  console.log(md);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
