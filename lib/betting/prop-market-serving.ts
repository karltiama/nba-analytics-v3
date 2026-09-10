/**
 * On-demand Props Explorer market research: historical book comparison from
 * decision lines, live shopping from player_prop_lines only when fresh,
 * certified Market Movement from analytics.player_prop_market_movement.
 */

import { query, queryOne } from '@/lib/db';
import { isIngestionFrozen } from '@/lib/betting/ai-briefing-eligibility';
import {
  etCalendarDate,
  etCalendarDateFromInstant,
  historicalPaperBetAllowed,
  resolvePropsMarketContext,
  type PropsMarketContext,
} from '@/lib/betting/props-market-context';
import {
  liveShoppingAvailability,
  marketContextLabels,
  parseLineValue,
  parsePropSide,
  PROP_MARKET_BOOK_CAP,
  shoppingUnavailableMessage,
  summarizeComparableBoard,
  type PropMarketBookRow,
  type PropMarketLinePick,
  type PropSide,
} from '@/lib/betting/prop-market-compare';
import {
  getPlayerMarketMovement,
  type PlayerMarketMovementResponse,
} from '@/lib/betting/market-movement-server';

export type PropMarketResearchInput = {
  gameId: string;
  playerId: string;
  propType: string;
  side: string;
  lineValue: string | number;
  sportsbook: string;
  snapshotAt?: string;
  oddsAmerican?: number | null;
  dateEt?: string;
  todayEt?: string;
  now?: Date;
  frozen?: boolean;
};

export type PropMarketResearch = {
  marketContext: PropsMarketContext;
  lineLabel: string;
  comparisonLabel: string;
  paperBetAllowed: boolean;
  selected: {
    gameId: string;
    playerId: string;
    propType: string;
    sportsbook: string;
    side: PropSide;
    lineValue: number;
    oddsAmerican: number | null;
    snapshotAt: string | null;
  };
  shopping: {
    status: 'ok' | 'unavailable';
    reason: string | null;
    message: string | null;
    sourceTable: string | null;
    bookCount: number | null;
    marketMinLine: number | null;
    marketMaxLine: number | null;
    latestSnapshotAt: string | null;
    bestAvailableOverLine: PropMarketLinePick | null;
    bestAvailableUnderLine: PropMarketLinePick | null;
    bestPriceAtSelectedLine: PropMarketLinePick | null;
    books: PropMarketBookRow[];
  };
  /**
   * Certified 3-Hour Pre-Tip → Close Market Movement v1.
   */
  marketMovement: PlayerMarketMovementResponse;
};

type DbBookRow = {
  sportsbook: string;
  side: string;
  line_value: string | number;
  odds_american: number;
  snapshot_at: string | Date;
};

function emptyShopping(
  reason: string,
  sourceTable: string | null = null
): PropMarketResearch['shopping'] {
  return {
    status: 'unavailable',
    reason,
    message: shoppingUnavailableMessage(),
    sourceTable,
    bookCount: null,
    marketMinLine: null,
    marketMaxLine: null,
    latestSnapshotAt: null,
    bestAvailableOverLine: null,
    bestAvailableUnderLine: null,
    bestPriceAtSelectedLine: null,
    books: [],
  };
}

