import { parseLineValue, parsePropSide } from '@/lib/betting/prop-market-compare';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';
import { canonicalizeXrayMarket } from './market';
import { resolveGameIdentity } from './game';
import { resolvePlayerIdentityFromName } from './player';
import { canonicalizeSportsbook } from './sportsbook';
import { resolveTeamAbbr } from './team';
import type {
  CanonicalParlayLegResolution,
  FieldResolution,
  OverallResolutionStatus,
  ResolutionStatus,
  XrayResolutionCatalog,
  XrayResolutionContext,
} from './types';

function cloneLeg(leg: ExtractedParlayLeg): ExtractedParlayLeg {
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

function emptyField<T>(extracted: string | number | null, reason: string): FieldResolution<T> {
  return { status: 'UNRESOLVED', value: null, extracted, reason };
}

function overallOf(parts: ResolutionStatus[]): OverallResolutionStatus {
  if (parts.some((s) => s === 'UNRESOLVED')) return 'UNRESOLVED';
  if (parts.some((s) => s === 'NEEDS_CONFIRMATION')) return 'NEEDS_CONFIRMATION';
  return 'CORE_RESOLVED';
}

export function resolveCanonicalParlayLeg(
  leg: ExtractedParlayLeg,
  catalog: XrayResolutionCatalog,
  context?: XrayResolutionContext
): CanonicalParlayLegResolution {
  const originalLeg = cloneLeg(leg);

  const playerResolution = resolvePlayerIdentityFromName(leg.playerDisplayName.value, catalog.players);

  const teamHit = resolveTeamAbbr(leg.teamAbbr.value, catalog.teams);
  const teamResolution: CanonicalParlayLegResolution['teamResolution'] = teamHit
    ? { status: 'RESOLVED', value: teamHit, extracted: leg.teamAbbr.value, reason: null }
    : emptyField(leg.teamAbbr.value, leg.teamAbbr.value ? 'UNKNOWN_TEAM' : 'MISSING_TEAM');

  const oppHit = resolveTeamAbbr(leg.opponentAbbr.value, catalog.teams);
  const opponentResolution: CanonicalParlayLegResolution['opponentResolution'] = oppHit
    ? { status: 'RESOLVED', value: oppHit, extracted: leg.opponentAbbr.value, reason: null }
    : emptyField(leg.opponentAbbr.value, leg.opponentAbbr.value ? 'UNKNOWN_TEAM' : 'MISSING_TEAM');

  const gameResolution = resolveGameIdentity({
    games: catalog.games,
    teams: catalog.teams,
    context,
    gameDate: leg.gameDate.value,
    teamAbbr: leg.teamAbbr.value,
    opponentAbbr: leg.opponentAbbr.value,
    matchupLabel: leg.matchupLabel.value,
  });

  const market = canonicalizeXrayMarket(leg.propKind.value, leg.propLabel.value);
  const marketExtracted = leg.propLabel.value ?? leg.propKind.value ?? null;
  const marketResolution: CanonicalParlayLegResolution['marketResolution'] = market.propType
    ? {
        status: 'RESOLVED',
        value: { propType: market.propType },
        extracted: marketExtracted,
        reason: null,
        unsupported: false,
      }
    : {
        status: 'UNRESOLVED',
        value: null,
        extracted: marketExtracted,
        reason: market.reason,
        unsupported: market.unsupported,
      };

  const extractedSide = leg.side.value ?? null;
  const parsedSide = parsePropSide(extractedSide);
  const sideResolution: CanonicalParlayLegResolution['sideResolution'] = parsedSide
    ? { status: 'RESOLVED', value: parsedSide, extracted: extractedSide, reason: null }
    : emptyField(extractedSide, extractedSide ? 'INVALID_SIDE' : 'MISSING_SIDE');

  const extractedLine = leg.line.value;
  const parsedLine = parseLineValue(extractedLine);
  const lineResolution: CanonicalParlayLegResolution['lineResolution'] =
    extractedLine == null
      ? emptyField(null, 'MISSING_LINE')
      : parsedLine == null
        ? emptyField(extractedLine, 'INVALID_LINE')
        : { status: 'RESOLVED', value: parsedLine, extracted: extractedLine, reason: null };

  const book = canonicalizeSportsbook(leg.sportsbookText.value);
  const sportsbookResolution: CanonicalParlayLegResolution['sportsbookResolution'] = book
    ? { status: 'RESOLVED', value: book, extracted: leg.sportsbookText.value, reason: null }
    : emptyField(leg.sportsbookText.value, leg.sportsbookText.value ? 'UNKNOWN_SPORTSBOOK' : 'MISSING_SPORTSBOOK');

  const coreStatus = overallOf([
    playerResolution.status,
    marketResolution.status,
    sideResolution.status,
    lineResolution.status,
  ]);
  const coreResolved = coreStatus === 'CORE_RESOLVED';
  const fullyResolved = coreResolved && gameResolution.status === 'RESOLVED';
  const overallStatus: OverallResolutionStatus = fullyResolved
    ? 'FULLY_RESOLVED'
    : coreResolved
      ? 'CORE_RESOLVED'
      : coreStatus;

  return {
    originalLeg,
    playerResolution,
    teamResolution,
    opponentResolution,
    gameResolution,
    marketResolution,
    sideResolution,
    lineResolution,
    sportsbookResolution,
    overallStatus,
    coreResolved,
    fullyResolved,
  };
}

export function resolveCanonicalParlayLegs(
  legs: ExtractedParlayLeg[],
  catalog: XrayResolutionCatalog,
  context?: XrayResolutionContext
): CanonicalParlayLegResolution[] {
  return legs.map((leg) => resolveCanonicalParlayLeg(leg, catalog, context));
}
