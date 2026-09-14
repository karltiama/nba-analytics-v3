/**
 * Build the post-acquisition coverage report from checkpoints + raw S3.
 * Never calls Owls. Empty HTTP 200 is EMPTY_PROVIDER_HISTORY, not market absence.
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { FileCheckpointStore, type CheckpointState } from '@/lib/providers/owls-insight/checkpoint';
import { extractRows } from '@/lib/providers/owls-insight/client';
import { asRecord } from '@/lib/providers/owls-insight/normalize';
import { verifyEnvelopeChecksum } from '@/lib/providers/owls-insight/archive';
import { loadCourtContextGames, classifyGamePhase } from '@/lib/providers/owls-insight/universe';
import { reconcileOwlsPropBackfill } from '@/lib/providers/owls-insight/reconcile';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import type {
  CourtContextGame,
  OwlsAcquisitionState,
  OwlsArchiveEnvelope,
  OwlsGameAcquisition,
} from '@/lib/providers/owls-insight/types';

const BUCKET = process.env.NBA_DATA_BUCKET?.trim() || 'nba-analytics-data-260029269390';
const CORE_ALIASES: Record<string, string[]> = {
  PTS: ['points'],
  REB: ['rebounds'],
  AST: ['assists'],
  '3PM': ['threes', 'threes_made'],
  PRA: ['pts_rebs_asts', 'points_rebounds_assists'],
  PA: ['pts_asts', 'points_assists'],
  PR: ['pts_rebs', 'points_rebounds'],
  RA: ['rebs_asts', 'assists_rebounds', 'rebounds_assists'],
};
const NAMED_BOOKS = ['draftkings', 'betmgm', 'caesars', 'espn bet', 'espnbet', 'espn_bet'] as const;

type QuoteShape = 'FULL_TWO_WAY' | 'SINGLE_PRICE' | 'PARTIAL' | 'MISSING_PRICE';

type SeasonAgg = {
  season: string;
  gamesTotal: number;
  populated: number;
  emptyProviderHistory: number;
  mappingFailed: number;
  requestFailed: number;
  archiveFailed: number;
  coveragePct: number;
  rows: number;
  books: Record<string, number>;
  propTypes: Record<string, number>;
  coreGameCoverage: Record<string, { games: number; rows: number }>;
  quotes: Record<QuoteShape, number>;
  quoteFields: {
    openingLine: number;
    openingOver: number;
    openingUnder: number;
    closingLine: number;
    closingOver: number;
    closingUnder: number;
    americanPrice: number;
  };
  byPhase: Record<string, { games: number; populated: number; empty: number; rows: number }>;
  byMonth: Record<string, { games: number; populated: number; empty: number; rows: number }>;
  byBook: Record<string, { games: Set<string>; rows: number; PTS: number; REB: number; AST: number; '3PM': number }>;
  requests: number;
  status429: number;
  status503: number;
  elapsedMs: number | null;
  s3Objects: number;
  checksumVerifiedPages: number;
  checksumFailedPages: number;
};

function emptySeason(season: string): SeasonAgg {
  return {
    season,
    gamesTotal: 0,
    populated: 0,
    emptyProviderHistory: 0,
    mappingFailed: 0,
    requestFailed: 0,
    archiveFailed: 0,
    coveragePct: 0,
    rows: 0,
    books: {},
    propTypes: {},
    coreGameCoverage: Object.fromEntries(
      Object.keys(CORE_ALIASES).map((k) => [k, { games: 0, rows: 0 }])
    ),
    quotes: { FULL_TWO_WAY: 0, SINGLE_PRICE: 0, PARTIAL: 0, MISSING_PRICE: 0 },
    quoteFields: {
      openingLine: 0,
      openingOver: 0,
      openingUnder: 0,
      closingLine: 0,
      closingOver: 0,
      closingUnder: 0,
      americanPrice: 0,
    },
    byPhase: {},
    byMonth: {},
    byBook: {},
    requests: 0,
    status429: 0,
    status503: 0,
    elapsedMs: null,
    s3Objects: 0,
    checksumVerifiedPages: 0,
    checksumFailedPages: 0,
  };
}

function bookBucket(book: string): 'draftkings' | 'betmgm' | 'caesars' | 'espn_bet' | 'other' {
  const n = book.trim().toLowerCase();
  if (n === 'draftkings') return 'draftkings';
  if (n === 'betmgm') return 'betmgm';
  if (n === 'caesars') return 'caesars';
  if (n === 'espn bet' || n === 'espnbet' || n === 'espn_bet') return 'espn_bet';
  return 'other';
}

function present(v: unknown): boolean {
  return v != null && v !== '';
}

function classifyQuote(row: Record<string, unknown>): QuoteShape {
  const opening = asRecord(row.opening);
  const closing = asRecord(row.closing);
  const openLine = present(opening?.line);
  const openOver = present(opening?.overPrice);
  const openUnder = present(opening?.underPrice);
  const closeLine = present(closing?.line);
  const closeOver = present(closing?.overPrice);
  const closeUnder = present(closing?.underPrice);
  const american =
    present(opening?.americanPrice) || present(closing?.americanPrice) || present(row.americanPrice);
  const twoWayCount = [openLine, openOver, openUnder, closeLine, closeOver, closeUnder].filter(Boolean).length;
  if (twoWayCount === 6) return 'FULL_TWO_WAY';
  if (twoWayCount === 0 && american) return 'SINGLE_PRICE';
  if (twoWayCount === 0 && !american) return 'MISSING_PRICE';
  return 'PARTIAL';
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
  const props = units.filter((u) => u.endpoint === 'history_player_props');
  if (props.length === 0) return 'GAME_MAPPING_FAILED';
  const rows = props.reduce((n, u) => n + (u.row_count ?? 0), 0);
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

export async function buildCoverageReport(runIds: string[]) {
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
  const integrity: Record<
    string,
    {
      run_id: string;
      expected_objects: number;
      actual_objects: number;
      missing: string[];
      checksum_mismatch: string[];
      failed_pages: string[];
      incomplete_games: string[];
      ok: boolean;
    }
  > = {};
  const remainingHeaders: string[] = [];

  for (const runId of runIds) {
    const state = await checkpoints.load(runId);
    if (!state) throw new Error(`checkpoint missing for ${runId}`);
    const recon = await reconcileOwlsPropBackfill({ runId, state, store });
    integrity[runId] = recon;
    const season = state.run.target_seasons[0] ?? runId;
    const agg = (seasonReports[season] ??= emptySeason(season));
    const universe = gamesBySeason.get(season) ?? [];
    agg.gamesTotal = universe.length;
    agg.requests += state.run.requests_successful;
    agg.status429 += state.run.status_429;
    agg.status503 += state.run.status_503;
    if (state.run.started_at && state.run.completed_at) {
      agg.elapsedMs =
        (agg.elapsedMs ?? 0) +
        (Date.parse(state.run.completed_at) - Date.parse(state.run.started_at));
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

      const propUnits = Object.values(state.units).filter(
        (u) =>
          u.court_context_game_id === game.courtContextGameId &&
          u.endpoint === 'history_player_props' &&
          u.archive_key
      );
      const coreThisGame: Record<string, number> = {};
      let gameRows = 0;
      for (const unit of propUnits) {
        const { env, bytes } = await getEnv(unit.archive_key!);
        void bytes;
        if (verifyEnvelopeChecksum(env) && (!unit.checksum || unit.checksum === env.checksum)) {
          agg.checksumVerifiedPages += 1;
        } else {
          agg.checksumFailedPages += 1;
        }
        const remaining = env.response_metadata?.headers?.['x-ratelimit-remaining-month'];
        if (remaining) remainingHeaders.push(remaining);
        for (const raw of extractRows(env.payload)) {
          const rec = asRecord(raw);
          if (!rec) continue;
          gameRows += 1;
          const propType = String(rec.propType ?? '');
          const book = String(rec.book ?? '');
          agg.propTypes[propType] = (agg.propTypes[propType] ?? 0) + 1;
          agg.books[book] = (agg.books[book] ?? 0) + 1;
          const bucket = bookBucket(book);
          const bookSlot = (agg.byBook[bucket] ??= {
            games: new Set(),
            rows: 0,
            PTS: 0,
            REB: 0,
            AST: 0,
            '3PM': 0,
          });
          bookSlot.games.add(game.courtContextGameId);
          bookSlot.rows += 1;
          for (const [core, aliases] of Object.entries(CORE_ALIASES)) {
            if (aliases.includes(propType)) {
              coreThisGame[core] = (coreThisGame[core] ?? 0) + 1;
              if (core === 'PTS' || core === 'REB' || core === 'AST' || core === '3PM') {
                bookSlot[core] += 1;
              }
            }
          }
          const opening = asRecord(rec.opening);
          const closing = asRecord(rec.closing);
          if (present(opening?.line)) agg.quoteFields.openingLine += 1;
          if (present(opening?.overPrice)) agg.quoteFields.openingOver += 1;
          if (present(opening?.underPrice)) agg.quoteFields.openingUnder += 1;
          if (present(closing?.line)) agg.quoteFields.closingLine += 1;
          if (present(closing?.overPrice)) agg.quoteFields.closingOver += 1;
          if (present(closing?.underPrice)) agg.quoteFields.closingUnder += 1;
          if (
            present(opening?.americanPrice) ||
            present(closing?.americanPrice) ||
            present(rec.americanPrice)
          ) {
            agg.quoteFields.americanPrice += 1;
          }
          agg.quotes[classifyQuote(rec)] += 1;
        }
      }
      agg.rows += gameRows;
      phaseSlot.rows += gameRows;
      monthSlot.rows += gameRows;
      for (const [core, n] of Object.entries(coreThisGame)) {
        if (!n) continue;
        agg.coreGameCoverage[core]!.games += 1;
        agg.coreGameCoverage[core]!.rows += n;
      }
    }
    if (agg.gamesTotal > 0) agg.coveragePct = agg.populated / agg.gamesTotal;
  }

  const storage = await listPrefixBytes(s3, [
    'raw/source=owls_insight/league=nba/season=2023/',
    'raw/source=owls_insight/league=nba/season=2024/',
    'raw/source=owls_insight/league=nba/season=2025/',
    'raw/source=owls_insight/league=nba/season=all/',
  ]);

  const json = {
    generatedAt: new Date().toISOString(),
    endpoint: '/api/v1/history/player-props',
    missingness:
      'EMPTY_PROVIDER_HISTORY means Owls returned HTTP 200 with no retained player-prop rows. It is not proof that a sportsbook offered no market.',
    seasons: Object.fromEntries(
      Object.entries(seasonReports).map(([k, v]) => [
        k,
        {
          ...v,
          byBook: Object.fromEntries(
            Object.entries(v.byBook).map(([bk, slot]) => [
              bk,
              { games: slot.games.size, rows: slot.rows, PTS: slot.PTS, REB: slot.REB, AST: slot.AST, '3PM': slot['3PM'] },
            ])
          ),
        },
      ])
    ),
    archiveIntegrity: {
      runs: integrity,
      expectedUnits: Object.values(integrity).reduce((n, r) => n + r.expected_objects, 0),
      actualUnits: Object.values(integrity).reduce((n, r) => n + r.actual_objects, 0),
      missing: Object.values(integrity).flatMap((r) => r.missing),
      checksumMismatch: Object.values(integrity).flatMap((r) => r.checksum_mismatch),
      requestFailures: Object.values(integrity).flatMap((r) => r.failed_pages),
      incompleteGames: Object.values(integrity).flatMap((r) => r.incomplete_games),
      ok: Object.values(integrity).every((r) => r.ok),
    },
    apiUsage: {
      requestsSuccessful: Object.values(seasonReports).reduce((n, s) => n + s.requests, 0),
      status429: Object.values(seasonReports).reduce((n, s) => n + s.status429, 0),
      status503: Object.values(seasonReports).reduce((n, s) => n + s.status503, 0),
      lastRemainingMonthHeader: remainingHeaders.at(-1) ?? null,
      elapsedMs: Object.values(seasonReports).reduce((n, s) => n + (s.elapsedMs ?? 0), 0),
    },
    s3Storage: {
      source: 'owls_insight',
      objects: storage.objects,
      compressedBytes: storage.compressedBytes,
    },
    namedBooks: [...NAMED_BOOKS],
  };

  const md = renderMarkdown(json);
  return { json, md };
}

function pct(n: number, d: number): string {
  if (!d) return 'n/a';
  return `${((100 * n) / d).toFixed(1)}%`;
}

function renderMarkdown(json: Awaited<ReturnType<typeof buildCoverageReport>> extends infer T ? T extends { json: infer J } ? J : never : never): string {
  const seasons = json.seasons as Record<string, SeasonAgg & { byBook: Record<string, { games: number; rows: number }> }>;
  const lines: string[] = [];
  lines.push('# Owls `/history/player-props` full coverage');
  lines.push('');
  lines.push(`Generated: ${json.generatedAt}`);
  lines.push('');
  lines.push('Empty Owls responses are recorded as **EMPTY_PROVIDER_HISTORY**. That is not proof a sportsbook had no market.');
  lines.push('');
  for (const key of ['2023', '2024', '2025']) {
    const s = seasons[key];
    if (!s) continue;
    const label = key === '2023' ? '2023–24' : key === '2024' ? '2024–25' : '2025–26';
    lines.push(`# ${label} Coverage`);
    lines.push('');
    lines.push(`- Games total (Court Context Final): **${s.gamesTotal}**`);
    lines.push(`- POPULATED: **${s.populated}** (${pct(s.populated, s.gamesTotal)})`);
    lines.push(`- EMPTY_PROVIDER_HISTORY: **${s.emptyProviderHistory}**`);
    lines.push(`- GAME_MAPPING_FAILED: **${s.mappingFailed}**`);
    lines.push(`- REQUEST_FAILED: **${s.requestFailed}**`);
    lines.push(`- ARCHIVE_FAILED: **${s.archiveFailed}**`);
    lines.push(`- Rows: **${s.rows}**`);
    lines.push(`- Books: ${Object.keys(s.books).sort().join(', ') || '(none)'}`);
    lines.push(`- Prop types: ${Object.keys(s.propTypes).sort().join(', ') || '(none)'}`);
    lines.push('');
  }
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
  lines.push('# Coverage by Prop');
  lines.push('');
  lines.push('| Season | PTS games | REB games | AST games | 3PM games | PRA games | PA games | PR games | RA games |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of Object.values(seasons)) {
    const c = s.coreGameCoverage;
    lines.push(
      `| ${s.season} | ${c.PTS?.games ?? 0} | ${c.REB?.games ?? 0} | ${c.AST?.games ?? 0} | ${c['3PM']?.games ?? 0} | ${c.PRA?.games ?? 0} | ${c.PA?.games ?? 0} | ${c.PR?.games ?? 0} | ${c.RA?.games ?? 0} |`
    );
  }
  lines.push('');
  lines.push('# Coverage by Sportsbook');
  lines.push('');
  lines.push('| Season | book | games | rows |');
  lines.push('|---|---|---:|---:|');
  for (const s of Object.values(seasons)) {
    for (const book of ['draftkings', 'betmgm', 'caesars', 'espn_bet', 'other']) {
      const slot = s.byBook[book] ?? { games: 0, rows: 0 };
      lines.push(`| ${s.season} | ${book} | ${slot.games} | ${slot.rows} |`);
    }
  }
  lines.push('');
  lines.push('# Quote Completeness');
  lines.push('');
  lines.push('| Season | rows | FULL_TWO_WAY | SINGLE_PRICE | PARTIAL | MISSING_PRICE | open line | open over | open under | close line | close over | close under | americanPrice |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of Object.values(seasons)) {
    const q = s.quotes;
    const f = s.quoteFields;
    lines.push(
      `| ${s.season} | ${s.rows} | ${q.FULL_TWO_WAY} | ${q.SINGLE_PRICE} | ${q.PARTIAL} | ${q.MISSING_PRICE} | ${f.openingLine} | ${f.openingOver} | ${f.openingUnder} | ${f.closingLine} | ${f.closingOver} | ${f.closingUnder} | ${f.americanPrice} |`
    );
  }
  lines.push('');
  lines.push('# Populated vs Empty Games');
  lines.push('');
  lines.push('| Season | populated | EMPTY_PROVIDER_HISTORY | mapping failed | request failed | archive failed |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const s of Object.values(seasons)) {
    lines.push(
      `| ${s.season} | ${s.populated} | ${s.emptyProviderHistory} | ${s.mappingFailed} | ${s.requestFailed} | ${s.archiveFailed} |`
    );
  }
  lines.push('');
  lines.push('# Selection-Bias Warning');
  lines.push('');
  lines.push('Market-model evaluations can only use games and players with valid historical market rows in this Owls `/history/player-props` archive.');
  lines.push('');
  lines.push('Future reports must include: eligible NBA games, games with market data, coverage percentage, and actual evaluation N.');
  lines.push('');
  lines.push('Do not imply season-wide sportsbook validation when only a subset is represented.');
  lines.push('');
  lines.push('Absence in Owls ≠ historical market absence.');
  lines.push('');
  lines.push('# Archive Integrity');
  lines.push('');
  const integ = json.archiveIntegrity;
  lines.push(`- expected archive units: **${integ.expectedUnits}**`);
  lines.push(`- actual archive units: **${integ.actualUnits}**`);
  lines.push(`- missing: **${integ.missing.length}**`);
  lines.push(`- checksum mismatches: **${integ.checksumMismatch.length}**`);
  lines.push(`- request failures: **${integ.requestFailures.length}**`);
  lines.push(`- incomplete games: **${integ.incompleteGames.length}**`);
  lines.push(`- ok: **${integ.ok}**`);
  lines.push('');
  lines.push('# API Usage');
  lines.push('');
  lines.push(`- requests successful (sum of season run counters): **${json.apiUsage.requestsSuccessful}**`);
  lines.push(`- 429: **${json.apiUsage.status429}**`);
  lines.push(`- 503: **${json.apiUsage.status503}**`);
  lines.push(`- last X-RateLimit-Remaining-Month seen in envelopes: **${json.apiUsage.lastRemainingMonthHeader ?? 'n/a'}**`);
  lines.push(`- elapsed (sum of run clocks): **${Math.round(json.apiUsage.elapsedMs / 1000)}s**`);
  lines.push('');
  lines.push('# S3 Storage');
  lines.push('');
  lines.push(`- source: **${json.s3Storage.source}**`);
  lines.push(`- objects: **${json.s3Storage.objects}**`);
  lines.push(`- compressed bytes: **${json.s3Storage.compressedBytes}**`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  if (process.argv.includes('--execute')) {
    throw new Error('coverage report never calls Owls. Remove --execute.');
  }
  const runIds = process.argv
    .slice(2)
    .filter((a) => a.startsWith('--run-id='))
    .map((a) => a.slice('--run-id='.length));
  const ids =
    runIds.length > 0
      ? runIds
      : [
          'owls-2026-09-14-season-2023',
          'owls-2026-09-14-season-2024',
          'owls-2026-09-14-season-2025',
        ];
  const { json, md } = await buildCoverageReport(ids);
  await mkdir('reports/data-infrastructure', { recursive: true });
  await writeFile('reports/data-infrastructure/owls-player-props-full-coverage.json', `${JSON.stringify(json, null, 2)}\n`);
  await writeFile('reports/data-infrastructure/owls-player-props-full-coverage.md', md);
  console.log(JSON.stringify({ ok: json.archiveIntegrity.ok, seasons: Object.keys(json.seasons), storage: json.s3Storage }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
