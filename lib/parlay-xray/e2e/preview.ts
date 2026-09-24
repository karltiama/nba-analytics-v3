import type { XRayParlay } from '@/lib/parlay-xray/types';
import { buildX3fConfirmedLegs, buildX3fExtractedLegs, buildX3fReplayContext, buildX3fReplayDeps } from './fixture';
import { runHistoricalXrayReplay } from './run';
import type { HistoricalXrayReplayResult } from './types';

export function runCanonicalX3fReplay(): HistoricalXrayReplayResult {
  return runHistoricalXrayReplay(buildX3fConfirmedLegs(), buildX3fReplayContext(), buildX3fReplayDeps());
}

export function buildHistoricalReplayReviewPreview(): {
  parlay: XRayParlay;
  historicalReplay: HistoricalXrayReplayResult['historicalReplay'];
} {
  const context = buildX3fReplayContext();
  return {
    parlay: {
      id: 'xray-historical-replay-review',
      source: 'screenshot',
      uploadedImage: {
        filename: 'historical-replay.png',
        mimeType: 'image/png',
        sizeBytes: 0,
        objectUrl: '',
      },
      legs: buildX3fExtractedLegs(),
      extractionStatus: 'complete',
      analysisStatus: 'unavailable',
      createdAt: context.cutoffAt,
    },
    historicalReplay: {
      cutoffAt: context.cutoffAt,
      dateLabel: `${context.dateLabel} · ${context.slateLabel}`,
      gameId: context.gameId,
    },
  };
}

export function buildHistoricalAnalysisPreview(): {
  parlay: XRayParlay;
  interpretations: HistoricalXrayReplayResult['interpretations'];
  historicalReplay: HistoricalXrayReplayResult['historicalReplay'];
} {
  return buildHistoricalReplayResultsPreview();
}

export function buildHistoricalReplayResultsPreview(): {
  parlay: XRayParlay;
  interpretations: HistoricalXrayReplayResult['interpretations'];
  historicalReplay: HistoricalXrayReplayResult['historicalReplay'];
} {
  const result = runCanonicalX3fReplay();
  return {
    parlay: {
      id: 'xray-historical-replay-results',
      source: 'screenshot',
      uploadedImage: {
        filename: 'historical-replay.png',
        mimeType: 'image/png',
        sizeBytes: 0,
        objectUrl: '',
      },
      legs: result.confirmedLegs,
      extractionStatus: 'complete',
      analysisStatus: 'ready',
      createdAt: result.historicalReplay.cutoffAt,
    },
    interpretations: result.interpretations,
    historicalReplay: result.historicalReplay,
  };
}
