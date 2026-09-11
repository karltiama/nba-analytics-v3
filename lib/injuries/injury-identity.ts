/**
 * Injury ingest identity adoption. Analytics board only receives serving BDL projections.
 */

import type { InjuryPullRow } from './ingest-plan';
import {
  filterRowsByServingIdentity,
  gateIngestIdentities,
  type IngestIdentityGate,
} from '@/lib/identity/ingest-identity-gate';
import type { PlayerIdentityIndex } from '@/lib/identity/player-identity-resolve';

export function gateInjuryProviderIds(args: {
  providerPlayerIds: string[];
  index: PlayerIdentityIndex;
  observedAt: string;
}): IngestIdentityGate {
  return gateIngestIdentities({
    provider: 'balldontlie',
    sourceContext: 'INJURY',
    providerPlayerIds: args.providerPlayerIds,
    index: args.index,
    observedAt: args.observedAt,
  });
}

export function selectInjuryRowsForAnalytics(
  rows: InjuryPullRow[],
  gate: IngestIdentityGate
): { keep: InjuryPullRow[]; skipped: InjuryPullRow[] } {
  return filterRowsByServingIdentity(rows, (r) => String(r.playerId), gate);
}
