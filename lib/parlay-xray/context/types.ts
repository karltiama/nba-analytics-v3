import type { CanonicalParlayLegResolution } from '@/lib/parlay-xray/resolution/types';
import type { HistoricalParlayLegMatch } from '@/lib/parlay-xray/replay/types';
import type { CanonicalPropType } from '@/lib/betting/market-movement';
import type { ExtractedParlayLeg, ParlayLegSide } from '@/lib/parlay-xray/types';

export const CONTEXT_SECTION_STATUSES = [
  'AVAILABLE',
  'LIMITED',
  'UNAVAILABLE',
  'NEEDS_CONFIRMATION',
] as const;
export type ContextSectionStatus = (typeof CONTEXT_SECTION_STATUSES)[number];

export type ContextSectionBase = {
  status: ContextSectionStatus;
  reason: string | null;
};

export type XrayPriorPlayerLog = {
  playerId: string;
  gameId: string;
  teamId: string | null;
  startTime: string;
  season: string | null;
  minutes: string | number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threePointersMade: number | null;
};

export type XrayPriorTeamStat = {
  teamId: string;
  gameId: string;
  opponentTeamId: string | null;
  startTime: string;
  season: string | null;
  pace: number | null;
  pointsAllowed: number | null;
  teamPoints: number | null;
};

export type XrayArchivedProjection = {
  playerId: string;
  gameId: string;
  modelVersion: string;
  generatedAt: string;
  intendedCutoffAt: string;
  predictions: Record<string, unknown> | null;
};

export type XRayContextSources = {
  priorPlayerLogs: XrayPriorPlayerLog[];
  priorTeamStats: XrayPriorTeamStat[];
  projectionSnapshots: XrayArchivedProjection[];
};

export type XRayLegContextRequest = {
  resolution: CanonicalParlayLegResolution;
  match: HistoricalParlayLegMatch;
  contextCutoffAt: string;
  season?: string | null;
  playerTeamId?: string | null;
  opponentTeamId?: string | null;
  sources: XRayContextSources;
};

export type WindowStat = {
  gameCount: number;
  average: number | null;
};

export type LineRelativeHistory = {
  sampleCount: number;
  aboveRequestedLine: number;
  belowRequestedLine: number;
  equalRequestedLine: number;
};

export type XRayIdentityContext = ContextSectionBase & {
  originalLeg: ExtractedParlayLeg;
  playerId: string | null;
  playerDisplayName: string | null;
  gameId: string | null;
  gameStartTime: string | null;
  teamAbbr: string | null;
  opponentAbbr: string | null;
  market: CanonicalPropType | null;
  side: ParlayLegSide | null;
  line: number | null;
  sportsbook: string | null;
  historicalDate: string | null;
  contextCutoffAt: string | null;
};

export type XRayMarketContext = ContextSectionBase & {
  requestedBook: string | null;
  matchedBook: string | null;
  matchStatus: HistoricalParlayLegMatch['status'];
  lineQuality: HistoricalParlayLegMatch['lineQuality'];
  requestedLine: number | null;
  threeHourLine: number | null;
  threeHourOdds: number | null;
  threeHourTimestamp: string | null;
  closeLine: number | null;
  closeOdds: number | null;
  closeTimestamp: string | null;
  lineDeltaCloseMinusThreeHour: number | null;
  lineDeltaThreeHourMinusRequested: number | null;
  americanOddsDeltaCloseMinusThreeHour: number | null;
  snapshotAvailable: {
    threeHourPreTip: boolean;
    decisionClose: boolean;
  };
};

export type XRayPlayerFormContext = ContextSectionBase & {
  market: CanonicalPropType | null;
  seasonToDate: WindowStat;
  last5: WindowStat;
  last10: WindowStat;
  lineRelative: LineRelativeHistory;
};

export type XRayRoleContext = ContextSectionBase & {
  priorGameMinutes: number | null;
  seasonToDateMinutes: WindowStat;
  last5Minutes: WindowStat;
  last10Minutes: WindowStat;
  gamesPlayed: number;
  startersPregame: ContextSectionBase;
};

export type XRayMatchupContext = ContextSectionBase & {
  opponentAbbr: string | null;
  opponentTeamId: string | null;
  playerTeamId: string | null;
  teamPace: WindowStat;
  opponentPace: WindowStat;
  opponentPointsAllowed: WindowStat;
  teamPoints: WindowStat;
};

export type XRayWowyContext = ContextSectionBase;
export type XRayAvailabilityContext = ContextSectionBase;

export type XRayProjectionContext = ContextSectionBase & {
  modelVersion: string | null;
  generatedAt: string | null;
  intendedCutoffAt: string | null;
  projectedStat: number | null;
  requestedLine: number | null;
  difference: number | null;
};

export type XRayDataQualityContext = {
  canonicalPlayerResolved: boolean;
  canonicalGameResolved: boolean;
  marketExact: boolean;
  marketPartial: boolean;
  sameBookMatch: boolean;
  exactLineMatch: boolean;
  threeHourSnapshotAvailable: boolean;
  closeSnapshotAvailable: boolean;
  playerPriorSampleCount: number;
  last5AvailableCount: number;
  last10AvailableCount: number;
  wowy: ContextSectionStatus;
  projection: ContextSectionStatus;
  availability: ContextSectionStatus;
  playerForm: ContextSectionStatus;
  matchup: ContextSectionStatus;
  role: ContextSectionStatus;
  market: ContextSectionStatus;
};

export type XRayLegContext = {
  identity: XRayIdentityContext;
  market: XRayMarketContext;
  playerForm: XRayPlayerFormContext;
  role: XRayRoleContext;
  matchup: XRayMatchupContext;
  wowy: XRayWowyContext;
  projection: XRayProjectionContext;
  availability: XRayAvailabilityContext;
  dataQuality: XRayDataQualityContext;
};
