/**
 * Read-only Model Lab fixture for the Context Engine inspector.
 * Historical/dev example only. Not production-certified.
 */

import {
  CONTEXT_ENGINE_CONTRACT_ID,
  CONTEXT_ENGINE_CONTRACT_VERSION,
  CONTEXT_LAYER,
  FACT_CATEGORIES,
  RELIABILITY_STATE,
  THRESHOLD_NOT_CERTIFIED,
  signalDefinition,
  type ContextEngineSnapshot,
} from '@/lib/context-engine/contract';

export const CONTEXT_ENGINE_INSPECTOR_FIXTURE: ContextEngineSnapshot = {
  contractId: CONTEXT_ENGINE_CONTRACT_ID,
  contractVersion: CONTEXT_ENGINE_CONTRACT_VERSION,
  productionCertified: false,
  facts: [
    {
      layer: CONTEXT_LAYER.FACT,
      category: FACT_CATEGORIES.MINUTES,
      key: 'min_l5',
      value: 34.2,
      observedAt: '2026-04-01T00:00:00.000Z',
      source: 'reconstructed_historical_box',
      asOfSafe: true,
      liveAvailable: false,
      note: 'Dev fixture. Reconstructed historical minutes, not a live pregame observation.',
    },
    {
      layer: CONTEXT_LAYER.FACT,
      category: FACT_CATEGORIES.AVAILABILITY,
      key: 'primary_teammate_status',
      value: null,
      observedAt: null,
      source: null,
      asOfSafe: false,
      liveAvailable: false,
      note: 'Missing availability. Not healthy. Not imputed Out.',
    },
    {
      layer: CONTEXT_LAYER.FACT,
      category: FACT_CATEGORIES.WOWY,
      key: 'with_games',
      value: 12,
      observedAt: '2026-04-01T00:00:00.000Z',
      source: 'game-level-wowy-v1',
      asOfSafe: true,
      liveAvailable: false,
      note: 'Game-level participation WOWY v1. Not possession on/off.',
    },
  ],
  signals: [
    {
      definition: signalDefinition('MINUTES_ELEVATED'),
      present: false,
      reliability: {
        state: RELIABILITY_STATE.INSUFFICIENT,
        dimensions: {
          sampleCount: 5,
          recency: 'l5',
          freshness: 'unknown',
          sourceAvailability: 'missing',
          historicalCoverage: 'dev fixture',
          stability: THRESHOLD_NOT_CERTIFIED,
          qualificationStatus: 'unknown',
        },
        stateThreshold: THRESHOLD_NOT_CERTIFIED,
        opaqueConfidencePercentForbidden: true,
      },
    },
    {
      definition: signalDefinition('TEAMMATE_OUT'),
      present: false,
      reliability: {
        state: RELIABILITY_STATE.INSUFFICIENT,
        dimensions: {
          sampleCount: 0,
          recency: null,
          freshness: 'unknown',
          sourceAvailability: 'blocked',
          historicalCoverage: 'injury collection disabled',
          stability: THRESHOLD_NOT_CERTIFIED,
          qualificationStatus: 'unqualified',
        },
        stateThreshold: THRESHOLD_NOT_CERTIFIED,
        opaqueConfidencePercentForbidden: true,
      },
    },
  ],
  modelFeatureEligibility: [
    {
      layer: CONTEXT_LAYER.MODEL_FEATURE,
      featureName: 'pred_track_a_pts',
      eligible: true,
      reason: 'Already-certified Model C allowlist feature.',
    },
    {
      layer: CONTEXT_LAYER.MODEL_FEATURE,
      featureName: 'wowy_pts_diff',
      eligible: false,
      reason: 'WOWY remains experimental/inconclusive. Missing availability does not become a numeric feature.',
    },
  ],
  interpretations: [
    {
      layer: CONTEXT_LAYER.INTERPRETATION,
      consumer: 'model_lab',
      text: 'Recent minutes fact is present in this fixture; the MINUTES_ELEVATED signal is experimental and not production-certified.',
    },
  ],
};
