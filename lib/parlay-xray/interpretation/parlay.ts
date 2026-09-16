import type { CanonicalPropType } from '@/lib/betting/market-movement';
import { formatMarketLabel } from './display';
import type { XRayLegInterpretation } from './types';
import type {
  ParlayContextCoverage,
  ParlayDataQuality,
  ParlayDependencyGroup,
  ParlayEvidence,
  ParlayEvidenceCode,
  ParlayFormCounts,
  ParlayLegReview,
  ParlayMarketPositionCounts,
  ParlayReviewFlag,
  ParlaySummaryState,
  XRayParlayInterpretation,
} from './parlay-types';

function norm(value: string | null | undefined): string | null {
  const n = (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return n || null;
}

function evidence(
  code: ParlayEvidenceCode,
  title: string,
  detail: string,
  legIndexes: number[]
): ParlayEvidence {
  return { code, title, detail, legIndexes: [...legIndexes].sort((a, b) => a - b) };
}

function identityResolved(leg: XRayLegInterpretation): boolean {
  return Boolean(
    norm(leg.identity.playerDisplayName) &&
      leg.identity.market &&
      (leg.identity.side === 'over' || leg.identity.side === 'under') &&
      leg.identity.line != null
  );
}

function playerKey(leg: XRayLegInterpretation): string | null {
  return norm(leg.identity.playerDisplayName);
}

function gameKey(leg: XRayLegInterpretation): string | null {
  return norm(leg.identity.gameId);
}

function teamKey(leg: XRayLegInterpretation): string | null {
  return norm(leg.identity.teamAbbr);
}

function opponentKey(leg: XRayLegInterpretation): string | null {
  return norm(leg.identity.opponentAbbr);
}

function displayName(leg: XRayLegInterpretation): string {
  return leg.identity.playerDisplayName?.trim() || 'Unknown player';
}

function marketList(legs: XRayLegInterpretation[], indexes: number[]): Array<CanonicalPropType | null> {
  return indexes.map((i) => legs[i]?.identity.market ?? null);
}

function groupBy(
  legs: XRayLegInterpretation[],
  keyOf: (leg: XRayLegInterpretation) => string | null
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  legs.forEach((leg, index) => {
    const key = keyOf(leg);
    if (!key) return;
    const rows = map.get(key) ?? [];
    rows.push(index);
    map.set(key, rows);
  });
  return map;
}

function sameIndexSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((i) => other.has(i));
}

function sortGroups(groups: ParlayDependencyGroup[]): ParlayDependencyGroup[] {
  return [...groups].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.key !== b.key) return a.key.localeCompare(b.key);
    return a.legIndexes.join(',').localeCompare(b.legIndexes.join(','));
  });
}

function overUnderCannotBothHit(overLine: number, underLine: number): boolean {
  return !(overLine < underLine);
}

function reviewFlagsFor(leg: XRayLegInterpretation): ParlayReviewFlag[] {
  const flags: ParlayReviewFlag[] = [];
  if (!identityResolved(leg) || !gameKey(leg)) flags.push('NEEDS_IDENTITY_CONFIRMATION');
  if (leg.dataAvailability.market === 'LIMITED' || leg.dataAvailability.market === 'NEEDS_CONFIRMATION') {
    flags.push('PARTIAL_MARKET_MATCH');
  }
  if (leg.recentForm.sampleBand === 'ZERO' || leg.recentForm.sampleBand === 'SMALL_SAMPLE') {
    flags.push('LIMITED_SAMPLE');
  }
  if (leg.dataAvailability.playerForm !== 'AVAILABLE' || !gameKey(leg) || !identityResolved(leg)) {
    flags.push('MISSING_CONTEXT');
  }
  if (leg.counterContext.length > 0) flags.push('COUNTERSIGNALS_PRESENT');
  return flags;
}

