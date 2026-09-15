/**
 * Game-level WOWY v1: how player A performed in games teammate B played
 * versus games B had a verified did-not-play roster row.
 *
 * This is not possession-level on/off. Both players appearing in a game
 * does not establish that they shared the floor.
 */

export const WOWY_CALCULATION_VERSION = 'game-level-wowy-v1';
export const WOWY_DATA_VERSION = 'analytics.player_game_logs+analytics.games';

export const WOWY_STAT_KEYS = [
  'minutes',
  'pts',
  'reb',
  'ast',
  'tpm',
  'fga',
  'tpa',
  'fta',
] as const;
export type WowyStatKey = (typeof WOWY_STAT_KEYS)[number];

export const WOWY_RATE_STAT_KEYS = [
  'pts',
  'reb',
  'ast',
  'tpm',
  'fga',
  'tpa',
  'fta',
] as const;
export type WowyRateStatKey = (typeof WOWY_RATE_STAT_KEYS)[number];

export const WOWY_SEASON_TYPES = ['regular', 'playoffs'] as const;
export type WowySeasonType = (typeof WOWY_SEASON_TYPES)[number];

export const WOWY_BUCKETS = ['with', 'without', 'excluded'] as const;
export type WowyBucket = (typeof WOWY_BUCKETS)[number];

export const WOWY_TEAMMATE_PARTICIPATION = ['played', 'verified_dnp', 'unknown'] as const;
export type WowyTeammateParticipation = (typeof WOWY_TEAMMATE_PARTICIPATION)[number];

export const WOWY_EXCLUDE_REASONS = [
  'subject_did_not_play',
  'subject_malformed_minutes',
  'incomplete_game',
  'teammate_unknown_participation',
  'teammate_unknown_membership',
  'teammate_different_team',
  'ambiguous_identity',
  'ambiguous_team_membership',
  'malformed_teammate_minutes',
  'season_type_mismatch',
  'outside_date_range',
  'on_or_after_cutoff',
] as const;
export type WowyExcludeReason = (typeof WOWY_EXCLUDE_REASONS)[number];

export const WOWY_SUPPORT_TIERS = ['insufficient', 'low_support', 'adequate'] as const;
export type WowySupportTier = (typeof WOWY_SUPPORT_TIERS)[number];

export type WowyMembershipEvidenceKind =
  | 'same_team_game_log'
  | 'different_team_game_log'
  | 'teammate_row_missing'
  | 'subject_row_only';

export interface WowyMembershipEvidence {
  kind: WowyMembershipEvidenceKind;
  subjectTeamId: string;
  teammateTeamId: string | null;
  /** Human-readable source of the classification. Not a trade timestamp. */
  note: string;
}

export interface WowyPairQuery {
  subjectPlayerId: string;
  teammatePlayerId: string;
  season: string;
  /** Required so distinct team stints are not silently pooled. */
  teamId: string;
  seasonType: WowySeasonType | 'all';
  dateFrom?: string | null;
  dateTo?: string | null;
  /**
   * Exclusive historical cutoff (ISO tipoff). Games on or after this instant,
   * and games on the same America/New_York basketball date, are excluded.
   */
  cutoffStartTime?: string | null;
}

export interface WowyLoadedGame {
  gameId: string;
  startTime: string | null;
  gameDate: string | null;
  season: string;
  status: string | null;
  homeScore: number | null;
  awayScore: number | null;
  subjectTeamId: string;
  opponentTeamId: string | null;
  opponentAbbr: string | null;
  subjectMinutes: string | number | null;
  subjectPts: number | null;
  subjectReb: number | null;
  subjectAst: number | null;
  subjectTpm: number | null;
  subjectFga: number | null;
  subjectTpa: number | null;
  subjectFta: number | null;
  teammateRowPresent: boolean;
  teammateTeamId: string | null;
  teammateMinutes: string | number | null;
  teammatePts: number | null;
  teammateReb: number | null;
  teammateAst: number | null;
  teammateTpm: number | null;
  teammateFga: number | null;
  teammateFta: number | null;
}

export interface WowyPlayerIdentity {
  playerId: string;
  fullName: string;
  position: string | null;
  playerEntityId: string | null;
  nbaPlayerId: string | null;
  identityOk: boolean;
  identityReason: string | null;
}

export interface WowyAppearanceRef {
  class: 'played' | 'dnp' | 'malformed';
  minutes: number | null;
  minutesToken: string | null;
  reason: string;
}

