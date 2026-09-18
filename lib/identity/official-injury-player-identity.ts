/**
 * Official injury-report player identity resolver v1 (Phase 4D).
 *
 * Pure decision policy — no Postgres, no fetches, no status/reason identity evidence.
 * Candidate loading is the caller's responsibility.
 *
 * Policy: Phase 4C conservative D2 (U4 inferred-only → quarantine).
 * U5 historical: DISABLED.
 */

import {
  OFFICIAL_INJURY_PLAYER_IDENTITY_RESOLVER_VERSION,
  injuryIdentityNameKey,
  isInjuryIdentityNameKeySafe,
} from './injury-identity-name-key';

export const OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION =
  OFFICIAL_INJURY_PLAYER_IDENTITY_RESOLVER_VERSION;

export type CandidateCardinality = 'none' | 'unique' | 'multiple';

export type U2CandidateEvidence = {
  cardinality: CandidateCardinality;
  playerId?: string | null;
  playerEntityId?: string | null;
  minutes?: string | null;
};

export type U4CandidateEvidence = {
  cardinality: CandidateCardinality;
  playerEntityId?: string | null;
  source: 'nba_stats' | 'inferred_pgl' | string;
};

/**
 * Optional serving projection for Tier C (U4 NBA without U2).
 * Must come from existing canonical relationships — never fabricated.
 */
export type OfficialInjuryCandidateEvidence = {
  u2: U2CandidateEvidence;
  u4Nba: U4CandidateEvidence;
  u4Inferred: U4CandidateEvidence;
  /** Explicit serving BDL id when known without U2 (rare). */
  servingPlayerId?: string | null;
};

export type OfficialInjuryPlayerIdentityInput = {
  gameId: string;
  teamId: string;
  gameDateEt: string;
  playerNameRaw: string;
  teamAbbreviation?: string;
};

export type OfficialInjuryResolutionStatus =
  | 'RESOLVED_CANONICAL_ENTITY'
  | 'RESOLVED_ENTITY_NO_SERVING_PLAYER'
  | 'QUARANTINED_NO_SAFE_CANDIDATE'
  | 'QUARANTINED_INFERRED_ONLY'
  | 'QUARANTINED_MULTIPLE_CANDIDATES'
  | 'QUARANTINED_SOURCE_CONFLICT'
  | 'QUARANTINED_NAME_UNSAFE';

export type OfficialInjuryConfidenceClass = 'A' | 'B' | 'C';

export type OfficialInjuryProvenanceCategory =
  | 'U2_PLUS_U4_NBA'
  | 'U2_SAME_GAME'
  | 'U4_NBA_STINT';

export type OfficialInjuryProvenanceEntry = {
  source: 'same_game_pgl' | 'u4_nba_stint' | 'u4_inferred_pgl';
  independenceClass: 'BOX_TAPE' | 'NBA_MEMBERSHIP' | 'BOX_TAPE_DERIVED';
  candidatePlayerId?: string | null;
  candidateEntityId?: string | null;
  supportingOnly?: boolean;
};

export type OfficialInjuryPlayerIdentityResult = {
  resolverVersion: typeof OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION;
  gameId: string;
  teamId: string;
  playerNameRaw: string;
  nameKey: string;
  resolutionStatus: OfficialInjuryResolutionStatus;
  playerEntityId: string | null;
  servingPlayerId: string | null;
  confidenceClass: OfficialInjuryConfidenceClass | null;
  provenanceCategory: OfficialInjuryProvenanceCategory | null;
  provenance: OfficialInjuryProvenanceEntry[];
  independentSourceCount: number;
  quarantineReason:
    | 'NO_SAFE_CANDIDATE'
    | 'MULTIPLE_CANDIDATES'
    | 'SOURCE_CONFLICT'
    | 'INFERRED_ONLY_NOT_ACCEPTED'
    | 'NAME_KEY_UNSAFE'
    | null;
};

function quarantine(
  input: OfficialInjuryPlayerIdentityInput,
  nameKey: string,
  status: OfficialInjuryResolutionStatus,
  reason: NonNullable<OfficialInjuryPlayerIdentityResult['quarantineReason']>
): OfficialInjuryPlayerIdentityResult {
  return {
    resolverVersion: OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
    gameId: input.gameId,
    teamId: input.teamId,
    playerNameRaw: input.playerNameRaw,
    nameKey,
    resolutionStatus: status,
    playerEntityId: null,
    servingPlayerId: null,
    confidenceClass: null,
    provenanceCategory: null,
    provenance: [],
    independentSourceCount: 0,
    quarantineReason: reason,
  };
}

function success(args: {
  input: OfficialInjuryPlayerIdentityInput;
  nameKey: string;
  entityId: string;
  servingPlayerId: string | null;
  confidenceClass: OfficialInjuryConfidenceClass;
  provenanceCategory: OfficialInjuryProvenanceCategory;
  provenance: OfficialInjuryProvenanceEntry[];
  independentSourceCount: number;
}): OfficialInjuryPlayerIdentityResult {
  const hasServing = Boolean(args.servingPlayerId);
  return {
    resolverVersion: OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
    gameId: args.input.gameId,
    teamId: args.input.teamId,
    playerNameRaw: args.input.playerNameRaw,
    nameKey: args.nameKey,
    resolutionStatus: hasServing
      ? 'RESOLVED_CANONICAL_ENTITY'
      : 'RESOLVED_ENTITY_NO_SERVING_PLAYER',
    playerEntityId: args.entityId,
    servingPlayerId: args.servingPlayerId,
    confidenceClass: args.confidenceClass,
    provenanceCategory: args.provenanceCategory,
    provenance: args.provenance,
    independentSourceCount: args.independentSourceCount,
    quarantineReason: null,
  };
}