function coverage(legs: XRayLegInterpretation[]): ParlayContextCoverage {
  const n = legs.length;
  return {
    legCount: n,
    identityResolvedCount: legs.filter(identityResolved).length,
    identityNeedsConfirmationCount: legs.filter((leg) => !identityResolved(leg)).length,
    marketMatchCount: legs.filter((leg) => leg.dataAvailability.market === 'AVAILABLE').length,
    exactBookCount: legs.filter((leg) => leg.dataAvailability.market === 'AVAILABLE').length,
    partialMarketCount: legs.filter((leg) => leg.dataAvailability.market === 'LIMITED').length,
    recentFormCount: legs.filter((leg) => leg.dataAvailability.playerForm === 'AVAILABLE').length,
    formWindowCount: legs.filter((leg) => leg.recentForm.sampleBand === 'WINDOW_AVAILABLE').length,
    availabilityCount: legs.filter((leg) => leg.dataAvailability.availability === 'AVAILABLE').length,
    projectionCount: legs.filter((leg) => leg.dataAvailability.projection === 'AVAILABLE').length,
    wowyCount: legs.filter((leg) => leg.dataAvailability.wowy === 'AVAILABLE').length,
  };
}

function marketCounts(legs: XRayLegInterpretation[]): ParlayMarketPositionCounts {
  const counts: ParlayMarketPositionCounts = {
    betterThanClose: 0,
    sameAsClose: 0,
    worseThanClose: 0,
    unknown: 0,
  };
  for (const leg of legs) {
    const kind: MarketPositionKind = leg.marketPosition.kind;
    if (kind === 'BETTER_NUMBER_THAN_CLOSE') counts.betterThanClose += 1;
    else if (kind === 'SAME_AS_CLOSE') counts.sameAsClose += 1;
    else if (kind === 'WORSE_NUMBER_THAN_CLOSE') counts.worseThanClose += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function formCounts(legs: XRayLegInterpretation[]): ParlayFormCounts {
  const counts: ParlayFormCounts = {
    aboveMoreOften: 0,
    belowMoreOften: 0,
    evenSplit: 0,
    limitedSample: 0,
  };
  for (const leg of legs) {
    const read: FormLineRead = leg.recentForm.lineRead;
    if (read === 'ABOVE_MORE_OFTEN_THAN_BELOW') counts.aboveMoreOften += 1;
    else if (read === 'BELOW_MORE_OFTEN_THAN_ABOVE') counts.belowMoreOften += 1;
    else if (read === 'EVEN_SPLIT') counts.evenSplit += 1;
    else counts.limitedSample += 1;
  }
  return counts;
}

function dataQuality(legs: XRayLegInterpretation[], cover: ParlayContextCoverage): ParlayDataQuality {
  const of = legs.length;
  return {
    canonical: { have: cover.identityResolvedCount, of },
    historicalMarket: { exact: cover.exactBookCount, partial: cover.partialMarketCount, of },
    recentForm: { have: cover.recentFormCount, of },
    role: {
      have: legs.filter((leg) => leg.role.seasonMinutes != null || leg.role.priorGameMinutes != null).length,
      of,
    },
    wowy: { have: cover.wowyCount, of },
    projection: { have: cover.projectionCount, of },
    availability: { have: cover.availabilityCount, of },
  };
}

function dependencyGroups(legs: XRayLegInterpretation[]): ParlayDependencyGroup[] {
  const groups: ParlayDependencyGroup[] = [];

  for (const [key, indexes] of groupBy(legs, playerKey)) {
    if (indexes.length < 2) continue;
    const name = displayName(legs[indexes[0]!]);
    groups.push({
      kind: 'SHARED_PLAYER',
      key,
      label: name,
      detail: `${indexes.length} legs depend on ${name}'s performance in the same identity.`,
      legIndexes: indexes,
      playerDisplayName: name,
      gameId: gameKey(legs[indexes[0]!]),
      teamAbbr: legs[indexes[0]!]?.identity.teamAbbr ?? null,
      markets: marketList(legs, indexes),
    });
  }

  for (const [key, indexes] of groupBy(legs, gameKey)) {
    if (indexes.length < 2) continue;
    const sample = legs[indexes[0]!];
    const matchup = [sample?.identity.teamAbbr, sample?.identity.opponentAbbr].filter(Boolean).join(' vs ');
    const teams = new Set(indexes.map((i) => teamKey(legs[i]!)).filter(Boolean));
    groups.push({
      kind: 'SHARED_GAME',
      key,
      label: matchup || `Game ${sample?.identity.gameId}`,
      detail: `${indexes.length} legs depend on the same game environment.`,
      legIndexes: indexes,
      playerDisplayName: null,
      gameId: sample?.identity.gameId ?? null,
      teamAbbr: sample?.identity.teamAbbr ?? null,
      markets: marketList(legs, indexes),
    });
    if (teams.size > 1) {
      groups.push({
        kind: 'SHARED_GAME_ENVIRONMENT',
        key: `${key}|sides`,
        label: matchup || `Game ${sample?.identity.gameId}`,
        detail: `${indexes.length} legs share this game, including players from more than one team.`,
        legIndexes: indexes,
        playerDisplayName: null,
        gameId: sample?.identity.gameId ?? null,
        teamAbbr: null,
        markets: marketList(legs, indexes),
      });
    }
  }

  for (const [key, indexes] of groupBy(legs, teamKey)) {
    const players = new Set(indexes.map((i) => playerKey(legs[i]!)).filter(Boolean));
    if (players.size < 2) continue;
    const abbr = legs[indexes[0]!]?.identity.teamAbbr ?? key.toUpperCase();
    groups.push({
      kind: 'SHARED_TEAM',
      key,
      label: abbr,
      detail: `Multiple legs rely on the same team's offensive environment (${abbr}).`,
      legIndexes: indexes,
      playerDisplayName: null,
      gameId: null,
      teamAbbr: abbr,
      markets: marketList(legs, indexes),
    });
  }

  for (const [key, indexes] of groupBy(legs, opponentKey)) {
    if (indexes.length < 2) continue;
    const gameIndexes = gameKey(legs[indexes[0]!])
      ? groupBy(legs, gameKey).get(gameKey(legs[indexes[0]!])!) ?? []
      : [];
    if (sameIndexSet(indexes, gameIndexes)) continue;
    const abbr = legs[indexes[0]!]?.identity.opponentAbbr ?? key.toUpperCase();
    groups.push({
      kind: 'SHARED_OPPONENT',
      key,
      label: abbr,
      detail: `${indexes.length} legs share ${abbr} as the opponent.`,
      legIndexes: indexes,
      playerDisplayName: null,
      gameId: null,
      teamAbbr: null,
      markets: marketList(legs, indexes),
    });
  }

  for (const [key, indexes] of groupBy(legs, playerKey)) {
    if (indexes.length < 2) continue;
    const role = legs[indexes[0]!]?.role.minutesVsSeason;
    if (role !== 'ABOVE' && role !== 'BELOW') continue;
    const same = indexes.every((i) => legs[i]?.role.minutesVsSeason === role);
    if (!same) continue;
    const name = displayName(legs[indexes[0]!]);
    groups.push({
      kind: 'SHARED_ROLE_ASSUMPTION',
      key: `${key}|role`,
      label: name,
      detail:
        role === 'ABOVE'
          ? `Both ${name} legs rely on the same recent-minute context above season minutes.`
          : `Both ${name} legs rely on the same recent-minute context below season minutes.`,
      legIndexes: indexes,
      playerDisplayName: name,
      gameId: gameKey(legs[indexes[0]!]),
      teamAbbr: legs[indexes[0]!]?.identity.teamAbbr ?? null,
      markets: marketList(legs, indexes),
    });
  }

  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const a = legs[i]!;
      const b = legs[j]!;
      const samePlayer = playerKey(a) && playerKey(a) === playerKey(b);
      const sameMarket = a.identity.market && a.identity.market === b.identity.market;
      const sameGame = !gameKey(a) || !gameKey(b) || gameKey(a) === gameKey(b);
      if (!samePlayer || !sameMarket || !sameGame) continue;
      const name = displayName(a);
      const market = formatMarketLabel(a.identity.market);
      if (a.identity.side === b.identity.side && a.identity.line === b.identity.line) {
        groups.push({
          kind: 'DUPLICATE_LEG',
          key: `dup|${i}|${j}`,
          label: `${name} ${market}`,
          detail: `Exact duplicate: ${name} ${a.identity.side} ${a.identity.line} ${market} appears more than once.`,
          legIndexes: [i, j],
          playerDisplayName: name,
          gameId: a.identity.gameId,
          teamAbbr: a.identity.teamAbbr,
          markets: [a.identity.market, b.identity.market],
        });
        continue;
      }
      if (a.identity.side === b.identity.side && a.identity.line !== b.identity.line) {
        groups.push({
          kind: 'NEAR_DUPLICATE_LEG',
          key: `near|${i}|${j}`,
          label: `${name} ${market}`,
          detail: `Same player, market, and side with different lines (${a.identity.line} and ${b.identity.line}).`,
          legIndexes: [i, j],
          playerDisplayName: name,
          gameId: a.identity.gameId,
          teamAbbr: a.identity.teamAbbr,
          markets: [a.identity.market, b.identity.market],
        });
        continue;
      }
      if (a.identity.side && b.identity.side && a.identity.side !== b.identity.side) {
        groups.push({
          kind: 'OPPOSITE_SIDE_SAME_MARKET',
          key: `opp|${i}|${j}`,
          label: `${name} ${market}`,
          detail: `${name} appears on both Over and Under in ${market}.`,
          legIndexes: [i, j],
          playerDisplayName: name,
          gameId: a.identity.gameId,
          teamAbbr: a.identity.teamAbbr,
          markets: [a.identity.market, b.identity.market],
        });
        const over = a.identity.side === 'over' ? a : b;
        const under = a.identity.side === 'under' ? a : b;
        if (
          over.identity.line != null &&
          under.identity.line != null &&
          overUnderCannotBothHit(over.identity.line, under.identity.line)
        ) {
          groups.push({
            kind: 'LOGICAL_CONFLICT',
            key: `conflict|${i}|${j}`,
            label: `${name} ${market}`,
            detail: `Over ${over.identity.line} and Under ${under.identity.line} cannot both hit on the same ${market} result.`,
            legIndexes: [i, j],
            playerDisplayName: name,
            gameId: a.identity.gameId,
            teamAbbr: a.identity.teamAbbr,
            markets: [a.identity.market, b.identity.market],
          });
        }
      }
    }
  }

  return sortGroups(groups);
}

