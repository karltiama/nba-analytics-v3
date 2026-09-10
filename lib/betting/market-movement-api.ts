/**
 * Certified Market Movement v1 API contract (no DB client).
 * SQL accessors live in market-movement-server.ts.
 */
import {
  CONSENSUS_MEDIAN_DISCLAIMER,
  MOVEMENT_CLASS_API_LABEL,
  PLAYER_PROP_COMPARISON_KIND,
  PLAYER_PROP_CONSENSUS_MIN_BOOKS,
  PLAYER_PROP_REFERENCE_KIND,
  PLAYER_PROP_V1_VENDORS,
  displayVendor,
  playerPropApiDisplayLabel,
  playerPropConsensus,
  type ConsensusResult,
  type MovementClass,
  type PlayerPropV1PropType,
  type PlayerPropV1Vendor,
} from '@/lib/betting/market-movement';

export const PLAYER_PROP_MARKET_MOVEMENT_TABLE = 'analytics.player_prop_market_movement';
export const GAME_ODDS_MARKET_MOVEMENT_TABLE = 'analytics.game_odds_market_movement';

export type MarketMovementAvailability =
  | 'ok'
  | 'empty'
  | 'unsupported_prop';

export type ApiConsensusSnapshot = {
  available: boolean;
  median: number | null;
  min: number | null;
  max: number | null;
  bookCount: number;
};

export type PlayerMarketMovementBook = {
  vendor: PlayerPropV1Vendor;
  vendorLabel: string;
  reference: {
    line: number | null;
    overOdds: number | null;
    underOdds: number | null;
    timestamp: string | null;
  };
  comparison: {
    line: number | null;
    overOdds: number | null;
    underOdds: number | null;
    timestamp: string | null;
  };
  movement: {
    lineDelta: number | null;
    overImpliedProbabilityDelta: number | null;
    underImpliedProbabilityDelta: number | null;
    class: (typeof MOVEMENT_CLASS_API_LABEL)[MovementClass];
    classCode: MovementClass;
  };
};

export type PlayerMarketMovementResponse = {
  status: MarketMovementAvailability;
  reason: 'no_certified_historical_snapshot' | 'unsupported_prop' | null;
  sourceTable: typeof PLAYER_PROP_MARKET_MOVEMENT_TABLE;
  detail: 'full' | 'summary';
  market: {
    gameId: string;
    player: { id: string; name: string | null };
    propType: string;
    displayLabel: string;
  };
  reference: {
    kind: typeof PLAYER_PROP_REFERENCE_KIND;
    label: '3-Hour Pre-Tip';
    timestamp: string | null;
  };
  comparison: {
    kind: typeof PLAYER_PROP_COMPARISON_KIND;
    label: 'Close';
    timestamp: string | null;
  };
  consensus: {
    note: typeof CONSENSUS_MEDIAN_DISCLAIMER;
    isStatisticalMedianNotAnOfferedLine: true;
    reference: ApiConsensusSnapshot;
    comparison: ApiConsensusSnapshot;
    lineDelta: number | null;
  };
  books: PlayerMarketMovementBook[];
  coverage: {
    referenceType: typeof PLAYER_PROP_REFERENCE_KIND;
    comparisonType: typeof PLAYER_PROP_COMPARISON_KIND;
    historical: true;
    liveCurrent: false;
    eligibleBookCount: number;
    consensusMinimumBooks: typeof PLAYER_PROP_CONSENSUS_MIN_BOOKS;
    booksWithMeaningfulMovement: number;
  };
};

export type ServingJoinRow = {
  game_id: string;
  player_id: string;
  player_name: string | null;
  prop_type: string;
  vendor: string;
  reference_kind: string;
  reference_line: string | number | null;
  reference_over_odds: number | null;
  reference_under_odds: number | null;
  reference_timestamp: string | Date | null;
  comparison_kind: string;
  comparison_line: string | number | null;
  comparison_over_odds: number | null;
  comparison_under_odds: number | null;
  comparison_timestamp: string | Date | null;
  line_delta: string | number | null;
  over_implied_probability_delta: string | number | null;
  under_implied_probability_delta: string | number | null;
  movement_class: string;
};

function finiteNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

