/**
 * Build public-betting coverage report from checkpoints + raw S3.
 * Never calls Owls. Does not rewrite archive objects.
 *
 *   npx tsx scripts/owls-insight/report-owls-public-betting-coverage.ts
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { FileCheckpointStore, type CheckpointState } from '@/lib/providers/owls-insight/checkpoint';
import { extractRows } from '@/lib/providers/owls-insight/client';
import { asRecord } from '@/lib/providers/owls-insight/normalize';
import { verifyEnvelopeChecksum } from '@/lib/providers/owls-insight/archive';
import { captureTimingClass, readLivePublicBettingRow } from '@/lib/providers/owls-insight/public-betting';
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
const RUN_IDS = ['owls-2026-09-14-public-2023', 'owls-2026-09-14-public-2024', 'owls-2026-09-14-public-2025'];
const CLOSING_RUN_IDS = [
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
  gamesWithSpread: number;
  gamesWithTotal: number;
  gamesWithMoneyline: number;
  gamesSpreadNonZero: number;
  gamesTotalNonZero: number;
  gamesAllZero: number;
  gamesWithMoneyShare: number;
  captureTiming: Record<string, number>;
  byPhase: Record<string, { games: number; populated: number; empty: number; rows: number }>;
  byMonth: Record<string, { games: number; populated: number; empty: number; rows: number; allZero: number }>;
  requests: number;
  status429: number;
  status503: number;
  elapsedMs: number | null;
  s3Objects: number;
  checksumVerifiedPages: number;
  checksumFailedPages: number;
  lastRemainingMonth: string | null;
  joinableToClosingOdds: number;
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
    gamesWithSpread: 0,
    gamesWithTotal: 0,
    gamesWithMoneyline: 0,
    gamesSpreadNonZero: 0,
    gamesTotalNonZero: 0,
    gamesAllZero: 0,
    gamesWithMoneyShare: 0,
    captureTiming: {},
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
    joinableToClosingOdds: 0,
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
  const rows = units.filter((u) => u.endpoint === 'history_public_betting');
  if (rows.length === 0) return 'GAME_MAPPING_FAILED';
  const count = rows.reduce((n, u) => n + (u.row_count ?? 0), 0);
  return count > 0 ? 'POPULATED' : 'EMPTY_PROVIDER_HISTORY';
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

function pct(n: number, d: number): string {
  if (!d) return 'n/a';
  return `${((100 * n) / d).toFixed(1)}%`;
}

export async function buildPublicBettingCoverageReport(runIds = RUN_IDS) {
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

  const closingPopulated = new Set<string>();
  for (const closingRunId of CLOSING_RUN_IDS) {
    const closing = await checkpoints.load(closingRunId);
    for (const [cc, acq] of Object.entries(closing?.game_acquisition ?? {})) {
      if (acq.state === 'POPULATED' && acq.event_id) closingPopulated.add(cc);
    }
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
      const monthSlot = (agg.byMonth[month] ??= { games: 0, populated: 0, empty: 0, rows: 0, allZero: 0 });
      phaseSlot.games += 1;
      monthSlot.games += 1;
      if (recorded?.event_id) agg.gamesMapped += 1;

      if (acq === 'POPULATED') {
        agg.populated += 1;
        phaseSlot.populated += 1;
        monthSlot.populated += 1;
        if (closingPopulated.has(game.courtContextGameId)) agg.joinableToClosingOdds += 1;
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
          u.endpoint === 'history_public_betting' &&
          u.archive_key
      );
      let gameRows = 0;
      let gameAllZero = false;
      let sawSpread = false;
      let sawTotal = false;
      let sawMl = false;
      let sawSpreadNonZero = false;
      let sawTotalNonZero = false;
      let sawMoneyShare = false;
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
        for (const raw of extractRows(env.payload)) {
          const rec = asRecord(raw);
          if (!rec) continue;
          gameRows += 1;
          agg.rows += 1;
          const live = readLivePublicBettingRow(rec);
          const timing = captureTimingClass(rec);
          agg.captureTiming[timing] = (agg.captureTiming[timing] ?? 0) + 1;
          if (live.hasSpreadObject) sawSpread = true;
          if (live.hasTotalObject) sawTotal = true;
          if (live.hasMoneylineObject) sawMl = true;
          if ((live.spreadHomePct ?? 0) !== 0 || (live.spreadAwayPct ?? 0) !== 0) sawSpreadNonZero = true;
          if ((live.totalOverPct ?? 0) !== 0 || (live.totalUnderPct ?? 0) !== 0) sawTotalNonZero = true;
          if (live.allZeroSnapshot) gameAllZero = true;
          if (live.hasMoneyShareField) sawMoneyShare = true;
        }
      }
      if (sawSpread) agg.gamesWithSpread += 1;
      if (sawTotal) agg.gamesWithTotal += 1;
      if (sawMl) agg.gamesWithMoneyline += 1;
      if (sawSpreadNonZero) agg.gamesSpreadNonZero += 1;
      if (sawTotalNonZero) agg.gamesTotalNonZero += 1;
      if (gameAllZero) agg.gamesAllZero += 1;
      if (sawMoneyShare) agg.gamesWithMoneyShare += 1;
      phaseSlot.rows += gameRows;
      monthSlot.rows += gameRows;
      if (gameAllZero) monthSlot.allZero += 1;
    }
    agg.coveragePct = agg.gamesTotal ? agg.populated / agg.gamesTotal : 0;
  }

  const prefixes = ['2023', '2024', '2025'].map(
    (season) => `raw/source=owls_insight/league=nba/season=${season}/entity=historical_public_betting/`
  );
  const storage = await listPrefixBytes(s3, prefixes);
  const storageBySeason: Record<string, { objects: number; compressedBytes: number }> = {};
  for (const season of ['2023', '2024', '2025']) {
    storageBySeason[season] = await listPrefixBytes(s3, [
      `raw/source=owls_insight/league=nba/season=${season}/entity=historical_public_betting/`,
    ]);
  }

  const json = {
    generatedAt: new Date().toISOString(),
    liveContract: {
      endpoint: 'GET /api/v1/history/public-betting',
      wrapper: '{ success, data: { betting, pagination:{total,limit,offset,hasMore} } }',
      rowShape:
        'one betting[] row per event: eventId, sport, homeTeam, awayTeam, gameDate, spread{homePct,awayPct}, total{overPct,underPct}',
      documentedVsLive:
        'Docs mention bet % and money % by side. Live rows expose a single ticket-style percent per spread/total side. No moneyline object, no money-share fields, no book, no capturedAt.',
      requestCost: '1 request/game at limit=100; pagination.hasMore=false on probes',
    },
    captureTimeSemantics: {
      class: 'TIMING_UNKNOWN',
      gameDate: 'Owls midnight UTC game identity, not a public-betting capture timestamp',
      notSafeAsTimeSpecificModelFeature: true,
    },
    missingness:
      'EMPTY_PROVIDER_HISTORY means Owls returned HTTP 200 with no betting[] rows. It is not proof that no public betting market existed. Provider 0 is preserved and is not rewritten to missing. All-zero snapshots are POPULATED, not empty.',
    researchSafety: {
      SAFE_FOR_DESCRIPTIVE_RESEARCH: 'YES',
      SAFE_FOR_PREGAME_MODEL_FEATURES: 'NO',
      ticketVsMoney: 'Live rows do not expose a money-share field. ticket_money_gap cannot be computed from this archive.',
      interpretationsForbidden: [
        'money share != sharp money',
        'public majority != bad side',
        'unknown timing can create leakage',
        'missing provider history != no public betting market',
        'provider 0 != proven absence of public betting',
      ],
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
    joinability: {
      key: 'Court Context game_id / Owls eventId',
      markets: 'spread home/away and total over/under can be aligned to historical_closing_odds nested sides. moneyline is not present on live public-betting rows.',
      destructiveMerge: false,
    },
  };
  return { json, md: renderMarkdown(json) };
}

function renderMarkdown(json: Awaited<ReturnType<typeof buildPublicBettingCoverageReport>>['json']): string {
  const seasons = json.seasons;
  const lines: string[] = [];
  lines.push('# Owls `/history/public-betting` full coverage');
  lines.push('');
  lines.push(`Generated: ${json.generatedAt}`);
  lines.push('');
  lines.push('# Live Contract');
  lines.push('');
  lines.push(`- Endpoint: \`${json.liveContract.endpoint}\``);
  lines.push(`- Wrapper: \`${json.liveContract.wrapper}\``);
  lines.push(`- Row shape: ${json.liveContract.rowShape}`);
  lines.push(`- ${json.liveContract.documentedVsLive}`);
  lines.push(`- Request cost: ${json.liveContract.requestCost}`);
  lines.push('');
  lines.push('# Capture-Time Semantics');
  lines.push('');
  lines.push(`- Class: **${json.captureTimeSemantics.class}**`);
  lines.push(`- ${json.captureTimeSemantics.gameDate}`);
  lines.push('- NOT SAFE AS A TIME-SPECIFIC MODEL FEATURE');
  lines.push('');
  lines.push(json.missingness);
  lines.push('');
  for (const key of ['2023', '2024', '2025']) {
    const s = seasons[key];
    if (!s) continue;
    const label = key === '2023' ? '2023–24 Coverage' : key === '2024' ? '2024–25 Coverage' : '2025–26 Coverage';
    lines.push(`# ${label}`);
    lines.push('');
    lines.push(`- Games eligible (Court Context Final): **${s.gamesTotal}**`);
    lines.push(`- Games mapped to Owls eventId: **${s.gamesMapped}**`);
    lines.push(`- POPULATED: **${s.populated}** (${pct(s.populated, s.gamesTotal)})`);
    lines.push(`- EMPTY_PROVIDER_HISTORY: **${s.emptyProviderHistory}**`);
    lines.push(`- GAME_MAPPING_FAILED: **${s.mappingFailed}**`);
    lines.push(`- REQUEST_FAILED: **${s.requestFailed}**`);
    lines.push(`- ARCHIVE_FAILED: **${s.archiveFailed}**`);
    lines.push(`- Rows: **${s.rows}**`);
    lines.push(`- All-zero snapshots (provider 0 on every present side): **${s.gamesAllZero}**`);
    lines.push(`- Joinable to closing-odds POPULATED games: **${s.joinableToClosingOdds}**`);
    lines.push('');
  }
  lines.push('# Coverage by Market');
  lines.push('');
  lines.push('| Season | populated | ML object | spread object | spread non-zero | total object | total non-zero | money share |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of Object.values(seasons)) {
    lines.push(
      `| ${s.season} | ${s.populated} | ${s.gamesWithMoneyline} | ${s.gamesWithSpread} | ${s.gamesSpreadNonZero} | ${s.gamesWithTotal} | ${s.gamesTotalNonZero} | ${s.gamesWithMoneyShare} |`
    );
  }
  lines.push('');
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
    lines.push('| Month | games | populated | EMPTY_PROVIDER_HISTORY | all-zero | rows | coverage |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const [month, slot] of Object.entries(s.byMonth).sort()) {
      lines.push(
        `| ${month} | ${slot.games} | ${slot.populated} | ${slot.empty} | ${slot.allZero} | ${slot.rows} | ${pct(slot.populated, slot.games)} |`
      );
    }
    lines.push('');
  }
  lines.push('# Ticket vs Money Fields');
  lines.push('');
  lines.push(json.researchSafety.ticketVsMoney);
  lines.push('');
  lines.push('Do not interpret any single-side percent as sharp money or as a fade-the-public signal.');
  lines.push('');
  lines.push('# Joinability With Closing Odds');
  lines.push('');
  lines.push(`- Join key: ${json.joinability.key}`);
  lines.push(`- ${json.joinability.markets}`);
  lines.push('- No destructive merge was performed.');
  lines.push('');
  lines.push('# Leakage / Timing Warning');
  lines.push('');
  lines.push('Capture timing is **TIMING_UNKNOWN**. `gameDate` is not an as-of timestamp. Do not use these percentages as pregame model features until a capture time is established.');
  lines.push('');
  lines.push('# Archive Integrity');
  lines.push('');
  lines.push(`- Expected units: **${json.archiveIntegrity.expectedUnits}**`);
  lines.push(`- Actual units: **${json.archiveIntegrity.actualUnits}**`);
  lines.push(`- Missing: **${json.archiveIntegrity.missing.length}**`);
  lines.push(`- Checksum mismatches: **${json.archiveIntegrity.checksumMismatch.length}**`);
  lines.push(`- Incomplete games: **${json.archiveIntegrity.incompleteGames.length}**`);
  lines.push(`- Failed pages: **${json.archiveIntegrity.failedPages.length}**`);
  lines.push(`- OK: **${json.archiveIntegrity.ok}**`);
  lines.push('');
  lines.push('# API Usage');
  lines.push('');
  lines.push(`- Requests: **${json.apiUsage.requests}**`);
  lines.push(`- 429: **${json.apiUsage.status429}**`);
  lines.push(`- 503: **${json.apiUsage.status503}**`);
  lines.push(`- Last remaining-month header: **${json.apiUsage.lastRemainingMonth ?? 'n/a'}**`);
  lines.push(`- Runtime (checkpoint elapsed): **${json.apiUsage.elapsedMs} ms**`);
  lines.push('');
  lines.push('# Storage');
  lines.push('');
  lines.push(`- Objects: **${json.storage.total.objects}**`);
  lines.push(`- Compressed bytes: **${json.storage.total.compressedBytes}**`);
  for (const [season, slot] of Object.entries(json.storage.bySeason)) {
    lines.push(`- Season ${season}: ${slot.objects} objects, ${slot.compressedBytes} bytes`);
  }
  lines.push('');
  lines.push('# Research Usability');
  lines.push('');
  lines.push(`- SAFE_FOR_DESCRIPTIVE_RESEARCH: **${json.researchSafety.SAFE_FOR_DESCRIPTIVE_RESEARCH}**`);
  lines.push(`- SAFE_FOR_PREGAME_MODEL_FEATURES: **${json.researchSafety.SAFE_FOR_PREGAME_MODEL_FEATURES}**`);
  for (const caveat of json.researchSafety.interpretationsForbidden) {
    lines.push(`- ${caveat}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const { json, md } = await buildPublicBettingCoverageReport();
  await mkdir('reports/data-infrastructure', { recursive: true });
  await writeFile('reports/data-infrastructure/owls-public-betting-full-coverage.json', `${JSON.stringify(json, null, 2)}\n`);
  await writeFile('reports/data-infrastructure/owls-public-betting-full-coverage.md', md);
  console.log(
    JSON.stringify(
      {
        ok: json.archiveIntegrity.ok,
        requests: json.apiUsage.requests,
        remaining: json.apiUsage.lastRemainingMonth,
        storage: json.storage.total,
        populated: Object.fromEntries(Object.entries(json.seasons).map(([k, s]) => [k, s.populated])),
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
