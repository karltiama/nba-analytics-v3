/**
 * Certified Market Movement v1 math (Step 7E / 11B).
 * One implementation for backfill, API, and the trial analysis script.
 * Raw implied probability only — no vig normalization, no American-odds subtraction.
 */

export const JUICE_IMPLIED_PROB_THRESHOLD = 0.02;
export const LINE_UNCHANGED_EPSILON = 1e-9;
export const PLAYER_PROP_CONSENSUS_MIN_BOOKS = 2;

export const PLAYER_PROP_REFERENCE_KIND = '3_hour_pre_tip' as const;
export const PLAYER_PROP_COMPARISON_KIND = 'decision_close' as const;
export const GAME_ODDS_REFERENCE_KIND = 'opening_snapshot' as const;
export const GAME_ODDS_COMPARISON_KIND = 'last_pre_tip_history' as const;

export const GAME_ODDS_CERTIFIED_WINDOW = {
  start: '2026-03-09',
  end: '2026-03-22',
} as const;

export const GAME_ODDS_COVERAGE_DEGRADES_FROM = '2026-03-23';

export const PLAYER_PROP_V1_VENDORS = ['betmgm', 'fanduel', 'draftkings', 'caesars'] as const;
export type PlayerPropV1Vendor = (typeof PLAYER_PROP_V1_VENDORS)[number];

export const PLAYER_PROP_V1_PROP_TYPES = [
  'points',
  'rebounds',
  'assists',
  'threes',
  'points_rebounds',
  'points_assists',
  'points_rebounds_assists',
] as const;
export type PlayerPropV1PropType = (typeof PLAYER_PROP_V1_PROP_TYPES)[number];

/** Matcher-recognized props (research + v1). Product allowlist is PLAYER_PROP_V1_PROP_TYPES. */
export const CANONICAL_PROP_TYPES = [
  'points',
  'rebounds',
  'assists',
  'threes',
  'blocks',
  'steals',
  'points_rebounds',
  'points_assists',
  'rebounds_assists',
  'points_rebounds_assists',
] as const;
export type CanonicalPropType = (typeof CANONICAL_PROP_TYPES)[number];

export type MovementClass = 'A' | 'B' | 'C' | 'D' | 'unclassified';

export type PlayerPropReferenceKind = typeof PLAYER_PROP_REFERENCE_KIND;
export type PlayerPropComparisonKind = typeof PLAYER_PROP_COMPARISON_KIND | 'live_current';
export type GameOddsReferenceKind = typeof GAME_ODDS_REFERENCE_KIND;
export type GameOddsComparisonKind = typeof GAME_ODDS_COMPARISON_KIND | 'live_current';

export type VendorNormalization = {
  raw: string;
  canonical: string;
  isPlayerPropV1Vendor: boolean;
};

export type ConsensusUnavailableReason = 'insufficient_books' | 'no_finite_lines';

export type ConsensusResult =
  | {
      available: true;
      median: number;
      min: number;
      max: number;
      count: number;
      reason: null;
    }
  | {
      available: false;
      median: null;
      min: null;
      max: null;
      count: number;
      reason: ConsensusUnavailableReason;
    };

const PLAYER_PROP_V1_VENDOR_SET = new Set<string>(PLAYER_PROP_V1_VENDORS);
const PLAYER_PROP_V1_PROP_SET = new Set<string>(PLAYER_PROP_V1_PROP_TYPES);
const CANONICAL_PROP_SET = new Set<string>(CANONICAL_PROP_TYPES);

const PROP_ALIAS: Record<string, CanonicalPropType> = {
  points: 'points',
  pts: 'points',
  player_points: 'points',
  rebounds: 'rebounds',
  reb: 'rebounds',
  player_rebounds: 'rebounds',
  assists: 'assists',
  ast: 'assists',
  player_assists: 'assists',
  threes: 'threes',
  three_pointers: 'threes',
  '3pt': 'threes',
  '3-pointers': 'threes',
  made_threes: 'threes',
  blocks: 'blocks',
  blk: 'blocks',
  player_blocks: 'blocks',
  steals: 'steals',
  stl: 'steals',
  player_steals: 'steals',
  points_rebounds: 'points_rebounds',
  pr: 'points_rebounds',
  pts_reb: 'points_rebounds',
  points_assists: 'points_assists',
  pa: 'points_assists',
  pts_ast: 'points_assists',
  rebounds_assists: 'rebounds_assists',
  ra: 'rebounds_assists',
  reb_ast: 'rebounds_assists',
  points_rebounds_assists: 'points_rebounds_assists',
  pra: 'points_rebounds_assists',
};

