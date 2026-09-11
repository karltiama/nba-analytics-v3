/**
 * One identity boundary per ingest family: unique ids → 2 SQL lookups → gate.
 * Does not create analytics.players.
 */

import type {
  PlayerIdentityProvider,
  PlayerIdentitySourceContext,
} from './player-identity';
import {
  gateIngestIdentities,
  type IngestIdentityGate,
} from './ingest-identity-gate';
import {
  loadPartialIdentityIndex,
  persistQuarantineObservations,
  type SqlQuery,
} from './player-identity-store';

export async function gateIngestIdentitiesFromDb(args: {
  query: SqlQuery;
  provider: PlayerIdentityProvider;
  sourceContext: PlayerIdentitySourceContext;
  providerPlayerIds: string[];
  observedAt: string;
  persistQuarantine?: boolean;
  sampleGameId?: string | null;
  sampleTeamId?: string | null;
}): Promise<IngestIdentityGate> {
  const index = await loadPartialIdentityIndex(
    args.query,
    args.provider,
    args.providerPlayerIds
  );
  const gate = gateIngestIdentities({
    provider: args.provider,
    sourceContext: args.sourceContext,
    providerPlayerIds: args.providerPlayerIds,
    index,
    observedAt: args.observedAt,
    sampleGameId: args.sampleGameId,
    sampleTeamId: args.sampleTeamId,
  });
  if (args.persistQuarantine && gate.observations.length > 0) {
    await persistQuarantineObservations(args.query, gate.observations);
  }
  return gate;
}
