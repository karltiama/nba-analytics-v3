/**
 * Shared ingest resolver: provider id → canonical entity → optional BDL projection.
 * Names are never an authoritative fallback. Does not create bridges or fabricate IDs.
 */

import {
  providerIdentityKey,
  type AnalyticsServingResult,
  type PlayerIdentityBridgeRow,
  type PlayerIdentityDiagnostic,
  type PlayerIdentityProjectionRow,
  type PlayerIdentityProvider,
  type PlayerIdentityResolution,
  type PlayerIdentitySourceContext,
} from './player-identity';

export type PlayerIdentityIndex = {
  entityIdsByProviderKey: Map<string, string[]>;
  analyticsPlayerIdByEntity: Map<string, string>;
};

export function buildPlayerIdentityIndex(args: {
  bridges: PlayerIdentityBridgeRow[];
  projections: PlayerIdentityProjectionRow[];
}): PlayerIdentityIndex {
  const entityIdsByProviderKey = new Map<string, string[]>();
  for (const row of args.bridges) {
    const id = row.providerPlayerId.trim();
    if (!id) continue;
    const key = providerIdentityKey(row.provider, id);
    const list = entityIdsByProviderKey.get(key) ?? [];
    if (!list.includes(row.playerEntityId)) list.push(row.playerEntityId);
    entityIdsByProviderKey.set(key, list);
  }
  const analyticsPlayerIdByEntity = new Map<string, string>();
  for (const p of args.projections) {
    analyticsPlayerIdByEntity.set(p.playerEntityId, p.analyticsPlayerId);
  }
  return { entityIdsByProviderKey, analyticsPlayerIdByEntity };
}

export function resolvePlayerIdentity(
  provider: PlayerIdentityProvider,
  providerPlayerId: string,
  index: PlayerIdentityIndex
): PlayerIdentityResolution {
  const id = providerPlayerId.trim();
  if (!id) {
    return { status: 'unresolved', provider, providerPlayerId };
  }
  const candidates = index.entityIdsByProviderKey.get(
    providerIdentityKey(provider, id)
  );
  if (!candidates || candidates.length === 0) {
    return { status: 'unresolved', provider, providerPlayerId: id };
  }
  if (candidates.length > 1) {
    return {
      status: 'conflict',
      provider,
      providerPlayerId: id,
      candidateEntityIds: [...candidates].sort(),
    };
  }
  const playerEntityId = candidates[0]!;
  return {
    status: 'resolved',
    provider,
    providerPlayerId: id,
    playerEntityId,
    analyticsPlayerId: index.analyticsPlayerIdByEntity.get(playerEntityId) ?? null,
  };
}

export function resolvePlayerIdentities(
  provider: PlayerIdentityProvider,
  providerPlayerIds: string[],
  index: PlayerIdentityIndex
): PlayerIdentityResolution[] {
  return providerPlayerIds.map((id) =>
    resolvePlayerIdentity(provider, id, index)
  );
}

export function requireAnalyticsPlayerId(
  resolution: PlayerIdentityResolution
): AnalyticsServingResult {
  if (resolution.status === 'unresolved') {
    return { status: 'fail_closed', reason: 'unresolved' };
  }
  if (resolution.status === 'conflict') {
    return { status: 'fail_closed', reason: 'conflict' };
  }
  if (resolution.analyticsPlayerId) {
    return { status: 'serving', analyticsPlayerId: resolution.analyticsPlayerId };
  }
  return { status: 'not_serving_yet', playerEntityId: resolution.playerEntityId };
}

export function playerIdentityDiagnostic(args: {
  resolution: PlayerIdentityResolution;
  sourceContext: PlayerIdentitySourceContext;
}): PlayerIdentityDiagnostic {
  const { resolution, sourceContext } = args;
  return {
    provider: resolution.provider,
    sourceContext,
    status: resolution.status,
    providerPlayerId: resolution.providerPlayerId,
    playerEntityId:
      resolution.status === 'resolved' ? resolution.playerEntityId : null,
  };
}
