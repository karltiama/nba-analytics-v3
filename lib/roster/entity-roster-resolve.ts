/**
 * Entity-aware NBA roster resolution (Phase 2.T.2D.1cC).
 *
 * Preferred path: NBA id → analytics.player_provider_ids → player_entity_id
 * BDL analytics.players is optional.
 */

import { normalizePersonName } from './normalize-player-name';
import type { RosterObservation } from './identity-resolver';

export type EntityProviderRow = {
  playerEntityId: string;
  provider: 'nba' | 'balldontlie';
  providerPlayerId: string;
};

export type EntityRow = {
  playerEntityId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
};

export type EntityResolveStatus =
  | 'entity_provider_match'
  | 'entity_safe_fallback'
  | 'unresolved'
  | 'ambiguous';

export type EntityResolveResult = {
  status: EntityResolveStatus;
  nbaPlayerId: string;
  fullName: string;
  teamAbbr: string;
  jersey: string | null;
  position: string | null;
  playerEntityId: string | null;
  /** Optional BDL-backed analytics.players.player_id when mapped. */
  analyticsPlayerId: string | null;
  hasBdlIdentity: boolean;
  method: string | null;
  reason: string | null;
  candidates: Array<{ playerEntityId: string; displayName: string }>;
};

export type EntityResolverIndex = {
  nbaToEntity: Map<string, string>;
  bdlToEntity: Map<string, string>;
  entityById: Map<string, EntityRow>;
  bdlByEntity: Map<string, string>;
  /** normalized display name → entities */
  entitiesByNormalizedName: Map<string, EntityRow[]>;
  /** NBA ids that map to multiple entities (should not happen under UNIQUE) */
  ambiguousNbaIds: Set<string>;
};

export function buildEntityResolverIndex(args: {
  entities: EntityRow[];
  providerRows: EntityProviderRow[];
}): EntityResolverIndex {
  const nbaToEntity = new Map<string, string>();
  const bdlToEntity = new Map<string, string>();
  const bdlByEntity = new Map<string, string>();
  const ambiguousNbaIds = new Set<string>();
  const entityById = new Map(args.entities.map((e) => [e.playerEntityId, e]));

  for (const row of args.providerRows) {
    if (row.provider === 'nba') {
      const existing = nbaToEntity.get(row.providerPlayerId);
      if (existing && existing !== row.playerEntityId) {
        ambiguousNbaIds.add(row.providerPlayerId);
      } else {
        nbaToEntity.set(row.providerPlayerId, row.playerEntityId);
      }
    } else if (row.provider === 'balldontlie') {
      bdlToEntity.set(row.providerPlayerId, row.playerEntityId);
      bdlByEntity.set(row.playerEntityId, row.providerPlayerId);
    }
  }

  const entitiesByNormalizedName = new Map<string, EntityRow[]>();
  for (const e of args.entities) {
    const key = normalizePersonName(e.displayName);
    if (!key) continue;
    const list = entitiesByNormalizedName.get(key) ?? [];
    list.push(e);
    entitiesByNormalizedName.set(key, list);
  }

  return {
    nbaToEntity,
    bdlToEntity,
    entityById,
    bdlByEntity,
    entitiesByNormalizedName,
    ambiguousNbaIds,
  };
}

export function resolveRosterToEntity(
  obs: RosterObservation,
  index: EntityResolverIndex
): EntityResolveResult {
  const base = {
    nbaPlayerId: obs.nbaPlayerId,
    fullName: obs.fullName,
    teamAbbr: obs.teamAbbr,
    jersey: obs.jersey,
    position: obs.position,
  };

  if (index.ambiguousNbaIds.has(obs.nbaPlayerId)) {
    return {
      ...base,
      status: 'ambiguous',
      playerEntityId: null,
      analyticsPlayerId: null,
      hasBdlIdentity: false,
      method: null,
      reason: `NBA id ${obs.nbaPlayerId} maps to multiple entities`,
      candidates: [],
    };
  }

  // Level 1 — NBA provider → entity
  const entityId = index.nbaToEntity.get(obs.nbaPlayerId);
  if (entityId) {
    const entity = index.entityById.get(entityId);
    const bdl = index.bdlByEntity.get(entityId) ?? null;
    return {
      ...base,
      status: 'entity_provider_match',
      playerEntityId: entityId,
      analyticsPlayerId: bdl,
      hasBdlIdentity: bdl != null,
      method: 'player_provider_ids:nba→entity',
      reason: null,
      candidates: entity
        ? [{ playerEntityId: entity.playerEntityId, displayName: entity.displayName }]
        : [],
    };
  }

  // Level 3 — unique normalized name among entities (fail closed if >1)
  const key = normalizePersonName(obs.fullName);
  const nameHits = key ? index.entitiesByNormalizedName.get(key) ?? [] : [];
  if (nameHits.length === 1) {
    const e = nameHits[0]!;
    const bdl = index.bdlByEntity.get(e.playerEntityId) ?? null;
    return {
      ...base,
      status: 'entity_safe_fallback',
      playerEntityId: e.playerEntityId,
      analyticsPlayerId: bdl,
      hasBdlIdentity: bdl != null,
      method: 'entity_normalized_name_unique',
      reason: null,
      candidates: [
        { playerEntityId: e.playerEntityId, displayName: e.displayName },
      ],
    };
  }
  if (nameHits.length > 1) {
    return {
      ...base,
      status: 'ambiguous',
      playerEntityId: null,
      analyticsPlayerId: null,
      hasBdlIdentity: false,
      method: null,
      reason: `Multiple entities named "${obs.fullName}"`,
      candidates: nameHits.map((e) => ({
        playerEntityId: e.playerEntityId,
        displayName: e.displayName,
      })),
    };
  }

  return {
    ...base,
    status: 'unresolved',
    playerEntityId: null,
    analyticsPlayerId: null,
    hasBdlIdentity: false,
    method: null,
    reason: `No entity for NBA id ${obs.nbaPlayerId} / name "${obs.fullName}"`,
    candidates: [],
  };
}

/** Plan attaching a later BDL id to an existing entity (schema support check). */
export function planAttachBdlToEntity(args: {
  playerEntityId: string;
  bdlPlayerId: string;
  existingBdlOnEntity: string | null;
  existingEntityForBdl: string | null;
}):
  | { action: 'insert_bdl_map' }
  | { action: 'already_attached' }
  | { action: 'conflict'; detail: string } {
  if (args.existingBdlOnEntity === args.bdlPlayerId) {
    return { action: 'already_attached' };
  }
  if (args.existingBdlOnEntity && args.existingBdlOnEntity !== args.bdlPlayerId) {
    return {
      action: 'conflict',
      detail: `Entity already has BDL ${args.existingBdlOnEntity}`,
    };
  }
  if (
    args.existingEntityForBdl &&
    args.existingEntityForBdl !== args.playerEntityId
  ) {
    return {
      action: 'conflict',
      detail: `BDL ${args.bdlPlayerId} already bound to entity ${args.existingEntityForBdl}`,
    };
  }
  return { action: 'insert_bdl_map' };
}