const VENDOR_DISPLAY: Record<string, string> = {
  betmgm: 'BetMGM',
  fanduel: 'FanDuel',
  caesars: 'Caesars',
  draftkings: 'DraftKings',
  betrivers: 'BetRivers',
  fanatics: 'Fanatics',
  ballybet: 'Bally Bet',
  betparx: 'BetParx',
  betway: 'Betway',
  rebet: 'Rebet',
  polymarket: 'Polymarket',
  kalshi: 'Kalshi',
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

function finiteNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse American odds. Certified 7E: 0 is missing/invalid, not even money.
 * Even money is +100 or -100.
 */
export function parseAmericanOdds(v: unknown): number | null {
  const n = finiteNumber(v);
  if (n == null || n === 0) return null;
  return n;
}

/**
 * American odds → raw implied probability (includes vig).
 * Negative: |odds| / (|odds| + 100). Positive: 100 / (odds + 100).
 * null / non-finite / 0 → null (7E invalid-zero semantics).
 */
export function americanOddsToImpliedProbability(odds: number | null | undefined): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

/** comparisonImplied - referenceImplied. Null if either side missing. */
export function impliedProbabilityDelta(
  referenceOdds: number | null | undefined,
  comparisonOdds: number | null | undefined
): number | null {
  const open = americanOddsToImpliedProbability(referenceOdds ?? null);
  const close = americanOddsToImpliedProbability(comparisonOdds ?? null);
  if (open == null || close == null) return null;
  return close - open;
}

export function interpolatingQuantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return s[lo] ?? null;
  const a = s[lo];
  const b = s[hi];
  if (a == null || b == null) return null;
  return a + (b - a) * (i - lo);
}

export function interpolatingMedian(xs: number[]): number | null {
  return interpolatingQuantile(xs, 0.5);
}

export type ClassifyPropMovementInput = {
  referenceLine: number | null;
  comparisonLine: number | null;
  referenceOverImplied: number | null;
  comparisonOverImplied: number | null;
  referenceUnderImplied: number | null;
  comparisonUnderImplied: number | null;
};

/**
 * Step 7E taxonomy. Missing open or close line → unclassified.
 * Juice uses either side with abs(delta) >= 0.02 (2pp).
 * A Quiet / B Juice / C Line / D Line+Price.
 */
export function classifyPropMovement(input: ClassifyPropMovementInput): MovementClass {
  const { referenceLine, comparisonLine } = input;
  if (referenceLine == null || comparisonLine == null) return 'unclassified';

  const lineMoved = Math.abs(comparisonLine - referenceLine) >= LINE_UNCHANGED_EPSILON;
  const juiceDeltas: number[] = [];
  if (input.referenceOverImplied != null && input.comparisonOverImplied != null) {
    juiceDeltas.push(Math.abs(input.comparisonOverImplied - input.referenceOverImplied));
  }
  if (input.referenceUnderImplied != null && input.comparisonUnderImplied != null) {
    juiceDeltas.push(Math.abs(input.comparisonUnderImplied - input.referenceUnderImplied));
  }
  const juiceMeaningful = juiceDeltas.some((x) => x >= JUICE_IMPLIED_PROB_THRESHOLD);

  if (!lineMoved && !juiceMeaningful) return 'A';
  if (!lineMoved && juiceMeaningful) return 'B';
  if (lineMoved && juiceMeaningful) return 'D';
  return 'C';
}

export function normalizeVendor(raw: unknown): VendorNormalization | null {
  const trimmed = sid(raw);
  if (!trimmed) return null;
  const canonical = trimmed.toLowerCase();
  return {
    raw: trimmed,
    canonical,
    isPlayerPropV1Vendor: PLAYER_PROP_V1_VENDOR_SET.has(canonical),
  };
}

export function isPlayerPropV1Vendor(vendor: string): vendor is PlayerPropV1Vendor {
  return PLAYER_PROP_V1_VENDOR_SET.has(vendor);
}

export function displayVendor(canonical: string): string {
  return VENDOR_DISPLAY[canonical] ?? canonical;
}

export function canonicalizePropType(raw: unknown): CanonicalPropType | null {
  const k = lower(raw)?.replace(/\s+/g, '_') ?? '';
  if (!k) return null;
  if (PROP_ALIAS[k]) return PROP_ALIAS[k];
  if (CANONICAL_PROP_SET.has(k)) return k as CanonicalPropType;
  return null;
}

export function isPlayerPropV1PropType(propType: string): propType is PlayerPropV1PropType {
  return PLAYER_PROP_V1_PROP_SET.has(propType);
}

export function displayPropType(propType: string): string {
  if (propType === 'points_rebounds_assists') return 'PRA';
  return propType;
}