function summaryState(
  legs: XRayLegInterpretation[],
  cover: ParlayContextCoverage,
  groups: ParlayDependencyGroup[],
  reviews: ParlayLegReview[]
): ParlaySummaryState {
  if (legs.length === 0) return 'LIMITED_DATA';
  if (cover.recentFormCount === 0) return 'LIMITED_DATA';
  const concentrated = groups.some(
    (group) =>
      (group.kind === 'SHARED_PLAYER' ||
        group.kind === 'SHARED_GAME' ||
        group.kind === 'SHARED_GAME_ENVIRONMENT' ||
        group.kind === 'LOGICAL_CONFLICT') &&
      group.legIndexes.length >= 2
  );
  if (concentrated) return 'DEPENDENCY_CONCENTRATION';
  const counterLegs = reviews.filter((row) => row.flags.includes('COUNTERSIGNALS_PRESENT')).length;
  if (counterLegs >= 2) return 'MULTIPLE_COUNTERSIGNALS';
  const mixed =
    cover.partialMarketCount > 0 ||
    cover.identityNeedsConfirmationCount > 0 ||
    reviews.some((row) => row.flags.includes('LIMITED_SAMPLE')) ||
    cover.recentFormCount < legs.length;
  if (mixed) return 'MIXED_CONTEXT';
  return 'WELL_COVERED';
}

