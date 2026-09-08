/**
 * Canonical Context Check model.
 *
 * Every input path (manual studio, mock preview, future automatic discovery)
 * normalizes into ContextCheckData. Presentation components must consume this
 * object only — they never query a database.
 *
 * Public auto-publishing is intentionally NOT part of v1.
 */

export type ContextVerdictType =
  | 'supports'
  | 'mixed'
  | 'pushes_back'
  | 'insufficient';

export type ContextCheckType =
  | 'recent_form'
  | 'line_context'
  | 'role_change'
  | 'roster_change';

export type ContextMarketType =
  | 'points'
  | 'rebounds'
  | 'assists'
  | 'threes'
  | 'pra';

export type ContextCheckDirection = 'over' | 'under';

export type ContextCheckSource = 'automatic' | 'manual';

export type ContextCheckCardVariant = 'web' | 'social';

export interface ContextCheckPlayer {
  id: string;
  name: string;
  teamAbbreviation?: string;
  teamName?: string;
  headshotUrl?: string;
}

export interface ContextCheckMarket {
  type: ContextMarketType;
  direction: ContextCheckDirection;
  line: number;
}

export interface ContextCheckSample {
  label: string;
  hits: number;
  games: number;
  /** Hit rate in 0–1 inclusive. */
  hitRate: number;
}

export interface ContextCheckHeadline {
  text: string;
  hits: number;
  games: number;
  /** Hit rate in 0–1 inclusive. */
  hitRate: number;
}

export interface ContextCheckLineContext {
  currentLine: number;
  last5AverageLine?: number;
  last10AverageLine?: number;
  difference?: number;
}

export interface ContextCheckRoleContext {
  seasonMinutes?: number;
  recentMinutes?: number;
  minutesChange?: number;
  starterStatus?: string;
}

export interface ContextCheckVerdict {
  type: ContextVerdictType;
  title: string;
  explanation: string;
}

/**
 * Frozen statistical snapshot for a Context Check.
 *
 * When a check is later published, this object should be persisted as-is so
 * historical posts do not drift when later games land in the database.
 */
export interface ContextCheckData {
  id?: string;
  player: ContextCheckPlayer;
  market: ContextCheckMarket;
  headline: ContextCheckHeadline;
  samples: ContextCheckSample[];
  lineContext?: ContextCheckLineContext;
  roleContext?: ContextCheckRoleContext;
  verdict: ContextCheckVerdict;
  contextType: ContextCheckType;
  dataAsOf: string;
  source: ContextCheckSource;
}

export interface ManualContextCheckInput {
  playerId: string;
  marketType: ContextMarketType;
  direction: ContextCheckDirection;
  line: number;
  contextType: ContextCheckType;
}

export interface ContextCheckStudioPlayer {
  id: string;
  name: string;
  teamAbbreviation: string;
  teamName: string;
}

/**
 * Editorial candidate for the admin Suggested tab.
 * `score` is internal-only and must never appear on ContextCheckCard.
 */
export interface ContextCheckCandidate {
  id: string;
  score: number;
  reason: string;
  contextType: ContextCheckType;
  summary: string;
  data: ContextCheckData;
}
