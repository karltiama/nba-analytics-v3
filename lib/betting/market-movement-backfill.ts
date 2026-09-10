/**
 * Deterministic Market Movement v1 historical match + serving-row builders (Step 11C).
 * Join methodology is the certified Step 7E path. Thresholds live in market-movement.ts.
 */

import {
  GAME_ODDS_CERTIFIED_WINDOW,
  GAME_ODDS_COMPARISON_KIND,
  GAME_ODDS_REFERENCE_KIND,
  PLAYER_PROP_COMPARISON_KIND,
  PLAYER_PROP_REFERENCE_KIND,
  americanOddsToImpliedProbability,
  canonicalizePropType,
  classifyPropMovement,
  findAmbiguousSimultaneousLineKeys,
  impliedProbabilityDelta,
  interpolatingQuantile,
  isPlayerPropV1PropType,
  isPlayerPropV1Vendor,
  parseAmericanOdds,
  playerPropConsensus,
  playerPropMatchKey,
  type MovementClass,
  type PlayerPropV1PropType,
  type PlayerPropV1Vendor,
} from './market-movement';

export const MARKET_MOVEMENT_V1_BACKFILL_REVISION = 'historical_v1_11c';

export const OPENING_PLAYER_PROPS_S3_PREFIX =
  'raw/source=balldontlie/league=nba/season=2025/entity=opening_player_props';
export const OPENING_GAME_ODDS_S3_PREFIX =
  'raw/source=balldontlie/league=nba/season=2025/entity=opening_game_odds/window=2026-03-09_to_2026-03-22';

export const CERTIFIED_PLAYER_OPENING_ROWS = 44127;
export const CERTIFIED_PLAYER_OPENING_GAMES = 129;
export const CERTIFIED_PLAYER_PRODUCT_GRADE_MATCHES = 24412;
export const CERTIFIED_PLAYER_V1_ALLOWLIST_MATCHES = 21132;
export const CERTIFIED_GAME_OPENING_ROWS = 1179;
export const CERTIFIED_GAME_OPENING_GAMES = 107;
export const CERTIFIED_GAME_SPORTSBOOK_OPENING_ROWS = 965;
export const CERTIFIED_GAME_SPORTSBOOK_MATCHES = 945;
export const CERTIFIED_GAME_UNMATCHED_SPORTSBOOK_ROWS = 20;

