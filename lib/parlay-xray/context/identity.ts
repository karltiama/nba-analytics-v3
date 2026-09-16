import type { CanonicalParlayLegResolution } from '@/lib/parlay-xray/resolution/types';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';
import type { XRayIdentityContext } from './types';

function cloneOriginalLeg(leg: ExtractedParlayLeg): ExtractedParlayLeg {
  return {
    ...leg,
    playerDisplayName: { ...leg.playerDisplayName },
    playerId: { ...leg.playerId },
    nbaPlayerId: { ...leg.nbaPlayerId },
    teamAbbr: { ...leg.teamAbbr },
    opponentAbbr: { ...leg.opponentAbbr },
    matchupLabel: { ...leg.matchupLabel },
    propKind: { ...leg.propKind },
    propLabel: { ...leg.propLabel },
    side: { ...leg.side },
    line: { ...leg.line },
    oddsAmerican: { ...leg.oddsAmerican },
    sportsbookText: { ...leg.sportsbookText },
    gameDate: { ...leg.gameDate },
    extractionConfidence: { ...leg.extractionConfidence },
  };
}

export function assembleIdentity(args: {
  resolution: CanonicalParlayLegResolution;
  contextCutoffAt: string | null;
  historicalDate: string | null;
}): XRayIdentityContext {
  const { resolution } = args;
  const playerOk = resolution.playerResolution.status === 'RESOLVED';
  const gameOk = resolution.gameResolution.status === 'RESOLVED';
  let status: XRayIdentityContext['status'] = 'AVAILABLE';
  let reason: string | null = null;
  if (!args.contextCutoffAt) {
    status = 'NEEDS_CONFIRMATION';
    reason = 'MISSING_CONTEXT_CUTOFF';
  } else if (!playerOk || !gameOk) {
    status = playerOk || gameOk ? 'NEEDS_CONFIRMATION' : 'UNAVAILABLE';
    reason = !playerOk && !gameOk ? 'PLAYER_AND_GAME_UNRESOLVED' : !playerOk ? 'PLAYER_UNRESOLVED' : 'GAME_UNRESOLVED';
  }

  return {
    status,
    reason,
    originalLeg: cloneOriginalLeg(resolution.originalLeg),
    playerId: resolution.playerResolution.value?.playerId ?? null,
    playerDisplayName: resolution.playerResolution.value?.displayName ?? null,
    gameId: resolution.gameResolution.value?.gameId ?? null,
    gameStartTime: resolution.gameResolution.value?.startTime ?? null,
    teamAbbr: resolution.teamResolution.value?.abbreviation ?? null,
    opponentAbbr: resolution.opponentResolution.value?.abbreviation ?? null,
    market: resolution.marketResolution.value?.propType ?? null,
    side: resolution.sideResolution.value,
    line: resolution.lineResolution.value,
    sportsbook: resolution.sportsbookResolution.value?.vendor ?? null,
    historicalDate: args.historicalDate,
    contextCutoffAt: args.contextCutoffAt,
  };
}
