/**
 * Pure player-prop selection matching against a normalized bookmaker market snapshot.
 * Status semantics match SportsbookSelectionResolution (without deeplink allowlist).
 */

export type NormalizedOutcome = {
  /** Over / Under (or equivalent). */
  side: 'over' | 'under';
  line: number;
  oddsAmerican: number;
  playerName: string;
  /** Sportsbook-native selection SID when present. */
  selectionSid: string | null;
  /** Provider-generated deeplink when present — never synthesize. */
  link: string | null;
};

export type NormalizedMarketSnapshot = {
  marketKey: string;
  /** Sportsbook-native market SID when present. */
  marketSid: string | null;
  /** Sportsbook-native event SID when present. */
  eventSid: string | null;
  outcomes: readonly NormalizedOutcome[];
};

export type SelectionMatchQuery = {
  playerName: string;
  side: 'over' | 'under';
  line: number;
};

export type SelectionMatchResult =
  | {
      status: 'EXACT';
      outcome: NormalizedOutcome;
      marketSid: string | null;
      eventSid: string | null;
    }
  | {
      status: 'LINE_CHANGED';
      outcome: NormalizedOutcome;
      marketSid: string | null;
      eventSid: string | null;
      currentLine: number;
    }
  | { status: 'NOT_FOUND'; reason: string };

function normalizePlayerName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Allow "Jayson Tatum" vs "J. Tatum" only when last token matches and first initial matches.
  const aParts = na.split(' ');
  const bParts = nb.split(' ');
  if (aParts.length >= 2 && bParts.length >= 2) {
    const aLast = aParts[aParts.length - 1]!;
    const bLast = bParts[bParts.length - 1]!;
    if (aLast === bLast && aParts[0]![0] === bParts[0]![0]) return true;
  }
  return false;
}

function uniqueLines(outcomes: readonly NormalizedOutcome[]): number[] {
  const set = new Set<number>();
  for (const o of outcomes) set.add(o.line);
  return [...set].sort((a, b) => a - b);
}

/**
 * Match a canonical selection against a single main-line market snapshot.
 * Does not request or merge alternate markets — multiple distinct lines ⇒ no arbitrary pick.
 */
export function matchNormalizedSelection(
  market: NormalizedMarketSnapshot,
  query: SelectionMatchQuery
): SelectionMatchResult {
  const playerOutcomes = market.outcomes.filter((o) => namesMatch(o.playerName, query.playerName));
  if (playerOutcomes.length === 0) {
    return { status: 'NOT_FOUND', reason: 'player_not_found' };
  }

  const exactLine = playerOutcomes.filter((o) => o.line === query.line);
  const exact = exactLine.find((o) => o.side === query.side);
  if (exact) {
    return {
      status: 'EXACT',
      outcome: exact,
      marketSid: market.marketSid,
      eventSid: market.eventSid,
    };
  }

  const lines = uniqueLines(playerOutcomes);
  if (lines.length !== 1) {
    return {
      status: 'NOT_FOUND',
      reason: lines.length === 0 ? 'no_lines' : 'ambiguous_alternate_lines',
    };
  }

  const onlyLine = lines[0]!;
  const changed = playerOutcomes.find((o) => o.line === onlyLine && o.side === query.side);
  if (!changed) {
    return { status: 'NOT_FOUND', reason: 'side_not_found_on_current_line' };
  }

  return {
    status: 'LINE_CHANGED',
    outcome: changed,
    marketSid: market.marketSid,
    eventSid: market.eventSid,
    currentLine: onlyLine,
  };
}