export interface WowyClassifiedGame {
  gameId: string;
  startTime: string;
  basketballDateEt: string;
  season: string;
  seasonType: WowySeasonType;
  teamId: string;
  opponentTeamId: string | null;
  opponentAbbr: string | null;
  subject: WowyAppearanceRef & {
    stats: Record<WowyStatKey, number | null>;
  };
  teammate: {
    participation: WowyTeammateParticipation;
    appearance: WowyAppearanceRef | null;
    membership: WowyMembershipEvidence;
  };
  bucket: WowyBucket;
  excludeReason: WowyExcludeReason | null;
}

export type WowyStatMap = Record<WowyStatKey, number | null>;
export type WowyRateMap = Record<WowyRateStatKey, number | null>;

export interface WowyGroupSummary {
  gameCount: number;
  totalMinutes: number;
  validMinutesForRates: number;
  dateCoverage: { first: string | null; last: string | null };
  perGame: WowyStatMap;
  perMinute: WowyRateMap;
  perMinuteEligible: boolean;
  countingRetainedDespiteIneligibleRates: boolean;
  gameIds: string[];
}

export interface WowyDiffSummary {
  absolutePerGame: WowyStatMap;
  percentPerGame: WowyStatMap;
  absolutePerMinute: WowyRateMap;
  percentPerMinute: WowyRateMap;
}

export interface WowyExclusionTally {
  reason: WowyExcludeReason;
  count: number;
}

export interface WowyCoverageNotes {
  dnpSemantics:
    'analytics.player_game_logs.minutes = "00" is the verified DNP/inactive roster row; not an injury label';
  missingRowSemantics: 'A missing teammate row is unknown, never inferred absence';
  membershipSemantics: 'Same-team membership for a game requires both players to have a game-log row on the same team_id';
  stintSemantics: 'analytics.player_team_stints observed_from/to are roster observations, not verified trade timestamps. inferred_pgl stints are game-derived and must not be treated as trade dates.';
  possessionDisclaimer: 'Game-level WOWY does not establish shared-court possessions';
  seasonsWithBoxLogs: readonly string[];
}

export interface WowyPairSummary {
  calculationVersion: typeof WOWY_CALCULATION_VERSION;
  dataVersion: typeof WOWY_DATA_VERSION;
  query: WowyPairQuery;
  subject: { playerId: string; fullName: string };
  teammate: { playerId: string; fullName: string };
  with: WowyGroupSummary;
  without: WowyGroupSummary;
  diff: WowyDiffSummary;
  excludedCount: number;
  unknownParticipationCount: number;
  unknownMembershipCount: number;
  exclusions: WowyExclusionTally[];
  support: {
    tier: WowySupportTier;
    policyId: string;
    withGames: number;
    withoutGames: number;
    label: string;
  };
  coverage: WowyCoverageNotes;
  classifiedGames: WowyClassifiedGame[];
}

export interface WowyReliabilityMetadata {
  supportTier: WowySupportTier;
  withGames: number;
  withoutGames: number;
  unknownParticipationCount: number;
  unknownMembershipCount: number;
  cutoffApplied: boolean;
  cutoffStartTime: string | null;
  leakSafe: boolean;
  notes: string[];
}

export type WowyScenarioSelection =
  | { status: 'unknown'; source: 'pregame_availability_unknown' }
  | { status: 'hypothetical'; choice: 'with' | 'without'; source: 'user_explicit' }
  | {
      status: 'observed_pregame';
      choice: 'with' | 'without';
      source: 'timestamped_pregame_availability';
      observedAt: string;
    };

export interface WowyModelPairResult {
  history: WowyPairSummary;
  reliability: WowyReliabilityMetadata;
  /**
   * Scenario is never inferred from the target box or teammate participation.
   * Callers must supply timestamped pregame availability or an explicit
   * hypothetical. Default is unknown — do not apply an absence adjustment.
   */
  scenario: WowyScenarioSelection;
}

export interface WowyTeammateOption {
  playerId: string;
  fullName: string;
  position: string | null;
  nbaPlayerId: string | null;
  sharedRosterGames: number;
  togetherPlayedGames: number;
  verifiedDnpGames: number;
}

export interface WowyTeamStintOption {
  teamId: string;
  abbreviation: string;
  fullName: string;
  firstGameDate: string | null;
  lastGameDate: string | null;
  gameCount: number;
  /** Always false for game-log bounds; stints are observations, not trades. */
  verifiedTradeDates: false;
  evidence: 'game_log_team_id';
}
