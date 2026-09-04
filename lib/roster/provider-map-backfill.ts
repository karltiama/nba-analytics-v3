/**
 * Controlled high-confidence provider_id_map backfill for NBA ↔ BDL bridges.
 *
 * Inserts only:
 *   entity_type='player', provider='balldontlie',
 *   internal_id=<nba/shared id>, provider_id=<analytics/bdl id>
 *
 * Fail-closed on conflicts. No broad name-only writes without unique resolution
 * already established by the identity resolver (safe_fallback_match).
 */

export type ExistingMap = {
  provider: 'nba' | 'balldontlie';
  providerId: string;
  internalId: string;
};

export type ProposedBdlBridge = {
  nbaPlayerId: string;
  internalId: string;
  analyticsPlayerId: string;
  fullName: string;
  reason: string;
};

export type BackfillDecision =
  | { action: 'insert'; proposal: ProposedBdlBridge }
  | { action: 'skip_already_present'; proposal: ProposedBdlBridge }
  | { action: 'conflict'; proposal: ProposedBdlBridge; detail: string }
  | { action: 'reject'; proposal: ProposedBdlBridge; detail: string };

/**
 * Decide whether a safe_fallback_match may insert a balldontlie bridge.
 * Requires an nba provider row so internal_id is known.
 */
export function decideBdlBridgeBackfill(args: {
  nbaPlayerId: string;
  fullName: string;
  analyticsPlayerId: string;
  /** Must come from resolver status === safe_fallback_match (or provider with missing bridge). */
  resolutionMethod: string;
  existingMaps: ExistingMap[];
}): BackfillDecision {
  const proposal: ProposedBdlBridge = {
    nbaPlayerId: args.nbaPlayerId,
    internalId: args.nbaPlayerId, // default; overridden when nba map exists
    analyticsPlayerId: args.analyticsPlayerId,
    fullName: args.fullName,
    reason: args.resolutionMethod,
  };

  const nbaMaps = args.existingMaps.filter(
    (m) => m.provider === 'nba' && m.providerId === args.nbaPlayerId
  );
  if (nbaMaps.length === 0) {
    return {
      action: 'reject',
      proposal,
      detail: 'No nba provider_id_map row; refusing to invent internal_id',
    };
  }
  if (nbaMaps.length > 1) {
    return {
      action: 'conflict',
      proposal,
      detail: 'Multiple nba provider rows for same provider_id',
    };
  }

  const internalId = nbaMaps[0].internalId;
  proposal.internalId = internalId;

  const bdlByProvider = args.existingMaps.filter(
    (m) => m.provider === 'balldontlie' && m.providerId === args.analyticsPlayerId
  );
  if (bdlByProvider.length === 1) {
    if (bdlByProvider[0].internalId === internalId) {
      return { action: 'skip_already_present', proposal };
    }
    return {
      action: 'conflict',
      proposal,
      detail: `balldontlie provider_id=${args.analyticsPlayerId} already maps to internal_id=${bdlByProvider[0].internalId}, not ${internalId}`,
    };
  }
  if (bdlByProvider.length > 1) {
    return {
      action: 'conflict',
      proposal,
      detail: 'Multiple balldontlie rows for same provider_id',
    };
  }

  const bdlByInternal = args.existingMaps.filter(
    (m) => m.provider === 'balldontlie' && m.internalId === internalId
  );
  if (bdlByInternal.length === 1) {
    if (bdlByInternal[0].providerId === args.analyticsPlayerId) {
      return { action: 'skip_already_present', proposal };
    }
    return {
      action: 'conflict',
      proposal,
      detail: `internal_id=${internalId} already bridged to balldontlie provider_id=${bdlByInternal[0].providerId}`,
    };
  }
  if (bdlByInternal.length > 1) {
    return {
      action: 'conflict',
      proposal,
      detail: `internal_id=${internalId} has multiple balldontlie bridges`,
    };
  }

  // Only allow methods that are explicitly safe (unique identity already established).
  const allowed =
    args.resolutionMethod.startsWith('normalized_name_unique') ||
    args.resolutionMethod.startsWith('normalized_name+pgl_team') ||
    args.resolutionMethod.startsWith('normalized_name+position') ||
    args.resolutionMethod.includes('provider_id_map');

  if (!allowed) {
    return {
      action: 'reject',
      proposal,
      detail: `Resolution method not eligible for backfill: ${args.resolutionMethod}`,
    };
  }

  return { action: 'insert', proposal };
}