function toBookRow(row: DbBookRow): PropMarketBookRow | null {
  const side = parsePropSide(row.side);
  const lineValue = parseLineValue(row.line_value);
  if (!side || !isFiniteNumber(row.odds_american) || !isPresentOrZero(lineValue)) return null;
  const snapshotAt =
    row.snapshot_at instanceof Date ? row.snapshot_at.toISOString() : String(row.snapshot_at);
  return {
    sportsbook: String(row.sportsbook).trim().toLowerCase(),
    side,
    lineValue,
    oddsAmerican: row.odds_american,
    snapshotAt,
  };
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function isPresentOrZero(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

async function resolveDateEt(gameId: string, dateEt: string | undefined): Promise<string> {
  if (dateEt && /^\d{4}-\d{2}-\d{2}$/.test(dateEt)) return dateEt;
  const game = await queryOne<{ start_time: string | Date }>(
    `SELECT start_time FROM analytics.games WHERE game_id::text = $1 LIMIT 1`,
    [gameId]
  );
  return etCalendarDateFromInstant(game?.start_time) ?? etCalendarDate();
}

async function loadHistoricalBooks(
  gameId: string,
  playerId: string,
  propType: string
): Promise<PropMarketBookRow[]> {
  const rows = await query<DbBookRow>(
    `SELECT sportsbook, side, line_value, odds_american, decision_at AS snapshot_at
     FROM research.prop_decision_lines
     WHERE game_id::text = $1
       AND player_id::text = $2
       AND lower(prop_type) = lower($3)
     ORDER BY side, line_value, sportsbook
     LIMIT ${PROP_MARKET_BOOK_CAP}`,
    [gameId, playerId, propType]
  );
  return rows.map(toBookRow).filter((r): r is PropMarketBookRow => r != null);
}

async function loadLiveBooks(
  gameId: string,
  playerId: string,
  propType: string
): Promise<PropMarketBookRow[]> {
  const rows = await query<DbBookRow>(
    `SELECT sportsbook, side, line_value, odds_american, snapshot_at
     FROM analytics.player_prop_lines l
     WHERE l.game_id::text = $1
       AND l.player_id::text = $2
       AND lower(l.market_type) = lower($3)
       AND l.snapshot_at = (
         SELECT max(snapshot_at) FROM analytics.player_prop_lines
         WHERE game_id::text = $1 AND player_id::text = $2 AND lower(market_type) = lower($3)
       )
     ORDER BY side, line_value, sportsbook
     LIMIT ${PROP_MARKET_BOOK_CAP}`,
    [gameId, playerId, propType]
  );
  return rows.map(toBookRow).filter((r): r is PropMarketBookRow => r != null);
}

export async function getPropMarketResearch(
  input: PropMarketResearchInput
): Promise<PropMarketResearch | { error: string; status: number }> {
  const gameId = input.gameId.trim();
  const playerId = input.playerId.trim();
  const propType = input.propType.trim();
  const sportsbook = input.sportsbook.trim().toLowerCase();
  const side = parsePropSide(input.side);
  const lineValue = parseLineValue(input.lineValue);

  if (!gameId || !playerId || !propType || !sportsbook || !side || lineValue == null) {
    return { error: 'Missing market keys', status: 400 };
  }

  const todayEt = input.todayEt ?? etCalendarDate(input.now);
  const dateEt = await resolveDateEt(gameId, input.dateEt);
  const marketContext = resolvePropsMarketContext({ dateEt, todayEt });
  const labels = marketContextLabels(marketContext);
  const frozen = input.frozen ?? isIngestionFrozen();
  const now = input.now ?? new Date();

  const selected = {
    gameId,
    playerId,
    propType,
    sportsbook,
    side,
    lineValue,
    oddsAmerican: isFiniteNumber(input.oddsAmerican) ? input.oddsAmerican : null,
    snapshotAt: input.snapshotAt?.trim() || null,
  };

  let shopping: PropMarketResearch['shopping'];
  if (marketContext === 'historical') {
    const rows = await loadHistoricalBooks(gameId, playerId, propType);
    const board = summarizeComparableBoard(rows, selected);
    shopping = board
      ? {
          status: 'ok',
          reason: null,
          message: null,
          sourceTable: 'research.prop_decision_lines',
          bookCount: board.bookCount,
          marketMinLine: board.marketMinLine,
          marketMaxLine: board.marketMaxLine,
          latestSnapshotAt: board.latestSnapshotAt,
          bestAvailableOverLine: board.bestAvailableOverLine,
          bestAvailableUnderLine: board.bestAvailableUnderLine,
          bestPriceAtSelectedLine: board.bestPriceAtSelectedLine,
          books: board.books,
        }
      : emptyShopping('missing_shopping_data', 'research.prop_decision_lines');
  } else if (frozen) {
    shopping = emptyShopping('frozen_current', 'analytics.player_prop_lines');
  } else {
    const rows = await loadLiveBooks(gameId, playerId, propType);
    const newest = rows.map((r) => r.snapshotAt).sort().at(-1) ?? null;
    const freshness = liveShoppingAvailability({
      frozen,
      newestSnapshotAt: newest,
      selectedSnapshotAt: selected.snapshotAt,
      now,
    });
    const board = summarizeComparableBoard(rows, selected);
    shopping =
      freshness.ok && board
        ? {
            status: 'ok',
            reason: null,
            message: null,
            sourceTable: 'analytics.player_prop_lines',
            bookCount: board.bookCount,
            marketMinLine: board.marketMinLine,
            marketMaxLine: board.marketMaxLine,
            latestSnapshotAt: board.latestSnapshotAt,
            bestAvailableOverLine: board.bestAvailableOverLine,
            bestAvailableUnderLine: board.bestAvailableUnderLine,
            bestPriceAtSelectedLine: board.bestPriceAtSelectedLine,
            books: board.books,
          }
        : emptyShopping(
            freshness.ok ? 'missing_shopping_data' : freshness.reason,
            'analytics.player_prop_lines'
          );
  }

  const marketMovement = await getPlayerMarketMovement({ gameId, playerId, propType });

  return {
    marketContext,
    lineLabel: labels.lineLabel,
    comparisonLabel: labels.comparisonLabel,
    paperBetAllowed: marketContext === 'historical' ? historicalPaperBetAllowed() : true,
    selected,
    shopping,
    marketMovement,
  };
}
