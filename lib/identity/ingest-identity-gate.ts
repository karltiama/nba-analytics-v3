/**
 * Shared ingest identity boundary (13R.3).
 *
 * provider ids → batch resolve → serving write / skip+quarantine.
 * Does not create analytics.players or fabricate BDL ids.
 */

import type { PlayerIdentityObservation } from './player-identity-quarantine';
import type {
  AnalyticsServingResult,
  PlayerIdentityDiagnostic,
  PlayerIdentityProvider,
  PlayerIdentityResolution,
  PlayerIdentitySourceContext,
} from './player-identity';
import {
  playerIdentityDiagnostic,
  requireAnalyticsPlayerId,
  resolvePlayerIdentity,
  type PlayerIdentityIndex,
} from './player-identity-resolve';

export type IngestIdentityEvent =
  | 'identity_resolved'
  | 'identity_not_serving'
  | 'identity_unresolved'
  | 'identity_conflict';

export type IngestIdentityAccounting = {
  inputIds: number;
  uniqueProviderIds: number;
  resolverLookups: number;
  serving: number;
  notServingYet: number;
  unresolved: number;
  conflicts: number;
  outputRows: number;
  quarantined: number;
  skipped: number;
};

export type IngestIdentityDecision = {
  providerPlayerId: string;
  resolution: PlayerIdentityResolution;
  serving: AnalyticsServingResult;
  event: IngestIdentityEvent;
  observation: PlayerIdentityObservation | null;
  diagnostic: PlayerIdentityDiagnostic;
};

export type IngestIdentityGate = {
  byId: Map<string, IngestIdentityDecision>;
  servingIds: Set<string>;
  observations: PlayerIdentityObservation[];
  accounting: IngestIdentityAccounting;
  diagnostics: PlayerIdentityDiagnostic[];
};

export function ingestIdentityEvent(
  serving: AnalyticsServingResult
): IngestIdentityEvent {
  if (serving.status === 'serving') return 'identity_resolved';
  if (serving.status === 'not_serving_yet') return 'identity_not_serving';
  return serving.reason === 'conflict' ? 'identity_conflict' : 'identity_unresolved';
}

export function gateIngestIdentities(args: {
  provider: PlayerIdentityProvider;
  sourceContext: PlayerIdentitySourceContext;
  providerPlayerIds: string[];
  index: PlayerIdentityIndex;
  observedAt: string;
  sampleGameId?: string | null;
  sampleTeamId?: string | null;
}): IngestIdentityGate {
  const unique = [
    ...new Set(args.providerPlayerIds.map((id) => id.trim()).filter(Boolean)),
  ];
  const byId = new Map<string, IngestIdentityDecision>();
  const servingIds = new Set<string>();
  const observations: PlayerIdentityObservation[] = [];
  const diagnostics: PlayerIdentityDiagnostic[] = [];
  let serving = 0;
  let notServingYet = 0;
  let unresolved = 0;
  let conflicts = 0;

  for (const id of unique) {
    const resolution = resolvePlayerIdentity(args.provider, id, args.index);
    const servingResult = requireAnalyticsPlayerId(resolution);
    const event = ingestIdentityEvent(servingResult);
    let observation: PlayerIdentityObservation | null = null;
    if (servingResult.status === 'serving') {
      serving += 1;
      servingIds.add(id);
    } else if (servingResult.status === 'not_serving_yet') {
      notServingYet += 1;
      observation = {
        provider: args.provider,
        providerPlayerId: id,
        sourceContext: args.sourceContext,
        observedAt: args.observedAt,
        kind: 'UNRESOLVED',
        sampleGameId: args.sampleGameId ?? null,
        sampleTeamId: args.sampleTeamId ?? null,
      };
    } else if (servingResult.reason === 'conflict') {
      conflicts += 1;
      observation = {
        provider: args.provider,
        providerPlayerId: id,
        sourceContext: args.sourceContext,
        observedAt: args.observedAt,
        kind: 'CONFLICT',
        sampleGameId: args.sampleGameId ?? null,
        sampleTeamId: args.sampleTeamId ?? null,
      };
    } else {
      unresolved += 1;
      observation = {
        provider: args.provider,
        providerPlayerId: id,
        sourceContext: args.sourceContext,
        observedAt: args.observedAt,
        kind: 'UNRESOLVED',
        sampleGameId: args.sampleGameId ?? null,
        sampleTeamId: args.sampleTeamId ?? null,
      };
    }
    if (observation) observations.push(observation);
    const diagnostic = playerIdentityDiagnostic({
      resolution,
      sourceContext: args.sourceContext,
    });
    diagnostics.push(diagnostic);
    byId.set(id, {
      providerPlayerId: id,
      resolution,
      serving: servingResult,
      event,
      observation,
      diagnostic,
    });
  }

  const skipped = notServingYet + unresolved + conflicts;
  return {
    byId,
    servingIds,
    observations,
    diagnostics,
    accounting: {
      inputIds: args.providerPlayerIds.length,
      uniqueProviderIds: unique.length,
      resolverLookups: 1,
      serving,
      notServingYet,
      unresolved,
      conflicts,
      outputRows: serving,
      quarantined: observations.length,
      skipped,
    },
  };
}

export function filterRowsByServingIdentity<T>(
  rows: T[],
  getProviderPlayerId: (row: T) => string,
  gate: IngestIdentityGate
): { keep: T[]; skipped: T[]; accounting: IngestIdentityAccounting } {
  const keep: T[] = [];
  const skipped: T[] = [];
  for (const row of rows) {
    const id = String(getProviderPlayerId(row) ?? '').trim();
    const decision = gate.byId.get(id);
    if (decision?.serving.status === 'serving') keep.push(row);
    else skipped.push(row);
  }
  return {
    keep,
    skipped,
    accounting: { ...gate.accounting, outputRows: keep.length, skipped: skipped.length },
  };
}

export function starterGameIdentityReason(
  starterProviderIds: string[],
  gate: IngestIdentityGate
): 'ok' | 'identity_not_serving' | 'identity_unresolved' | 'identity_conflict' {
  for (const id of starterProviderIds) {
    const decision = gate.byId.get(id.trim());
    if (!decision || decision.serving.status === 'fail_closed') {
      return decision?.event === 'identity_conflict'
        ? 'identity_conflict'
        : 'identity_unresolved';
    }
    if (decision.serving.status === 'not_serving_yet') return 'identity_not_serving';
  }
  return 'ok';
}

export function playParticipantServingLink(
  providerPlayerId: string,
  gate: IngestIdentityGate
): { available: boolean; analyticsPlayerId: string | null } {
  const decision = gate.byId.get(providerPlayerId.trim());
  if (decision?.serving.status === 'serving') {
    return { available: true, analyticsPlayerId: decision.serving.analyticsPlayerId };
  }
  return { available: false, analyticsPlayerId: null };
}
