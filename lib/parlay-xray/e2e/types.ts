import type { TargetGameContextRow } from '@/lib/parlay-xray/context/load';
import type { XRayContextSources, XRayLegContext } from '@/lib/parlay-xray/context/types';
import type { XRayParlayInterpretation } from '@/lib/parlay-xray/interpretation/parlay-types';
import type { XRayLegInterpretation } from '@/lib/parlay-xray/interpretation/types';
import type { HistoricalMovementRow, HistoricalParlayLegMatch } from '@/lib/parlay-xray/replay/types';
import type { CanonicalParlayLegResolution, XrayResolutionCatalog } from '@/lib/parlay-xray/resolution/types';
import type { XrayHistoricalReplay } from '@/lib/parlay-xray/session';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';

export type HistoricalXrayReplayContext = {
  historicalDate: string;
  cutoffAt: string;
  gameId: string;
  dateLabel: string;
  season: string;
  slateLabel: string;
};

export type HistoricalXrayReplayDeps = {
  catalog: XrayResolutionCatalog;
  movementRows: HistoricalMovementRow[];
  targetGame: TargetGameContextRow;
  sourcesByPlayerId: Record<string, XRayContextSources>;
  nowMs?: () => number;
};

export type HistoricalXrayReplayTimings = {
  resolveMs: number;
  matchMs: number;
  contextMs: number;
  interpretMs: number;
  totalMs: number;
};

export type HistoricalXrayIdentityLayer = {
  legId: string;
  ocr: string | null;
  confirmedPlayerName: string | null;
  canonicalPlayerName: string | null;
  canonicalPlayerId: string | null;
};

export type HistoricalXrayReplayResult = {
  confirmedLegs: ExtractedParlayLeg[];
  resolutions: CanonicalParlayLegResolution[];
  matches: HistoricalParlayLegMatch[];
  contexts: XRayLegContext[];
  interpretations: XRayLegInterpretation[];
  parlayInterpretation: XRayParlayInterpretation;
  historicalReplay: XrayHistoricalReplay;
  identityLayers: HistoricalXrayIdentityLayer[];
  timings: HistoricalXrayReplayTimings;
};

export function assertHistoricalReplayContext(
  context: HistoricalXrayReplayContext | null | undefined
): asserts context is HistoricalXrayReplayContext {
  if (!context) {
    throw new Error('HISTORICAL_REPLAY_CONTEXT_REQUIRED');
  }
  if (!context.historicalDate.trim() || !context.cutoffAt.trim() || !context.gameId.trim()) {
    throw new Error('HISTORICAL_REPLAY_CONTEXT_INCOMPLETE');
  }
}
