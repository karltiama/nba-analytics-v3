/**
 * Preseason preview automation contracts (V1.1).
 *
 * Pipeline drafts are separate from published TeamPreseasonPreviewContent.
 * Facts stay structured; editorial prose is optional and always NEEDS_REVIEW.
 *
 * Public snapshot fields are regular-season-only when safely derived.
 * All-games aggregates stay internal with explicit metricsScope metadata.
 */

/** Provenance for a factual value or signal evidence row. */
export type FactProvenance = {
  /** Stable method id, e.g. roster_entity_set_diff_v1 */
  method: string;
  /** Primary table(s), e.g. analytics.team_roster_current */
  tables: string[];
  /** Analytics season start year the fact was computed from */
  season: string | null;
  /** Short human note when needed */
  note?: string | null;
};

export type PacketPlayer = {
  playerEntityId: string;
  displayName: string;
  /** BallDontLie / analytics player_id when known */
  playerId: string | null;
  position: string | null;
};

/** Scope metadata for the recent competitive minutes window. */
export type RecentCompetitiveWindow = {
  gamesIncluded: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  regularSeasonGameCount: number;
  postseasonGameCount: number;
  baselineMpg: number | null;
  recentMpg: number | null;
  /** Window intentionally includes postseason when tipoffs fall on/after floor. */
  includesPostseasonByPolicy: true;
};

export type PacketPlayerRoleStats = {
  playerEntityId: string;
  playerId: string | null;
  displayName: string;
  gamesPlayed: number | null;
  /** Whole-season MPG from player_game_logs (all teams that season; competitive). */
  mpg: number | null;
  /** Whole-season PPG from player_season_averages. */
  ppg: number | null;
  /**
   * Canonical HIGH_USAGE aggregation (see policy.ts USAGE_AGGREGATION_METHOD):
   * unweighted mean of player_game_advanced.usage_percentage for rows where
   * usage is non-null AND joined PGL minutes > MIN_USAGE_MINUTES_PER_GAME,
   * prior analytics season, all teams.
   */
  usageAvg: number | null;
  usageGames: number | null;
  /** Sum of minutes across usage-eligible games (sample gate evidence). */
  usageTotalMinutes: number | null;
  recentCompetitive: RecentCompetitiveWindow | null;
  provenance: FactProvenance;
};

/** Internal all-games TSA snapshot — never label as regular-season record. */
export type PacketAllGamesSnapshot = {
  season: string;
  available: boolean;
  unavailableReason: string | null;
  wins: number | null;
  losses: number | null;
  record: string | null;
  offensiveRating: number | null;
  defensiveRating: number | null;
  pace: number | null;
  gamesPlayed: number;
  includesPostseason: boolean;
  metricsScope: 'all_games';
  scopeNote: string | null;
  provenance: FactProvenance;
};

/** Public-facing prior season metrics — regular season only. */
export type PacketRegularSeasonSnapshot = {
  season: string;
  available: boolean;
  unavailableReason: string | null;
  metricsScope: 'regular_season';
  postseasonStartEt: string | null;
  gamesPlayed: number;
  wins: number | null;
  losses: number | null;
  record: string | null;
  offensiveRating: number | null;
  defensiveRating: number | null;
  pace: number | null;
  provenance: FactProvenance;
};

export type PacketWowyCandidate = {
  focalPlayerId: string;
  teammateId: string;
  scope: 'GAME_LEVEL_WITH_WITHOUT';
  sampleSize: { withGames: number; withoutGames: number };
  supportTier: string;
  metrics: Record<string, number | null>;
  provenance: FactProvenance;
};

/** Facts-only team packet — no prose, no OpenAI. */
export type PreseasonTeamPacket = {
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
  /** Prefer this for public/editorial snapshot fields. */
  previousSeasonRegular: PacketRegularSeasonSnapshot;
  /** Internal all-games TSA; not for unlabeled "Record" display. */
  previousSeasonAllGames: PacketAllGamesSnapshot;
  currentRoster: PacketPlayer[];
  previousRoster: PacketPlayer[];
  additions: PacketPlayer[];
  departures: PacketPlayer[];
  returningPlayers: PacketPlayer[];
  playerSeasonStats: PacketPlayerRoleStats[];
  schedule: {
    games: never[];
    unavailableReason: string;
    provenance: FactProvenance;
  };
  availableWowySummaries: PacketWowyCandidate[];
  warnings: string[];
  provenanceSummary: FactProvenance[];
};