function toApiConsensus(result: ConsensusResult): ApiConsensusSnapshot {
  return {
    available: result.available,
    median: result.available ? result.median : null,
    min: result.available ? result.min : null,
    max: result.available ? result.max : null,
    bookCount: result.count,
  };
}

function emptyConsensus(): ApiConsensusSnapshot {
  return { available: false, median: null, min: null, max: null, bookCount: 0 };
}

function isMovementClass(v: string): v is MovementClass {
  return v === 'A' || v === 'B' || v === 'C' || v === 'D' || v === 'unclassified';
}

const VENDOR_ORDER = new Map(PLAYER_PROP_V1_VENDORS.map((v, i) => [v, i]));

export function playerMarketMovementSql(): string {
  return `
    SELECT
      m.game_id,
      m.player_id,
      p.full_name AS player_name,
      m.prop_type,
      m.vendor,
      m.reference_kind,
      m.reference_line,
      m.reference_over_odds,
      m.reference_under_odds,
      m.reference_timestamp,
      m.comparison_kind,
      m.comparison_line,
      m.comparison_over_odds,
      m.comparison_under_odds,
      m.comparison_timestamp,
      m.line_delta,
      m.over_implied_probability_delta,
      m.under_implied_probability_delta,
      m.movement_class
    FROM ${PLAYER_PROP_MARKET_MOVEMENT_TABLE} m
    LEFT JOIN analytics.players p ON p.player_id = m.player_id
    WHERE m.game_id = $1
      AND m.player_id = $2
      AND m.prop_type = $3
      AND m.vendor = ANY($4::text[])
    ORDER BY m.vendor
  `;
}

export function gameOddsMarketMovementSql(): string {
  return `
    SELECT game_id, vendor, reference_kind, comparison_kind,
           certified_window_start, certified_window_end
    FROM ${GAME_ODDS_MARKET_MOVEMENT_TABLE}
    WHERE game_id = $1
    ORDER BY vendor
  `;
}

export function emptyPlayerMarketMovement(input: {
  gameId: string;
  playerId: string;
  playerName: string | null;
  propType: string;
  status: MarketMovementAvailability;
  reason: PlayerMarketMovementResponse['reason'];
}): PlayerMarketMovementResponse {
  return {
    status: input.status,
    reason: input.reason,
    sourceTable: PLAYER_PROP_MARKET_MOVEMENT_TABLE,
    detail: 'full',
    market: {
      gameId: input.gameId,
      player: { id: input.playerId, name: input.playerName },
      propType: input.propType,
      displayLabel: playerPropApiDisplayLabel(input.propType),
    },
    reference: {
      kind: PLAYER_PROP_REFERENCE_KIND,
      label: '3-Hour Pre-Tip',
      timestamp: null,
    },
    comparison: {
      kind: PLAYER_PROP_COMPARISON_KIND,
      label: 'Close',
      timestamp: null,
    },
    consensus: {
      note: CONSENSUS_MEDIAN_DISCLAIMER,
      isStatisticalMedianNotAnOfferedLine: true,
      reference: emptyConsensus(),
      comparison: emptyConsensus(),
      lineDelta: null,
    },
    books: [],
    coverage: {
      referenceType: PLAYER_PROP_REFERENCE_KIND,
      comparisonType: PLAYER_PROP_COMPARISON_KIND,
      historical: true,
      liveCurrent: false,
      eligibleBookCount: 0,
      consensusMinimumBooks: PLAYER_PROP_CONSENSUS_MIN_BOOKS,
      booksWithMeaningfulMovement: 0,
    },
  };
}

