/**
 * Step 7E: zero-API market-intelligence analysis.
 * Reads existing opening S3 archives + closing Postgres tables. No BDL HTTP.
 * No Postgres writes. No serving backfill. Uses lib/betting/market-movement.ts.
 *
 *   npx tsx scripts/archive/analyze-market-intelligence.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import {
  CANONICAL_PROP_TYPES,
  americanOddsToImpliedProbability,
  canonicalizePropType,
  classifyPropMovement,
  displayPropType,
  displayVendor,
  findAmbiguousSimultaneousLineKeys,
  interpolatingQuantile,
  parseAmericanOdds,
  playerPropMatchKey,
  JUICE_IMPLIED_PROB_THRESHOLD,
  type CanonicalPropType,
} from '@/lib/betting/market-movement';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const EXPECTED_DB_BYTES = 342_846_611;
const TRIAL_START_ISO = '2026-09-08T12:10:59.422Z';
const PROP_PREFIX = 'raw/source=balldontlie/league=nba/season=2025/entity=opening_player_props';
const ODDS_PREFIX =
  'raw/source=balldontlie/league=nba/season=2025/entity=opening_game_odds/window=2026-03-09_to_2026-03-22';
const ADV_PREFIX = 'raw/source=balldontlie/league=nba/season=2025/entity=advanced_stats_v2';

const CANONICAL_PROPS = CANONICAL_PROP_TYPES;
type CanonicalProp = CanonicalPropType;

const PROP_CANDIDATE_VENDORS = [
  'betmgm',
  'fanduel',
  'caesars',
  'draftkings',
  'betrivers',
  'fanatics',
] as const;

const GAME_ODDS_PRODUCT_BOOKS = [
  'ballybet',
  'betmgm',
  'betparx',
  'betrivers',
  'caesars',
  'draftkings',
  'fanatics',
  'fanduel',
  'rebet',
] as const;

const PREDICTION_MARKETS = new Set(['polymarket', 'kalshi']);
const SPREAD_OUTLIER_ABS = 8;
const TOTAL_OUTLIER_ABS = 10;
const CONSENSUS_DIVERGE_ABS = 6;
const JUICE_PP_2 = JUICE_IMPLIED_PROB_THRESHOLD;
const JUICE_PP_5 = 0.05;

type Json = Record<string, unknown>;

type ClosingProp = {
  gameId: string;
  playerId: string;
  vendor: string;
  propType: string;
  canonical: CanonicalProp | null;
  side: string;
  line: number | null;
  oddsAmerican: number | null;
  implied: number | null;
};

type OpeningProp = {
  gameId: string;
  playerId: string;
  vendor: string;
  rawPropType: string;
  canonical: CanonicalProp | null;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  openedAt: string | null;
  ambiguous: boolean;
};

type MatchedProp = OpeningProp & {
  closeLine: number | null;
  closeOverOdds: number | null;
  closeUnderOdds: number | null;
  closeOverImplied: number | null;
  closeUnderImplied: number | null;
  openOverImplied: number | null;
  openUnderImplied: number | null;
};

type OpeningOddsRow = {
  gameId: string;
  vendor: string;
  class: 'sportsbook' | 'prediction-market';
  spread: number | null;
  total: number | null;
  homeMl: number | null;
  awayMl: number | null;
  openedAt: string | null;
};

type ClosingOddsRow = {
  gameId: string;
  vendor: string;
  spread: number | null;
  total: number | null;
  homeMl: number | null;
  awayMl: number | null;
  snapshotAt: string | null;
};

function sid(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function lower(v: unknown): string | null {
  const s = sid(v);
  return s ? s.toLowerCase() : null;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(n: number | null | undefined, d = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function pct(n: number, d: number, digits = 1): number | null {
  if (!d) return null;
  return round((100 * n) / d, digits);
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function quantile(xs: number[], q: number): number | null {
  return interpolatingQuantile(xs, q);
}

function summarize(xs: number[]) {
  const n = xs.length;
  if (!n) {
    return {
      n: 0,
      mean: null as number | null,
      median: null as number | null,
      p25: null as number | null,
      p75: null as number | null,
      min: null as number | null,
      max: null as number | null,
    };
  }
  return {
    n,
    mean: round(mean(xs), 3),
    median: round(quantile(xs, 0.5), 3),
    p25: round(quantile(xs, 0.25), 3),
    p75: round(quantile(xs, 0.75), 3),
    min: round(Math.min(...xs), 3),
    max: round(Math.max(...xs), 3),
  };
}

function movementShare(deltas: number[]) {
  const n = deltas.length;
  if (!n) {
    return {
      pctIncreased: null,
      pctDecreased: null,
      pctUnchanged: null,
      pctMovedGe05: null,
      pctMovedGe10: null,
      pctMovedGe15: null,
    };
  }
  let up = 0;
  let down = 0;
  let flat = 0;
  let ge05 = 0;
  let ge10 = 0;
  let ge15 = 0;
  for (const d of deltas) {
    if (d > 1e-9) up += 1;
    else if (d < -1e-9) down += 1;
    else flat += 1;
    const a = Math.abs(d);
    if (a >= 0.5) ge05 += 1;
    if (a >= 1) ge10 += 1;
    if (a >= 1.5) ge15 += 1;
  }
  return {
    pctIncreased: pct(up, n),
    pctDecreased: pct(down, n),
    pctUnchanged: pct(flat, n),
    pctMovedGe05: pct(ge05, n),
    pctMovedGe10: pct(ge10, n),
    pctMovedGe15: pct(ge15, n),
  };
}

function canonicalProp(raw: unknown): CanonicalProp | null {
  return canonicalizePropType(raw);
}

function displayProp(p: string): string {
  return displayPropType(p);
}

function extractRows(body: unknown): Json[] {
  if (!body) return [];
  if (Array.isArray(body)) return body as Json[];
  const obj = body as Json;
  if (Array.isArray(obj.data)) return obj.data as Json[];
  if (Array.isArray(obj.pages)) {
    const rows: Json[] = [];
    for (const page of obj.pages as unknown[]) {
      if (Array.isArray(page)) rows.push(...(page as Json[]));
      else if (page && typeof page === 'object' && Array.isArray((page as Json).data)) {
        rows.push(...((page as Json).data as Json[]));
      }
    }
    return rows;
  }
  return [];
}

function gameIdFromKey(key: string): string | null {
  const m = key.match(/game_id=([^/]+?)(?:\.json)?$/);
  return m ? m[1] : null;
}

function oddsAmerican(v: unknown): number | null {
  return parseAmericanOdds(v);
}

function impliedFromAmerican(v: number | null): number | null {
  return americanOddsToImpliedProbability(v);
}

function nestedId(row: Json, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v != null && typeof v !== 'object') {
      const direct = sid(v);
      if (direct) return direct;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const id = sid((v as Json).id);
      if (id) return id;
    }
  }
  return null;
}

function parseOpeningProp(row: Json, fallbackGameId: string | null): OpeningProp | null {
  const gameId = sid(row.game_id) ?? nestedId(row, 'game') ?? fallbackGameId;
  const playerId = sid(row.player_id) ?? nestedId(row, 'player');
  const vendor = lower(row.vendor) ?? lower(row.sportsbook);
  const rawPropType = sid(row.prop_type) ?? '';
  if (!gameId || !playerId || !vendor || !rawPropType) return null;
  const market = row.market && typeof row.market === 'object' ? (row.market as Json) : null;
  return {
    gameId,
    playerId,
    vendor,
    rawPropType,
    canonical: canonicalProp(rawPropType),
    line: num(row.line_value ?? row.line ?? row.line_score ?? market?.line_value ?? market?.line),
    overOdds: oddsAmerican(row.over_odds ?? row.over_american ?? market?.over_odds ?? market?.over_american),
    underOdds: oddsAmerican(row.under_odds ?? row.under_american ?? market?.under_odds ?? market?.under_american),
    openedAt: sid(row.opened_at),
    ambiguous: false,
  };
}

function parseOpeningOdds(row: Json, fallbackGameId: string | null): OpeningOddsRow | null {
  const gameId = sid(row.game_id) ?? nestedId(row, 'game') ?? fallbackGameId;
  const vendor = lower(row.vendor) ?? lower(row.sportsbook);
  if (!gameId || !vendor) return null;
  return {
    gameId,
    vendor,
    class: PREDICTION_MARKETS.has(vendor) ? 'prediction-market' : 'sportsbook',
    spread: num(row.spread_home_value ?? row.home_spread ?? row.spread),
    total: num(row.total_value ?? row.total),
    homeMl: oddsAmerican(row.moneyline_home_odds ?? row.home_moneyline),
    awayMl: oddsAmerican(row.moneyline_away_odds ?? row.away_moneyline),
    openedAt: sid(row.opened_at),
  };
}

function parseAdvancedIds(row: Json): { gameId: string; playerId: string } | null {
  const gameId = sid(row.game_id) ?? nestedId(row, 'game');
  const playerId = sid(row.player_id) ?? nestedId(row, 'player');
  if (!gameId || !playerId) return null;
  return { gameId, playerId };
}

function qualityTier(args: {
  matched: number;
  games: number;
  matchPct: number | null;
  openPricePct: number | null;
  closePricePct: number | null;
}): 'A' | 'B' | 'C' {
  const matchPct = args.matchPct ?? 0;
  const openP = args.openPricePct ?? 0;
  const closeP = args.closePricePct ?? 0;
  if (args.matched >= 400 && args.games >= 80 && matchPct >= 70 && openP >= 80 && closeP >= 80) {
    return 'A';
  }
  if (args.matched >= 80 && args.games >= 25 && matchPct >= 50) return 'B';
  return 'C';
}

function hoursBefore(openedAt: string | null, tip: Date | null): number | null {
  if (!openedAt || !tip) return null;
  const o = new Date(openedAt);
  if (Number.isNaN(o.getTime())) return null;
  return (tip.getTime() - o.getTime()) / 3_600_000;
}

async function loadS3GameObjects(s3: S3Storage, prefix: string) {
  const objects: { key: string; size: number }[] = [];
  for await (const o of s3.listByPrefix(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
    if (!o.key.endsWith('.json')) continue;
    if (o.key.includes('_manifest') || o.key.includes('_characterization')) continue;
    if (!o.key.includes('game_id=')) continue;
    objects.push({ key: o.key, size: o.size });
  }
  return objects;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const lock = bdlAcquisitionLockStatus();
  const frozen = mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun;

  const client = await pool.connect();
  let dbBytesBefore = 0;
  let dbBytesAfter = 0;
  let isolation: Json = {};
  let closingProps: ClosingProp[] = [];
  let closingOdds: ClosingOddsRow[] = [];
  let gamesById = new Map<string, { startTime: Date | null; season: string | null }>();
  let joinability: Json = {};
  let injuryFeasibility: Json = {};

  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout = '180000'");

    const snap = await client.query<{
      db_bytes: string;
      pdl_rows: number;
      pdl_games: number;
      goh_rows: number;
      goh_games: number;
      goc_games: number;
      logs_2025: number;
      games_2025: number;
      games_2026: number;
      logs_2026: number;
      raw_stats_2025: number;
    }>(
      `select
         pg_database_size(current_database())::text as db_bytes,
         (select count(*)::int from research.prop_decision_lines) as pdl_rows,
         (select count(distinct game_id)::int from research.prop_decision_lines) as pdl_games,
         (select count(*)::int from analytics.game_odds_history) as goh_rows,
         (select count(distinct game_id)::int from analytics.game_odds_history) as goh_games,
         (select count(*)::int from analytics.game_odds_current) as goc_games,
         (select count(*)::int from analytics.player_game_logs where season = '2025') as logs_2025,
         (select count(*)::int from analytics.games where season = '2025') as games_2025,
         (select count(*)::int from analytics.games where season = '2026') as games_2026,
         (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026,
         (select count(*)::int from raw.player_game_stats) as raw_stats_2025`
    );
    const s = snap.rows[0]!;
    dbBytesBefore = Number(s.db_bytes);

    const serving = await client.query<{ rel: string | null }>(
      `select to_regclass('analytics.player_advanced_stats')::text as rel
       union all select to_regclass('analytics.advanced_stats')::text
       union all select to_regclass('analytics.player_game_advanced_stats')::text`
    );
    const advancedServingTables = serving.rows.map((r) => r.rel).filter(Boolean);

    isolation = {
      dbBytes: dbBytesBefore,
      dbMb: round(dbBytesBefore / (1024 * 1024), 2),
      expectedDbBytes: EXPECTED_DB_BYTES,
      postgresUnchanged: dbBytesBefore === EXPECTED_DB_BYTES,
      propDecisionLines: { rows: s.pdl_rows, games: s.pdl_games },
      gameOddsHistory: { rows: s.goh_rows, games: s.goh_games },
      gameOddsCurrent: { games: s.goc_games },
      games2025: s.games_2025,
      logs2025: s.logs_2025,
      games2026: s.games_2026,
      logs2026: s.logs_2026,
      rawPlayerGameStats: s.raw_stats_2025,
      advancedServingTables,
    };

    if (!frozen || pin !== '2025') {
      throw new Error(
        `Safety stop: frozen=${frozen} pin=${pin} dataMode=${mode.dataMode}. No provider request made.`
      );
    }

    const pdl = await client.query<{
      game_id: string;
      player_id: string;
      sportsbook: string;
      prop_type: string;
      side: string;
      line_value: string | number | null;
      odds_american: number | null;
      implied_probability: string | number | null;
    }>(
      `select game_id, player_id, sportsbook, prop_type, side, line_value, odds_american, implied_probability
       from research.prop_decision_lines`
    );
    closingProps = pdl.rows.map((r) => ({
      gameId: String(r.game_id),
      playerId: String(r.player_id),
      vendor: String(r.sportsbook).trim().toLowerCase(),
      propType: String(r.prop_type),
      canonical: canonicalProp(r.prop_type),
      side: String(r.side).trim().toLowerCase(),
      line: num(r.line_value),
      oddsAmerican: num(r.odds_american),
      implied: num(r.implied_probability),
    }));

    const games = await client.query<{
      game_id: string;
      start_time: Date | null;
      season: string | null;
    }>(`select game_id, start_time, season from analytics.games`);
    gamesById = new Map(
      games.rows.map((g) => [
        String(g.game_id),
        { startTime: g.start_time ? new Date(g.start_time) : null, season: g.season },
      ])
    );

    const goh = await client.query<{
      game_id: string;
      vendor: string;
      home_spread: string | number | null;
      total: string | number | null;
      home_moneyline: number | null;
      away_moneyline: number | null;
      snapshot_at: Date;
      start_time: Date | null;
    }>(
      `select distinct on (h.game_id, lower(h.vendor))
         h.game_id,
         lower(h.vendor) as vendor,
         h.home_spread,
         h.total,
         h.home_moneyline,
         h.away_moneyline,
         h.snapshot_at,
         g.start_time
       from analytics.game_odds_history h
       join analytics.games g on g.game_id = h.game_id
       where g.start_time is not null
         and h.snapshot_at <= g.start_time
       order by h.game_id, lower(h.vendor), h.snapshot_at desc`
    );
    closingOdds = goh.rows.map((r) => ({
      gameId: String(r.game_id),
      vendor: String(r.vendor),
      spread: num(r.home_spread),
      total: num(r.total),
      homeMl: num(r.home_moneyline),
      awayMl: num(r.away_moneyline),
      snapshotAt: r.snapshot_at ? new Date(r.snapshot_at).toISOString() : null,
    }));

    const inj = await client.query<{
      hist_n: number;
      hist_players: number;
      hist_min: Date | null;
      hist_max: Date | null;
      curr_n: number;
      curr_players: number;
      raw_n: number;
      raw_min: Date | null;
      raw_max: Date | null;
      stints_2025: number;
    }>(
      `select
         (select count(*)::int from analytics.player_injury_status_history) as hist_n,
         (select count(distinct player_id)::int from analytics.player_injury_status_history) as hist_players,
         (select min(snapshot_at) from analytics.player_injury_status_history) as hist_min,
         (select max(snapshot_at) from analytics.player_injury_status_history) as hist_max,
         (select count(*)::int from analytics.player_injury_status_current) as curr_n,
         (select count(distinct player_id)::int from analytics.player_injury_status_current) as curr_players,
         (select count(*)::int from raw.player_injuries) as raw_n,
         (select min(created_at) from raw.player_injuries) as raw_min,
         (select max(created_at) from raw.player_injuries) as raw_max,
         (select count(*)::int from analytics.player_team_stints where season = '2025') as stints_2025`
    );
    injuryFeasibility = {
      history: {
        rows: inj.rows[0]?.hist_n ?? 0,
        players: inj.rows[0]?.hist_players ?? 0,
        minSnapshotAt: inj.rows[0]?.hist_min ?? null,
        maxSnapshotAt: inj.rows[0]?.hist_max ?? null,
      },
      current: {
        rows: inj.rows[0]?.curr_n ?? 0,
        players: inj.rows[0]?.curr_players ?? 0,
        note: 'Latest state only; not an as-of timeline for historical games.',
      },
      rawInjuries: {
        rows: inj.rows[0]?.raw_n ?? 0,
        minSnapshotAt: inj.rows[0]?.raw_min ?? null,
        maxSnapshotAt: inj.rows[0]?.raw_max ?? null,
      },
      stints2025: inj.rows[0]?.stints_2025 ?? 0,
    };

    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET is required for S3 reads');
  const s3 = new S3Storage({ bucket });

  const propObjects = await loadS3GameObjects(s3, PROP_PREFIX);
  const oddsObjects = await loadS3GameObjects(s3, ODDS_PREFIX);

  const openingProps: OpeningProp[] = [];
  let propSampleKeys: string[] | null = null;
  for (const obj of propObjects) {
    const body = await s3.getJson(obj.key);
    const rows = extractRows(body);
    const gid = gameIdFromKey(obj.key);
    if (!propSampleKeys && rows[0]) propSampleKeys = Object.keys(rows[0]);
    for (const row of rows) {
      const parsed = parseOpeningProp(row, gid);
      if (parsed) openingProps.push(parsed);
    }
  }

  const openingOdds: OpeningOddsRow[] = [];
  let oddsSampleKeys: string[] | null = null;
  for (const obj of oddsObjects) {
    const body = await s3.getJson(obj.key);
    const rows = extractRows(body);
    const gid = gameIdFromKey(obj.key);
    if (!oddsSampleKeys && rows[0]) oddsSampleKeys = Object.keys(rows[0]);
    for (const row of rows) {
      const parsed = parseOpeningOdds(row, gid);
      if (parsed) openingOdds.push(parsed);
    }
  }

  const ambiguousKeys = findAmbiguousSimultaneousLineKeys(
    openingProps
      .filter((r): r is OpeningProp & { canonical: CanonicalProp } => r.canonical != null)
      .map((r) => ({
        gameId: r.gameId,
        playerId: r.playerId,
        vendor: r.vendor,
        propType: r.canonical,
        line: r.line,
      }))
  );
  for (const r of openingProps) {
    if (!r.canonical) continue;
    const k = playerPropMatchKey({
      gameId: r.gameId,
      playerId: r.playerId,
      vendor: r.vendor,
      propType: r.canonical,
    });
    if (ambiguousKeys.has(k)) r.ambiguous = true;
  }

  const closeIndex = new Map<string, { over?: ClosingProp; under?: ClosingProp; any?: ClosingProp }>();
  for (const c of closingProps) {
    if (!c.canonical) continue;
    const k = `${c.gameId}|${c.playerId}|${c.vendor}|${c.canonical}`;
    const slot = closeIndex.get(k) ?? {};
    if (c.side === 'over') slot.over = c;
    else if (c.side === 'under') slot.under = c;
    else slot.any = c;
    closeIndex.set(k, slot);
  }

  const matchedProps: MatchedProp[] = [];
  for (const r of openingProps) {
    if (!r.canonical || r.ambiguous) continue;
    const k = `${r.gameId}|${r.playerId}|${r.vendor}|${r.canonical}`;
    const close = closeIndex.get(k);
    if (!close) continue;
    const over = close.over ?? close.any;
    const under = close.under;
    matchedProps.push({
      ...r,
      closeLine: over?.line ?? under?.line ?? null,
      closeOverOdds: over?.oddsAmerican ?? null,
      closeUnderOdds: under?.oddsAmerican ?? null,
      closeOverImplied: over ? impliedFromAmerican(over.oddsAmerican) : null,
      closeUnderImplied: under ? impliedFromAmerican(under.oddsAmerican) : null,
      openOverImplied: impliedFromAmerican(r.overOdds),
      openUnderImplied: impliedFromAmerican(r.underOdds),
    });
  }

  const closeOddsIndex = new Map<string, ClosingOddsRow>();
  for (const r of closingOdds) closeOddsIndex.set(`${r.gameId}|${r.vendor}`, r);

  const sportsbookOpen = openingOdds.filter((r) => r.class === 'sportsbook');
  const predictionOpen = openingOdds.filter((r) => r.class === 'prediction-market');
  const matchedSportsbookOdds = sportsbookOpen.filter((r) => closeOddsIndex.has(`${r.gameId}|${r.vendor}`));
  const unmatchedSportsbookOdds = sportsbookOpen.filter((r) => !closeOddsIndex.has(`${r.gameId}|${r.vendor}`));

  const eligibleOpening = openingProps.filter((r) => r.canonical && !r.ambiguous);
  const vendorPropStats: Json[] = [];
  const vendorSet = new Set(openingProps.map((r) => r.vendor));
  for (const vendor of [...vendorSet].sort()) {
    for (const prop of CANONICAL_PROPS) {
      const openingRows = openingProps.filter((r) => r.vendor === vendor && r.canonical === prop);
      const eligible = openingRows.filter((r) => !r.ambiguous);
      const matched = matchedProps.filter((r) => r.vendor === vendor && r.canonical === prop);
      const games = new Set(matched.map((r) => r.gameId)).size;
      const players = new Set(matched.map((r) => r.playerId)).size;
      const openPrice = eligible.filter((r) => r.overOdds != null || r.underOdds != null).length;
      const closePrice = matched.filter((r) => r.closeOverOdds != null || r.closeUnderOdds != null).length;
      const matchPct = pct(matched.length, eligible.length);
      const openPricePct = pct(openPrice, eligible.length);
      const closePricePct = pct(closePrice, matched.length || 1);
      const smallSample = matched.length < 80 || games < 25;
      vendorPropStats.push({
        vendor,
        vendorDisplay: displayVendor(vendor),
        propType: prop,
        propDisplay: displayProp(prop),
        openingRows: openingRows.length,
        eligibleRows: eligible.length,
        deterministicMatchedRows: matched.length,
        matchPct,
        openingPricePopulationPct: openPricePct,
        closingPricePopulationPct: matched.length ? closePricePct : null,
        gamesRepresented: games,
        playersRepresented: players,
        smallSample,
        tier: qualityTier({
          matched: matched.length,
          games,
          matchPct,
          openPricePct,
          closePricePct: matched.length ? closePricePct : 0,
        }),
      });
    }
  }

  const candidateMatrix = vendorPropStats.filter((r) =>
    (PROP_CANDIDATE_VENDORS as readonly string[]).includes(String(r.vendor))
  );
  const tierA = candidateMatrix.filter((r) => r.tier === 'A');
  const candidateVendorIds = [...new Set(tierA.map((r) => String(r.vendor)))].filter((v) => v !== 'betrivers');
  const coreMarkets = ['points', 'rebounds', 'assists', 'threes'];
  const comboMarkets = ['points_rebounds', 'points_assists', 'points_rebounds_assists'];
  const v1Vendors = candidateVendorIds.filter((v) =>
    coreMarkets.every((m) =>
      candidateMatrix.some((r) => r.vendor === v && r.propType === m && r.tier === 'A')
    )
  );
  const v1Core = coreMarkets.filter((m) =>
    v1Vendors.some((v) => candidateMatrix.some((r) => r.vendor === v && r.propType === m && r.tier === 'A'))
  );
  const v1Combos = comboMarkets.filter((m) =>
    v1Vendors.some((v) => candidateMatrix.some((r) => r.vendor === v && r.propType === m && r.tier === 'A'))
  );

  const recommendedUniverse = {
    vendors: v1Vendors.length ? v1Vendors.map(displayVendor) : ['BetMGM', 'FanDuel', 'Caesars', 'DraftKings'],
    vendorIds: v1Vendors.length ? v1Vendors : ['betmgm', 'fanduel', 'caesars', 'draftkings'],
    markets: [...v1Core, ...v1Combos],
    deferred: {
      rebounds_assists: 'Tier A on strong books but less line movement than PR/PA/PRA; v1.1 candidate',
      blocks: 'Almost no line movement (99% unchanged); juice-only at best',
      steals: 'Sparse opening coverage and almost no line movement',
      fanatics: 'Tier B — ~100 opening rows per market, not v1 display',
      betrivers: 'Ambiguous simultaneous-line groups destroy points coverage; do not pick a variant',
    },
    excludedFromV1: [
      'BetRivers — 100% of ambiguous simultaneous-line groups in the opening archive; do not pick a variant arbitrarily',
      'Fanatics — useful research coverage but not v1 (small opening n)',
      'blocks / steals — insufficient movement and/or coverage for a Market Movement feature',
      'Double Double / Triple Double — unmapped, no deterministic Open→Close',
    ],
    note: 'v1 is the intersection of sample size, match rate, book/game coverage, and whether the market actually moves. Combos are included because they move ~25% of the time vs ~4–21% for counting stats.',
  };

  const productGradeVendors = new Set(recommendedUniverse.vendorIds);
  const productGradeAllMatched = matchedProps.filter((r) => productGradeVendors.has(r.vendor));

  function lineDeltas(rows: MatchedProp[]) {
    return rows
      .map((r) => (r.closeLine != null && r.line != null ? r.closeLine - r.line : null))
      .filter((n): n is number => n != null);
  }

  function lineMovementBlock(rows: MatchedProp[]) {
    const deltas = lineDeltas(rows);
    return { ...summarize(deltas), ...movementShare(deltas) };
  }

  const lineMovementOverall = lineMovementBlock(productGradeAllMatched);
  const lineMovementByProp: Json[] = CANONICAL_PROPS.map((prop) => ({
    propType: prop,
    propDisplay: displayProp(prop),
    ...lineMovementBlock(productGradeAllMatched.filter((r) => r.canonical === prop)),
  }));
  const lineMovementByVendor: Json[] = [...productGradeVendors].map((vendor) => ({
    vendor,
    vendorDisplay: displayVendor(vendor),
    ...lineMovementBlock(productGradeAllMatched.filter((r) => r.vendor === vendor)),
  }));

  function juiceRows(rows: MatchedProp[]) {
    return rows.filter(
      (r) =>
        r.line != null &&
        r.closeLine != null &&
        Math.abs(r.closeLine - r.line) < 1e-9 &&
        ((r.openOverImplied != null && r.closeOverImplied != null) ||
          (r.openUnderImplied != null && r.closeUnderImplied != null))
    );
  }

  function juiceMoves(rows: MatchedProp[]) {
    const moves: number[] = [];
    for (const r of juiceRows(rows)) {
      if (r.openOverImplied != null && r.closeOverImplied != null) {
        moves.push(r.closeOverImplied - r.openOverImplied);
      } else if (r.openUnderImplied != null && r.closeUnderImplied != null) {
        moves.push(r.closeUnderImplied - r.openUnderImplied);
      }
    }
    return moves;
  }

  function juiceAbs(rows: MatchedProp[]) {
    return juiceMoves(rows).map((x) => Math.abs(x));
  }

  function juiceBlock(rows: MatchedProp[]) {
    const signed = juiceMoves(rows);
    const abs = juiceAbs(rows);
    const n = signed.length;
    return {
      n,
      meanProbabilityMovePp: round(mean(signed) != null ? mean(signed)! * 100 : null, 3),
      medianPp: round(quantile(signed, 0.5) != null ? quantile(signed, 0.5)! * 100 : null, 3),
      p25Pp: round(quantile(signed, 0.25) != null ? quantile(signed, 0.25)! * 100 : null, 3),
      p75Pp: round(quantile(signed, 0.75) != null ? quantile(signed, 0.75)! * 100 : null, 3),
      meanAbsPp: round(mean(abs) != null ? mean(abs)! * 100 : null, 3),
      pctMeaningfulGe2pp: pct(abs.filter((x) => x >= JUICE_PP_2).length, n),
      pctMeaningfulGe5pp: pct(abs.filter((x) => x >= JUICE_PP_5).length, n),
      note: 'Implied-probability change, not raw American-odds subtraction. Not a profitability claim.',
    };
  }

  const juiceOverall = juiceBlock(productGradeAllMatched);
  const juiceByProp: Json[] = CANONICAL_PROPS.map((prop) => ({
    propType: prop,
    ...juiceBlock(productGradeAllMatched.filter((r) => r.canonical === prop)),
  }));

  function taxonomy(rows: MatchedProp[]) {
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    let skipped = 0;
    for (const r of rows) {
      const cls = classifyPropMovement({
        referenceLine: r.line,
        comparisonLine: r.closeLine,
        referenceOverImplied: r.openOverImplied,
        comparisonOverImplied: r.closeOverImplied,
        referenceUnderImplied: r.openUnderImplied,
        comparisonUnderImplied: r.closeUnderImplied,
      });
      if (cls === 'unclassified') {
        skipped += 1;
        continue;
      }
      if (cls === 'A') a += 1;
      else if (cls === 'B') b += 1;
      else if (cls === 'C') c += 1;
      else d += 1;
    }
    const n = a + b + c + d;
    return {
      n,
      skippedMissingLine: skipped,
      A_noMeaningfulMovement: { n: a, pct: pct(a, n) },
      B_juiceOnly: { n: b, pct: pct(b, n) },
      C_lineMovement: { n: c, pct: pct(c, n) },
      D_linePlusMaterialPrice: { n: d, pct: pct(d, n) },
      meaningfulMovementPct: pct(b + c + d, n),
      lineUnchangedPct: pct(a + b, n),
    };
  }

  const taxonomyOverall = taxonomy(productGradeAllMatched);
  const taxonomyByProp: Json[] = CANONICAL_PROPS.map((prop) => ({
    propType: prop,
    ...taxonomy(productGradeAllMatched.filter((r) => r.canonical === prop)),
  }));

  type BookLine = { vendor: string; openLine: number; closeLine: number | null };
  const multiBook = new Map<string, BookLine[]>();
  for (const r of productGradeAllMatched) {
    if (r.line == null) continue;
    const k = `${r.gameId}|${r.playerId}|${r.canonical}`;
    if (!multiBook.has(k)) multiBook.set(k, []);
    multiBook.get(k)!.push({ vendor: r.vendor, openLine: r.line, closeLine: r.closeLine });
  }
  const multiBookMarkets = [...multiBook.entries()].filter(([, books]) => {
    const vendors = new Set(books.map((b) => b.vendor));
    return vendors.size >= 2;
  });

  const openRanges: number[] = [];
  let allAgree = 0;
  let diff05 = 0;
  let diff10 = 0;
  let diff15 = 0;
  const disagreementByProp: Record<string, { n: number; ranges: number[]; ge10: number }> = {};
  for (const [k, books] of multiBookMarkets) {
    const uniq = new Map<string, BookLine>();
    for (const b of books) uniq.set(b.vendor, b);
    const lines = [...uniq.values()].map((b) => b.openLine);
    const range = Math.max(...lines) - Math.min(...lines);
    openRanges.push(range);
    if (range < 1e-9) allAgree += 1;
    if (Math.abs(range - 0.5) < 1e-9 || (range >= 0.5 - 1e-9 && range < 1 - 1e-9)) diff05 += 1;
    if (range >= 1 - 1e-9) diff10 += 1;
    if (range >= 1.5 - 1e-9) diff15 += 1;
    const prop = k.split('|')[2]!;
    if (!disagreementByProp[prop]) disagreementByProp[prop] = { n: 0, ranges: [], ge10: 0 };
    disagreementByProp[prop].n += 1;
    disagreementByProp[prop].ranges.push(range);
    if (range >= 1 - 1e-9) disagreementByProp[prop].ge10 += 1;
  }
  const nMulti = multiBookMarkets.length;
  const crossBook = {
    productGradeVendors: [...productGradeVendors].map(displayVendor),
    multiBookMarkets: nMulti,
    medianLineRange: round(quantile(openRanges, 0.5), 3),
    pctAllBooksAgree: pct(allAgree, nMulti),
    pctRange0p5: pct(diff05, nMulti),
    pctRangeGe1: pct(diff10, nMulti),
    pctRangeGe1p5: pct(diff15, nMulti),
    byPropType: Object.entries(disagreementByProp)
      .map(([prop, v]) => ({
        propType: prop,
        n: v.n,
        medianRange: round(quantile(v.ranges, 0.5), 3),
        pctGe1: pct(v.ge10, v.n),
      }))
      .sort((a, b) => (b.pctGe1 ?? 0) - (a.pctGe1 ?? 0)),
  };

  const closeRanges: number[] = [];
  let converge = 0;
  let diverge = 0;
  let rangeUnchanged = 0;
  let comparable = 0;
  for (const [, books] of multiBookMarkets) {
    const uniq = new Map<string, BookLine>();
    for (const b of books) uniq.set(b.vendor, b);
    const vals = [...uniq.values()].filter((b) => b.closeLine != null);
    if (vals.length < 2) continue;
    const oRange = Math.max(...[...uniq.values()].map((b) => b.openLine)) - Math.min(...[...uniq.values()].map((b) => b.openLine));
    const cRange = Math.max(...vals.map((b) => b.closeLine!)) - Math.min(...vals.map((b) => b.closeLine!));
    closeRanges.push(cRange);
    comparable += 1;
    if (cRange < oRange - 1e-9) converge += 1;
    else if (cRange > oRange + 1e-9) diverge += 1;
    else rangeUnchanged += 1;
  }
  const closingConvergence = {
    comparableMultiBookMarkets: comparable,
    medianOpeningRange: round(quantile(openRanges, 0.5), 3),
    medianClosingRange: round(quantile(closeRanges, 0.5), 3),
    pctConverge: pct(converge, comparable),
    pctDiverge: pct(diverge, comparable),
    pctUnchanged: pct(rangeUnchanged, comparable),
    note: 'Descriptive range comparison only. No causality claim.',
  };

  const consensusAtOpen = new Map<string, number>();
  const consensusAtClose = new Map<string, number>();
  for (const [k, books] of multiBookMarkets) {
    const uniq = new Map<string, BookLine>();
    for (const b of books) uniq.set(b.vendor, b);
    const opens = [...uniq.values()].map((b) => b.openLine).sort((a, b) => a - b);
    const closes = [...uniq.values()].map((b) => b.closeLine).filter((n): n is number => n != null).sort((a, b) => a - b);
    consensusAtOpen.set(k, quantile(opens, 0.5)!);
    if (closes.length) consensusAtClose.set(k, quantile(closes, 0.5)!);
  }

  const bookBehavior: Json[] = [...productGradeVendors].map((vendor) => {
    const rows = productGradeAllMatched.filter((r) => r.vendor === vendor);
    const tax = taxonomy(rows);
    const deltas = lineDeltas(rows);
    let above = 0;
    let below = 0;
    let equal = 0;
    let closer = 0;
    let farther = 0;
    let sameDist = 0;
    let consN = 0;
    for (const r of rows) {
      if (r.line == null) continue;
      const k = `${r.gameId}|${r.playerId}|${r.canonical}`;
      const cons = consensusAtOpen.get(k);
      if (cons == null) continue;
      consN += 1;
      if (r.line > cons + 1e-9) above += 1;
      else if (r.line < cons - 1e-9) below += 1;
      else equal += 1;
      const closeCons = consensusAtClose.get(k);
      if (r.closeLine != null && closeCons != null) {
        const openDist = Math.abs(r.line - cons);
        const closeDist = Math.abs(r.closeLine - closeCons);
        if (closeDist < openDist - 1e-9) closer += 1;
        else if (closeDist > openDist + 1e-9) farther += 1;
        else sameDist += 1;
      }
    }
    return {
      vendor,
      vendorDisplay: displayVendor(vendor),
      matchedMarkets: rows.length,
      lineMovementFrequencyPct: pct((tax.C_lineMovement.n ?? 0) + (tax.D_linePlusMaterialPrice.n ?? 0), tax.n),
      juiceOnlyFrequencyPct: tax.B_juiceOnly.pct,
      medianLineChange: round(quantile(deltas, 0.5), 3),
      vsOpenConsensus: {
        n: consN,
        pctAbove: pct(above, consN),
        pctBelow: pct(below, consN),
        pctEqual: pct(equal, consN),
      },
      towardCloseConsensus: {
        n: closer + farther + sameDist,
        pctCloser: pct(closer, closer + farther + sameDist),
        pctFarther: pct(farther, closer + farther + sameDist),
        pctSame: pct(sameDist, closer + farther + sameDist),
      },
      note: 'Descriptive only. Do not label any sportsbook sharp from this dataset.',
    };
  });

  const nine = new Set<string>(GAME_ODDS_PRODUCT_BOOKS);
  const targetGameIds = [...new Set(openingOdds.map((r) => r.gameId))];
  const gameConsensus: Json[] = [];
  const openSpreadRanges: number[] = [];
  const closeSpreadRanges: number[] = [];
  const openTotalRanges: number[] = [];
  const closeTotalRanges: number[] = [];
  const spreadMoves: number[] = [];
  const totalMoves: number[] = [];
  const mlMoves: number[] = [];

  for (const gameId of targetGameIds) {
    const opens = openingOdds.filter((r) => r.gameId === gameId && nine.has(r.vendor));
    const closes = opens
      .map((o) => ({ open: o, close: closeOddsIndex.get(`${gameId}|${o.vendor}`) }))
      .filter((x) => x.close);
    const openSpreads = opens.map((r) => r.spread).filter((n): n is number => n != null);
    const closeSpreads = closes.map((x) => x.close!.spread).filter((n): n is number => n != null);
    const openTotals = opens.map((r) => r.total).filter((n): n is number => n != null);
    const closeTotals = closes.map((x) => x.close!.total).filter((n): n is number => n != null);
    const openMl = opens
      .map((r) => impliedFromAmerican(r.homeMl))
      .filter((n): n is number => n != null);
    const closeMl = closes
      .map((x) => impliedFromAmerican(x.close!.homeMl))
      .filter((n): n is number => n != null);
    const openSpreadMed = quantile(openSpreads, 0.5);
    const closeSpreadMed = quantile(closeSpreads, 0.5);
    const openTotalMed = quantile(openTotals, 0.5);
    const closeTotalMed = quantile(closeTotals, 0.5);
    const openMlMed = quantile(openMl, 0.5);
    const closeMlMed = quantile(closeMl, 0.5);
    if (openSpreads.length >= 2) openSpreadRanges.push(Math.max(...openSpreads) - Math.min(...openSpreads));
    if (closeSpreads.length >= 2) closeSpreadRanges.push(Math.max(...closeSpreads) - Math.min(...closeSpreads));
    if (openTotals.length >= 2) openTotalRanges.push(Math.max(...openTotals) - Math.min(...openTotals));
    if (closeTotals.length >= 2) closeTotalRanges.push(Math.max(...closeTotals) - Math.min(...closeTotals));
    if (openSpreadMed != null && closeSpreadMed != null) spreadMoves.push(closeSpreadMed - openSpreadMed);
    if (openTotalMed != null && closeTotalMed != null) totalMoves.push(closeTotalMed - openTotalMed);
    if (openMlMed != null && closeMlMed != null) mlMoves.push(closeMlMed - openMlMed);
    gameConsensus.push({
      gameId,
      openSpreadMedian: round(openSpreadMed, 3),
      closeSpreadMedian: round(closeSpreadMed, 3),
      openTotalMedian: round(openTotalMed, 3),
      closeTotalMedian: round(closeTotalMed, 3),
      openHomeWpMedian: round(openMlMed != null ? openMlMed * 100 : null, 2),
      closeHomeWpMedian: round(closeMlMed != null ? closeMlMed * 100 : null, 2),
    });
  }

  const gameOddsConsensus = {
    gamesAnalyzed: targetGameIds.length,
    productGradeBooks: [...GAME_ODDS_PRODUCT_BOOKS],
    excludedBetway: true,
    predictionMarketsSeparated: true,
    medianSpreadMovement: round(quantile(spreadMoves, 0.5), 3),
    medianTotalMovement: round(quantile(totalMoves, 0.5), 3),
    medianHomeImpliedProbabilityMovePp: round((quantile(mlMoves, 0.5) ?? 0) * 100, 3),
    spreadMovement: { ...summarize(spreadMoves), ...movementShare(spreadMoves) },
    totalMovement: { ...summarize(totalMoves), ...movementShare(totalMoves) },
    crossBookDispersion: {
      medianOpeningSpreadRange: round(quantile(openSpreadRanges, 0.5), 3),
      medianClosingSpreadRange: round(quantile(closeSpreadRanges, 0.5), 3),
      medianOpeningTotalRange: round(quantile(openTotalRanges, 0.5), 3),
      medianClosingTotalRange: round(quantile(closeTotalRanges, 0.5), 3),
    },
    note: 'Medians reduce outlier impact. Window is certified Mar 9–22 2026 only.',
  };

  const outliers: Json[] = [];
  for (const open of sportsbookOpen.filter((r) => nine.has(r.vendor))) {
    const close = closeOddsIndex.get(`${open.gameId}|${open.vendor}`);
    if (!close) continue;
    const spreadDelta =
      open.spread != null && close.spread != null ? close.spread - open.spread : null;
    const totalDelta = open.total != null && close.total != null ? close.total - open.total : null;
    const extremeSpread = spreadDelta != null && Math.abs(spreadDelta) >= SPREAD_OUTLIER_ABS;
    const extremeTotal = totalDelta != null && Math.abs(totalDelta) >= TOTAL_OUTLIER_ABS;
    if (!extremeSpread && !extremeTotal) continue;
    const peers = sportsbookOpen.filter((r) => r.gameId === open.gameId && nine.has(r.vendor) && r.vendor !== open.vendor);
    const peerSpreadMoves: number[] = [];
    const peerTotalMoves: number[] = [];
    const peerOpenSpreads = peers.map((p) => p.spread).filter((n): n is number => n != null);
    const peerOpenTotals = peers.map((p) => p.total).filter((n): n is number => n != null);
    for (const p of peers) {
      const pc = closeOddsIndex.get(`${p.gameId}|${p.vendor}`);
      if (!pc) continue;
      if (p.spread != null && pc.spread != null) peerSpreadMoves.push(pc.spread - p.spread);
      if (p.total != null && pc.total != null) peerTotalMoves.push(pc.total - p.total);
    }
    const consSpreadMove = quantile(peerSpreadMoves, 0.5);
    const consTotalMove = quantile(peerTotalMoves, 0.5);
    const openVsPeerSpread =
      open.spread != null && peerOpenSpreads.length
        ? open.spread - quantile(peerOpenSpreads, 0.5)!
        : null;
    const openVsPeerTotal =
      open.total != null && peerOpenTotals.length ? open.total - quantile(peerOpenTotals, 0.5)! : null;
    let classification = 'legitimate_or_unclear';
    if (
      (spreadDelta != null &&
        consSpreadMove != null &&
        Math.abs(spreadDelta - consSpreadMove) >= CONSENSUS_DIVERGE_ABS) ||
      (totalDelta != null &&
        consTotalMove != null &&
        Math.abs(totalDelta - consTotalMove) >= CONSENSUS_DIVERGE_ABS)
    ) {
      if (
        (openVsPeerSpread != null && Math.abs(openVsPeerSpread) >= CONSENSUS_DIVERGE_ABS) ||
        (openVsPeerTotal != null && Math.abs(openVsPeerTotal) >= CONSENSUS_DIVERGE_ABS)
      ) {
        classification = 'suspicious_opening_snapshot';
      } else {
        classification = 'suspicious_vendor_move_vs_consensus';
      }
    } else {
      classification = 'aligned_with_cross_book_consensus';
    }
    outliers.push({
      gameId: open.gameId,
      vendor: open.vendor,
      spreadDelta: round(spreadDelta, 2),
      totalDelta: round(totalDelta, 2),
      consensusSpreadDelta: round(consSpreadMove, 2),
      consensusTotalDelta: round(consTotalMove, 2),
      openVsPeerSpread: round(openVsPeerSpread, 2),
      openVsPeerTotal: round(openVsPeerTotal, 2),
      classification,
    });
  }

  const outlierSummary = {
    thresholds: { spreadAbs: SPREAD_OUTLIER_ABS, totalAbs: TOTAL_OUTLIER_ABS, consensusDivergeAbs: CONSENSUS_DIVERGE_ABS },
    count: outliers.length,
    byClassification: Object.fromEntries(
      [...new Set(outliers.map((o) => String(o.classification)))].map((c) => [
        c,
        outliers.filter((o) => o.classification === c).length,
      ])
    ),
    rows: outliers,
    note: 'Raw archive was not altered. These are filter candidates only.',
  };

  const gameOddsVendorQuality: Json[] = [...new Set(openingOdds.map((r) => r.vendor))]
    .sort()
    .map((vendor) => {
      const opens = openingOdds.filter((r) => r.vendor === vendor);
      const matched = opens.filter((r) => closeOddsIndex.has(`${r.gameId}|${r.vendor}`));
      const suspicious = outliers.filter((o) => o.vendor === vendor).length;
      const klass = PREDICTION_MARKETS.has(vendor)
        ? 'prediction-market'
        : vendor === 'betway'
          ? 'not-product-grade'
          : nine.has(vendor)
            ? 'sportsbook'
            : 'other';
      const totalPop = pct(opens.filter((r) => r.total != null).length, opens.length) ?? 0;
      const spreadPop = pct(opens.filter((r) => r.spread != null).length, opens.length) ?? 0;
      let tier: 'A' | 'B' | 'C' | 'excluded' | 'prediction-market' = 'C';
      if (klass === 'prediction-market') tier = 'prediction-market';
      else if (vendor === 'betway') tier = 'excluded';
      else if (opens.length >= 100 && (pct(matched.length, opens.length) ?? 0) >= 95 && suspicious <= 2) {
        tier = spreadPop >= 90 && totalPop >= 90 ? 'A' : 'B';
      } else if (opens.length >= 50 && (pct(matched.length, opens.length) ?? 0) >= 80) tier = 'B';
      return {
        vendor,
        vendorDisplay: displayVendor(vendor),
        class: klass,
        gamesWithOpeningSnapshot: new Set(opens.map((r) => r.gameId)).size,
        openingCloseMatches: matched.length,
        matchPct: pct(matched.length, opens.length),
        spreadPopulationPct: pct(opens.filter((r) => r.spread != null).length, opens.length),
        totalPopulationPct: pct(opens.filter((r) => r.total != null).length, opens.length),
        moneylinePopulationPct: pct(opens.filter((r) => r.homeMl != null || r.awayMl != null).length, opens.length),
        suspiciousOutlierCount: suspicious,
        tier,
      };
    });

  const uniquePairs = new Map<string, { gameId: string; playerId: string }>();
  for (const r of matchedProps) uniquePairs.set(`${r.gameId}|${r.playerId}`, { gameId: r.gameId, playerId: r.playerId });
  const pairGames = [...uniquePairs.values()].map((p) => p.gameId);
  const pairPlayers = [...uniquePairs.values()].map((p) => p.playerId);

  const joinClient = await pool.connect();
  try {
    await joinClient.query('begin read only');
    await joinClient.query("set local statement_timeout = '180000'");
    const logJoin = await joinClient.query<{ n: string }>(
      `select count(*)::text as n
       from (
         select distinct t.game_id, t.player_id
         from unnest($1::text[], $2::text[]) as t(game_id, player_id)
       ) m
       join analytics.player_game_logs l
         on l.game_id = m.game_id and l.player_id = m.player_id`,
      [pairGames, pairPlayers]
    );
    const stintJoin = await joinClient.query<{ n: string }>(
      `select count(*)::text as n
       from (
         select distinct t.game_id, t.player_id
         from unnest($1::text[], $2::text[]) as t(game_id, player_id)
       ) m
       join analytics.games g on g.game_id = m.game_id
       join analytics.player_team_stints s
         on s.player_id = m.player_id
        and s.season = '2025'
        and g.start_time::date >= s.observed_from
        and (s.observed_to is null or g.start_time::date <= s.observed_to)`,
      [pairGames, pairPlayers]
    );
    const injHistJoin = await joinClient.query<{ n: string }>(
      `select count(distinct m.player_id)::text as n
       from (
         select distinct t.player_id from unnest($1::text[]) as t(player_id)
       ) m
       join analytics.player_injury_status_history h on h.player_id = m.player_id`,
      [[...new Set(pairPlayers)]]
    );
    const injAsOf = await joinClient.query<{ n: string }>(
      `select count(*)::text as n
       from (
         select distinct t.game_id, t.player_id
         from unnest($1::text[], $2::text[]) as t(game_id, player_id)
       ) m
       join analytics.games g on g.game_id = m.game_id
       join analytics.player_injury_status_history h
         on h.player_id = m.player_id
        and h.snapshot_at <= g.start_time`,
      [pairGames, pairPlayers]
    );
    const oddsGames = targetGameIds;
    const gameJoin = await joinClient.query<{ n: string }>(
      `select count(*)::text as n from analytics.games where game_id = any($1::text[])`,
      [oddsGames]
    );
    const tgsJoin = await joinClient.query<{ n: string }>(
      `select count(distinct game_id)::text as n
       from analytics.team_game_stats
       where game_id = any($1::text[])`,
      [oddsGames]
    );
    const tsaJoin = await joinClient.query<{ n: string }>(
      `select count(*)::text as n
       from analytics.games g
       join analytics.team_season_averages a on a.team_id = g.home_team_id and a.season = g.season
       where g.game_id = any($1::text[])`,
      [oddsGames]
    );
    const dbAfter = await joinClient.query<{ db_bytes: string }>(
      `select pg_database_size(current_database())::text as db_bytes`
    );
    dbBytesAfter = Number(dbAfter.rows[0]!.db_bytes);
    await joinClient.query('commit');

    joinability = {
      playerProps: {
        matchedOpeningRows: matchedProps.length,
        distinctPlayerGamePairs: uniquePairs.size,
        joinedPlayerGameLogs: Number(logJoin.rows[0]?.n ?? 0),
        playerGameLogJoinPct: pct(Number(logJoin.rows[0]?.n ?? 0), uniquePairs.size),
        joinedPlayerTeamStints: Number(stintJoin.rows[0]?.n ?? 0),
        stintJoinPct: pct(Number(stintJoin.rows[0]?.n ?? 0), uniquePairs.size),
        playersWithAnyInjuryHistory: Number(injHistJoin.rows[0]?.n ?? 0),
        playerGamesWithInjurySnapshotAtOrBeforeTip: Number(injAsOf.rows[0]?.n ?? 0),
        advancedStatsServingTable: false,
      },
      gameOdds: {
        targetedGames: oddsGames.length,
        joinedAnalyticsGames: Number(gameJoin.rows[0]?.n ?? 0),
        gamesWithTeamGameStats: Number(tgsJoin.rows[0]?.n ?? 0),
        gamesWithHomeTeamSeasonAverages: Number(tsaJoin.rows[0]?.n ?? 0),
      },
    };
  } catch (err) {
    await joinClient.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    joinClient.release();
  }

  let advPairs = 0;
  let advOverlap = 0;
  let advPages = 0;
  let advSampleKeys: string[] | null = null;
  const matchedPairSet = new Set([...uniquePairs.keys()]);
  const matchedGameSet = new Set(pairGames);
  const advGameIds = new Set<string>();
  for await (const o of s3.listByPrefix(ADV_PREFIX.endsWith('/') ? ADV_PREFIX : `${ADV_PREFIX}/`)) {
    if (!o.key.endsWith('.json') || o.key.includes('_manifest') || o.key.includes('_run')) continue;
    if (!o.key.includes('page=')) continue;
    advPages += 1;
    const body = await s3.getJson(o.key);
    const rows = extractRows(body);
    if (!advSampleKeys && rows[0]) advSampleKeys = Object.keys(rows[0]);
    for (const row of rows) {
      const ids = parseAdvancedIds(row as Json);
      if (!ids) continue;
      advPairs += 1;
      advGameIds.add(ids.gameId);
      if (matchedPairSet.has(`${ids.gameId}|${ids.playerId}`)) advOverlap += 1;
    }
  }
  const advGameOverlap = [...matchedGameSet].filter((g) => advGameIds.has(g)).length;
  (joinability.playerProps as Json).advancedStatsS3RecordsScanned = advPairs;
  (joinability.playerProps as Json).advancedStatsS3Pages = advPages;
  (joinability.playerProps as Json).advancedStatsGamesOverlapping = advGameOverlap;
  (joinability.playerProps as Json).advancedStatsGameOverlapPct = pct(advGameOverlap, matchedGameSet.size);
  (joinability.playerProps as Json).advancedStatsJoinablePairs = advOverlap;
  (joinability.playerProps as Json).advancedStatsJoinPct = pct(advOverlap, uniquePairs.size);
  (joinability.playerProps as Json).advancedStatsIdentityNote =
    advOverlap === 0 && advGameOverlap > 0
      ? 'Prop games exist in the Advanced Stats V2 archive, but nested player.id values do not match opening-prop / player_game_logs player_id. Feature F needs a player identity crosswalk.'
      : advOverlap > 0
        ? 'Nested Advanced Stats player.id + game.id join to matched prop pairs. Still S3-only — no serving table.'
        : 'Advanced Stats game overlap is incomplete relative to the prop window.';
  (joinability.playerProps as Json).advancedStatsSampleKeys = advSampleKeys;

  const propGameTimes = matchedProps
    .map((r) => gamesById.get(r.gameId)?.startTime)
    .filter((d): d is Date => !!d);
  const minPropGame = propGameTimes.length ? new Date(Math.min(...propGameTimes.map((d) => d.getTime()))) : null;
  const maxPropGame = propGameTimes.length ? new Date(Math.max(...propGameTimes.map((d) => d.getTime()))) : null;
  const histMin = injuryFeasibility.history && (injuryFeasibility.history as Json).minSnapshotAt
    ? new Date(String((injuryFeasibility.history as Json).minSnapshotAt))
    : null;
  const histMax = injuryFeasibility.history && (injuryFeasibility.history as Json).maxSnapshotAt
    ? new Date(String((injuryFeasibility.history as Json).maxSnapshotAt))
    : null;
  const injuryCoversPropWindow =
    !!histMin &&
    !!histMax &&
    !!minPropGame &&
    !!maxPropGame &&
    histMin.getTime() <= minPropGame.getTime() &&
    histMax.getTime() >= maxPropGame.getTime();

  const injuryRole = {
    sufficientForCausalStudy: false,
    haveJoinKeys: {
      playerIdOnProps: true,
      gameIdOnProps: true,
      playerIdOnInjuries: true,
      gameStartTime: true,
      advancedStatsS3PlayerGame: advPairs > 0,
      advancedStatsPairJoin: advOverlap > 0,
      lineupsArchived: false,
    },
    injuryTimelineCoversPropGames: injuryCoversPropWindow,
    propGameWindow: {
      min: minPropGame?.toISOString() ?? null,
      max: maxPropGame?.toISOString() ?? null,
    },
    injuryHistoryWindow: {
      min: histMin?.toISOString() ?? null,
      max: histMax?.toISOString() ?? null,
    },
    asOfJoinCount: (joinability.playerProps as Json).playerGamesWithInjurySnapshotAtOrBeforeTip,
    majorMissingPieces: [
      'No lineup archive yet — cannot confirm starter/bench/role at the 3-hour snapshot',
      'Injury current table is latest-state only and cannot reconstruct as-of availability',
      injuryCoversPropWindow
        ? 'Injury history exists across the prop window but is not guaranteed to be sampled densely enough around each 3-hour snapshot'
        : 'Injury history timestamps do not fully cover the prop-game window; as-of absence is not reconstructable',
      'Advanced Stats exist only on S3 (no serving table)',
      ...(advOverlap === 0
        ? ['Advanced Stats player.id does not match prop/player_game_logs player_id; identity crosswalk required']
        : []),
      'Absence vs minutes-drop vs doubtful is not operationalized',
    ],
    recommendation: 'Do not run a teammate-prop-vs-absence causal study in this trial. Feature F stays later.',
  };

  const hoursProp: number[] = [];
  for (const r of openingProps) {
    const tip = gamesById.get(r.gameId)?.startTime ?? null;
    const h = hoursBefore(r.openedAt, tip);
    if (h != null) hoursProp.push(h);
  }
  const hoursOdds: number[] = [];
  for (const r of sportsbookOpen) {
    const tip = gamesById.get(r.gameId)?.startTime ?? null;
    const h = hoursBefore(r.openedAt, tip);
    if (h != null) hoursOdds.push(h);
  }

  const features = {
    A_threeHourPreTipToClose: {
      dataReadiness: 'ready_for_scoped_v1',
      coverage: `${productGradeAllMatched.length} deterministic matches on product-grade books; ${openingProps.length} opening rows / ${propObjects.length} games`,
      majorLimitation:
        'Timestamp is a 3-hour pre-tip snapshot, not first print. Betrivers variants and unmapped DD/TD are excluded.',
      recommendedPriority: 'P1',
    },
    B_marketConsensus: {
      dataReadiness: nMulti >= 500 ? 'ready_for_scoped_v1' : 'limited',
      coverage: `${nMulti} multi-book product-grade markets`,
      majorLimitation: 'Only the v1 vendor set; not a universal sportsbook consensus.',
      recommendedPriority: 'P1',
    },
    C_lineShopping: {
      dataReadiness: 'partial',
      coverage: 'Cross-book lines exist at the 3-hour snapshot and at close for matched books',
      majorLimitation:
        'Closing side is last pre-tip decision line, not a live shoppable book. Opening archive is historical only.',
      recommendedPriority: 'P2',
    },
    D_bookMovement: {
      dataReadiness: 'ready_descriptive',
      coverage: `${[...productGradeVendors].length} product-grade books with Open→Close matches`,
      majorLimitation: 'Do not label books sharp. Betrivers excluded from v1 because of simultaneous-line groups.',
      recommendedPriority: 'P2',
    },
    E_gameOpeningSnapshotToClose: {
      dataReadiness: 'ready_with_window_warning',
      coverage: `${targetGameIds.length} games, Mar 9–22 2026, 9 product-grade books`,
      majorLimitation:
        'Not season-wide. Sportsbook opening coverage degrades beginning 2026-03-23. Label as Opening Snapshot, not opening line.',
      recommendedPriority: 'P1_historical_window',
    },
    F_marketPlusContext: {
      dataReadiness: 'not_ready',
      coverage: `Player-game log join ${String((joinability.playerProps as Json).playerGameLogJoinPct)}%; Advanced Stats S3 overlap ${String((joinability.playerProps as Json).advancedStatsJoinPct)}%`,
      majorLimitation: injuryRole.majorMissingPieces.join('; '),
      recommendedPriority: 'later',
    },
  };

  const terminology = {
    playerProps: {
      recommendedLabel: '3-Hour Pre-Tip',
      medianHoursBeforeTip: round(quantile(hoursProp, 0.5), 2),
      minHoursBeforeTip: round(hoursProp.length ? Math.min(...hoursProp) : null, 2),
      maxHoursBeforeTip: round(hoursProp.length ? Math.max(...hoursProp) : null, 2),
      avoid: ['true market open', 'opening line', 'first print'],
    },
    gameOdds: {
      recommendedLabel: 'Opening Snapshot',
      medianHoursBeforeTip: round(quantile(hoursOdds, 0.5), 2),
      coverageLimitation: 'Certified only for the Mar 9–22 2026 targeted window.',
      avoid: ['true market open', 'opening line', 'season-wide opening odds'],
    },
  };

  const whatNotToBuild = [
    'Universal all-book opening history — archive coverage is vendor-uneven and Betrivers is ambiguous',
    'Season-wide game opening odds — sportsbook openings collapse after 2026-03-22',
    'Double Double / Triple Double Open→Close — unmapped, no deterministic match',
    'Betway opening movement as a product-grade book — 3/107 games in the targeted window',
    'Arbitrary BetRivers variant selection when simultaneous lines exist',
    'Live line-shopping as if closing decision lines were current offers',
    'Betting profitability / CLV / +EV claims from this descriptive dataset',
    'Injury-driven teammate prop movement as a v1 feature — as-of injury + lineup keys are incomplete',
    'Calling the 3-hour snapshot the true market open',
    'Prediction-market (Polymarket/Kalshi) sportsbook-style spread/total movement in the same UI as books',
  ];

  const reconstructed = {
    playerProps: {
      s3GameObjects: propObjects.length,
      openingRows: openingProps.length,
      expectedOpeningRows: 44127,
      expectedMatches: 27491,
      eligibleRows: eligibleOpening.length,
      ambiguousGroups: ambiguousKeys.size,
      ambiguousRows: openingProps.filter((r) => r.ambiguous).length,
      unmappedRows: openingProps.filter((r) => !r.canonical).length,
      deterministicMatchedRows: matchedProps.length,
      matchPctOfOpening: pct(matchedProps.length, openingProps.length),
      matchPctOfEligible: pct(matchedProps.length, eligibleOpening.length),
      games: new Set(openingProps.map((r) => r.gameId)).size,
      sampleKeys: propSampleKeys,
      key: 'game_id + player_id + lower(vendor) + canonical prop_type',
      excludedAmbiguousSimultaneousLines: true,
    },
    gameOdds: {
      s3GameObjects: oddsObjects.length,
      openingRows: openingOdds.length,
      sportsbookOpeningRows: sportsbookOpen.length,
      predictionMarketOpeningRows: predictionOpen.length,
      expectedSportsbookMatches: 945,
      deterministicSportsbookMatches: matchedSportsbookOdds.length,
      unmatchedSportsbookRows: unmatchedSportsbookOdds.length,
      unmatchedVendors: [...new Set(unmatchedSportsbookOdds.map((r) => r.vendor))],
      matchPctSportsbook: pct(matchedSportsbookOdds.length, sportsbookOpen.length),
      games: targetGameIds.length,
      sampleKeys: oddsSampleKeys,
      key: 'game_id + lower(vendor)',
    },
  };

  const strongBooks = productGradeAllMatched.length >= 10000 && nMulti >= 500;
  const marketVerdict = strongBooks ? 'STRONG_SUCCESS' : matchedProps.length >= 10000 ? 'PARTIAL_SUCCESS' : 'LOW_VALUE';
  const stepVerdict = strongBooks
    ? 'GREEN — captured market data supports differentiated Court Context features'
    : matchedProps.length >= 10000
      ? 'YELLOW — useful market data but product scope remains narrow'
      : 'RED — market data does not justify product investment';

  const elapsedH = (Date.parse(generatedAt) - Date.parse(TRIAL_START_ISO)) / 3_600_000;
  const remainingH = 48 - elapsedH;
  const usableAfterReserveH = remainingH - 6;
  const remainingPriorities = {
    next: 'lineup characterization only (small sample, not full archive)',
    doNotLaunch: ['full lineup archive', '2022 S3 archive', 'additional provider probes unless a blocker appears', 'serving-table work'],
    then: 'final trial audit after lineup characterization (or skip lineups if characterization is low-value)',
    maintainSixHourReserve: true,
    remainingHoursApprox: round(remainingH, 2),
    usableAfterReserveHoursApprox: round(usableAfterReserveH, 2),
    rationale:
      'Market data is already captured. Remaining trial time should characterize lineups cheaply, then reserve 6 hours. Do not spend GOAT budget on 2022 or a full lineup crawl in this step.',
  };

  const safety = {
    productionFrozen: frozen,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    currentAnalyticsSeason: pin,
    bdlHttp: 0,
    postgresWrites: 0,
    propDecisionLinesReadOnly: true,
    gameOddsHistoryReadOnly: true,
    openingArchivesFromS3: true,
    s3RawAcquisition: 0,
    coreServingUnchanged: true,
    acquisitionLockHeld: lock.active,
    lockAcquiredThisStep: false,
    dbBytesBefore: dbBytesBefore,
    dbBytesAfter: dbBytesAfter,
    dbMb: round(dbBytesAfter / (1024 * 1024), 2),
    postgresUnchanged: dbBytesBefore === EXPECTED_DB_BYTES && dbBytesAfter === EXPECTED_DB_BYTES,
    isolation,
  };

  const report = {
    generatedAt,
    step: '7E',
    postgresWrites: false,
    bdlHttp: 0,
    safety,
    reconstructedMatchedDatasets: reconstructed,
    propVendorMarketQualityMatrix: vendorPropStats,
    recommendedPropProductUniverse: recommendedUniverse,
    propLineMovement: {
      overall: lineMovementOverall,
      byPropType: lineMovementByProp,
      byStrongVendor: lineMovementByVendor,
      comboVsCountingNote:
        'Combo markets are expected to move more than counting stats; compare byPropType medians and % moved >=1.0.',
    },
    propJuiceMovement: {
      overall: juiceOverall,
      byPropType: juiceByProp,
      thresholdsPp: { meaningful: 2, large: 5 },
    },
    movementTaxonomy: {
      overall: taxonomyOverall,
      byPropType: taxonomyByProp,
      definition: {
        A: 'line unchanged + implied-prob move < 2pp',
        B: 'line unchanged + implied-prob move >= 2pp',
        C: 'line changed, price move < 2pp or missing',
        D: 'line changed + implied-prob move >= 2pp',
      },
    },
    crossBookDispersion: crossBook,
    closingConvergence,
    bookSpecificBehavior: bookBehavior,
    gameOddsConsensusMovement: gameOddsConsensus,
    gameOddsOutliers: outlierSummary,
    gameOddsVendorQuality,
    contextJoinability: joinability,
    injuryRoleAnalysisFeasibility: injuryRole,
    candidateProductFeatures: features,
    recommendedV1Terminology: terminology,
    whatNotToBuild,
    marketDataTrialVerdict: marketVerdict,
    recommendedRemainingTrialPriorities: remainingPriorities,
    postgresUnchangedConfirmation: {
      beforeBytes: dbBytesBefore,
      afterBytes: dbBytesAfter,
      expectedBytes: EXPECTED_DB_BYTES,
      unchanged: dbBytesBefore === EXPECTED_DB_BYTES && dbBytesAfter === EXPECTED_DB_BYTES,
    },
    stepVerdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync('reports/trial/market-intelligence-analysis.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync('reports/trial/market-intelligence-analysis.md', renderMarkdown(report));
  console.log(
    JSON.stringify(
      {
        stepVerdict,
        marketDataTrialVerdict: marketVerdict,
        matchedProps: matchedProps.length,
        matchedSportsbookOdds: matchedSportsbookOdds.length,
        dbBytes: dbBytesAfter,
        bdlHttp: 0,
        postgresWrites: 0,
      },
      null,
      2
    )
  );
}

function renderMarkdown(report: Json): string {
  const s = report.safety as Json;
  const rec = report.reconstructedMatchedDatasets as Json;
  const props = rec.playerProps as Json;
  const odds = rec.gameOdds as Json;
  const uni = report.recommendedPropProductUniverse as Json;
  const tax = (report.movementTaxonomy as Json).overall as Json;
  const juice = (report.propJuiceMovement as Json).overall as Json;
  const line = (report.propLineMovement as Json).overall as Json;
  const conv = report.closingConvergence as Json;
  const disp = report.crossBookDispersion as Json;
  const gcons = report.gameOddsConsensusMovement as Json;
  const join = report.contextJoinability as Json;
  return `# Market intelligence analysis (Step 7E)

Generated: ${report.generatedAt}

**${report.stepVerdict}**

Zero BDL HTTP. Zero Postgres writes. Opening archives read from S3 only.

## Safety State

- Production frozen: ${s.productionFrozen} (\`DATA_MODE=${s.dataMode}\`, OFFSEASON=${s.offseasonMode}, CRON_DRY_RUN=${s.cronDryRun})
- Season pin: ${s.currentAnalyticsSeason}
- BDL HTTP: ${s.bdlHttp}
- Postgres writes: ${s.postgresWrites}
- Acquisition lock held: ${s.acquisitionLockHeld}
- Postgres: ${s.dbBytesAfter} bytes / ${s.dbMb} MB (expected ${EXPECTED_DB_BYTES})
- Unchanged: ${s.postgresUnchanged}

## Reconstructed Matched Datasets

### Player props
- Opening rows: ${props.openingRows} (expected ~44,127)
- Deterministic matches: ${props.deterministicMatchedRows} (expected ~27,491)
- Eligible (canonical, non-ambiguous): ${props.eligibleRows}
- Ambiguous groups/rows: ${props.ambiguousGroups} / ${props.ambiguousRows}
- Unmapped rows: ${props.unmappedRows}
- Key: \`${props.key}\`

### Game odds
- Opening rows: ${odds.openingRows}
- Sportsbook opening rows: ${odds.sportsbookOpeningRows}
- Deterministic sportsbook matches: ${odds.deterministicSportsbookMatches} (expected 945)
- Match %: ${odds.matchPctSportsbook}
- Games: ${odds.games}

## Recommended Prop Product Universe

Vendors: ${(uni.vendors as string[]).join(', ')}
Markets: ${(uni.markets as string[]).join(', ')}

## Prop Line Movement

n=${line.n} median=${line.median} mean=${line.mean} unchanged=${line.pctUnchanged}% moved≥1.0=${line.pctMovedGe10}%

## Prop Juice Movement (unchanged line)

n=${juice.n} mean abs=${juice.meanAbsPp}pp ≥2pp=${juice.pctMeaningfulGe2pp}% ≥5pp=${juice.pctMeaningfulGe5pp}%

## Movement Taxonomy

A ${JSON.stringify(tax.A_noMeaningfulMovement)} · B ${JSON.stringify(tax.B_juiceOnly)} · C ${JSON.stringify(tax.C_lineMovement)} · D ${JSON.stringify(tax.D_linePlusMaterialPrice)}

## Cross-Book Dispersion

Multi-book markets: ${disp.multiBookMarkets}; median range ${disp.medianLineRange}; all agree ${disp.pctAllBooksAgree}%

## Closing Convergence

Median open range ${conv.medianOpeningRange} vs close ${conv.medianClosingRange}; converge ${conv.pctConverge}% diverge ${conv.pctDiverge}%

## Game-Odds Consensus

Games ${gcons.gamesAnalyzed}; median spread move ${gcons.medianSpreadMovement}; median total move ${gcons.medianTotalMovement}

## Context Joinability

${JSON.stringify(join, null, 2)}

## Market-Data Trial Verdict

${report.marketDataTrialVerdict}

## What Not To Build

${(report.whatNotToBuild as string[]).map((x) => `- ${x}`).join('\n')}

## Remaining Trial Priorities

${JSON.stringify(report.recommendedRemainingTrialPriorities, null, 2)}

Machine-readable: \`reports/trial/market-intelligence-analysis.json\`
`;
}

main()
  .catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