function summarySentence(
  state: ParlaySummaryState,
  cover: ParlayContextCoverage,
  groups: ParlayDependencyGroup[],
  fail: ParlayEvidence[]
): string {
  if (state === 'LIMITED_DATA') {
    return 'Available parlay context is limited: recent-form coverage is missing for the slip.';
  }
  if (state === 'DEPENDENCY_CONCENTRATION') {
    const first =
      groups.find((g) => g.kind === 'SHARED_GAME' || g.kind === 'SHARED_PLAYER' || g.kind === 'LOGICAL_CONFLICT') ??
      groups[0];
    return first
      ? `The parlay concentrates on shared context. ${first.detail}`
      : 'The parlay concentrates on shared player or game context.';
  }
  if (state === 'MULTIPLE_COUNTERSIGNALS') {
    const row = fail.find((item) => item.code === 'PARLAY_FORM_COUNTERSIGNALS' || item.code === 'PARLAY_MARKET_WORSE_COUNT');
    return row ? `Countersignals appear on multiple legs. ${row.detail}` : 'Countersignals appear on multiple legs.';
  }
  if (state === 'MIXED_CONTEXT') {
    return `Available context is mixed: ${cover.recentFormCount} of ${cover.legCount} legs have recent-form context, ${cover.partialMarketCount} have a partial market match.`;
  }
  return `Available context is well covered across ${cover.legCount} legs, with no multi-leg player or game concentration.`;
}

