import {
  filterRowsByServingIdentity,
  gateIngestIdentities,
  starterGameIdentityReason,
} from './ingest-identity-gate';
import type { PlayerIdentityIndex } from './player-identity-resolve';
import type { PlayerIdentitySourceContext } from './player-identity';

export function gateArchivePlayerIds(args: {
  sourceContext: Extract<
    PlayerIdentitySourceContext,
    'ADVANCED' | 'LINEUP' | 'PLAYS' | 'SEASON_AVERAGE'
  >;
  providerPlayerIds: string[];
  index: PlayerIdentityIndex;
  observedAt: string;
}) {
  return gateIngestIdentities({
    provider: 'balldontlie',
    ...args,
  });
}

export function selectArchiveRowsForServing<T>(
  sourceContext: Extract<
    PlayerIdentitySourceContext,
    'ADVANCED' | 'LINEUP' | 'PLAYS' | 'SEASON_AVERAGE'
  >,
  rows: T[],
  getId: (row: T) => string,
  index: PlayerIdentityIndex,
  observedAt: string
) {
  const gate = gateArchivePlayerIds({
    sourceContext,
    providerPlayerIds: rows.map(getId),
    index,
    observedAt,
  });
  return { ...filterRowsByServingIdentity(rows, getId, gate), gate };
}

export { starterGameIdentityReason };
export { failStarterCertificationIfIdentityUnsafe } from '@/lib/archive/game-starters-from-lineups';
