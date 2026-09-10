/**
 * Canonical player identity types (13R.2).
 * player_entities = person; player_provider_ids = bridges; analytics.players = BDL projection.
 */

export const PLAYER_IDENTITY_PROVIDERS = ['balldontlie', 'nba', 'bbref'] as const;
export type PlayerIdentityProvider = (typeof PLAYER_IDENTITY_PROVIDERS)[number];

export const PLAYER_IDENTITY_SOURCE_CONTEXTS = [
  'BOX_SCORE',
  'PLAYER_PROP',
  'INJURY',
  'ADVANCED',
  'LINEUP',
  'PLAYS',
  'SEASON_AVERAGE',
  'OTHER',
] as const;
export type PlayerIdentitySourceContext =
  (typeof PLAYER_IDENTITY_SOURCE_CONTEXTS)[number];

export const PLAYER_IDENTITY_QUARANTINE_STATUSES = [
  'UNRESOLVED',
  'CONFLICT',
  'RESOLVED',
] as const;
export type PlayerIdentityQuarantineStatus =
  (typeof PLAYER_IDENTITY_QUARANTINE_STATUSES)[number];

export type PlayerIdentityBridgeRow = {
  playerEntityId: string;
  provider: PlayerIdentityProvider;
  providerPlayerId: string;
};

/** Optional BDL serving projection (analytics.players.player_id). */
export type PlayerIdentityProjectionRow = {
  playerEntityId: string;
  analyticsPlayerId: string;
};

export type PlayerIdentityResolution =
  | {
      status: 'resolved';
      provider: PlayerIdentityProvider;
      providerPlayerId: string;
      playerEntityId: string;
      analyticsPlayerId: string | null;
    }
  | {
      status: 'unresolved';
      provider: PlayerIdentityProvider;
      providerPlayerId: string;
    }
  | {
      status: 'conflict';
      provider: PlayerIdentityProvider;
      providerPlayerId: string;
      candidateEntityIds: string[];
    };

export type AnalyticsServingResult =
  | { status: 'serving'; analyticsPlayerId: string }
  | { status: 'not_serving_yet'; playerEntityId: string }
  | { status: 'fail_closed'; reason: 'unresolved' | 'conflict' };

export type PlayerIdentityDiagnostic = {
  provider: PlayerIdentityProvider;
  sourceContext: PlayerIdentitySourceContext;
  status: PlayerIdentityResolution['status'];
  providerPlayerId: string;
  playerEntityId: string | null;
};

export function isPlayerIdentityProvider(
  value: string
): value is PlayerIdentityProvider {
  return (PLAYER_IDENTITY_PROVIDERS as readonly string[]).includes(value);
}

export function isPlayerIdentitySourceContext(
  value: string
): value is PlayerIdentitySourceContext {
  return (PLAYER_IDENTITY_SOURCE_CONTEXTS as readonly string[]).includes(value);
}

export function providerIdentityKey(
  provider: PlayerIdentityProvider,
  providerPlayerId: string
): string {
  return `${provider}\0${providerPlayerId}`;
}
