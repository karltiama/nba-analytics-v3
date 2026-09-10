/**
 * Future automatic Context Check discovery.
 *
 * Intended workflow (not implemented for publishing):
 *
 *   Database → candidate detection → Suggested Context Check → human review → publish
 *
 * Not:
 *
 *   Database → social media
 *
 * v1 ships a mock source plus pure signal rules. Do not query analytics.*,
 * raw.*, or any serving table from this module until a dedicated read-only
 * path is confirmed safe and isolated from ingestion.
 */

import { MOCK_CANDIDATES } from './mocks';
import type { ContextCheckCandidate } from './types';

export const DISCOVERY_RULES = {
  recentFormDivergence: {
    l5HitRateMin: 0.8,
    seasonHitRateMax: 0.55,
  },
  lineInflation: {
    minLineIncrease: 2,
  },
  roleChange: {
    minMinutesDelta: 4,
  },
} as const;

export type DiscoverySignalKind = 'recent_form_divergence' | 'line_inflation' | 'role_change';

export interface DiscoverySignalInput {
  l5HitRate?: number;
  seasonHitRate?: number;
  currentLine?: number;
  recentAverageLine?: number;
  recentMinutes?: number;
  seasonMinutes?: number;
}

export interface ContextCheckDiscoverySource {
  /**
   * Return editorial candidates. Implementations must be read-only.
   * Candidate `score` is internal/editorial and must not be shown on ContextCheckCard.
   */
  findContextCheckCandidates(): Promise<ContextCheckCandidate[]>;
}

export function evaluateDiscoverySignals(input: DiscoverySignalInput): DiscoverySignalKind[] {
  const signals: DiscoverySignalKind[] = [];

  if (
    input.l5HitRate != null &&
    input.seasonHitRate != null &&
    input.l5HitRate >= DISCOVERY_RULES.recentFormDivergence.l5HitRateMin &&
    input.seasonHitRate <= DISCOVERY_RULES.recentFormDivergence.seasonHitRateMax
  ) {
    signals.push('recent_form_divergence');
  }

  if (
    input.currentLine != null &&
    input.recentAverageLine != null &&
    input.currentLine - input.recentAverageLine >= DISCOVERY_RULES.lineInflation.minLineIncrease
  ) {
    signals.push('line_inflation');
  }

  if (
    input.recentMinutes != null &&
    input.seasonMinutes != null &&
    Math.abs(input.recentMinutes - input.seasonMinutes) >= DISCOVERY_RULES.roleChange.minMinutesDelta
  ) {
    signals.push('role_change');
  }

  return signals;
}

export class MockContextCheckDiscovery implements ContextCheckDiscoverySource {
  async findContextCheckCandidates(): Promise<ContextCheckCandidate[]> {
    return MOCK_CANDIDATES.map((candidate) => ({ ...candidate }));
  }
}

/**
 * TODO: AnalyticsContextCheckDiscovery
 *
 * When a safe read-only analytics query exists, implement:
 *
 *   export class AnalyticsContextCheckDiscovery implements ContextCheckDiscoverySource
 *
 * Suggested detection (do not run against production from this file yet):
 * - recent-form divergence: L5 hit rate >= 80% AND season hit rate <= 55%
 * - line inflation: current line - recent average line >= 2
 * - role change: abs(recent minutes - season minutes) >= 4
 *
 * Requirements for a real implementation:
 * - SELECT-only
 * - no schema / migration changes
 * - no shared ingestion services
 * - freeze results into ContextCheckData snapshots before publish
 */
export const defaultContextCheckDiscovery: ContextCheckDiscoverySource =
  new MockContextCheckDiscovery();

export async function findContextCheckCandidates(
  source: ContextCheckDiscoverySource = defaultContextCheckDiscovery
): Promise<ContextCheckCandidate[]> {
  return source.findContextCheckCandidates();
}