const PROP_API_LABEL: Record<PlayerPropV1PropType, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  threes: '3-Pointers',
  points_rebounds: 'Points + Rebounds',
  points_assists: 'Points + Assists',
  points_rebounds_assists: 'PRA',
};

/** Product display label. UI should not need to know PRA is stored as points_rebounds_assists. */
export function playerPropApiDisplayLabel(propType: string): string {
  if (isPlayerPropV1PropType(propType)) return PROP_API_LABEL[propType];
  return displayPropType(propType);
}

export const MOVEMENT_CLASS_API_LABEL: Record<MovementClass, string> = {
  A: 'Quiet',
  B: 'Juice',
  C: 'Line',
  D: 'Line+Price',
  unclassified: 'Unclassified',
};

export const CONSENSUS_MEDIAN_DISCLAIMER =
  'Consensus is a statistical median and may not correspond to a line offered by any individual sportsbook.';

export function playerPropMatchKey(input: {
  gameId: string;
  playerId: string;
  vendor: string;
  propType: string;
}): string {
  return `${input.gameId}|${input.playerId}|${input.vendor}|${input.propType}`;
}

export type PropLineIdentity = {
  gameId: string;
  playerId: string;
  vendor: string;
  propType: string;
  line: number | null;
};

/**
 * Certified BetRivers (and any book) rule: two+ distinct lines on the same
 * game+player+vendor+canonical-prop key are ambiguous. Exclude the group.
 * Do not pick first/last/min/max.
 */
export function findAmbiguousSimultaneousLineKeys(rows: PropLineIdentity[]): Set<string> {
  const groupLines = new Map<string, Set<number>>();
  for (const r of rows) {
    if (r.line == null) continue;
    const k = playerPropMatchKey(r);
    if (!groupLines.has(k)) groupLines.set(k, new Set());
    groupLines.get(k)!.add(r.line);
  }
  const ambiguous = new Set<string>();
  for (const [k, lines] of groupLines) {
    if (lines.size > 1) ambiguous.add(k);
  }
  return ambiguous;
}

export function isAmbiguousSimultaneousGroup(key: string, ambiguousKeys: Set<string>): boolean {
  return ambiguousKeys.has(key);
}

export type ConsensusLineInput = {
  vendor: unknown;
  line: number | null;
};

/**
 * v1 player-prop consensus across BetMGM / FanDuel / DraftKings / Caesars.
 * Requires >= 2 eligible books with finite lines.
 * Median is interpolating quantile(0.5): 25.5 + 26.5 → 26.0 (not necessarily offered).
 */
export function playerPropConsensus(rows: ConsensusLineInput[]): ConsensusResult {
  const byVendor = new Map<string, number>();
  for (const row of rows) {
    const vendor = normalizeVendor(row.vendor);
    if (!vendor || !vendor.isPlayerPropV1Vendor) continue;
    if (row.line == null || !Number.isFinite(row.line)) continue;
    byVendor.set(vendor.canonical, row.line);
  }
  const lines = [...byVendor.values()];
  if (lines.length === 0) {
    return {
      available: false,
      median: null,
      min: null,
      max: null,
      count: 0,
      reason: 'no_finite_lines',
    };
  }
  if (lines.length < PLAYER_PROP_CONSENSUS_MIN_BOOKS) {
    return {
      available: false,
      median: null,
      min: null,
      max: null,
      count: lines.length,
      reason: 'insufficient_books',
    };
  }
  const median = interpolatingMedian(lines);
  if (median == null) {
    return {
      available: false,
      median: null,
      min: null,
      max: null,
      count: lines.length,
      reason: 'no_finite_lines',
    };
  }
  return {
    available: true,
    median,
    min: Math.min(...lines),
    max: Math.max(...lines),
    count: lines.length,
    reason: null,
  };
}

/** Game-odds median across whatever finite lines the caller passes (outliers handled by caller). */
export function numericConsensus(lines: Array<number | null | undefined>): ConsensusResult {
  const finite = lines.filter((n): n is number => n != null && Number.isFinite(n));
  if (finite.length === 0) {
    return {
      available: false,
      median: null,
      min: null,
      max: null,
      count: 0,
      reason: 'no_finite_lines',
    };
  }
  if (finite.length < PLAYER_PROP_CONSENSUS_MIN_BOOKS) {
    return {
      available: false,
      median: null,
      min: null,
      max: null,
      count: finite.length,
      reason: 'insufficient_books',
    };
  }
  const median = interpolatingMedian(finite);
  if (median == null) {
    return {
      available: false,
      median: null,
      min: null,
      max: null,
      count: finite.length,
      reason: 'no_finite_lines',
    };
  }
  return {
    available: true,
    median,
    min: Math.min(...finite),
    max: Math.max(...finite),
    count: finite.length,
    reason: null,
  };
}
