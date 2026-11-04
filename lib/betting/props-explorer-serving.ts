/**
 * Shared Props Explorer query: live current table vs historical closing/decision lines.
 * Does not write to analytics.player_props_current.
 */

import { query, queryOne } from '@/lib/db';
import { getPlayerPropModelInputs, type PlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { getCalibrationVersion } from '@/lib/betting/ev-calibration';
import { resolveEvTrack } from '@/lib/betting/ev-selection-policy';
import { computePropEvFields, type PropEvFields } from '@/lib/betting/player-prop-ev-row';
import { noVigProbability } from '@/lib/betting/market-probability';
import {
  etCalendarDate,
  etCalendarDateFromInstant,
  gameHasStarted,
  isActivePaperBetAllowed,
  LATEST_OBSERVED_LINE_LABEL,
  PREGAME_LINE_LABEL,
  propsLineLabel,
  propsServingSource,
  resolvePropsMarketContext,
  type PropsMarketContext,
  type PropsServingSource,
} from '@/lib/betting/props-market-context';
import {
  ARB_MAX_QUOTE_GAP_MINUTES,
  findArb,
  type ArbQuote,
  type PropsExplorerArb,
} from '@/lib/betting/props-explorer-arb';
import {
  computeMovement,
  type MovementObservation,
  type PropsExplorerMovement,
} from '@/lib/betting/props-explorer-movement';

export type PropsExplorerDbRow = {
  game_id: string | number;
  player_id: number | string;
  player_name: string | null;
  sportsbook: string | null;
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: string | number | null;
  odds_american: number | null;
  odds_decimal: string | number | null;
  implied_probability: string | number | null;
  snapshot_at: string | Date;
  game_start_time: string | Date | null;
  nba_player_id: string | null;
  away_team_abbr: string | null;
  home_team_abbr: string | null;
  row_source?: string | null;
  opposite_implied_probability?: string | number | null;
  best_odds_american?: number | null;
  best_odds_decimal?: string | number | null;
  best_sportsbook?: string | null;
  avg_odds_decimal?: string | number | null;
  market_book_count?: string | number | null;
};

const COMPUTED_SORTS = new Set(['ev', 'ev_track_a', 'ev_track_b', 'confidence']);
/** SQL-orderable sort on the price-shopping columns (price_gap is a select alias). */
export const PRICE_GAP_SORT = 'price_gap';

/**
 * What Best price and vs Avg compare against. With one book selected there is nothing to compare
 * within the filter, so the row's price is compared with every book ("vs market"). With no filter or
 * two or more books, the comparison stays inside the selected books.
 */
export type PriceScope = 'selected_books' | 'market';
export function priceScopeForBooks(books: string[] | null | undefined): PriceScope {
  return books != null && books.length === 1 ? 'market' : 'selected_books';
}
export const PROPS_EXPLORER_MAX_LIMIT = 200;
export const PROPS_EXPLORER_EV_FETCH_CAP = 2500;

function impliedProbFromAmerican(oddsAmerican: number | null): number | null {
  if (oddsAmerican == null || Number.isNaN(oddsAmerican) || oddsAmerican === 0) return null;
  if (oddsAmerican < 0) return (-oddsAmerican) / ((-oddsAmerican) + 100);
  return 100 / (oddsAmerican + 100);
}

function unavailableEvPatch(): Pick<
  PropEvFields,
  'modelProbability' | 'ev' | 'projection' | 'confidenceTier' | 'evTrackA' | 'evTrackB'
> {
  return {
    modelProbability: null,
    ev: null,
    projection: null,
    confidenceTier: null,
    evTrackA: null,
    evTrackB: null,
  };
}

export function buildPropsExplorerWhere(sp: {
  gameId: string;
  dateEt: string;
  playerName: string;
  propType: string;
  side: string;
  sportsbook: string;
  marketType: string;
}): { sql: string; params: unknown[]; booksParamIndex: number | null } {
  const conditions: string[] = [];
  let booksParamIndex: number | null = null;
  const params: unknown[] = [];
  let i = 1;

  if (sp.gameId) {
    conditions.push(`p.game_id::text = $${i++}`);
    params.push(sp.gameId);
  } else {
    conditions.push(`g.start_time >= ($${i}::timestamp AT TIME ZONE 'America/New_York')`);
    conditions.push(`g.start_time < (($${i}::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')`);
    params.push(sp.dateEt);
    i++;
  }

  if (sp.playerName) {
    conditions.push(`COALESCE(p.player_name, pl.full_name) ILIKE $${i++}`);
    params.push(`%${sp.playerName}%`);
  }

  if (sp.propType) {
    const pattern = sp.propType.includes('%') ? sp.propType : `${sp.propType}%`;
    conditions.push(`p.prop_type ILIKE $${i++}`);
    params.push(pattern);
  }

  if (sp.side && sp.side !== 'all') {
    conditions.push(`lower(p.side) = lower($${i++})`);
    params.push(sp.side);
  }

  if (sp.sportsbook) {
    const books = sp.sportsbook.split(',').filter(Boolean).map((b) => b.toLowerCase());
    if (books.length > 0) {
      booksParamIndex = i;
      conditions.push(`lower(trim(p.sportsbook)) = ANY($${i++})`);
      params.push(books);
    }
  }

  if (sp.marketType && sp.marketType !== 'all') {
    conditions.push(`lower(p.market_type) = lower($${i++})`);
    params.push(sp.marketType);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    booksParamIndex,
  };
}

const decimalOdds = (a: string) =>
  `COALESCE(${a}.odds_decimal::float8,
            CASE WHEN ${a}.odds_american < 0 THEN 1 + 100.0 / abs(${a}.odds_american)
                 WHEN ${a}.odds_american > 0 THEN 1 + ${a}.odds_american / 100.0 END)`;

/**
 * Best and average price for the same game, player, prop, side and line across books.
 * With a book filter, only the selected books count ("best price you can get").
 */
export function marketPriceLateralSql(context: PropsMarketContext, booksParamIndex: number | null): string {
  const table =
    context === 'historical' ? 'research.prop_decision_lines' : 'analytics.player_props_current';
  const bookFilter =
    booksParamIndex == null ? '' : `AND lower(trim(m.sportsbook)) = ANY($${booksParamIndex})`;
  return `
      LEFT JOIN LATERAL (
        SELECT (array_agg(m.odds_american ORDER BY ${decimalOdds('m')} DESC NULLS LAST, m.sportsbook))[1] AS best_odds_american,
               max(${decimalOdds('m')}) AS best_odds_decimal,
               (array_agg(m.sportsbook ORDER BY ${decimalOdds('m')} DESC NULLS LAST, m.sportsbook))[1] AS best_sportsbook,
               avg(${decimalOdds('m')}) AS avg_odds_decimal,
               count(DISTINCT m.sportsbook) AS market_book_count
          FROM ${table} m
         WHERE m.game_id = p.game_id
           AND m.player_id = p.player_id
           AND m.prop_type = p.prop_type
           AND m.line_value = p.line_value
           AND lower(m.side) = lower(p.side)
           AND lower(m.market_type) = lower(p.market_type)
           ${bookFilter}
      ) mk ON true`;
}

/** Row price over the average book price, as a fraction; null with fewer than two books. */
const PRICE_GAP_SQL = `CASE WHEN mk.market_book_count >= 2 AND mk.avg_odds_decimal > 0
             THEN ${decimalOdds('p')} / mk.avg_odds_decimal - 1 END AS price_gap`;

const MARKET_COLUMNS = `mk.best_odds_american, mk.best_odds_decimal, mk.best_sportsbook,
                mk.avg_odds_decimal, mk.market_book_count, ${PRICE_GAP_SQL}`;

function fromJoin(
  context: PropsMarketContext,
  whereSql: string,
  market: { booksParamIndex: number | null } | null = null
): string {
  const mediaJoins = `
      LEFT JOIN analytics.player_provider_ids nba
        ON nba.player_entity_id = pl.player_entity_id
       AND nba.provider = 'nba'
      LEFT JOIN analytics.teams t_home ON t_home.team_id = g.home_team_id
      LEFT JOIN analytics.teams t_away ON t_away.team_id = g.away_team_id`;
  if (context === 'historical') {
    return `
      FROM research.prop_decision_lines p
      INNER JOIN analytics.games g ON g.game_id = p.game_id
      LEFT JOIN analytics.players pl ON pl.player_id = p.player_id
      ${mediaJoins}
      ${market ? marketPriceLateralSql(context, market.booksParamIndex) : ''}
      ${whereSql}
    `;
  }
  return `
      FROM analytics.player_props_current p
      INNER JOIN analytics.games g ON g.game_id = p.game_id::text
      LEFT JOIN analytics.players pl ON pl.player_id = p.player_id::text
      ${mediaJoins}
      ${market ? marketPriceLateralSql(context, market.booksParamIndex) : ''}
      ${whereSql}
    `;
}

function excludeGamesWithDecisionLines(whereSql: string): string {
  const exclusion = `NOT EXISTS (
         SELECT 1 FROM research.prop_decision_lines d
         WHERE d.game_id = p.game_id::text
       )`;
  return whereSql ? `${whereSql} AND ${exclusion}` : `WHERE ${exclusion}`;
}

/**
 * Raw implied probability of the other side of the same over/under offer
 * (same game, player, book, prop and line). Feeds the no-vig fair probability.
 */
function oppositeImpliedSql(context: PropsMarketContext): string {
  const table =
    context === 'historical' ? 'research.prop_decision_lines' : 'analytics.player_props_current';
  return `(SELECT COALESCE(o.implied_probability, 1 / NULLIF(o.odds_decimal, 0))
             FROM ${table} o
            WHERE o.game_id = p.game_id
              AND o.player_id = p.player_id
              AND o.sportsbook = p.sportsbook
              AND o.prop_type = p.prop_type
              AND o.line_value = p.line_value
              AND lower(o.market_type) = 'over_under'
              AND lower(o.side) = CASE lower(p.side) WHEN 'over' THEN 'under' WHEN 'under' THEN 'over' END
            LIMIT 1)::float8 AS opposite_implied_probability`;
}

/** Same columns as selectList, with text ids so the two tables can be combined. */
function mixedSelect(
  context: PropsMarketContext,
  rowSource: 'decision' | 'current',
  withMarket: boolean
): string {
  const observed = context === 'historical' ? 'p.decision_at' : 'p.snapshot_at';
  return `SELECT p.game_id::text AS game_id, p.player_id::text AS player_id,
                COALESCE(p.player_name, pl.full_name) AS player_name, p.sportsbook, p.prop_type,
                p.market_type, p.side, p.line_value, p.odds_american, p.odds_decimal,
                p.implied_probability, ${observed} AS snapshot_at,
                g.start_time AS game_start_time,
                nba.provider_player_id AS nba_player_id,
                t_away.abbreviation AS away_team_abbr,
                t_home.abbreviation AS home_team_abbr,
                ${oppositeImpliedSql(context)},
                ${withMarket ? `${MARKET_COLUMNS},` : ''}
                '${rowSource}'::text AS row_source`;
}

function mixedDateBody(whereSql: string, booksParamIndex: number | null, withMarket: boolean): string {
  const market = withMarket ? { booksParamIndex } : null;
  return `${mixedSelect('historical', 'decision', withMarket)}
      ${fromJoin('historical', whereSql, market)}
      UNION ALL
      ${mixedSelect('live', 'current', withMarket)}
      ${fromJoin('live', excludeGamesWithDecisionLines(whereSql), market)}`;
}

/** Count body: same rows as mixedDateBody without the per-row market lateral. */
function mixedDateCountBody(whereSql: string): string {
  return `SELECT 1 ${fromJoin('historical', whereSql)}
      UNION ALL
      SELECT 1 ${fromJoin('live', excludeGamesWithDecisionLines(whereSql))}`;
}

function selectList(context: PropsMarketContext, withMarket: boolean): string {
  const observed =
    context === 'historical' ? 'p.decision_at AS snapshot_at' : 'p.snapshot_at';
  return `SELECT p.game_id, p.player_id, COALESCE(p.player_name, pl.full_name) AS player_name, p.sportsbook, p.prop_type, p.market_type, p.side,
                p.line_value, p.odds_american, p.odds_decimal, p.implied_probability, ${observed},
                g.start_time AS game_start_time,
                nba.provider_player_id AS nba_player_id,
                t_away.abbreviation AS away_team_abbr,
                t_home.abbreviation AS home_team_abbr,
                ${oppositeImpliedSql(context)}${withMarket ? `,
                ${MARKET_COLUMNS}` : ''}`;
}

type MarketPriceRow = {
  game_id: string;
  player_id: string;
  prop_type: string;
  side: string;
  line_value: string;
  best_odds_american: number | null;
  best_odds_decimal: string | number | null;
  best_sportsbook: string | null;
  avg_odds_decimal: string | number | null;
  market_book_count: string | number | null;
};

const marketKey = (
  gameId: unknown,
  playerId: unknown,
  propType: unknown,
  side: unknown,
  line: unknown
): string =>
  [String(gameId), String(playerId), String(propType), String(side ?? '').toLowerCase(), Number(line)].join('|');

/**
 * Same aggregate as marketPriceLateralSql, for an already-fetched page of rows:
 * one grouped query instead of a lateral per matching row.
 */
async function loadMarketPrices(
  context: PropsMarketContext,
  rows: PropsExplorerDbRow[],
  books: string[] | null
): Promise<Map<string, MarketPriceRow>> {
  const out = new Map<string, MarketPriceRow>();
  if (rows.length === 0) return out;
  const table =
    context === 'historical' ? 'research.prop_decision_lines' : 'analytics.player_props_current';
  const gameIds = [...new Set(rows.map((r) => String(r.game_id)))];
  const playerIds = [...new Set(rows.map((r) => String(r.player_id)))];
  const params: unknown[] = [gameIds, playerIds];
  const bookFilter = books && books.length > 0 ? `AND lower(trim(m.sportsbook)) = ANY($3)` : '';
  if (bookFilter) params.push(books);
  const found = await query<MarketPriceRow>(
    `SELECT m.game_id::text AS game_id, m.player_id::text AS player_id, m.prop_type,
            lower(m.side) AS side, m.line_value::text AS line_value,
            (array_agg(m.odds_american ORDER BY ${decimalOdds('m')} DESC NULLS LAST, m.sportsbook))[1] AS best_odds_american,
            max(${decimalOdds('m')}) AS best_odds_decimal,
            (array_agg(m.sportsbook ORDER BY ${decimalOdds('m')} DESC NULLS LAST, m.sportsbook))[1] AS best_sportsbook,
            avg(${decimalOdds('m')}) AS avg_odds_decimal,
            count(DISTINCT m.sportsbook) AS market_book_count
       FROM ${table} m
      WHERE m.game_id::text = ANY($1::text[])
        AND m.player_id::text = ANY($2::text[])
        AND lower(m.market_type) = 'over_under'
        AND m.line_value IS NOT NULL
        ${bookFilter}
      GROUP BY 1, 2, 3, 4, 5`,
    params
  );
  for (const m of Array.isArray(found) ? found : []) out.set(marketKey(m.game_id, m.player_id, m.prop_type, m.side, m.line_value), m);
  return out;
}

/**
 * Rows that form a two-book arbitrage (see props-explorer-arb): another book's opposite side at the
 * same line, captured within the quote-gap window, adds up to under 100% implied. Live lines for
 * games that have not started only.
 */
export function arbExistsSql(booksParamIndex: number | null): string {
  const bookFilter =
    booksParamIndex == null ? '' : `AND lower(trim(o.sportsbook)) = ANY($${booksParamIndex})`;
  return `lower(p.market_type) = 'over_under'
       AND g.start_time > now()
       AND EXISTS (
         SELECT 1 FROM analytics.player_props_current o
          WHERE o.game_id = p.game_id
            AND o.player_id = p.player_id
            AND o.prop_type = p.prop_type
            AND o.line_value = p.line_value
            AND lower(o.market_type) = 'over_under'
            AND lower(o.side) = CASE lower(p.side) WHEN 'over' THEN 'under' WHEN 'under' THEN 'over' END
            AND lower(trim(o.sportsbook)) <> lower(trim(p.sportsbook))
            ${bookFilter}
            AND abs(extract(epoch FROM (o.snapshot_at - p.snapshot_at))) <= ${ARB_MAX_QUOTE_GAP_MINUTES * 60}
            AND 1 / ${decimalOdds('p')} + 1 / ${decimalOdds('o')} < 1
       )`;
}

const lineKey = (gameId: unknown, playerId: unknown, propType: unknown, line: unknown): string =>
  [String(gameId), String(playerId), String(propType), Number(line)].join('|');

/** Every live over/under quote for the page's players, grouped by game, player, prop and line. */
async function loadArbQuotes(rows: PropsExplorerDbRow[], books: string[] | null): Promise<Map<string, ArbQuote[]>> {
  const out = new Map<string, ArbQuote[]>();
  if (rows.length === 0) return out;
  const params: unknown[] = [
    [...new Set(rows.map((r) => String(r.game_id)))],
    [...new Set(rows.map((r) => String(r.player_id)))],
  ];
  const bookFilter = books && books.length > 0 ? `AND lower(trim(m.sportsbook)) = ANY($3)` : '';
  if (bookFilter) params.push(books);
  const found = await query<{
    game_id: string;
    player_id: string;
    prop_type: string;
    line_value: string;
    sportsbook: string | null;
    side: string | null;
    odds_american: number | null;
    odds_decimal: string | number | null;
    snapshot_at: string | Date;
  }>(
    `SELECT m.game_id::text AS game_id, m.player_id::text AS player_id, m.prop_type, m.line_value::text AS line_value,
            m.sportsbook, lower(m.side) AS side, m.odds_american, m.odds_decimal, m.snapshot_at
       FROM analytics.player_props_current m
      WHERE m.game_id::text = ANY($1::text[])
        AND m.player_id::text = ANY($2::text[])
        AND lower(m.market_type) = 'over_under'
        AND m.line_value IS NOT NULL
        ${bookFilter}`,
    params
  );
  for (const q of Array.isArray(found) ? found : []) {
    const k = lineKey(q.game_id, q.player_id, q.prop_type, q.line_value);
    const list = out.get(k) ?? [];
    list.push({
      sportsbook: q.sportsbook,
      side: q.side,
      oddsAmerican: q.odds_american,
      oddsDecimal: q.odds_decimal == null ? null : Number(q.odds_decimal),
      snapshotAt: q.snapshot_at,
    });
    out.set(k, list);
  }
  return out;
}

const movementKey = (gameId: unknown, playerId: unknown, sportsbook: unknown, propType: unknown): string =>
  [String(gameId), String(playerId), String(sportsbook ?? '').trim().toLowerCase(), String(propType)].join('|');

/**
 * Stored over/under history for each live row's game, player, book and prop (all lines, both sides),
 * from the append-only snapshot table. One query per page, joined on the exact keys.
 */
async function loadMovementHistory(rows: PropsExplorerDbRow[]): Promise<Map<string, MovementObservation[]>> {
  const out = new Map<string, MovementObservation[]>();
  const keys = new Map<string, [number, number, string, string]>();
  for (const r of rows) {
    const g = Number(r.game_id);
    const p = Number(r.player_id);
    const book = String(r.sportsbook ?? '').trim().toLowerCase();
    if (!Number.isFinite(g) || !Number.isFinite(p) || !book || !r.prop_type) continue;
    keys.set(movementKey(g, p, book, r.prop_type), [g, p, book, r.prop_type]);
  }
  if (keys.size === 0) return out;
  const list = [...keys.values()];
  const found = await query<{
    game_id: number;
    player_id: number;
    sportsbook: string;
    prop_type: string;
    side: string | null;
    line_value: string | null;
    odds_american: number | null;
    odds_decimal: string | number | null;
    fetched_at: string | Date;
  }>(
    `SELECT s.game_id, s.player_id, k.book AS sportsbook, s.prop_type, lower(s.side) AS side,
            s.line_value::text AS line_value, s.odds_american, s.odds_decimal, s.fetched_at
       FROM unnest($1::int[], $2::int[], $3::text[], $4::text[]) AS k(game_id, player_id, book, prop_type)
       JOIN raw.player_prop_snapshots_v2 s
         ON s.game_id = k.game_id AND s.player_id = k.player_id AND s.prop_type = k.prop_type
        AND lower(trim(s.sportsbook)) = k.book
      WHERE lower(s.market_type) = 'over_under'
        AND s.line_value IS NOT NULL`,
    [list.map((k) => k[0]), list.map((k) => k[1]), list.map((k) => k[2]), list.map((k) => k[3])]
  );
  for (const o of Array.isArray(found) ? found : []) {
    const k = movementKey(o.game_id, o.player_id, o.sportsbook, o.prop_type);
    const arr = out.get(k) ?? [];
    arr.push({
      side: o.side,
      lineValue: o.line_value == null ? null : Number(o.line_value),
      oddsAmerican: o.odds_american,
      oddsDecimal: o.odds_decimal == null ? null : Number(o.odds_decimal),
      observedAt: o.fetched_at,
    });
    out.set(k, arr);
  }
  return out;
}

async function loadInputsForPlayers(playerIds: number[]): Promise<Map<number, PlayerPropModelInputs | null>> {
  const map = new Map<number, PlayerPropModelInputs | null>();
  const unique = [...new Set(playerIds)];
  const chunkSize = 12;
  for (let c = 0; c < unique.length; c += chunkSize) {
    const chunk = unique.slice(c, c + chunkSize);
    await Promise.all(
      chunk.map(async (id) => {
        try {
          const inputs = await getPlayerPropModelInputs(String(id));
          map.set(id, inputs);
        } catch {
          map.set(id, null);
        }
      })
    );
  }
  return map;
}

function sortKey(
  row: {
    ev?: number | null;
    evTrackA?: number | null;
    evTrackB?: number | null;
    confidenceTier?: string | null;
    snapshotAt: string;
  },
  sort: string
): number {
  if (sort === 'ev' || sort === 'ev_track_a' || sort === 'ev_track_b') {
    const v =
      sort === 'ev_track_a' ? row.evTrackA : sort === 'ev_track_b' ? row.evTrackB : row.ev;
    return v == null || !Number.isFinite(v) ? Number.NEGATIVE_INFINITY : v;
  }
  if (sort === 'confidence') {
    const t = row.confidenceTier;
    return t === 'high' ? 3 : t === 'medium' ? 2 : t === 'low' ? 1 : 0;
  }
  return new Date(row.snapshotAt).getTime();
}

export type PropsExplorerRow = {
  gameId: string | number;
  playerId: number;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  marketType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  impliedProbability: number | null;
  /** No-vig probability from both sides of the same book and line; null without a matched pair. */
  fairProbability: number | null;
  /** Price shopping across books for the same player, prop, side and line. */
  bestPrice: PropsExplorerBestPrice | null;
  /** Two-book arbitrage this row forms, for live lines before tip; null otherwise. */
  arb: PropsExplorerArb | null;
  /** Line and price movement at this book since the first stored pull; live over/under rows only. */
  movement: PropsExplorerMovement | null;
  snapshotAt: string;
  marketContext: PropsMarketContext;
  lineLabel: string;
  paperBetAllowed: boolean;
  sourceTable: PropsServingSource;
  nbaPlayerId: string | null;
  awayTeamAbbr: string | null;
  homeTeamAbbr: string | null;
} & Partial<PropEvFields> & {
    evSelectedTrack?: string;
    calibrationVersion?: string;
  };

export type PropsExplorerBestPrice = {
  oddsAmerican: number | null;
  oddsDecimal: number;
  sportsbook: string | null;
  /** Books quoting this exact line and side (within the book filter, when set). */
  bookCount: number;
  /** This row is the best available price (ties count). */
  isBest: boolean;
  /** This row's decimal price over the average book's, minus 1; null with one book. */
  vsAverage: number | null;
  /** True when compared with every book because only one book is selected. */
  marketWide: boolean;
};

const num = (v: string | number | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function toBestPrice(
  r: Pick<
    PropsExplorerDbRow,
    | 'odds_decimal'
    | 'odds_american'
    | 'best_odds_american'
    | 'best_odds_decimal'
    | 'best_sportsbook'
    | 'avg_odds_decimal'
    | 'market_book_count'
  >
): PropsExplorerBestPrice | null {
  const best = num(r.best_odds_decimal);
  const bookCount = num(r.market_book_count) ?? 0;
  if (best == null || best <= 1 || bookCount < 1) return null;
  const american = r.odds_american;
  const own =
    num(r.odds_decimal) ??
    (american == null || american === 0
      ? null
      : american < 0
        ? 1 + 100 / Math.abs(american)
        : 1 + american / 100);
  const avg = num(r.avg_odds_decimal);
  return {
    oddsAmerican: r.best_odds_american ?? null,
    oddsDecimal: best,
    sportsbook: r.best_sportsbook ?? null,
    bookCount,
    isBest: own != null && own >= best - 1e-9,
    vsAverage: bookCount >= 2 && own != null && avg != null && avg > 0 ? own / avg - 1 : null,
    marketWide: false,
  };
}

export type GetPlayerPropsForExplorerInput = {
  dateEt: string;
  gameId?: string;
  playerName?: string;
  propType?: string;
  side?: string;
  sportsbook?: string;
  marketType?: string;
  sort?: string;
  dirAsc?: boolean;
  limit: number;
  offset: number;
  minEv?: number | null;
  /** Only rows that form a two-book arbitrage (live lines before tip). */
  arbOnly?: boolean;
  todayEt?: string;
  now?: Date;
};

export type SelectedExplorerGame = {
  gameId: string;
  awayAbbr: string | null;
  homeAbbr: string | null;
  found: boolean;
};

function teamAbbr(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

export async function getPlayerPropsForExplorer(
  input: GetPlayerPropsForExplorerInput
): Promise<{
  rows: PropsExplorerRow[];
  totalMatching: number;
  marketContext: PropsMarketContext;
  sourceTable: PropsServingSource;
  lineLabel: string;
  dateEt: string;
  evSelectedTrack: string;
  calibrationVersion: string | null;
  evFetchCap: number | null;
  sort: string;
  selectedGame: SelectedExplorerGame | null;
  priceScope: PriceScope;
}> {
  const now = input.now ?? new Date();
  const todayEt = input.todayEt ?? etCalendarDate(now);
  let dateEt = input.dateEt;
  const gameId = (input.gameId ?? '').trim();
  let gameStart: string | Date | null = null;
  let selectedGame: SelectedExplorerGame | null = null;

  if (gameId) {
    const game = await queryOne<{
      start_time: string | Date | null;
      away_abbr: string | null;
      home_abbr: string | null;
    }>(
      `SELECT g.start_time,
              t_away.abbreviation AS away_abbr,
              t_home.abbreviation AS home_abbr
       FROM analytics.games g
       LEFT JOIN analytics.teams t_away ON t_away.team_id = g.away_team_id
       LEFT JOIN analytics.teams t_home ON t_home.team_id = g.home_team_id
       WHERE g.game_id = $1`,
      [gameId]
    );
    if (!game) {
      const marketContext = resolvePropsMarketContext({ dateEt, todayEt });
      const sortRaw = (input.sort || 'snapshot_at').toLowerCase();
      return {
        rows: [],
        totalMatching: 0,
        marketContext,
        sourceTable: propsServingSource(marketContext),
        lineLabel:
          marketContext === 'historical' ? propsLineLabel('historical') : LATEST_OBSERVED_LINE_LABEL,
        dateEt,
        evSelectedTrack: resolveEvTrack(),
        calibrationVersion: null,
        evFetchCap: null,
        sort: sortRaw === 'edge' ? 'snapshot_at' : sortRaw,
        selectedGame: { gameId, awayAbbr: null, homeAbbr: null, found: false },
        priceScope: priceScopeForBooks((input.sportsbook ?? '').split(',').filter(Boolean)),
      };
    }
    gameStart = game.start_time ?? null;
    selectedGame = {
      gameId,
      awayAbbr: teamAbbr(game.away_abbr),
      homeAbbr: teamAbbr(game.home_abbr),
      found: true,
    };
    const fromGame = etCalendarDateFromInstant(gameStart);
    if (fromGame) dateEt = fromGame;
  }

  const marketContext = resolvePropsMarketContext({ dateEt, todayEt });
  let readCurrent = marketContext === 'live';
  let lineLabel = propsLineLabel(marketContext);
  if (marketContext === 'historical' && gameId) {
    const counts = await queryOne<{ decision_n: string; current_n: string }>(
      `SELECT
         (SELECT count(*)::text FROM research.prop_decision_lines WHERE game_id = $1) AS decision_n,
         (SELECT count(*)::text FROM analytics.player_props_current WHERE game_id::text = $1) AS current_n`,
      [gameId]
    );
    if (Number(counts?.decision_n ?? 0) === 0 && Number(counts?.current_n ?? 0) > 0) {
      readCurrent = true;
      lineLabel = PREGAME_LINE_LABEL;
    }
  }
  let mixDateSources = false;
  if (marketContext === 'historical' && !gameId) {
    const mix = await queryOne<{ decision_games: string; current_only_games: string }>(
      `SELECT
         (SELECT count(DISTINCT d.game_id)::text
            FROM research.prop_decision_lines d
            INNER JOIN analytics.games g ON g.game_id = d.game_id
           WHERE g.start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
             AND g.start_time < (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
         ) AS decision_games,
         (SELECT count(DISTINCT c.game_id)::text
            FROM analytics.player_props_current c
            INNER JOIN analytics.games g ON g.game_id = c.game_id::text
           WHERE g.start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
             AND g.start_time < (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
             AND NOT EXISTS (
               SELECT 1 FROM research.prop_decision_lines d WHERE d.game_id = c.game_id::text
             )
         ) AS current_only_games`,
      [dateEt]
    );
    const decisionGames = Number(mix?.decision_games ?? 0);
    const currentOnlyGames = Number(mix?.current_only_games ?? 0);
    if (decisionGames > 0 && currentOnlyGames > 0) {
      mixDateSources = true;
      lineLabel = PREGAME_LINE_LABEL;
    } else if (decisionGames === 0) {
      readCurrent = true;
      lineLabel = PREGAME_LINE_LABEL;
    }
  }
  if (readCurrent && marketContext === 'live' && selectedGame?.found) {
    lineLabel = gameHasStarted(gameStart, now) ? PREGAME_LINE_LABEL : LATEST_OBSERVED_LINE_LABEL;
  }
  const sqlContext: PropsMarketContext = readCurrent ? 'live' : 'historical';
  const sourceTable = propsServingSource(sqlContext);
  const selectedTrack = resolveEvTrack();

  const built = buildPropsExplorerWhere({
    gameId,
    dateEt,
    playerName: (input.playerName ?? '').trim(),
    propType: (input.propType ?? '').trim(),
    side: (input.side || 'all').toLowerCase(),
    sportsbook: (input.sportsbook ?? '').trim(),
    marketType: (input.marketType || 'over_under').trim().toLowerCase(),
  });
  const { params: whereParams, booksParamIndex } = built;
  const selectedBooks = booksParamIndex == null ? null : (whereParams[booksParamIndex - 1] as string[]);
  const priceScope = priceScopeForBooks(selectedBooks);
  // Best price / vs Avg: the selected books, or every book when only one is selected.
  const priceBooksParamIndex = priceScope === 'market' ? null : booksParamIndex;
  // Arbs are a live, pre-tip feature: past lines are not bettable.
  const arbOnly = Boolean(input.arbOnly);
  const arbAvailable = sqlContext === 'live' && !mixDateSources;
  if (arbOnly && !arbAvailable) {
    return {
      rows: [],
      totalMatching: 0,
      marketContext,
      sourceTable,
      lineLabel,
      dateEt,
      evSelectedTrack: selectedTrack,
      calibrationVersion: null,
      evFetchCap: null,
      sort: (input.sort || 'snapshot_at').toLowerCase() === 'edge' ? 'snapshot_at' : (input.sort || 'snapshot_at').toLowerCase(),
      selectedGame,
      priceScope,
    };
  }
  const whereSql = arbOnly
    ? `${built.sql ? `${built.sql} AND` : 'WHERE'} ${arbExistsSql(booksParamIndex)}`
    : built.sql;

  const sortRaw = (input.sort || 'snapshot_at').toLowerCase();
  const sort = sortRaw === 'edge' ? 'snapshot_at' : sortRaw;
  // Only the price-gap sort needs market prices inside SQL; other sorts look them up per page.
  const sqlMarket = sort === PRICE_GAP_SORT;
  const mixedBody = mixDateSources ? mixedDateBody(whereSql, priceBooksParamIndex, sqlMarket) : '';
  const join = mixDateSources
    ? ''
    : fromJoin(sqlContext, whereSql, sqlMarket ? { booksParamIndex: priceBooksParamIndex } : null);
  const countResult = await query<{ count: string }>(
    mixDateSources
      ? `SELECT count(*)::text AS count FROM (${mixedDateCountBody(whereSql)}) mixed_rows`
      : `SELECT count(*)::text AS count ${fromJoin(sqlContext, whereSql)}`,
    whereParams
  );
  const totalMatching = parseInt(countResult[0]?.count ?? '0', 10) || 0;

  const dirAsc = Boolean(input.dirAsc);
  const observedCol = sqlContext === 'historical' ? 'p.decision_at' : 'p.snapshot_at';
  const useComputedSort = marketContext === 'live' && COMPUTED_SORTS.has(sort);
  const orderSqlCol =
    sort === PRICE_GAP_SORT
      ? PRICE_GAP_SORT
      : sort === 'odds_american'
      ? 'p.odds_american'
      : useComputedSort
        ? observedCol
        : sort === 'snapshot_at' || !COMPUTED_SORTS.has(sort)
          ? observedCol
          : observedCol;
  const orderDir = dirAsc ? 'ASC' : 'DESC';

  let dbRows: PropsExplorerDbRow[];
  if (mixDateSources) {
    const fetchParams = [...whereParams, input.limit, input.offset];
    const limIdx = whereParams.length + 1;
    const offIdx = whereParams.length + 2;
    const mixedOrder =
      sort === PRICE_GAP_SORT ? PRICE_GAP_SORT : sort === 'odds_american' ? 'odds_american' : 'snapshot_at';
    dbRows = await query<PropsExplorerDbRow>(
      `SELECT * FROM (${mixedBody}) mixed_rows
       ORDER BY ${mixedOrder} ${orderDir} NULLS LAST
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      fetchParams
    );
  } else if (useComputedSort) {
    const fetchParams = [...whereParams, PROPS_EXPLORER_EV_FETCH_CAP];
    const limIdx = whereParams.length + 1;
    dbRows = await query<PropsExplorerDbRow>(
      `${selectList(sqlContext, sqlMarket)} ${join}
       ORDER BY ${observedCol} DESC NULLS LAST
       LIMIT $${limIdx}`,
      fetchParams
    );
  } else {
    const fetchParams = [...whereParams, input.limit, input.offset];
    const limIdx = whereParams.length + 1;
    const offIdx = whereParams.length + 2;
    dbRows = await query<PropsExplorerDbRow>(
      `${selectList(sqlContext, sqlMarket)} ${join}
       ORDER BY ${orderSqlCol} ${orderDir} NULLS LAST
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      fetchParams
    );
  }

  if (!sqlMarket) {
    const books = priceScope === 'market' ? null : selectedBooks;
    const groups: Array<[PropsMarketContext, PropsExplorerDbRow[]]> = mixDateSources
      ? [
          ['historical', dbRows.filter((r) => r.row_source === 'decision')],
          ['live', dbRows.filter((r) => r.row_source === 'current')],
        ]
      : [[sqlContext, dbRows]];
    for (const [ctx, group] of groups) {
      const prices = await loadMarketPrices(ctx, group, books);
      for (const r of group) {
        const m = prices.get(marketKey(r.game_id, r.player_id, r.prop_type, r.side, r.line_value));
        if (m) Object.assign(r, m, { game_id: r.game_id, player_id: r.player_id, side: r.side, line_value: r.line_value });
      }
    }
  }

  const liveRows = mixDateSources
    ? dbRows.filter((r) => r.row_source === 'current')
    : sqlContext === 'live'
      ? dbRows
      : [];
  const arbQuotes = await loadArbQuotes(
    liveRows.filter((r) => (r.market_type ?? '').toLowerCase() === 'over_under' && !gameHasStarted(r.game_start_time, now)),
    booksParamIndex == null ? null : (whereParams[booksParamIndex - 1] as string[])
  );
  const arbFor = (r: PropsExplorerDbRow): PropsExplorerArb | null => {
    const quotes = arbQuotes.get(lineKey(r.game_id, r.player_id, r.prop_type, r.line_value));
    if (!quotes) return null;
    return findArb(
      {
        sportsbook: r.sportsbook,
        side: r.side,
        oddsAmerican: r.odds_american,
        oddsDecimal: r.odds_decimal == null ? null : Number(r.odds_decimal),
        snapshotAt: r.snapshot_at,
      },
      quotes
    );
  };

  const movementRows = liveRows.filter((r) => (r.market_type ?? '').toLowerCase() === 'over_under');
  const movementRowSet = new Set(movementRows);
  const movementHistory = await loadMovementHistory(movementRows);
  const movementFor = (r: PropsExplorerDbRow): PropsExplorerMovement | null => {
    if (!movementRowSet.has(r)) return null;
    const history = movementHistory.get(movementKey(r.game_id, r.player_id, r.sportsbook, r.prop_type));
    if (!history) return null;
    return computeMovement(
      {
        side: r.side,
        lineValue: r.line_value != null ? Number(r.line_value) : null,
        oddsAmerican: r.odds_american,
        oddsDecimal: r.odds_decimal != null ? Number(r.odds_decimal) : null,
      },
      history
    );
  };

  let inputsByPlayer = new Map<number, PlayerPropModelInputs | null>();
  if (marketContext === 'live') {
    const uniquePlayers = [
      ...new Set(dbRows.map((r) => Number(r.player_id)).filter((id) => Number.isFinite(id))),
    ];
    inputsByPlayer = await loadInputsForPlayers(uniquePlayers);
  }

  const cal = marketContext === 'live' ? getCalibrationVersion() : null;

  const rows: PropsExplorerRow[] = dbRows.map((r) => {
    const offerP =
      r.implied_probability != null
        ? Number(r.implied_probability)
        : impliedProbFromAmerican(r.odds_american);
    const playerId = Number(r.player_id);
    const evFields =
      marketContext === 'live'
        ? computePropEvFields(
            {
              prop_type: r.prop_type,
              market_type: r.market_type,
              side: r.side,
              line_value: r.line_value != null ? Number(r.line_value) : null,
              odds_american: r.odds_american,
              odds_decimal: r.odds_decimal != null ? Number(r.odds_decimal) : null,
            },
            inputsByPlayer.get(playerId) ?? null,
            selectedTrack
          )
        : unavailableEvPatch();

    const snapshotAt =
      r.snapshot_at instanceof Date ? r.snapshot_at.toISOString() : String(r.snapshot_at);

    return {
      gameId: r.game_id,
      playerId,
      playerName: r.player_name ?? null,
      sportsbook: r.sportsbook ?? null,
      propType: r.prop_type ?? null,
      marketType: r.market_type ?? null,
      side: r.side ?? null,
      lineValue: r.line_value != null ? Number(r.line_value) : null,
      oddsAmerican: r.odds_american ?? null,
      oddsDecimal: r.odds_decimal != null ? Number(r.odds_decimal) : null,
      impliedProbability: offerP != null && Number.isFinite(offerP) ? offerP : null,
      fairProbability:
        (r.market_type ?? '').toLowerCase() === 'over_under'
          ? noVigProbability(
              offerP,
              r.opposite_implied_probability != null ? Number(r.opposite_implied_probability) : null
            )
          : null,
      bestPrice: (() => {
        const bp = toBestPrice(r);
        return bp ? { ...bp, marketWide: priceScope === 'market' } : null;
      })(),
      arb: arbFor(r),
      movement: movementFor(r),
      snapshotAt,
      marketContext,
      lineLabel:
        r.row_source === 'current'
          ? PREGAME_LINE_LABEL
          : r.row_source === 'decision'
            ? propsLineLabel('historical')
            : marketContext === 'live' && gameHasStarted(r.game_start_time, now)
              ? PREGAME_LINE_LABEL
              : lineLabel,
      paperBetAllowed:
        marketContext === 'live' &&
        isActivePaperBetAllowed({ gameStartTime: r.game_start_time, now }),
      sourceTable:
        r.row_source === 'current'
          ? 'analytics.player_props_current'
          : r.row_source === 'decision'
            ? 'research.prop_decision_lines'
            : sourceTable,
      nbaPlayerId:
        r.nba_player_id != null && String(r.nba_player_id).trim() !== ''
          ? String(r.nba_player_id).trim()
          : null,
      awayTeamAbbr:
        r.away_team_abbr != null && String(r.away_team_abbr).trim() !== ''
          ? String(r.away_team_abbr).trim()
          : null,
      homeTeamAbbr:
        r.home_team_abbr != null && String(r.home_team_abbr).trim() !== ''
          ? String(r.home_team_abbr).trim()
          : null,
      ...evFields,
      evSelectedTrack: selectedTrack,
      calibrationVersion: cal ?? undefined,
    };
  });

  let outRows = rows;
  const minEv = input.minEv;
  if (marketContext === 'live' && minEv != null && Number.isFinite(minEv)) {
    outRows = outRows.filter((r) => r.ev != null && Number.isFinite(r.ev) && r.ev >= minEv);
  }

  if (useComputedSort) {
    outRows = [...outRows].sort((a, b) => {
      const ka = sortKey(a, sort);
      const kb = sortKey(b, sort);
      const cmp = ka - kb;
      return dirAsc ? cmp : -cmp;
    });
    outRows = outRows.slice(input.offset, input.offset + input.limit);
  }

  return {
    rows: outRows,
    totalMatching,
    marketContext,
    sourceTable,
    lineLabel,
    dateEt,
    evSelectedTrack: selectedTrack,
    calibrationVersion: cal,
    evFetchCap: useComputedSort ? PROPS_EXPLORER_EV_FETCH_CAP : null,
    sort,
    selectedGame,
    priceScope,
  };
}
