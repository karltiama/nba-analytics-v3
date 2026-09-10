/**
 * Pure quarantine lifecycle. Persistence is a SQL upsert on
 * (provider, provider_player_id, source_context).
 */

import type {
  PlayerIdentityProvider,
  PlayerIdentityQuarantineStatus,
  PlayerIdentitySourceContext,
} from './player-identity';

export type PlayerIdentityQuarantineRow = {
  provider: PlayerIdentityProvider;
  providerPlayerId: string;
  sourceContext: PlayerIdentitySourceContext;
  status: PlayerIdentityQuarantineStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  sampleGameId: string | null;
  sampleTeamId: string | null;
  resolvedPlayerEntityId: string | null;
};

export type PlayerIdentityObservation = {
  provider: PlayerIdentityProvider;
  providerPlayerId: string;
  sourceContext: PlayerIdentitySourceContext;
  observedAt: string;
  kind: 'UNRESOLVED' | 'CONFLICT';
  sampleGameId?: string | null;
  sampleTeamId?: string | null;
};

export function quarantineNaturalKey(row: {
  provider: PlayerIdentityProvider;
  providerPlayerId: string;
  sourceContext: PlayerIdentitySourceContext;
}): string {
  return `${row.provider}\0${row.providerPlayerId}\0${row.sourceContext}`;
}

function escalateStatus(
  current: PlayerIdentityQuarantineStatus,
  incoming: 'UNRESOLVED' | 'CONFLICT'
): PlayerIdentityQuarantineStatus {
  if (current === 'RESOLVED') return 'RESOLVED';
  if (current === 'CONFLICT' || incoming === 'CONFLICT') return 'CONFLICT';
  return 'UNRESOLVED';
}

export function applyQuarantineObservation(
  existing: PlayerIdentityQuarantineRow | null,
  observation: PlayerIdentityObservation
): PlayerIdentityQuarantineRow {
  const id = observation.providerPlayerId.trim();
  if (!id) {
    throw new Error('quarantine observation requires a non-empty providerPlayerId');
  }
  if (!existing) {
    return {
      provider: observation.provider,
      providerPlayerId: id,
      sourceContext: observation.sourceContext,
      status: observation.kind,
      firstSeenAt: observation.observedAt,
      lastSeenAt: observation.observedAt,
      occurrenceCount: 1,
      sampleGameId: observation.sampleGameId ?? null,
      sampleTeamId: observation.sampleTeamId ?? null,
      resolvedPlayerEntityId: null,
    };
  }
  return {
    ...existing,
    lastSeenAt: observation.observedAt,
    occurrenceCount: existing.occurrenceCount + 1,
    sampleGameId: observation.sampleGameId ?? existing.sampleGameId,
    sampleTeamId: observation.sampleTeamId ?? existing.sampleTeamId,
    status: escalateStatus(existing.status, observation.kind),
  };
}

export function applyQuarantineResolution(
  existing: PlayerIdentityQuarantineRow,
  args: { playerEntityId: string; resolvedAt: string }
): PlayerIdentityQuarantineRow {
  return {
    ...existing,
    status: 'RESOLVED',
    resolvedPlayerEntityId: args.playerEntityId,
    lastSeenAt: args.resolvedAt,
    occurrenceCount: existing.occurrenceCount,
  };
}