/**
 * Resolve official injury player identity from pre-loaded candidate evidence.
 * Does not query or write databases. Does not use injury status/reason.
 * U5 historical is not consulted.
 */
export function resolveOfficialInjuryPlayerIdentity(
  input: OfficialInjuryPlayerIdentityInput,
  evidence: OfficialInjuryCandidateEvidence
): OfficialInjuryPlayerIdentityResult {
  const nameKey = injuryIdentityNameKey(input.playerNameRaw);
  if (!isInjuryIdentityNameKeySafe(nameKey)) {
    return quarantine(
      input,
      nameKey,
      'QUARANTINED_NAME_UNSAFE',
      'NAME_KEY_UNSAFE'
    );
  }

  const { u2, u4Nba, u4Inferred } = evidence;

  if (
    u2.cardinality === 'multiple' ||
    u4Nba.cardinality === 'multiple' ||
    u4Inferred.cardinality === 'multiple'
  ) {
    return quarantine(
      input,
      nameKey,
      'QUARANTINED_MULTIPLE_CANDIDATES',
      'MULTIPLE_CANDIDATES'
    );
  }

  const u2Entity =
    u2.cardinality === 'unique' && u2.playerEntityId
      ? u2.playerEntityId
      : null;
  const nbaEntity =
    u4Nba.cardinality === 'unique' && u4Nba.playerEntityId
      ? u4Nba.playerEntityId
      : null;

  if (u2Entity && nbaEntity && u2Entity !== nbaEntity) {
    return quarantine(
      input,
      nameKey,
      'QUARANTINED_SOURCE_CONFLICT',
      'SOURCE_CONFLICT'
    );
  }

  const inferredEntity =
    u4Inferred.cardinality === 'unique' && u4Inferred.playerEntityId
      ? u4Inferred.playerEntityId
      : null;

  // If inferred disagrees with an accepted independent entity, conflict
  if (inferredEntity && u2Entity && inferredEntity !== u2Entity) {
    return quarantine(
      input,
      nameKey,
      'QUARANTINED_SOURCE_CONFLICT',
      'SOURCE_CONFLICT'
    );
  }
  if (inferredEntity && nbaEntity && !u2Entity && inferredEntity !== nbaEntity) {
    return quarantine(
      input,
      nameKey,
      'QUARANTINED_SOURCE_CONFLICT',
      'SOURCE_CONFLICT'
    );
  }

  const inferredSupport: OfficialInjuryProvenanceEntry[] =
    inferredEntity && (u2Entity === inferredEntity || nbaEntity === inferredEntity)
      ? [
          {
            source: 'u4_inferred_pgl',
            independenceClass: 'BOX_TAPE_DERIVED',
            candidateEntityId: inferredEntity,
            supportingOnly: true,
          },
        ]
      : [];

  // Tier A
  if (u2Entity && nbaEntity && u2Entity === nbaEntity) {
    const provenance: OfficialInjuryProvenanceEntry[] = [
      {
        source: 'same_game_pgl',
        independenceClass: 'BOX_TAPE',
        candidatePlayerId: u2.playerId ?? null,
        candidateEntityId: u2Entity,
      },
      {
        source: 'u4_nba_stint',
        independenceClass: 'NBA_MEMBERSHIP',
        candidateEntityId: nbaEntity,
      },
      ...inferredSupport,
    ];
    return success({
      input,
      nameKey,
      entityId: u2Entity,
      servingPlayerId: u2.playerId ?? evidence.servingPlayerId ?? null,
      confidenceClass: 'A',
      provenanceCategory: 'U2_PLUS_U4_NBA',
      provenance,
      independentSourceCount: 2,
    });
  }

  // Tier B
  if (u2Entity && (!nbaEntity || nbaEntity === u2Entity)) {
    const provenance: OfficialInjuryProvenanceEntry[] = [
      {
        source: 'same_game_pgl',
        independenceClass: 'BOX_TAPE',
        candidatePlayerId: u2.playerId ?? null,
        candidateEntityId: u2Entity,
      },
      ...inferredSupport,
    ];
    return success({
      input,
      nameKey,
      entityId: u2Entity,
      servingPlayerId: u2.playerId ?? evidence.servingPlayerId ?? null,
      confidenceClass: 'B',
      provenanceCategory: 'U2_SAME_GAME',
      provenance,
      independentSourceCount: 1,
    });
  }

  // Tier C
  if (!u2Entity && nbaEntity) {
    const provenance: OfficialInjuryProvenanceEntry[] = [
      {
        source: 'u4_nba_stint',
        independenceClass: 'NBA_MEMBERSHIP',
        candidateEntityId: nbaEntity,
      },
      ...inferredSupport,
    ];
    return success({
      input,
      nameKey,
      entityId: nbaEntity,
      servingPlayerId: evidence.servingPlayerId ?? null,
      confidenceClass: 'C',
      provenanceCategory: 'U4_NBA_STINT',
      provenance,
      independentSourceCount: 1,
    });
  }

  // D2 — inferred only → quarantine
  if (!u2Entity && !nbaEntity && inferredEntity) {
    return quarantine(
      input,
      nameKey,
      'QUARANTINED_INFERRED_ONLY',
      'INFERRED_ONLY_NOT_ACCEPTED'
    );
  }

  return quarantine(
    input,
    nameKey,
    'QUARANTINED_NO_SAFE_CANDIDATE',
    'NO_SAFE_CANDIDATE'
  );
}
