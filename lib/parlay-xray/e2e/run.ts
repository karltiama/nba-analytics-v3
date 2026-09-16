import { assembleXrayLegContext } from '@/lib/parlay-xray/context/assemble';
import { matchupTeamIds } from '@/lib/parlay-xray/context/load';
import type { XRayContextSources } from '@/lib/parlay-xray/context/types';
import { interpretXrayLeg } from '@/lib/parlay-xray/interpretation/interpret';
import { interpretXrayParlay } from '@/lib/parlay-xray/interpretation/parlay';
import { matchHistoricalParlayLeg } from '@/lib/parlay-xray/replay/match';
import { replayInputFromResolution } from '@/lib/parlay-xray/replay/types';
import { resolveCanonicalParlayLegs } from '@/lib/parlay-xray/resolution/resolve-leg';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';
import {
  assertHistoricalReplayContext,
  type HistoricalXrayIdentityLayer,
  type HistoricalXrayReplayContext,
  type HistoricalXrayReplayDeps,
  type HistoricalXrayReplayResult,
  type HistoricalXrayReplayTimings,
} from './types';

const EMPTY_SOURCES: XRayContextSources = {
  priorPlayerLogs: [],
  priorTeamStats: [],
  projectionSnapshots: [],
};

function elapsed(now: () => number, started: number): number {
  return Math.max(0, now() - started);
}

/**
 * Deterministic historical replay. Requires an explicit replay context.
 * Does not invent a date. Does not call providers. Analysis uses confirmed
 * legs, not a stale OCR-only copy.
 */
export function runHistoricalXrayReplay(
  confirmedLegs: ExtractedParlayLeg[],
  context: HistoricalXrayReplayContext,
  deps: HistoricalXrayReplayDeps
): HistoricalXrayReplayResult {
  assertHistoricalReplayContext(context);
  const now = deps.nowMs ?? (() => 0);
  const t0 = now();

  const tResolve = now();
  const resolutions = resolveCanonicalParlayLegs(confirmedLegs, deps.catalog, {
    eventDate: context.historicalDate,
    slateDate: context.historicalDate,
    asOfDate: context.historicalDate,
  });
  const resolveMs = elapsed(now, tResolve);

  const tMatch = now();
  const matches = resolutions.map((resolution) => {
    const input = replayInputFromResolution(resolution, context.historicalDate);
    const playerId = input.playerId;
    const market = input.market;
    const scoped = deps.movementRows.filter(
      (row) =>
        row.game_id === context.gameId &&
        (playerId == null || row.player_id === playerId) &&
        (market == null || row.prop_type === market)
    );
    return matchHistoricalParlayLeg(input, scoped);
  });
  const matchMs = elapsed(now, tMatch);

  const tContext = now();
  const contexts = resolutions.map((resolution, index) => {
    const match = matches[index]!;
    const mapped = matchupTeamIds(resolution, deps.targetGame);
    const playerId = resolution.playerResolution.value?.playerId ?? null;
    const sources = (playerId && deps.sourcesByPlayerId[playerId]) || EMPTY_SOURCES;
    return assembleXrayLegContext({
      resolution,
      match,
      contextCutoffAt: context.cutoffAt,
      season: context.season,
      playerTeamId: mapped.playerTeamId,
      opponentTeamId: mapped.opponentTeamId,
      sources,
    });
  });
  const contextMs = elapsed(now, tContext);

  const tInterpret = now();
  const interpretations = contexts.map(interpretXrayLeg);
  const parlayInterpretation = interpretXrayParlay(interpretations);
  const interpretMs = elapsed(now, tInterpret);

  const identityLayers: HistoricalXrayIdentityLayer[] = confirmedLegs.map((leg, index) => ({
    legId: leg.id,
    ocr: leg.rawSnippet,
    confirmedPlayerName: leg.playerDisplayName.value,
    canonicalPlayerName: resolutions[index]?.playerResolution.value?.displayName ?? null,
    canonicalPlayerId: resolutions[index]?.playerResolution.value?.playerId ?? null,
  }));

  const timings: HistoricalXrayReplayTimings = {
    resolveMs,
    matchMs,
    contextMs,
    interpretMs,
    totalMs: elapsed(now, t0),
  };

  return {
    confirmedLegs,
    resolutions,
    matches,
    contexts,
    interpretations,
    parlayInterpretation,
    historicalReplay: {
      cutoffAt: context.cutoffAt,
      dateLabel: `${context.dateLabel} · ${context.slateLabel}`,
      gameId: context.gameId,
    },
    identityLayers,
    timings,
  };
}
