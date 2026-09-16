import { known, unknown, withDerivedResolution } from '@/lib/parlay-xray/fields';
import type { XRayLegContext } from '@/lib/parlay-xray/context/types';
import type { ExtractedParlayLeg, XrayPropKind } from '@/lib/parlay-xray/types';
import { buildAjayMitchellContext, cloneContext } from './ajay-context';
import { interpretXrayLeg } from './interpret';
import type { XRayLegInterpretation } from './types';
import type { XRayParlay } from '@/lib/parlay-xray/types';
import type { XrayHistoricalReplay } from '@/lib/parlay-xray/session';

function makeLeg(input: {
  id: string;
  player: string;
  team: string;
  opponent: string;
  matchup: string;
  kind: XrayPropKind;
  label: string;
  side: 'over' | 'under';
  line: number;
  odds: number | null;
}): ExtractedParlayLeg {
  return withDerivedResolution({
    id: input.id,
    playerDisplayName: known(input.player),
    playerId: unknown(),
    nbaPlayerId: unknown(),
    teamAbbr: known(input.team),
    opponentAbbr: known(input.opponent),
    matchupLabel: known(input.matchup),
    propKind: known(input.kind),
    propLabel: known(input.label),
    side: known(input.side),
    line: known(input.line),
    oddsAmerican: input.odds == null ? unknown() : known(input.odds),
    sportsbookText: known('DraftKings'),
    gameDate: known('2026-04-03'),
    extractionConfidence: known('high'),
    resolution: 'resolved',
    rawSnippet: null,
  });
}

/**
 * Four-leg Historical Replay fixture on certified game 18447934.
 * Leg 1 is the certified Ajay Mitchell X3C packet.
 * Legs 2–4 are deterministic demonstration packets cloned from that shape
 * with explicit identity/form/market overrides. They are not newly assembled
 * from the database and do not include outcomes.
 */