export type PreseasonContextSignalType =
  | 'VACATED_MINUTES'
  | 'RETURNING_HIGH_MINUTE_PLAYER'
  | 'HIGH_USAGE_RETURNER'
  | 'NEW_HIGH_MINUTE_ADDITION'
  | 'RECENT_COMPETITIVE_MINUTES_INCREASE';

export type PreseasonContextSignal = {
  type: PreseasonContextSignalType;
  playerEntityId: string;
  playerId: string | null;
  displayName: string;
  magnitude: number;
  evidence: Record<string, number | string | boolean | null>;
  provenance: FactProvenance;
};

export type PlayerWatchReason =
  | 'HIGH_USAGE_RETURNER'
  | 'RETURNING_HIGH_MINUTE_PLAYER'
  | 'VACATED_TEAMMATE_MINUTES'
  | 'NEW_HIGH_MINUTE_ADDITION'
  | 'RECENT_COMPETITIVE_MINUTES_INCREASE';

export type PlayerWatchCandidate = {
  playerEntityId: string;
  playerId: string | null;
  displayName: string;
  reasons: PlayerWatchReason[];
};

export type RoleWatchLabel =
  | 'STABLE'
  | 'OPPORTUNITY'
  | 'MINUTES_UP'
  | 'COMPETITION'
  | 'DEVELOPMENT'
  | 'ROLE_TBD';

export type RoleWatchCandidate = {
  playerEntityId: string;
  playerId: string | null;
  displayName: string;
  label: RoleWatchLabel;
  evidence: string[];
};

export type PreviewReviewStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'APPROVED';

export type EditorialTraceSection = {
  section: string;
  claimSummary: string;
  supportingFactPaths: string[];
  supportingSignalTypes: string[];
};

export type TeamPreseasonPreviewDraft = {
  version: string;
  season: string;
  generatedAt: string;
  team: PreseasonTeamPacket['team'];
  headline: string | null;
  dek: string | null;
  bigPicture: string[];
  /**
   * Public snapshot — regular-season fields only.
   * Never copies all-games TSA into record/ORTG/DRTG/pace.
   */
  snapshot: {
    regularSeasonRecord: string | null;
    regularSeasonOffensiveRating: number | null;
    regularSeasonDefensiveRating: number | null;
    regularSeasonPace: number | null;
    regularSeasonGamesPlayed: number | null;
    playoffResult: null;
    offensiveRatingRank: null;
    defensiveRatingRank: null;
    paceRank: null;
    /** Explicit: all-games aggregates are not surfaced here. */
    allGamesMetricsExcludedFromPublicSnapshot: true;
  };
  rosterChanges: {
    additions: Array<{
      playerEntityId: string;
      playerId: string | null;
      name: string;
      context: string | null;
    }>;
    departures: Array<{
      playerEntityId: string;
      playerId: string | null;
      name: string;
      context: string | null;
    }>;
    returning: Array<{
      playerEntityId: string;
      playerId: string | null;
      name: string;
      context: string | null;
    }>;
  };
  playersToWatch: Array<{
    playerEntityId: string;
    playerId: string | null;
    name: string;
    reasons: PlayerWatchReason[];
    watching: string | null;
  }>;
  roleWatch: Array<{
    playerEntityId: string;
    playerId: string | null;
    name: string;
    label: RoleWatchLabel;
    evidence: string[];
    explanation: string | null;
  }>;
  projectedRotation: {
    status: 'UNAVAILABLE';
    starters: never[];
    bench: never[];
  };
  keyQuestions: Array<{ headline: string; detail: string }>;
  wowyContext: Array<{
    title: string;
    detail: string;
    disclaimer: string;
  }>;
  preseasonSchedule: never[];
  outlook: string | null;
  contextSignals: PreseasonContextSignal[];
  editorialTrace: EditorialTraceSection[];
  sourceSummary: {
    factualFields: string[];
    derivedFields: string[];
    curatedFields: string[];
    unavailableFields: string[];
  };
  review: {
    status: PreviewReviewStatus;
    warnings: string[];
  };
};
