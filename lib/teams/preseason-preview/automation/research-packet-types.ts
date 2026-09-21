/**
 * V1.2 Preseason Research Packet — factual homework for human writers.
 * Not a final editorial article.
 */

import type { FactProvenance } from './types';
import type { RosterStatusPlayer } from './roster-status';
import type { PreseasonContextSignal } from './types';
import type {
  PacketPlayerRoleStats,
  PacketRegularSeasonSnapshot,
  PacketAllGamesSnapshot,
} from './types';

export type TracedClaim = {
  text: string;
  evidence: string[];
};

export type ResearchWatchCandidate = {
  playerEntityId: string;
  playerId: string | null;
  displayName: string;
  reasons: string[];
  supportingSignalTypes: string[];
  evidencePaths: string[];
  relevantStats: {
    mpg: number | null;
    ppg: number | null;
    usageAvg: number | null;
    recentMpg: number | null;
  };
};

export type ResearchRoleShiftCandidate = {
  kind:
    | 'VACATED_MINUTES'
    | 'HIGH_USAGE_RETURNER'
    | 'RECENT_COMPETITIVE_MINUTES_INCREASE'
    | 'NEW_HIGH_MINUTE_ADDITION'
    | 'RETURNING_HIGH_MINUTE_PLAYER'
    | 'TOP_USAGE_RETURNER';
  playerEntityId: string;
  playerId: string | null;
  displayName: string;
  /** Factual, non-speculative framing. */
  claim: TracedClaim;
  magnitude: number | null;
};

export type ResearchWowyCandidate = {
  status: 'HAS_DATA' | 'CANDIDATE_FOR_REVIEW';
  label: string;
  focalPlayerId: string | null;
  teammateId: string | null;
  focalDisplayName: string;
  teammateDisplayName: string | null;
  reason: string;
  evidencePaths: string[];
  sampleSize: { withGames: number; withoutGames: number } | null;
  supportTier: string | null;
  metrics: Record<string, number | null> | null;
};

export type ResearchNotableStat = {
  label: string;
  value: string;
  evidencePaths: string[];
};

export type PreseasonResearchPacket = {
  version: string;
  generatedAt: string;
  season: string;
  previousSeason: string;
  team: {
    teamId: string;
    slug: string;
    name: string;
    abbreviation: string;
    conference: string | null;
  };

  /** A. Team snapshot */
  snapshot: {
    regularSeason: PacketRegularSeasonSnapshot;
    allGamesInternal: PacketAllGamesSnapshot;
    previousSeed: null;
    previousPlayoffResult: null;
    coverageNotes: string[];
  };

  /** B. Roster changes */
  roster: {
    additions: RosterStatusPlayer[];
    departures: RosterStatusPlayer[];
    returningCore: RosterStatusPlayer[];
    draftPicks: never[];
    unresolved: RosterStatusPlayer[];
  };

  /** C. Players to watch (candidates, not editorial picks) */
  playersToWatchCandidates: ResearchWatchCandidate[];

  /** D. Role / usage shift candidates */
  roleUsageShiftCandidates: ResearchRoleShiftCandidate[];

  /** E. WOWY candidates */
  wowyCandidates: ResearchWowyCandidate[];

  /** F. Research questions (not answers) */
  researchQuestions: TracedClaim[];

  /** G. Notable stats */
  notableStats: ResearchNotableStat[];

  /** H. Unresolved / low-confidence */
  unresolvedItems: TracedClaim[];

  contextSignals: PreseasonContextSignal[];
  playerSeasonStats: PacketPlayerRoleStats[];
  provenanceSummary: FactProvenance[];
  warnings: string[];
};