export function interpretXrayParlay(legs: XRayLegInterpretation[]): XRayParlayInterpretation {
  const cover = coverage(legs);
  const groups = dependencyGroups(legs);
  const reviews: ParlayLegReview[] = legs.map((leg, legIndex) => ({
    legIndex,
    playerDisplayName: leg.identity.playerDisplayName,
    market: leg.identity.market,
    flags: reviewFlagsFor(leg),
  }));
  const positions = marketCounts(legs);
  const forms = formCounts(legs);
  const quality = dataQuality(legs, cover);

  const sharedAssumptions: ParlayEvidence[] = [];
  const supporting: ParlayEvidence[] = [];
  const uncertainties: ParlayEvidence[] = [];
  const whyFail: ParlayEvidence[] = [];

  const pushUnique = (list: ParlayEvidence[], item: ParlayEvidence) => {
    const key = `${item.code}|${item.legIndexes.join(',')}|${item.detail}`;
    if (list.some((row) => `${row.code}|${row.legIndexes.join(',')}|${row.detail}` === key)) return;
    list.push(item);
  };

  for (const group of groups) {
    if (group.kind === 'SHARED_PLAYER') {
      const item = evidence('PARLAY_SHARED_PLAYER', 'Shared player', group.detail, group.legIndexes);
      pushUnique(sharedAssumptions, item);
      pushUnique(whyFail, item);
    } else if (group.kind === 'SHARED_GAME' || group.kind === 'SHARED_GAME_ENVIRONMENT') {
      const item = evidence('PARLAY_SHARED_GAME', 'Shared game', group.detail, group.legIndexes);
      pushUnique(sharedAssumptions, item);
      pushUnique(whyFail, item);
    } else if (group.kind === 'SHARED_TEAM') {
      const item = evidence('PARLAY_SHARED_TEAM', 'Shared team', group.detail, group.legIndexes);
      pushUnique(sharedAssumptions, item);
      pushUnique(whyFail, item);
    } else if (group.kind === 'SHARED_ROLE_ASSUMPTION') {
      const item = evidence('PARLAY_SHARED_ROLE', 'Shared role context', group.detail, group.legIndexes);
      pushUnique(sharedAssumptions, item);
      pushUnique(whyFail, item);
    } else if (group.kind === 'LOGICAL_CONFLICT') {
      const item = evidence('PARLAY_LOGICAL_CONFLICT', 'Logical conflict', group.detail, group.legIndexes);
      pushUnique(whyFail, item);
    } else if (group.kind === 'DUPLICATE_LEG') {
      const item = evidence('PARLAY_DUPLICATE_LEG', 'Duplicate leg', group.detail, group.legIndexes);
      pushUnique(whyFail, item);
    } else if (group.kind === 'NEAR_DUPLICATE_LEG') {
      const item = evidence('PARLAY_NEAR_DUPLICATE', 'Near-duplicate leg', group.detail, group.legIndexes);
      pushUnique(whyFail, item);
    } else if (group.kind === 'OPPOSITE_SIDE_SAME_MARKET') {
      const item = evidence('PARLAY_OPPOSITE_SIDE', 'Opposite-side legs', group.detail, group.legIndexes);
      pushUnique(sharedAssumptions, item);
    }
  }

  const all = legs.map((_, i) => i);
  if (legs.length > 0 && quality.availability.have === 0) {
    const item = evidence(
      'PARLAY_SHARED_GAP_AVAILABILITY',
      'Availability gap across the parlay',
      `Historical availability context is unavailable for all ${legs.length} legs.`,
      all
    );
    pushUnique(uncertainties, item);
    pushUnique(whyFail, item);
  }
  if (legs.length > 0 && quality.projection.have === 0) {
    const item = evidence(
      'PARLAY_SHARED_GAP_PROJECTION',
      'Projection gap across the parlay',
      `No archived pregame projection is available for all ${legs.length} legs.`,
      all
    );
    pushUnique(uncertainties, item);
  }
  if (legs.length > 0 && quality.wowy.have === 0) {
    const item = evidence(
      'PARLAY_SHARED_GAP_WOWY',
      'WOWY gap across the parlay',
      `Historical as-of-safe WOWY is unavailable for all ${legs.length} legs.`,
      all
    );
    pushUnique(uncertainties, item);
  }

  const formCounterIndexes = legs
    .map((leg, i) => (leg.counterContext.some((row) => row.category === 'FORM') ? i : -1))
    .filter((i) => i >= 0);
  if (formCounterIndexes.length > 0) {
    const item = evidence(
      'PARLAY_FORM_COUNTERSIGNALS',
      'Recent-form countersignals',
      `${formCounterIndexes.length} of ${legs.length} legs have at least one recent-form counter-signal.`,
      formCounterIndexes
    );
    if (formCounterIndexes.length >= 2) pushUnique(whyFail, item);
  }

  const worseIndexes = legs.map((leg, i) => (leg.marketPosition.kind === 'WORSE_NUMBER_THAN_CLOSE' ? i : -1)).filter((i) => i >= 0);
  if (worseIndexes.length > 0) {
    pushUnique(
      whyFail,
      evidence(
        'PARLAY_MARKET_WORSE_COUNT',
        'Worse number than close',
        `${worseIndexes.length} of ${legs.length} captured lines were worse than Decision Close for the selected side.`,
        worseIndexes
      )
    );
  }

  const partialIndexes = reviews.filter((row) => row.flags.includes('PARTIAL_MARKET_MATCH')).map((row) => row.legIndex);
  if (partialIndexes.length > 0) {
    const item = evidence(
      'PARLAY_PARTIAL_MARKET',
      'Partial market match',
      `${partialIndexes.length} of ${legs.length} legs have a partial historical sportsbook match.`,
      partialIndexes
    );
    pushUnique(uncertainties, item);
    pushUnique(whyFail, item);
  }

  const sampleIndexes = reviews.filter((row) => row.flags.includes('LIMITED_SAMPLE')).map((row) => row.legIndex);
  if (sampleIndexes.length > 0) {
    const item = evidence(
      'PARLAY_LIMITED_SAMPLE',
      'Limited recent sample',
      `${sampleIndexes.length} of ${legs.length} legs have a small or empty recent-form sample.`,
      sampleIndexes
    );
    pushUnique(uncertainties, item);
    pushUnique(whyFail, item);
  }

  if (cover.identityResolvedCount === legs.length && legs.length > 0) {
    pushUnique(
      supporting,
      evidence(
        'PARLAY_CANONICAL_COVERAGE',
        'Canonical identity coverage',
        `All ${legs.length} legs have canonical player, market, side, and line fields.`,
        all
      )
    );
  }
  if (cover.formWindowCount > 0) {
    pushUnique(
      supporting,
      evidence(
        'PARLAY_FORM_WINDOW_COVERAGE',
        'Recent-form windows',
        `${cover.formWindowCount} of ${legs.length} legs have at least 10 prior games of recent-form context.`,
        legs.map((leg, i) => (leg.recentForm.sampleBand === 'WINDOW_AVAILABLE' ? i : -1)).filter((i) => i >= 0)
      )
    );
  }
  const betterOrSame = positions.betterThanClose + positions.sameAsClose;
  if (betterOrSame > 0) {
    pushUnique(
      supporting,
      evidence(
        'PARLAY_MARKET_BETTER_OR_SAME',
        'Captured numbers vs close',
        `${betterOrSame} of ${legs.length} captured lines were equal to or better than Decision Close for the selected side.`,
        legs
          .map((leg, i) =>
            leg.marketPosition.kind === 'BETTER_NUMBER_THAN_CLOSE' || leg.marketPosition.kind === 'SAME_AS_CLOSE'
              ? i
              : -1
          )
          .filter((i) => i >= 0)
      )
    );
  }

  const state = summaryState(legs, cover, groups, reviews);

  return {
    legCount: legs.length,
    contextCoverage: cover,
    dependencyGroups: groups,
    sharedAssumptions,
    supportingContext: supporting,
    crossLegUncertainties: uncertainties,
    whyThisParlayCouldFail: whyFail,
    reviewNeeded: reviews.filter((row) => row.flags.length > 0),
    marketPositionCounts: positions,
    formCounts: forms,
    dataQuality: quality,
    summaryState: state,
    summarySentence: summarySentence(state, cover, groups, whyFail),
  };
}