export const GAME_ODDS_PRODUCT_BOOKS = [
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

export const PREDICTION_MARKETS = new Set(['polymarket', 'kalshi']);
export const SPREAD_OUTLIER_ABS = 8;
export const TOTAL_OUTLIER_ABS = 10;
export const CONSENSUS_DIVERGE_ABS = 6;

export const PLAYER_UPSERT_BATCH_SIZE = 500;
export const GAME_UPSERT_BATCH_SIZE = 200;

const GAME_ODDS_PRODUCT_BOOK_SET = new Set<string>(GAME_ODDS_PRODUCT_BOOKS);

type Json = Record<string, unknown>;

export type ClosingProp = {
  gameId: string;
  playerId: string;
  vendor: string;
  canonical: string | null;
  side: string;
  line: number | null;
  oddsAmerican: number | null;
  decisionAt: string | null;
};

export type OpeningProp = {
  gameId: string;
  playerId: string;
  playerName: string | null;
  vendor: string;
  vendorRaw: string | null;
  rawPropType: string;
  canonical: string | null;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  openedAt: string | null;
  ambiguous: boolean;
};

export type MatchedProp = OpeningProp & {
  closeLine: number | null;
  closeOverOdds: number | null;
  closeUnderOdds: number | null;
  closeDecisionAt: string | null;
};

export type OpeningOddsRow = {
  gameId: string;
  vendor: string;
  vendorRaw: string | null;
  class: 'sportsbook' | 'prediction-market';
  homeSpread: number | null;
  homeSpreadOdds: number | null;
  awaySpread: number | null;
  awaySpreadOdds: number | null;
  total: number | null;
  overOdds: number | null;
  underOdds: number | null;
  homeMl: number | null;
  awayMl: number | null;
  openedAt: string | null;
};

export type ClosingOddsRow = {
  gameId: string;
  vendor: string;
  homeSpread: number | null;
  homeSpreadOdds: number | null;
  awaySpread: number | null;
  awaySpreadOdds: number | null;
  total: number | null;
  overOdds: number | null;
  underOdds: number | null;
  homeMl: number | null;
  awayMl: number | null;
  snapshotAt: string | null;
};

export type PlayerServingRow = {
  game_id: string;
  player_id: string;
  player_name: string | null;
  prop_type: PlayerPropV1PropType;
  vendor: PlayerPropV1Vendor;
  vendor_raw: string | null;
  reference_kind: typeof PLAYER_PROP_REFERENCE_KIND;
  reference_line: number | null;
  reference_over_odds: number | null;
  reference_under_odds: number | null;
  reference_timestamp: string | null;
  comparison_kind: typeof PLAYER_PROP_COMPARISON_KIND;
  comparison_line: number | null;
  comparison_over_odds: number | null;
  comparison_under_odds: number | null;
  comparison_timestamp: string | null;
  line_delta: number | null;
  over_implied_probability_delta: number | null;
  under_implied_probability_delta: number | null;
  movement_class: MovementClass;
  backfill_revision: string;
};

export type GameServingRow = {
  game_id: string;
  vendor: string;
  vendor_raw: string | null;
  outlier_class: string | null;
  reference_kind: typeof GAME_ODDS_REFERENCE_KIND;
  certified_window_start: typeof GAME_ODDS_CERTIFIED_WINDOW.start;
  certified_window_end: typeof GAME_ODDS_CERTIFIED_WINDOW.end;
  reference_home_spread: number | null;
  reference_home_spread_odds: number | null;
  reference_away_spread: number | null;
  reference_away_spread_odds: number | null;
  reference_total: number | null;
  reference_over_odds: number | null;
  reference_under_odds: number | null;
  reference_home_ml: number | null;
  reference_away_ml: number | null;
  reference_timestamp: string | null;
  comparison_kind: typeof GAME_ODDS_COMPARISON_KIND;
  comparison_home_spread: number | null;
  comparison_home_spread_odds: number | null;
  comparison_away_spread: number | null;
  comparison_away_spread_odds: number | null;
  comparison_total: number | null;
  comparison_over_odds: number | null;
  comparison_under_odds: number | null;
  comparison_home_ml: number | null;
  comparison_away_ml: number | null;
  comparison_timestamp: string | null;
  spread_delta: number | null;
  total_delta: number | null;
  home_ml_implied_probability_delta: number | null;
  away_ml_implied_probability_delta: number | null;
  backfill_revision: string;
};

export type PlayerMatchCounts = {
  openingRows: number;
  openingGames: number;
  v1BookRows: number;
  v1PropRows: number;
  v1BookAndPropRows: number;
  ambiguousGroups: number;
  ambiguousRows: number;
  v1AmbiguousGroups: number;
  v1AmbiguousRows: number;
  unmappedCanonical: number;
  productGradeMatched: number;
  v1MatchedBeforeDedupe: number;
  v1ServingCandidates: number;
  unmatchedV1Identities: number;
};

export function sid(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export function finiteNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
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

function nestedName(row: Json): string | null {
  const direct = sid(row.player_name) ?? sid(row.name);
  if (direct) return direct;
  const player = row.player;
  if (player && typeof player === 'object' && !Array.isArray(player)) {
    const p = player as Json;
    const name = sid(p.name);
    if (name) return name;
    const first = sid(p.first_name);
    const last = sid(p.last_name);
    if (first && last) return `${first} ${last}`;
    return first ?? last;
  }
  return null;
}

export function extractProviderRows(body: unknown): Json[] {
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

export function gameIdFromS3Key(key: string): string | null {
  const m = key.match(/game_id=([^/]+?)(?:\.json)?$/);
  return m ? m[1] : null;
}

export function isCanonicalGameArchiveObject(key: string): boolean {
  if (!key.endsWith('.json')) return false;
  if (key.includes('_manifest') || key.includes('_characterization')) return false;
  return key.includes('game_id=');
}

export function parseOpeningProp(row: Json, fallbackGameId: string | null): OpeningProp | null {
  const gameId = sid(row.game_id) ?? nestedId(row, 'game') ?? fallbackGameId;
  const playerId = sid(row.player_id) ?? nestedId(row, 'player');
  const vendorRaw = sid(row.vendor) ?? sid(row.sportsbook);
  const vendor = vendorRaw ? vendorRaw.toLowerCase() : null;
  const rawPropType = sid(row.prop_type) ?? '';
  if (!gameId || !playerId || !vendor || !rawPropType) return null;
  const market = row.market && typeof row.market === 'object' ? (row.market as Json) : null;
  return {
    gameId,
    playerId,
    playerName: nestedName(row),
    vendor,
    vendorRaw,
    rawPropType,
    canonical: canonicalizePropType(rawPropType),
    line: finiteNumber(row.line_value ?? row.line ?? row.line_score ?? market?.line_value ?? market?.line),
    overOdds: parseAmericanOdds(
      row.over_odds ?? row.over_american ?? market?.over_odds ?? market?.over_american
    ),
    underOdds: parseAmericanOdds(
      row.under_odds ?? row.under_american ?? market?.under_odds ?? market?.under_american
    ),
    openedAt: sid(row.opened_at),
    ambiguous: false,
  };
}

export function parseOpeningOdds(row: Json, fallbackGameId: string | null): OpeningOddsRow | null {
  const gameId = sid(row.game_id) ?? nestedId(row, 'game') ?? fallbackGameId;
  const vendorRaw = sid(row.vendor) ?? sid(row.sportsbook);
  const vendor = vendorRaw ? vendorRaw.toLowerCase() : null;
  if (!gameId || !vendor) return null;
  return {
    gameId,
    vendor,
    vendorRaw,
    class: PREDICTION_MARKETS.has(vendor) ? 'prediction-market' : 'sportsbook',
    homeSpread: finiteNumber(row.spread_home_value ?? row.home_spread ?? row.spread),
    homeSpreadOdds: parseAmericanOdds(row.spread_home_odds ?? row.home_spread_odds),
    awaySpread: finiteNumber(row.spread_away_value ?? row.away_spread),
    awaySpreadOdds: parseAmericanOdds(row.spread_away_odds ?? row.away_spread_odds),
    total: finiteNumber(row.total_value ?? row.total),
    overOdds: parseAmericanOdds(row.total_over_odds ?? row.over_odds),
    underOdds: parseAmericanOdds(row.total_under_odds ?? row.under_odds),
    homeMl: parseAmericanOdds(row.moneyline_home_odds ?? row.home_moneyline),
    awayMl: parseAmericanOdds(row.moneyline_away_odds ?? row.away_moneyline),
    openedAt: sid(row.opened_at),
  };
}

export function markAmbiguousOpeningProps(rows: OpeningProp[]): Set<string> {
  const keys = findAmbiguousSimultaneousLineKeys(
    rows
      .filter((r): r is OpeningProp & { canonical: string } => r.canonical != null)
      .map((r) => ({
        gameId: r.gameId,
        playerId: r.playerId,
        vendor: r.vendor,
        propType: r.canonical,
        line: r.line,
      }))
  );
  for (const r of rows) {
    if (!r.canonical) continue;
    const k = playerPropMatchKey({
      gameId: r.gameId,
      playerId: r.playerId,
      vendor: r.vendor,
      propType: r.canonical,
    });
    if (keys.has(k)) r.ambiguous = true;
  }
  return keys;
}

function closeIndexKey(gameId: string, playerId: string, vendor: string, canonical: string): string {
  return `${gameId}|${playerId}|${vendor}|${canonical}`;
}

export function indexClosingProps(closingProps: ClosingProp[]): Map<
  string,
  { over?: ClosingProp; under?: ClosingProp; any?: ClosingProp }
> {
  const closeIndex = new Map<string, { over?: ClosingProp; under?: ClosingProp; any?: ClosingProp }>();
  for (const c of closingProps) {
    if (!c.canonical) continue;
    const k = closeIndexKey(c.gameId, c.playerId, c.vendor, c.canonical);
    const slot = closeIndex.get(k) ?? {};
    if (c.side === 'over') slot.over = c;
    else if (c.side === 'under') slot.under = c;
    else slot.any = c;
    closeIndex.set(k, slot);
  }
  return closeIndex;
}

export function matchOpeningPropsToClose(
  openingProps: OpeningProp[],
  closeIndex: Map<string, { over?: ClosingProp; under?: ClosingProp; any?: ClosingProp }>
): MatchedProp[] {
  const matched: MatchedProp[] = [];
  for (const r of openingProps) {
    if (!r.canonical || r.ambiguous) continue;
    const close = closeIndex.get(closeIndexKey(r.gameId, r.playerId, r.vendor, r.canonical));
    if (!close) continue;
    const over = close.over ?? close.any;
    const under = close.under;
    matched.push({
      ...r,
      closeLine: over?.line ?? under?.line ?? null,
      closeOverOdds: over?.oddsAmerican ?? null,
      closeUnderOdds: under?.oddsAmerican ?? null,
      closeDecisionAt: over?.decisionAt ?? under?.decisionAt ?? null,
    });
  }
  return matched;
}

export function isProductGradeMatchedProp(r: MatchedProp): boolean {
  return isPlayerPropV1Vendor(r.vendor);
}

export function isPlayerV1ServingMatch(r: MatchedProp): r is MatchedProp & {
  canonical: PlayerPropV1PropType;
  vendor: PlayerPropV1Vendor;
} {
  return (
    isPlayerPropV1Vendor(r.vendor) && r.canonical != null && isPlayerPropV1PropType(r.canonical)
  );
}

function numericDelta(reference: number | null, comparison: number | null): number | null {
  if (reference == null || comparison == null) return null;
  return comparison - reference;
}

export function classifyMatchedProp(r: MatchedProp): MovementClass {
  return classifyPropMovement({
    referenceLine: r.line,
    comparisonLine: r.closeLine,
    referenceOverImplied: americanOddsToImpliedProbability(r.overOdds),
    comparisonOverImplied: americanOddsToImpliedProbability(r.closeOverOdds),
    referenceUnderImplied: americanOddsToImpliedProbability(r.underOdds),
    comparisonUnderImplied: americanOddsToImpliedProbability(r.closeUnderOdds),
  });
}

export function toPlayerServingRow(r: MatchedProp): PlayerServingRow | null {
  if (!isPlayerV1ServingMatch(r)) return null;
  return {
    game_id: r.gameId,
    player_id: r.playerId,
    player_name: r.playerName,
    prop_type: r.canonical,
    vendor: r.vendor,
    vendor_raw: r.vendorRaw,
    reference_kind: PLAYER_PROP_REFERENCE_KIND,
    reference_line: r.line,
    reference_over_odds: r.overOdds,
    reference_under_odds: r.underOdds,
    reference_timestamp: r.openedAt,
    comparison_kind: PLAYER_PROP_COMPARISON_KIND,
    comparison_line: r.closeLine,
    comparison_over_odds: r.closeOverOdds,
    comparison_under_odds: r.closeUnderOdds,
    comparison_timestamp: r.closeDecisionAt,
    line_delta: numericDelta(r.line, r.closeLine),
    over_implied_probability_delta: impliedProbabilityDelta(r.overOdds, r.closeOverOdds),
    under_implied_probability_delta: impliedProbabilityDelta(r.underOdds, r.closeUnderOdds),
    movement_class: classifyMatchedProp(r),
    backfill_revision: MARKET_MOVEMENT_V1_BACKFILL_REVISION,
  };
}

function servingGrain(row: PlayerServingRow): string {
  return `${row.game_id}|${row.player_id}|${row.prop_type}|${row.vendor}`;
}

export function dedupePlayerServingRows(rows: PlayerServingRow[]): PlayerServingRow[] {
  const byGrain = new Map<string, PlayerServingRow>();
  const sorted = [...rows].sort((a, b) => {
    const ak = servingGrain(a);
    const bk = servingGrain(b);
    if (ak !== bk) return ak < bk ? -1 : 1;
    const at = a.reference_timestamp ?? '';
    const bt = b.reference_timestamp ?? '';
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  for (const row of sorted) {
    const k = servingGrain(row);
    if (!byGrain.has(k)) byGrain.set(k, row);
  }
  return [...byGrain.values()];
}

export function buildPlayerServingDataset(input: {
  openingProps: OpeningProp[];
  closingProps: ClosingProp[];
}): {
  ambiguousKeys: Set<string>;
  matched: MatchedProp[];
  productGradeMatched: MatchedProp[];
  servingRows: PlayerServingRow[];
  unmatchedV1: OpeningProp[];
  counts: PlayerMatchCounts;
} {
  const openingProps = input.openingProps;
  const ambiguousKeys = markAmbiguousOpeningProps(openingProps);
  const closeIndex = indexClosingProps(input.closingProps);
  const matched = matchOpeningPropsToClose(openingProps, closeIndex);
  const productGradeMatched = matched.filter(isProductGradeMatchedProp);
  const v1Matched = matched.filter(isPlayerV1ServingMatch);
  const servingRows = dedupePlayerServingRows(
    v1Matched.map(toPlayerServingRow).filter((r): r is PlayerServingRow => r != null)
  );
  const servingKeys = new Set(servingRows.map(servingGrain));
  const unmatchedV1 = openingProps.filter((r) => {
    if (!r.canonical || !isPlayerPropV1Vendor(r.vendor) || !isPlayerPropV1PropType(r.canonical)) {
      return false;
    }
    if (r.ambiguous) return false;
    return !servingKeys.has(`${r.gameId}|${r.playerId}|${r.canonical}|${r.vendor}`);
  });

  const v1Ambiguous = [...ambiguousKeys].filter((k) => {
    const vendor = k.split('|')[2] ?? '';
    return isPlayerPropV1Vendor(vendor);
  });

  const counts: PlayerMatchCounts = {
    openingRows: openingProps.length,
    openingGames: new Set(openingProps.map((r) => r.gameId)).size,
    v1BookRows: openingProps.filter((r) => isPlayerPropV1Vendor(r.vendor)).length,
    v1PropRows: openingProps.filter((r) => r.canonical != null && isPlayerPropV1PropType(r.canonical)).length,
    v1BookAndPropRows: openingProps.filter(
      (r) =>
        isPlayerPropV1Vendor(r.vendor) && r.canonical != null && isPlayerPropV1PropType(r.canonical)
    ).length,
    ambiguousGroups: ambiguousKeys.size,
    ambiguousRows: openingProps.filter((r) => r.ambiguous).length,
    v1AmbiguousGroups: v1Ambiguous.length,
    v1AmbiguousRows: openingProps.filter(
      (r) => r.ambiguous && isPlayerPropV1Vendor(r.vendor)
    ).length,
    unmappedCanonical: openingProps.filter((r) => r.canonical == null).length,
    productGradeMatched: productGradeMatched.length,
    v1MatchedBeforeDedupe: v1Matched.length,
    v1ServingCandidates: servingRows.length,
    unmatchedV1Identities: unmatchedV1.length,
  };

  return { ambiguousKeys, matched, productGradeMatched, servingRows, unmatchedV1, counts };
}

export function oddsKey(gameId: string, vendor: string): string {
  return `${gameId}|${vendor}`;
}

export function indexClosingOdds(rows: ClosingOddsRow[]): Map<string, ClosingOddsRow> {
  const idx = new Map<string, ClosingOddsRow>();
  for (const r of rows) idx.set(oddsKey(r.gameId, r.vendor), r);
  return idx;
}

export type GameOddsMatchResult = {
  sportsbookOpen: OpeningOddsRow[];
  predictionOpen: OpeningOddsRow[];
  matched: Array<{ open: OpeningOddsRow; close: ClosingOddsRow }>;
  unmatched: OpeningOddsRow[];
  servingRows: GameServingRow[];
  outliers: Array<{ gameId: string; vendor: string; classification: string }>;
};

export function classifyGameOddsOutlier(args: {
  open: OpeningOddsRow;
  close: ClosingOddsRow;
  sportsbookOpen: OpeningOddsRow[];
  closeIndex: Map<string, ClosingOddsRow>;
}): string | null {
  if (!GAME_ODDS_PRODUCT_BOOK_SET.has(args.open.vendor)) return null;
  const spreadDelta = numericDelta(args.open.homeSpread, args.close.homeSpread);
  const totalDelta = numericDelta(args.open.total, args.close.total);
  const extremeSpread = spreadDelta != null && Math.abs(spreadDelta) >= SPREAD_OUTLIER_ABS;
  const extremeTotal = totalDelta != null && Math.abs(totalDelta) >= TOTAL_OUTLIER_ABS;
  if (!extremeSpread && !extremeTotal) return null;

  const peers = args.sportsbookOpen.filter(
    (r) =>
      r.gameId === args.open.gameId &&
      GAME_ODDS_PRODUCT_BOOK_SET.has(r.vendor) &&
      r.vendor !== args.open.vendor
  );
  const peerSpreadMoves: number[] = [];
  const peerTotalMoves: number[] = [];
  const peerOpenSpreads = peers.map((p) => p.homeSpread).filter((n): n is number => n != null);
  const peerOpenTotals = peers.map((p) => p.total).filter((n): n is number => n != null);
  for (const p of peers) {
    const pc = args.closeIndex.get(oddsKey(p.gameId, p.vendor));
    if (!pc) continue;
    const sd = numericDelta(p.homeSpread, pc.homeSpread);
    const td = numericDelta(p.total, pc.total);
    if (sd != null) peerSpreadMoves.push(sd);
    if (td != null) peerTotalMoves.push(td);
  }
  const consSpreadMove = interpolatingQuantile(peerSpreadMoves, 0.5);
  const consTotalMove = interpolatingQuantile(peerTotalMoves, 0.5);
  const openVsPeerSpread =
    args.open.homeSpread != null && peerOpenSpreads.length
      ? args.open.homeSpread - interpolatingQuantile(peerOpenSpreads, 0.5)!
      : null;
  const openVsPeerTotal =
    args.open.total != null && peerOpenTotals.length
      ? args.open.total - interpolatingQuantile(peerOpenTotals, 0.5)!
      : null;

  const diverges =
    (spreadDelta != null &&
      consSpreadMove != null &&
      Math.abs(spreadDelta - consSpreadMove) >= CONSENSUS_DIVERGE_ABS) ||
    (totalDelta != null &&
      consTotalMove != null &&
      Math.abs(totalDelta - consTotalMove) >= CONSENSUS_DIVERGE_ABS);

  if (diverges) {
    if (
      (openVsPeerSpread != null && Math.abs(openVsPeerSpread) >= CONSENSUS_DIVERGE_ABS) ||
      (openVsPeerTotal != null && Math.abs(openVsPeerTotal) >= CONSENSUS_DIVERGE_ABS)
    ) {
      return 'suspicious_opening_snapshot';
    }
    return 'suspicious_vendor_move_vs_consensus';
  }
  return 'aligned_with_cross_book_consensus';
}

export function assertCertifiedWindowDates(start: string, end: string): void {
  if (start !== GAME_ODDS_CERTIFIED_WINDOW.start || end !== GAME_ODDS_CERTIFIED_WINDOW.end) {
    throw new Error(
      `Game-odds serving row window ${start}..${end} is outside certified ${GAME_ODDS_CERTIFIED_WINDOW.start}..${GAME_ODDS_CERTIFIED_WINDOW.end}`
    );
  }
}

export function toGameServingRow(
  open: OpeningOddsRow,
  close: ClosingOddsRow,
  outlierClass: string | null
): GameServingRow {
  assertCertifiedWindowDates(GAME_ODDS_CERTIFIED_WINDOW.start, GAME_ODDS_CERTIFIED_WINDOW.end);
  return {
    game_id: open.gameId,
    vendor: open.vendor,
    vendor_raw: open.vendorRaw,
    outlier_class: outlierClass,
    reference_kind: GAME_ODDS_REFERENCE_KIND,
    certified_window_start: GAME_ODDS_CERTIFIED_WINDOW.start,
    certified_window_end: GAME_ODDS_CERTIFIED_WINDOW.end,
    reference_home_spread: open.homeSpread,
    reference_home_spread_odds: open.homeSpreadOdds,
    reference_away_spread: open.awaySpread,
    reference_away_spread_odds: open.awaySpreadOdds,
    reference_total: open.total,
    reference_over_odds: open.overOdds,
    reference_under_odds: open.underOdds,
    reference_home_ml: open.homeMl,
    reference_away_ml: open.awayMl,
    reference_timestamp: open.openedAt,
    comparison_kind: GAME_ODDS_COMPARISON_KIND,
    comparison_home_spread: close.homeSpread,
    comparison_home_spread_odds: close.homeSpreadOdds,
    comparison_away_spread: close.awaySpread,
    comparison_away_spread_odds: close.awaySpreadOdds,
    comparison_total: close.total,
    comparison_over_odds: close.overOdds,
    comparison_under_odds: close.underOdds,
    comparison_home_ml: close.homeMl,
    comparison_away_ml: close.awayMl,
    comparison_timestamp: close.snapshotAt,
    spread_delta: numericDelta(open.homeSpread, close.homeSpread),
    total_delta: numericDelta(open.total, close.total),
    home_ml_implied_probability_delta: impliedProbabilityDelta(open.homeMl, close.homeMl),
    away_ml_implied_probability_delta: impliedProbabilityDelta(open.awayMl, close.awayMl),
    backfill_revision: MARKET_MOVEMENT_V1_BACKFILL_REVISION,
  };
}

export function buildGameOddsServingDataset(input: {
  openingOdds: OpeningOddsRow[];
  closingOdds: ClosingOddsRow[];
}): GameOddsMatchResult {
  const closeIndex = indexClosingOdds(input.closingOdds);
  const sportsbookOpen = input.openingOdds.filter((r) => r.class === 'sportsbook');
  const predictionOpen = input.openingOdds.filter((r) => r.class === 'prediction-market');
  const matched: Array<{ open: OpeningOddsRow; close: ClosingOddsRow }> = [];
  const unmatched: OpeningOddsRow[] = [];
  for (const open of sportsbookOpen) {
    const close = closeIndex.get(oddsKey(open.gameId, open.vendor));
    if (close) matched.push({ open, close });
    else unmatched.push(open);
  }

  const outliers: Array<{ gameId: string; vendor: string; classification: string }> = [];
  const servingRows = matched.map(({ open, close }) => {
    const classification = classifyGameOddsOutlier({
      open,
      close,
      sportsbookOpen,
      closeIndex,
    });
    if (classification) outliers.push({ gameId: open.gameId, vendor: open.vendor, classification });
    return toGameServingRow(open, close, classification);
  });

  return {
    sportsbookOpen,
    predictionOpen,
    matched,
    unmatched,
    servingRows,
    outliers,
  };
}

export function movementClassCounts(rows: PlayerServingRow[]): Record<MovementClass, number> {
  const out: Record<MovementClass, number> = { A: 0, B: 0, C: 0, D: 0, unclassified: 0 };
  for (const r of rows) out[r.movement_class] += 1;
  return out;
}

export function meaningfulMovementRate(rows: PlayerServingRow[]): number | null {
  const classified = rows.filter((r) => r.movement_class !== 'unclassified');
  if (!classified.length) return null;
  const meaningful = classified.filter((r) => r.movement_class !== 'A').length;
  return (100 * meaningful) / classified.length;
}

export function consensusCoverageFromPlayerRows(rows: PlayerServingRow[]): {
  byBookCount: Record<1 | 2 | 3 | 4, number>;
  consensusEligibleMarkets: number;
  uniqueMarkets: number;
} {
  const groups = new Map<string, PlayerServingRow[]>();
  for (const r of rows) {
    const k = `${r.game_id}|${r.player_id}|${r.prop_type}`;
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  const byBookCount: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let consensusEligibleMarkets = 0;
  for (const list of groups.values()) {
    const result = playerPropConsensus(list.map((r) => ({ vendor: r.vendor, line: r.comparison_line })));
    const n = result.count as 1 | 2 | 3 | 4;
    if (n >= 1 && n <= 4) byBookCount[n] += 1;
    if (result.available) consensusEligibleMarkets += 1;
  }
  return { byBookCount, consensusEligibleMarkets, uniqueMarkets: groups.size };
}

export function countDiff(actual: number, expected: number): number {
  return actual - expected;
}

export function isMaterialCountMiss(actual: number, expected: number, absTol = 0): boolean {
  return Math.abs(actual - expected) > absTol;
}
