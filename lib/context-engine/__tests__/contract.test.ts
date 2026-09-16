import { describe, expect, it } from 'vitest';
import {
  CONTEXT_LAYER,
  FACT_CATEGORIES,
  MISSING_DATA_BEHAVIOR,
  THRESHOLD_NOT_CERTIFIED,
  XRAY_CONSUMER_BOUNDARY,
  assertLayerSeparation,
  classifyAvailabilityHealth,
  missingAvailabilityIsNotHealthy,
  qualifyWowySignal,
  signalDefinition,
  type AvailabilityFact,
} from '@/lib/context-engine/contract';

const cutoff = '2026-04-10T23:00:00.000Z';

describe('fact vs signal separation', () => {
  it('keeps facts, signals, model features, and interpretation as distinct layers', () => {
    expect(CONTEXT_LAYER.FACT).not.toBe(CONTEXT_LAYER.SIGNAL);
    expect(CONTEXT_LAYER.SIGNAL).not.toBe(CONTEXT_LAYER.MODEL_FEATURE);
    expect(CONTEXT_LAYER.MODEL_FEATURE).not.toBe(CONTEXT_LAYER.INTERPRETATION);
    expect(() => assertLayerSeparation({ layer: CONTEXT_LAYER.FACT, usedAs: CONTEXT_LAYER.SIGNAL })).toThrow(
      /Layer violation/
    );
    expect(() => assertLayerSeparation({ layer: CONTEXT_LAYER.FACT, usedAs: CONTEXT_LAYER.FACT })).not.toThrow();
    expect(signalDefinition('TEAMMATE_OUT').requiresFacts).toContain(FACT_CATEGORIES.AVAILABILITY);
    expect(signalDefinition('MINUTES_ELEVATED').numericThreshold).toBe(THRESHOLD_NOT_CERTIFIED);
    expect(XRAY_CONSUMER_BOUNDARY.wiredInThisStep).toBe(false);
  });
});

describe('availability safety', () => {
  it('does not treat missing availability as healthy', () => {
    expect(missingAvailabilityIsNotHealthy(null)).toBe(true);
    expect(classifyAvailabilityHealth(null)).not.toBe('HEALTHY');
    const missing: AvailabilityFact = {
      playerId: 'p1',
      gameId: 'g1',
      source: 'bdl',
      observedAt: cutoff,
      status: null,
      freshness: 'unknown',
      knownBeforeCutoff: false,
    };
    expect(classifyAvailabilityHealth(missing)).not.toBe('HEALTHY');
    expect(MISSING_DATA_BEHAVIOR.treatMissingAsHealthy).toBe(false);
    expect(MISSING_DATA_BEHAVIOR.imputeOutTeammate).toBe(false);
  });
});

describe('WOWY signal qualification', () => {
  it('cannot qualify without required sample and as-of-safe Out context', () => {
    const missingContext = qualifyWowySignal({
      teammateCondition: 'missing',
      withSample: 20,
      withoutSample: 12,
      statDifference: 4,
      minutesDifference: 2,
      cutoffAt: cutoff,
      availabilityKnownBeforeCutoff: false,
    });
    expect(missingContext.qualified).toBe(false);
    expect(missingContext.mayAdjustProjection).toBe(false);

    const smallSample = qualifyWowySignal({
      teammateCondition: 'out',
      withSample: 1,
      withoutSample: 1,
      statDifference: 4,
      minutesDifference: 2,
      cutoffAt: cutoff,
      availabilityKnownBeforeCutoff: true,
    });
    expect(smallSample.qualified).toBe(false);

    const ok = qualifyWowySignal({
      teammateCondition: 'out',
      withSample: 12,
      withoutSample: 10,
      statDifference: 4,
      minutesDifference: 2,
      cutoffAt: cutoff,
      availabilityKnownBeforeCutoff: true,
    });
    expect(ok.qualified).toBe(true);
    expect(ok.mayAdjustProjection).toBe(false);
  });
});
