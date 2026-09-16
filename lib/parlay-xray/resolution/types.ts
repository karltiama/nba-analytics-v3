import type { ExtractedParlayLeg, ParlayLegSide, XrayPropKind } from '@/lib/parlay-xray/types';
import type { CanonicalPropType } from '@/lib/betting/market-movement';

export const RESOLUTION_STATUSES = ['RESOLVED', 'NEEDS_CONFIRMATION', 'UNRESOLVED'] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

export const OVERALL_RESOLUTION_STATUSES = [
  'FULLY_RESOLVED',
  'CORE_RESOLVED',
  'NEEDS_CONFIRMATION',
  'UNRESOLVED',
] as const;
export type OverallResolutionStatus = (typeof OVERALL_RESOLUTION_STATUSES)[number];

export type XrayPlayerRecord = {
  playerId: string;
  entityId: string | null;
  displayName: string;
  firstName: string;
  lastName: string;
  nbaPlayerId?: string | null;
};

export type XrayTeamRecord = {
  teamId: string;
  abbreviation: string;
  fullName: string;
};

export type XrayGameRecord = {
  gameId: string;
  startTime: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
};

export type XrayResolutionCatalog = {
  players: XrayPlayerRecord[];
  teams: XrayTeamRecord[];
  games: XrayGameRecord[];
};

export type XrayResolutionContext = {
  asOfDate?: string | null;
  slateDate?: string | null;
  eventDate?: string | null;
};

export type PlayerResolutionCandidate = {
  playerId: string;
  entityId: string | null;
  displayName: string;
};

export type GameResolutionCandidate = {
  gameId: string;
  startTime: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
};

export type FieldResolution<T> = {
  status: ResolutionStatus;
  value: T | null;
  extracted: string | number | null;
  reason: string | null;
};

export type PlayerFieldResolution = FieldResolution<{
  playerId: string;
  entityId: string | null;
  displayName: string;
  nbaPlayerId: string | null;
}> & {
  candidates: PlayerResolutionCandidate[];
};

export type GameFieldResolution = FieldResolution<{
  gameId: string;
  startTime: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
}> & {
  candidates: GameResolutionCandidate[];
};

export type MarketFieldResolution = FieldResolution<{
  propType: CanonicalPropType;
}> & {
  unsupported: boolean;
};

export type SideFieldResolution = FieldResolution<ParlayLegSide>;
export type LineFieldResolution = FieldResolution<number>;
export type SportsbookFieldResolution = FieldResolution<{
  vendor: string;
  displayName: string;
}>;

export type CanonicalParlayLegResolution = {
  originalLeg: ExtractedParlayLeg;
  playerResolution: PlayerFieldResolution;
  teamResolution: FieldResolution<{ abbreviation: string; teamId: string | null }>;
  opponentResolution: FieldResolution<{ abbreviation: string; teamId: string | null }>;
  gameResolution: GameFieldResolution;
  marketResolution: MarketFieldResolution;
  sideResolution: SideFieldResolution;
  lineResolution: LineFieldResolution;
  sportsbookResolution: SportsbookFieldResolution;
  overallStatus: OverallResolutionStatus;
  coreResolved: boolean;
  fullyResolved: boolean;
};

export const XRAY_CANONICAL_MARKETS: readonly XrayPropKind[] = [
  'points',
  'rebounds',
  'assists',
  'threes',
  'points_rebounds',
  'points_assists',
  'rebounds_assists',
  'points_rebounds_assists',
];
