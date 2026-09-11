import {
  filterRowsByServingIdentity,
  gateIngestIdentities,
} from './ingest-identity-gate';
import type { PlayerIdentityIndex } from './player-identity-resolve';

export function gatePlayerPropProviderIds(args: {
  providerPlayerIds: string[];
  index: PlayerIdentityIndex;
  observedAt: string;
  sampleGameId?: string | null;
}) {
  return gateIngestIdentities({
    provider: 'balldontlie',
    sourceContext: 'PLAYER_PROP',
    providerPlayerIds: args.providerPlayerIds,
    index: args.index,
    observedAt: args.observedAt,
    sampleGameId: args.sampleGameId ?? null,
  });
}

export function selectPropRowsForAnalytics<T>(
  rows: T[],
  getId: (row: T) => string | number,
  index: PlayerIdentityIndex,
  observedAt: string,
  sampleGameId?: string | null
) {
  const gate = gatePlayerPropProviderIds({
    providerPlayerIds: rows.map((r) => String(getId(r))),
    index,
    observedAt,
    sampleGameId,
  });
  return {
    ...filterRowsByServingIdentity(rows, (r) => String(getId(r)), gate),
    gate,
  };
}
