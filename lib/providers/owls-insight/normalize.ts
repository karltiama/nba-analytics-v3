import { COURT_CONTEXT_PROP_MAPPING, type CourtContextProp } from './contract';
import { extractRows } from './client';
import type { NormalizedOwlsPropRow, OwlsArchiveEnvelope } from './types';

const PROP_TO_CC: Record<string, CourtContextProp> = {};
for (const row of COURT_CONTEXT_PROP_MAPPING) {
  PROP_TO_CC[row.canonicalOwlsPropType] = row.courtContext;
  for (const alias of row.owlsPropTypes) PROP_TO_CC[alias] = row.courtContext;
}

export function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function snapshotTypeForSchema(schema: string, requestOpening?: boolean): string {
  if (schema.includes('historical_player_props')) return 'closing_archive';
  if (requestOpening) return 'opening_filter';
  if (schema.includes('historical_prop_snapshots')) return 'archived_snapshot';
  return 'provider_payload';
}

/**
 * Conservative extractor. Only labels opening/closing when those keys exist.
 * A generic `line` is never renamed to closing.
 */
export function normalizePayloadRows(args: {
  envelope: OwlsArchiveEnvelope;
  courtContextGameId?: string | null;
  gameMatch?: NormalizedOwlsPropRow['game_match'];
  playerResolver?: (row: Record<string, unknown>) => {
    courtContextPlayerId: string | null;
    playerMatch: NormalizedOwlsPropRow['player_match'];
  };
}): NormalizedOwlsPropRow[] {
  const rows = extractRows(args.envelope.payload);
  const openingQuery = Boolean(args.envelope.request.query.opening);
  const snapshotType = snapshotTypeForSchema(args.envelope.schema, openingQuery);
  const out: NormalizedOwlsPropRow[] = [];
  for (const raw of rows) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const openingQuote = asRecord(rec.opening);
    const closingQuote = asRecord(rec.closing);
    const propType = pickString(rec, ['propType', 'prop_type', 'category', 'stat', 'market']);
    const openingLine =
      pickNumber(openingQuote ?? {}, ['line']) ??
      pickNumber(rec, ['openingLine', 'opening_line', 'openLine', 'open_line']);
    const closingLine =
      pickNumber(closingQuote ?? {}, ['line']) ??
      pickNumber(rec, ['closingLine', 'closing_line', 'closeLine', 'close_line']);
    const genericLine = closingLine ?? pickNumber(rec, ['line', 'points', 'value']);
    const overPrice =
      pickNumber(closingQuote ?? {}, ['overPrice', 'over_price', 'overOdds', 'overAmerican']) ??
      pickNumber(rec, [
        'overPrice',
        'over_price',
        'overOdds',
        'over_odds',
        'overAmerican',
        'priceOver',
      ]);
    const underPrice =
      pickNumber(closingQuote ?? {}, ['underPrice', 'under_price', 'underOdds', 'underAmerican']) ??
      pickNumber(rec, [
        'underPrice',
        'under_price',
        'underOdds',
        'under_odds',
        'underAmerican',
        'priceUnder',
      ]);
    const openingOver =
      pickNumber(openingQuote ?? {}, ['overPrice', 'over_price']) ??
      pickNumber(rec, ['openingOverPrice', 'opening_over_price', 'openOver']);
    const closingOver =
      pickNumber(closingQuote ?? {}, ['overPrice', 'over_price']) ??
      pickNumber(rec, ['closingOverPrice', 'closing_over_price', 'closeOver']);
    const playerName = pickString(rec, ['player', 'playerName', 'player_name', 'name']);
    const playerId = pickString(rec, ['playerId', 'player_id', 'id']);
    const book = pickString(rec, ['book', 'sportsbook', 'bookmaker']);
    const providerGameId =
      pickString(rec, ['eventId', 'event_id', 'gameId', 'game_id']) ?? args.envelope.provider_game_id;
    const snapshotAt = pickString(rec, ['snapshotAt', 'snapshot_at', 'timestamp', 'capturedAt', 'ts']);
    const playerResolved = args.playerResolver?.(rec) ?? {
      courtContextPlayerId: null,
      playerMatch: null,
    };

    const sides: Array<{ side: string; american: number | null; line: number | null }> = [];
    if (overPrice != null || underPrice != null || genericLine != null || openingLine != null || closingLine != null) {
      if (overPrice != null || genericLine != null || closingLine != null || openingLine != null) {
        sides.push({
          side: 'over',
          american: overPrice,
          line: genericLine,
        });
      }
      if (underPrice != null) {
        sides.push({
          side: 'under',
          american: underPrice,
          line: genericLine,
        });
      }
      if (sides.length === 0) {
        sides.push({ side: 'unknown', american: null, line: genericLine });
      }
    } else {
      sides.push({ side: 'unknown', american: null, line: genericLine });
    }

    for (const side of sides) {
      out.push({
        provider: 'owls_insight',
        provider_game_id: providerGameId,
        provider_player_id: playerId,
        provider_player_name: playerName,
        court_context_game_id: args.courtContextGameId ?? null,
        court_context_player_id: playerResolved.courtContextPlayerId,
        game_match: args.gameMatch ?? null,
        player_match: playerResolved.playerMatch,
        season: args.envelope.season,
        game_start_time: null,
        snapshot_type: snapshotType,
        snapshot_at: snapshotAt,
        book,
        prop_type: propType,
        court_context_prop: propType ? PROP_TO_CC[propType] ?? null : null,
        side: side.side,
        line: side.line,
        american_odds: side.american,
        decimal_odds:
          pickNumber(closingQuote ?? {}, ['decimal', 'decimalOdds', 'decimalPrice']) ??
          pickNumber(rec, ['decimal', 'decimalOdds', 'priceDecimal']),
        opening_line: openingLine,
        closing_line: closingLine,
        opening_price: openingOver,
        closing_price: closingOver,
        source_archive_key: '',
        backfill_run_id: args.envelope.backfill_run_id,
      });
    }
  }
  return out;
}

export function attachArchiveKey(rows: NormalizedOwlsPropRow[], key: string): NormalizedOwlsPropRow[] {
  return rows.map((r) => ({ ...r, source_archive_key: key }));
}

export function coverageCounts(rows: NormalizedOwlsPropRow[]): Record<CourtContextProp, number> {
  const out: Record<CourtContextProp, number> = {
    PTS: 0,
    REB: 0,
    AST: 0,
    '3PM': 0,
    PRA: 0,
    PA: 0,
    PR: 0,
    RA: 0,
  };
  for (const row of rows) {
    const cc = row.court_context_prop as CourtContextProp | null;
    if (cc && cc in out) out[cc] += 1;
  }
  return out;
}