export function buildHistoricalParlayContexts(): XRayLegContext[] {
  const ajayPoints = buildAjayMitchellContext();

  const ajayAssists = cloneContext(ajayPoints);
  ajayAssists.identity.originalLeg = makeLeg({
    id: 'leg-ajay-assists',
    player: 'Ajay Mitchell',
    team: 'OKC',
    opponent: 'DEN',
    matchup: 'OKC @ DEN',
    kind: 'assists',
    label: 'Assists',
    side: 'over',
    line: 3.5,
    odds: -110,
  });
  ajayAssists.identity.market = 'assists';
  ajayAssists.identity.line = 3.5;
  ajayAssists.market.requestedLine = 3.5;
  ajayAssists.market.threeHourLine = 3.5;
  ajayAssists.market.threeHourOdds = -110;
  ajayAssists.market.closeLine = 3.5;
  ajayAssists.market.closeOdds = -110;
  ajayAssists.market.lineDeltaCloseMinusThreeHour = 0;
  ajayAssists.market.lineDeltaThreeHourMinusRequested = 0;
  ajayAssists.market.americanOddsDeltaCloseMinusThreeHour = 0;
  ajayAssists.playerForm.market = 'assists';
  ajayAssists.playerForm.seasonToDate = { gameCount: 53, average: 3.8 };
  ajayAssists.playerForm.last5 = { gameCount: 5, average: 3.4 };
  ajayAssists.playerForm.last10 = { gameCount: 10, average: 3.6 };
  ajayAssists.playerForm.lineRelative = {
    sampleCount: 10,
    aboveRequestedLine: 5,
    belowRequestedLine: 5,
    equalRequestedLine: 0,
  };
  ajayAssists.projection.requestedLine = 3.5;

  const dort = cloneContext(ajayPoints);
  dort.identity.originalLeg = makeLeg({
    id: 'leg-dort-points',
    player: 'Luguentz Dort',
    team: 'OKC',
    opponent: 'DEN',
    matchup: 'OKC @ DEN',
    kind: 'points',
    label: 'Points',
    side: 'over',
    line: 9.5,
    odds: -115,
  });
  dort.identity.playerId = 'fixture-dort';
  dort.identity.playerDisplayName = 'Luguentz Dort';
  dort.identity.line = 9.5;
  dort.market.status = 'LIMITED';
  dort.market.matchStatus = 'PARTIAL_MATCH';
  dort.market.reason = 'BOOK_UNAVAILABLE';
  dort.market.matchedBook = null;
  dort.market.requestedLine = 9.5;
  dort.market.threeHourLine = 9.5;
  dort.market.threeHourOdds = -115;
  dort.market.closeLine = null;
  dort.market.closeOdds = null;
  dort.market.snapshotAvailable = { threeHourPreTip: true, decisionClose: false };
  dort.playerForm.seasonToDate = { gameCount: 3, average: 10.0 };
  dort.playerForm.last5 = { gameCount: 3, average: 10.0 };
  dort.playerForm.last10 = { gameCount: 3, average: 10.0 };
  dort.playerForm.lineRelative = {
    sampleCount: 3,
    aboveRequestedLine: 2,
    belowRequestedLine: 1,
    equalRequestedLine: 0,
  };
  dort.dataQuality.marketExact = false;
  dort.dataQuality.marketPartial = true;
  dort.dataQuality.playerPriorSampleCount = 3;
  dort.dataQuality.last5AvailableCount = 3;
  dort.dataQuality.last10AvailableCount = 3;
  dort.projection.requestedLine = 9.5;

  const jokic = cloneContext(ajayPoints);
  jokic.identity.originalLeg = makeLeg({
    id: 'leg-jokic-rebounds',
    player: 'Nikola Jokić',
    team: 'DEN',
    opponent: 'OKC',
    matchup: 'OKC @ DEN',
    kind: 'rebounds',
    label: 'Rebounds',
    side: 'over',
    line: 12.5,
    odds: -105,
  });
  jokic.identity.playerId = 'fixture-jokic';
  jokic.identity.playerDisplayName = 'Nikola Jokić';
  jokic.identity.teamAbbr = 'DEN';
  jokic.identity.opponentAbbr = 'OKC';
  jokic.identity.market = 'rebounds';
  jokic.identity.line = 12.5;
  jokic.market.requestedLine = 12.5;
  jokic.market.threeHourLine = 11.5;
  jokic.market.threeHourOdds = -120;
  jokic.market.closeLine = 11.5;
  jokic.market.closeOdds = -108;
  jokic.market.lineDeltaCloseMinusThreeHour = 0;
  jokic.market.lineDeltaThreeHourMinusRequested = -1;
  jokic.playerForm.market = 'rebounds';
  jokic.playerForm.seasonToDate = { gameCount: 70, average: 12.1 };
  jokic.playerForm.last5 = { gameCount: 5, average: 11.2 };
  jokic.playerForm.last10 = { gameCount: 10, average: 11.4 };
  jokic.playerForm.lineRelative = {
    sampleCount: 10,
    aboveRequestedLine: 3,
    belowRequestedLine: 7,
    equalRequestedLine: 0,
  };
  jokic.role.priorGameMinutes = 34;
  jokic.role.seasonToDateMinutes = { gameCount: 70, average: 34.6 };
  jokic.role.last5Minutes = { gameCount: 5, average: 34.2 };
  jokic.role.last10Minutes = { gameCount: 10, average: 34.4 };
  jokic.matchup.opponentAbbr = 'OKC';
  jokic.matchup.playerTeamId = '14';
  jokic.matchup.opponentTeamId = '21';
  jokic.projection.requestedLine = 12.5;

  return [ajayPoints, ajayAssists, dort, jokic];
}

export function buildHistoricalParlayInterpretations(): XRayLegInterpretation[] {
  return buildHistoricalParlayContexts().map(interpretXrayLeg);
}

export function buildHistoricalAnalysisPreview(): {
  parlay: XRayParlay;
  interpretations: XRayLegInterpretation[];
  historicalReplay: XrayHistoricalReplay;
} {
  const contexts = buildHistoricalParlayContexts();
  const interpretations = contexts.map(interpretXrayLeg);
  return {
    parlay: {
      id: 'xray-historical-parlay',
      source: 'screenshot',
      uploadedImage: {
        filename: 'historical-replay.png',
        mimeType: 'image/png',
        sizeBytes: 0,
        objectUrl: '',
      },
      legs: contexts.map((ctx) => ctx.identity.originalLeg),
      extractionStatus: 'complete',
      analysisStatus: 'unavailable',
      createdAt: '2026-04-03T01:30:00.000Z',
    },
    interpretations,
    historicalReplay: {
      cutoffAt: '2026-04-03T01:30:00.000Z',
      dateLabel: 'April 3, 2026',
      gameId: '18447934',
    },
  };
}