export function mapServingRowsToPlayerMarketMovement(input: {
  gameId: string;
  playerId: string;
  propType: PlayerPropV1PropType;
  rows: ServingJoinRow[];
  playerNameFallback?: string | null;
}): PlayerMarketMovementResponse {
  const { gameId, playerId, propType, rows } = input;
  if (rows.length === 0) {
    return emptyPlayerMarketMovement({
      gameId,
      playerId,
      playerName: input.playerNameFallback ?? null,
      propType,
      status: 'empty',
      reason: 'no_certified_historical_snapshot',
    });
  }

  const books: PlayerMarketMovementBook[] = rows
    .filter((r): r is ServingJoinRow & { vendor: PlayerPropV1Vendor } =>
      PLAYER_PROP_V1_VENDORS.includes(r.vendor as PlayerPropV1Vendor)
    )
    .map((r) => {
      const classCode: MovementClass = isMovementClass(r.movement_class)
        ? r.movement_class
        : 'unclassified';
      return {
        vendor: r.vendor,
        vendorLabel: displayVendor(r.vendor),
        reference: {
          line: finiteNumber(r.reference_line),
          overOdds: finiteNumber(r.reference_over_odds),
          underOdds: finiteNumber(r.reference_under_odds),
          timestamp: iso(r.reference_timestamp),
        },
        comparison: {
          line: finiteNumber(r.comparison_line),
          overOdds: finiteNumber(r.comparison_over_odds),
          underOdds: finiteNumber(r.comparison_under_odds),
          timestamp: iso(r.comparison_timestamp),
        },
        movement: {
          lineDelta: finiteNumber(r.line_delta),
          overImpliedProbabilityDelta: finiteNumber(r.over_implied_probability_delta),
          underImpliedProbabilityDelta: finiteNumber(r.under_implied_probability_delta),
          class: MOVEMENT_CLASS_API_LABEL[classCode],
          classCode,
        },
      };
    })
    .sort((a, b) => (VENDOR_ORDER.get(a.vendor) ?? 99) - (VENDOR_ORDER.get(b.vendor) ?? 99));

  const referenceConsensus = toApiConsensus(
    playerPropConsensus(books.map((b) => ({ vendor: b.vendor, line: b.reference.line })))
  );
  const comparisonConsensus = toApiConsensus(
    playerPropConsensus(books.map((b) => ({ vendor: b.vendor, line: b.comparison.line })))
  );
  const lineDelta =
    referenceConsensus.available && comparisonConsensus.available
      ? comparisonConsensus.median! - referenceConsensus.median!
      : null;

  const refTs = books.map((b) => b.reference.timestamp).filter((t): t is string => t != null);
  const cmpTs = books.map((b) => b.comparison.timestamp).filter((t): t is string => t != null);
  const playerName = rows[0]?.player_name ?? input.playerNameFallback ?? null;

  return {
    status: 'ok',
    reason: null,
    sourceTable: PLAYER_PROP_MARKET_MOVEMENT_TABLE,
    detail: 'full',
    market: {
      gameId,
      player: { id: playerId, name: playerName },
      propType,
      displayLabel: playerPropApiDisplayLabel(propType),
    },
    reference: {
      kind: PLAYER_PROP_REFERENCE_KIND,
      label: '3-Hour Pre-Tip',
      timestamp: refTs.length ? refTs.slice().sort()[0]! : null,
    },
    comparison: {
      kind: PLAYER_PROP_COMPARISON_KIND,
      label: 'Close',
      timestamp: cmpTs.length ? cmpTs.slice().sort().at(-1)! : null,
    },
    consensus: {
      note: CONSENSUS_MEDIAN_DISCLAIMER,
      isStatisticalMedianNotAnOfferedLine: true,
      reference: referenceConsensus,
      comparison: comparisonConsensus,
      lineDelta,
    },
    books,
    coverage: {
      referenceType: PLAYER_PROP_REFERENCE_KIND,
      comparisonType: PLAYER_PROP_COMPARISON_KIND,
      historical: true,
      liveCurrent: false,
      eligibleBookCount: books.length,
      consensusMinimumBooks: PLAYER_PROP_CONSENSUS_MIN_BOOKS,
      booksWithMeaningfulMovement: books.filter((b) =>
        b.movement.classCode === 'B' || b.movement.classCode === 'C' || b.movement.classCode === 'D'
      ).length,
    },
  };
}

/** Free users: close consensus only. No 3-Hour Pre-Tip numbers or per-book movement. */
export function summarizePlayerMarketMovementForFree(
  full: PlayerMarketMovementResponse
): PlayerMarketMovementResponse {
  if (full.status !== 'ok') {
    return { ...full, detail: 'summary', books: [] };
  }
  return {
    ...full,
    detail: 'summary',
    reference: { ...full.reference, timestamp: null },
    consensus: {
      ...full.consensus,
      reference: emptyConsensus(),
      lineDelta: null,
    },
    books: [],
    coverage: {
      ...full.coverage,
      booksWithMeaningfulMovement: 0,
    },
  };
}
