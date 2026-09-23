import { known, withDerivedResolution } from '@/lib/parlay-xray/fields';
import { buildFullPreviewFixture, buildPartialExtractionFixture } from '@/lib/parlay-xray/dev-fixture';
import type { ExtractedParlayLeg, UploadErrorCode, XRayAnalysis, XRayParlay } from '@/lib/parlay-xray/types';
import { previewId, previewNumericId } from './ids';
import type { PreviewScenario } from './scenario';

export type CourtContextXrayPreview =
  | { kind: 'error'; code: UploadErrorCode }
  | {
      kind: 'parlay';
      parlay: XRayParlay;
      analysis: XRayAnalysis | null;
      confirmed: boolean;
      result: 'SUCCESS' | 'PARTIAL' | 'NEEDS_CONFIRMATION' | 'NO_LEGS_FOUND';
    };

function scopeLeg(leg: ExtractedParlayLeg, index: number, dense: boolean): ExtractedParlayLeg {
  const playerId = String(previewNumericId(index + 1));
  const scoped = withDerivedResolution({
    ...leg,
    id: previewId(`xray-leg-${index + 1}`),
    playerId: known(playerId),
    nbaPlayerId: known(playerId),
    playerDisplayName: dense
      ? known('Christopher-James Okonkwo-Bellamy')
      : { ...leg.playerDisplayName },
    matchupLabel: dense
      ? known('Lumen Valley Night Owls Basketball Club @ Cinder Basin Foundrymen')
      : leg.matchupLabel,
  });
  return scoped;
}

function emptyParlay(): XRayParlay {
  return {
    id: previewId('xray-empty'),
    source: 'screenshot',
    uploadedImage: {
      filename: 'preview-empty.png',
      mimeType: 'image/png',
      sizeBytes: 0,
      objectUrl: '',
    },
    legs: [],
    extractionStatus: 'no_legs',
    analysisStatus: 'unavailable',
    createdAt: '2026-04-02T20:00:00.000Z',
  };
}

export function loadCourtContextXrayPreview(scenario: PreviewScenario): CourtContextXrayPreview {
  if (scenario === 'error') {
    return { kind: 'error', code: 'unreadable_screenshot' };
  }
  if (scenario === 'empty') {
    return {
      kind: 'parlay',
      parlay: emptyParlay(),
      analysis: null,
      confirmed: false,
      result: 'NO_LEGS_FOUND',
    };
  }
  if (scenario === 'partial') {
    const { parlay } = buildPartialExtractionFixture();
    return {
      kind: 'parlay',
      parlay: {
        ...parlay,
        id: previewId('xray-partial'),
        legs: parlay.legs.map((leg, index) => scopeLeg(leg, index, false)),
      },
      analysis: null,
      confirmed: false,
      result: 'PARTIAL',
    };
  }
  const full = buildFullPreviewFixture();
  const dense = scenario === 'mobile-dense';
  const legs = full.parlay.legs.map((leg, index) => scopeLeg(leg, index, dense && index === 0));
  return {
    kind: 'parlay',
    parlay: {
      ...full.parlay,
      id: previewId(dense ? 'xray-dense' : 'xray-default'),
      legs,
    },
    analysis: retargetAnalysis(full.analysis, full.parlay.legs, legs),
    confirmed: true,
    result: 'SUCCESS',
  };
}

function retargetAnalysis(
  analysis: XRayAnalysis,
  from: ExtractedParlayLeg[],
  to: ExtractedParlayLeg[]
): XRayAnalysis {
  let json = JSON.stringify(analysis);
  from.forEach((leg, index) => {
    const nextId = to[index]?.id;
    if (!nextId) return;
    json = json.split(leg.id).join(nextId);
  });
  return JSON.parse(json) as XRayAnalysis;
}

export function xrayExtractHttp(scenario: PreviewScenario): { status: number; body: unknown } {
  const loaded = loadCourtContextXrayPreview(scenario);
  const quota = { used: 0, limit: 5, remaining: 5 };
  if (loaded.kind === 'error') {
    return {
      status: 500,
      body: {
        result: 'INTERNAL_ERROR',
        message: 'Preview extract failed before any provider call.',
        legs: [],
        cacheHit: false,
        providerAttempted: false,
        quota,
        extractionVersion: 'ccpreview',
      },
    };
  }
  return {
    status: 200,
    body: {
      result: loaded.result,
      message:
        loaded.result === 'NO_LEGS_FOUND'
          ? 'No parlay legs were recognizable in that screenshot.'
          : null,
      legs: loaded.parlay.legs,
      cacheHit: true,
      providerAttempted: false,
      quota,
      extractionVersion: 'ccpreview',
    },
  };
}
