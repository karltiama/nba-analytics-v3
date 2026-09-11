/**
 * Known BALLDONTLIE capability for ops. Config/evidence only — /ops must not probe.
 */

export type ProviderCapabilityState =
  | 'AVAILABLE'
  | 'BLOCKED_BY_SUBSCRIPTION'
  | 'NOT_IMPLEMENTED'
  | 'UNKNOWN';

export type ProviderCapabilityRow = {
  id: string;
  label: string;
  state: ProviderCapabilityState;
  evidence: string;
};

export const PROVIDER_CAPABILITY_CATALOG: ProviderCapabilityRow[] = [
  {
    id: 'v1_games',
    label: '/v1/games',
    state: 'AVAILABLE',
    evidence: '13C schedule/status canary returned 200',
  },
  {
    id: 'v1_stats',
    label: '/v1/stats',
    state: 'BLOCKED_BY_SUBSCRIPTION',
    evidence: '13F.3A canary HTTP 401; parked',
  },
  {
    id: 'lineups',
    label: '/nba/v1/lineups',
    state: 'BLOCKED_BY_SUBSCRIPTION',
    evidence: 'GOAT inactive; not probed (13F.3A)',
  },
  {
    id: 'advanced',
    label: 'Advanced postgame',
    state: 'NOT_IMPLEMENTED',
    evidence: '13F.3 worker not implemented; GOAT parked',
  },
  {
    id: 'plays',
    label: 'Plays',
    state: 'NOT_IMPLEMENTED',
    evidence: '13F.3 worker not implemented; GOAT parked',
  },
];

export function classifyProviderCapabilityHealth(
  state: ProviderCapabilityState
): { health: 'HEALTHY' | 'BLOCKED' | 'FROZEN_EXPECTED' | 'UNKNOWN'; reason: string } {
  if (state === 'AVAILABLE') return { health: 'HEALTHY', reason: 'known available from prior canary' };
  if (state === 'BLOCKED_BY_SUBSCRIPTION') {
    return { health: 'BLOCKED', reason: 'subscription/entitlement blocked (not a generic FAILED)' };
  }
  if (state === 'NOT_IMPLEMENTED') {
    return { health: 'FROZEN_EXPECTED', reason: 'worker not implemented; not an incident' };
  }
  return { health: 'UNKNOWN', reason: 'capability not certified' };
}
