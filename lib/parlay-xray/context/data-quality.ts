import type {
  XRayAvailabilityContext,
  XRayDataQualityContext,
  XRayIdentityContext,
  XRayMarketContext,
  XRayMatchupContext,
  XRayPlayerFormContext,
  XRayProjectionContext,
  XRayRoleContext,
  XRayWowyContext,
} from './types';

export function assembleDataQuality(args: {
  identity: XRayIdentityContext;
  market: XRayMarketContext;
  playerForm: XRayPlayerFormContext;
  role: XRayRoleContext;
  matchup: XRayMatchupContext;
  wowy: XRayWowyContext;
  projection: XRayProjectionContext;
  availability: XRayAvailabilityContext;
}): XRayDataQualityContext {
  return {
    canonicalPlayerResolved: args.identity.playerId != null && args.identity.status !== 'UNAVAILABLE',
    canonicalGameResolved: args.identity.gameId != null,
    marketExact: args.market.lineQuality === 'EXACT_LINE_MATCH' && args.market.matchStatus === 'MATCHED',
    marketPartial: args.market.matchStatus === 'PARTIAL_MATCH',
    sameBookMatch: Boolean(args.market.matchedBook) && args.market.matchedBook === args.market.requestedBook,
    exactLineMatch: args.market.lineQuality === 'EXACT_LINE_MATCH',
    threeHourSnapshotAvailable: args.market.snapshotAvailable.threeHourPreTip,
    closeSnapshotAvailable: args.market.snapshotAvailable.decisionClose,
    playerPriorSampleCount: args.playerForm.seasonToDate.gameCount,
    last5AvailableCount: args.playerForm.last5.gameCount,
    last10AvailableCount: args.playerForm.last10.gameCount,
    wowy: args.wowy.status,
    projection: args.projection.status,
    availability: args.availability.status,
    playerForm: args.playerForm.status,
    matchup: args.matchup.status,
    role: args.role.status,
    market: args.market.status,
  };
}
