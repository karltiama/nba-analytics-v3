import { parseCutoffIso } from './cutoff';
import { assembleAvailabilityContext } from './availability';
import { assembleDataQuality } from './data-quality';
import { assembleIdentity } from './identity';
import { assembleMarketContext } from './market';
import { assembleMatchup } from './matchup';
import { assemblePlayerForm } from './player-form';
import { assembleProjection } from './projection';
import { assembleRole } from './role';
import { assembleWowyContext } from './wowy';
import type { XRayLegContext, XRayLegContextRequest } from './types';

export function assembleXrayLegContext(request: XRayLegContextRequest): XRayLegContext {
  const cutoff = parseCutoffIso(request.contextCutoffAt);
  const resolution = request.resolution;
  const identity = assembleIdentity({
    resolution,
    contextCutoffAt: cutoff,
    historicalDate: request.match.input.historicalDate,
  });
  const market = assembleMarketContext(request.match);
  const playerId = resolution.playerResolution.value?.playerId ?? null;
  const gameId = resolution.gameResolution.value?.gameId ?? null;
  const season = request.season ?? null;

  const playerForm = assemblePlayerForm({
    logs: request.sources.priorPlayerLogs,
    playerId,
    cutoffAt: cutoff,
    targetGameId: gameId,
    season,
    market: resolution.marketResolution.value?.propType ?? null,
    requestedLine: resolution.lineResolution.value,
  });
  const role = assembleRole({
    logs: request.sources.priorPlayerLogs,
    playerId,
    cutoffAt: cutoff,
    targetGameId: gameId,
    season,
  });
  const playerTeamId = request.playerTeamId ?? resolution.teamResolution.value?.teamId ?? null;
  const opponentTeamId = request.opponentTeamId ?? resolution.opponentResolution.value?.teamId ?? null;
  const matchup = assembleMatchup({
    teamStats: request.sources.priorTeamStats,
    cutoffAt: cutoff,
    targetGameId: gameId,
    season,
    playerTeamId,
    opponentTeamId,
    opponentAbbr: resolution.opponentResolution.value?.abbreviation ?? null,
  });
  const wowy = assembleWowyContext();
  const projection = assembleProjection({
    snapshots: request.sources.projectionSnapshots,
    playerId,
    gameId,
    cutoffAt: cutoff,
    market: resolution.marketResolution.value?.propType ?? null,
    requestedLine: resolution.lineResolution.value,
  });
  const availability = assembleAvailabilityContext();
  const dataQuality = assembleDataQuality({
    identity,
    market,
    playerForm,
    role,
    matchup,
    wowy,
    projection,
    availability,
  });

  return {
    identity,
    market,
    playerForm,
    role,
    matchup,
    wowy,
    projection,
    availability,
    dataQuality,
  };
}
