/**
 * Box / PGL identity. Nightly BDL player upsert remains the owned serving-projection
 * creation path for real BDL ids. Generic PGL writes still require serving.
 */

import {
  filterRowsByServingIdentity,
  gateIngestIdentities,
} from './ingest-identity-gate';
import type { PlayerIdentityIndex } from './player-identity-resolve';

export const BDL_SERVING_PROJECTION_OWNER =
  'nightly-bdl-updater / transform-raw-to-analytics upsertAnalyticsPlayer from attested BDL payload ids';

export function gateBoxScoreProviderIds(args: {
  providerPlayerIds: string[];
  index: PlayerIdentityIndex;
  observedAt: string;
}) {
  return gateIngestIdentities({
    provider: 'balldontlie',
    sourceContext: 'BOX_SCORE',
    ...args,
  });
}

export function selectBoxRowsForPgl<T>(
  rows: T[],
  getId: (row: T) => string,
  index: PlayerIdentityIndex,
  observedAt: string
) {
  const gate = gateBoxScoreProviderIds({
    providerPlayerIds: rows.map(getId),
    index,
    observedAt,
  });
  return { ...filterRowsByServingIdentity(rows, getId, gate), gate };
}
