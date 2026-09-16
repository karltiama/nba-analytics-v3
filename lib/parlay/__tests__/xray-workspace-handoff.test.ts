import { beforeEach, describe, expect, it } from 'vitest';
import {
  X3F_AJAY_ID,
  X3F_CUTOFF_AT,
  X3F_GAME_ID,
  X3F_GROUND_TRUTH_LEGS,
  X3F_HISTORICAL_DATE,
} from '@/lib/parlay-xray/e2e/ground-truth';
import {
  X3F_CATALOG,
  X3F_FUTURE_SENTINEL_LOG,
  X3F_TARGET_GAME_SENTINEL_LOG,
  buildX3fConfirmedLegs,
  buildX3fExtractedLegs,
  buildX3fReplayContext,
  buildX3fReplayDeps,
} from '@/lib/parlay-xray/e2e/fixture';
import { buildHistoricalReplayReviewPreview } from '@/lib/parlay-xray/e2e/preview';
import { runHistoricalXrayReplay } from '@/lib/parlay-xray/e2e/run';
import { acceptExtractedLeg } from '@/lib/parlay-xray/fields';
import { adaptPropsExplorerOffer, type PropsExplorerOfferInput } from '../adapt-props-explorer-offer';
import { handoffConfirmedXrayParlay, shouldShowXrayOcrProvenance } from '../adapt-xray-confirmed';
import {
  addExplorerOfferToSelection,
  isOfferSelected,
  removeSelectedLeg,
  workspaceSourceLabel,
  type SelectedParlayLeg,
} from '../selection';
import {
  getCanonicalParlaySelection,
  getParlaySelectionLegs,
  getWorkspaceAnalysisRecord,
  importConfirmedXrayLegsToStore,
  isXrayImportEdited,
  replaceParlaySelectionLegs,
  resetParlaySelectionStoreForTests,
  setWorkspaceAnalysisRecord,
} from '../selection-store';
import {
  evaluateWorkspaceAnalysisEligibility,
  runWorkspaceHistoricalAnalysis,
  selectionFingerprint,
} from '../workspace-analysis';

const OUTCOME_LEAK = /finalPoints|\bhit\b|\bmiss\b|wager result|final score|box score/i;

const HISTORICAL_REPLAY = buildHistoricalReplayReviewPreview().historicalReplay;

function mustAdapt(input: PropsExplorerOfferInput) {
  const result = adaptPropsExplorerOffer(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.offer;
}

function x3fPropsInput(row: (typeof X3F_GROUND_TRUTH_LEGS)[number]): PropsExplorerOfferInput {
  return {
    playerId: row.canonicalPlayerId,
    playerName: row.canonicalPlayerName,
    gameId: X3F_GAME_ID,
    propType: row.market,
    side: row.side,
    lineValue: row.requestedLine,
    sportsbook: 'DraftKings',
    oddsAmerican: row.closeOverOdds,
    snapshotAt: X3F_CUTOFF_AT,
    marketContext: 'historical',
    sourceTable: 'research.prop_decision_lines',
  };
}

function x3fPropsLegs(): SelectedParlayLeg[] {
  return X3F_GROUND_TRUTH_LEGS.map((row) => ({
    offer: mustAdapt(x3fPropsInput(row)),
    gameLabel: 'LAL @ OKC',
  }));
}

function mustHandoff(input: Parameters<typeof handoffConfirmedXrayParlay>[0]) {
  const result = handoffConfirmedXrayParlay(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.legs;
}

describe('XRay → Workspace source convergence', () => {
  beforeEach(() => {
    resetParlaySelectionStoreForTests();
  });

  it('does not hand off unconfirmed legs as an analyzable canonical parlay', () => {
    const result = handoffConfirmedXrayParlay({
      confirmed: false,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    expect(result).toEqual({ ok: false, code: 'NOT_CONFIRMED' });
    expect(getParlaySelectionLegs()).toEqual([]);
  });

  it('does not hand off legs that still need confirmation', () => {
    const result = handoffConfirmedXrayParlay({
      confirmed: true,
      legs: buildX3fExtractedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    expect(result).toEqual({ ok: false, code: 'NEEDS_CONFIRMATION' });
  });

  it('does not treat an accepted OCR typo as a canonical Workspace handoff', () => {
    const result = handoffConfirmedXrayParlay({
      confirmed: true,
      legs: buildX3fExtractedLegs().map(acceptExtractedLeg),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    expect(result).toEqual({ ok: false, code: 'UNRESOLVED' });
  });

  it('hands off confirmed XRay canonical legs with preserved identity and replay snapshot', () => {
    const legs = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    expect(legs).toHaveLength(4);
    expect(legs.every((leg) => leg.offer.source === 'xray')).toBe(true);
    expect(legs.every((leg) => leg.offer.sourceProvenance === 'xray_confirmed')).toBe(true);
    expect(legs.every((leg) => leg.offer.snapshotKind === 'decision_close')).toBe(true);
    expect(legs[0]?.offer.playerId).toBe(X3F_AJAY_ID);
    expect(legs[0]?.offer.gameId).toBe(X3F_GAME_ID);
    expect(legs[0]?.offer.market).toBe('points');
    expect(legs[0]?.offer.side).toBe('over');
    expect(legs[0]?.offer.line).toBe(12.5);
    expect(legs[0]?.offer.sportsbook.vendor).toBe('draftkings');
  });

  it('does not invent historical analysis when there is no explicit replay context', () => {
    const legs = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: null,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    expect(legs.every((leg) => leg.offer.snapshotKind === 'live_current')).toBe(true);
    const eligibility = evaluateWorkspaceAnalysisEligibility(legs);
    expect(eligibility.status).toBe('UNAVAILABLE');
    if (eligibility.status !== 'UNAVAILABLE') return;
    expect(eligibility.reasons.some((row) => row.code === 'LIVE_CURRENT')).toBe(true);
    expect(eligibility.reasons[0]?.message).toMatch(/Current-season Court Context analysis is not enabled yet/);
  });

  it('does not populate Workspace without a resolution catalog', () => {
    const result = handoffConfirmedXrayParlay({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: null,
      historicalReplay: HISTORICAL_REPLAY,
    });
    expect(result).toEqual({ ok: false, code: 'NO_CATALOG' });
  });

  it('marks a same-game XRay import READY and a multi-game import reviewable but blocked', () => {
    const sameGame = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    expect(evaluateWorkspaceAnalysisEligibility(sameGame)).toEqual({
      status: 'READY',
      gameId: X3F_GAME_ID,
      reasons: [],
    });

    const multi = sameGame.map((leg, index) =>
      index === 1
        ? {
            ...leg,
            offer: {
              ...leg.offer,
              gameId: 'other-game',
              offerIdentity: `xray|decision_close|${leg.offer.playerId}|other-game|${leg.offer.market}|${leg.offer.side}|${leg.offer.line}|${leg.offer.sportsbook.vendor}`,
              wagerIdentity: `${leg.offer.playerId}|other-game|${leg.offer.market}|${leg.offer.side}|${leg.offer.line}|${leg.offer.sportsbook.vendor}`,
            },
          }
        : leg
    );
    expect(multi).toHaveLength(4);
    const eligibility = evaluateWorkspaceAnalysisEligibility(multi);
    expect(eligibility.status).toBe('UNAVAILABLE');
    if (eligibility.status !== 'UNAVAILABLE') return;
    expect(eligibility.reasons.some((row) => row.code === 'MULTI_GAME')).toBe(true);
    expect(eligibility.reasons[0]?.message).toMatch(
      /Historical Court Context analysis currently supports parlays from one game/
    );
  });

  it('does not auto-analyze when XRay legs enter the Workspace store', () => {
    const legs = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    importConfirmedXrayLegsToStore(legs);
    expect(getParlaySelectionLegs()).toHaveLength(4);
    expect(getWorkspaceAnalysisRecord()).toBeNull();
  });

  it('labels XRay provenance and OCR corrections only when the screenshot text differs', () => {
    const legs = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    expect(workspaceSourceLabel(legs)).toBe('Imported from Parlay XRay');
    const ajay = legs[0]!;
    const luka = legs[3]!;
    expect(shouldShowXrayOcrProvenance(ajay)).toBe(false);
    expect(shouldShowXrayOcrProvenance(luka)).toBe(true);
    expect(luka.xrayProvenance?.ocrSnippet).toMatch(/Luka Doncik/);
    expect(luka.xrayProvenance?.confirmedPlayerName).toBe('Luka Doncic');
    expect(workspaceSourceLabel(x3fPropsLegs())).toBe('Built from Props Explorer');
    expect(x3fPropsLegs().every((leg) => !leg.xrayProvenance)).toBe(true);
  });

  it('converges XRay and Props Explorer on the same Ajay 12.5 DK wager identity', () => {
    const xray = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    const props = mustAdapt(x3fPropsInput(X3F_GROUND_TRUTH_LEGS[0]!));
    expect(xray[0]?.offer.wagerIdentity).toBe(props.wagerIdentity);
    expect(xray[0]?.offer.offerIdentity).not.toBe(props.offerIdentity);
    expect(xray[0]?.offer.source).toBe('xray');
    expect(props.source).toBe('props_explorer');
  });

  it('rejects a cross-source exact duplicate and allows different book or line', () => {
    const imported = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs().slice(0, 1),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    importConfirmedXrayLegsToStore(imported);
    const duplicate = addExplorerOfferToSelection(getParlaySelectionLegs(), x3fPropsInput(X3F_GROUND_TRUTH_LEGS[0]!));
    expect(duplicate.status).toBe('duplicate');
    expect(isOfferSelected(getParlaySelectionLegs(), x3fPropsInput(X3F_GROUND_TRUTH_LEGS[0]!))).toBe(true);

    const otherBook = addExplorerOfferToSelection(getParlaySelectionLegs(), {
      ...x3fPropsInput(X3F_GROUND_TRUTH_LEGS[0]!),
      sportsbook: 'FanDuel',
    });
    expect(otherBook.status).toBe('added');
    if (otherBook.status !== 'added') return;
    replaceParlaySelectionLegs(otherBook.legs);

    const otherLine = addExplorerOfferToSelection(getParlaySelectionLegs(), {
      ...x3fPropsInput(X3F_GROUND_TRUTH_LEGS[0]!),
      lineValue: 13.5,
    });
    expect(otherLine.status).toBe('added');
  });

  it('allows adding a distinct Props Explorer offer after XRay import and mixing sources', () => {
    importConfirmedXrayLegsToStore(
      mustHandoff({
        confirmed: true,
        legs: buildX3fConfirmedLegs().slice(0, 1),
        catalog: X3F_CATALOG,
        historicalReplay: HISTORICAL_REPLAY,
        resolveContext: { eventDate: X3F_HISTORICAL_DATE },
      })
    );
    const mixed = addExplorerOfferToSelection(getParlaySelectionLegs(), x3fPropsInput(X3F_GROUND_TRUTH_LEGS[1]!));
    expect(mixed.status).toBe('added');
    if (mixed.status !== 'added') return;
    replaceParlaySelectionLegs(mixed.legs);
    expect(getCanonicalParlaySelection().sourceContext).toBe('mixed');
    expect(workspaceSourceLabel(getParlaySelectionLegs())).toBe(
      'Combined from Parlay XRay and Props Explorer'
    );
  });

  it('can remove a confirmed XRay leg without mutating extraction records', () => {
    const original = buildX3fConfirmedLegs();
    importConfirmedXrayLegsToStore(
      mustHandoff({
        confirmed: true,
        legs: original,
        catalog: X3F_CATALOG,
        historicalReplay: HISTORICAL_REPLAY,
        resolveContext: { eventDate: X3F_HISTORICAL_DATE },
      })
    );
    const removedId = getParlaySelectionLegs()[0]?.offer.offerIdentity;
    replaceParlaySelectionLegs(removeSelectedLeg(getParlaySelectionLegs(), removedId!));
    expect(getParlaySelectionLegs()).toHaveLength(3);
    expect(isXrayImportEdited()).toBe(true);
    expect(original).toHaveLength(4);
    expect(original[0]?.playerDisplayName.value).toBe('Ajay Mitchell');
  });

  it('invalidates Workspace analysis after an XRay-origin mutation', () => {
    const legs = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    const result = runWorkspaceHistoricalAnalysis(legs, buildX3fReplayContext(), buildX3fReplayDeps());
    importConfirmedXrayLegsToStore(legs);
    setWorkspaceAnalysisRecord({ fingerprint: selectionFingerprint(legs), result });
    expect(getWorkspaceAnalysisRecord()).not.toBeNull();
    replaceParlaySelectionLegs(legs.slice(0, 3));
    expect(getWorkspaceAnalysisRecord()).toBeNull();
  });

  it('matches XRay and Props 4-leg Workspace analysis for the certified X3F parlay', () => {
    const xrayLegs = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    const xrayDirect = runHistoricalXrayReplay(
      buildX3fConfirmedLegs(),
      buildX3fReplayContext(),
      buildX3fReplayDeps()
    );
    const fromXray = runWorkspaceHistoricalAnalysis(
      xrayLegs,
      buildX3fReplayContext(),
      buildX3fReplayDeps()
    );
    const fromProps = runWorkspaceHistoricalAnalysis(
      x3fPropsLegs(),
      buildX3fReplayContext(),
      buildX3fReplayDeps()
    );

    expect(fromXray.matches.map((row) => row.status)).toEqual(xrayDirect.matches.map((row) => row.status));
    expect(fromProps.matches.map((row) => row.status)).toEqual(fromXray.matches.map((row) => row.status));
    expect(fromXray.matches.map((row) => row.requestedLine)).toEqual(
      fromProps.matches.map((row) => row.requestedLine)
    );
    expect(fromXray.interpretations.map((row) => row.whyItCouldFail.map((item) => item.code))).toEqual(
      fromProps.interpretations.map((row) => row.whyItCouldFail.map((item) => item.code))
    );
    expect(fromXray.parlayInterpretation.whyThisParlayCouldFail.map((item) => item.code)).toEqual(
      fromProps.parlayInterpretation.whyThisParlayCouldFail.map((item) => item.code)
    );
    expect(fromXray.parlayInterpretation.contextCoverage).toEqual(fromProps.parlayInterpretation.contextCoverage);
    expect(fromXray.parlayInterpretation.dataQuality).toEqual(fromProps.parlayInterpretation.dataQuality);
    expect(JSON.stringify(fromXray.parlayInterpretation)).not.toMatch(/correlat/i);
  });

  it('does not leak outcomes through either source path', () => {
    const deps = buildX3fReplayDeps();
    const playerId = X3F_AJAY_ID;
    const poisoned = {
      ...deps,
      sourcesByPlayerId: {
        ...deps.sourcesByPlayerId,
        [playerId]: {
          ...deps.sourcesByPlayerId[playerId]!,
          priorPlayerLogs: [
            ...(deps.sourcesByPlayerId[playerId]?.priorPlayerLogs ?? []),
            X3F_TARGET_GAME_SENTINEL_LOG,
            X3F_FUTURE_SENTINEL_LOG,
          ],
        },
      },
    };
    const xrayLegs = mustHandoff({
      confirmed: true,
      legs: buildX3fConfirmedLegs(),
      catalog: X3F_CATALOG,
      historicalReplay: HISTORICAL_REPLAY,
      resolveContext: { eventDate: X3F_HISTORICAL_DATE },
    });
    const xrayClean = runWorkspaceHistoricalAnalysis(xrayLegs, buildX3fReplayContext(), deps);
    const xrayPoisoned = runWorkspaceHistoricalAnalysis(xrayLegs, buildX3fReplayContext(), poisoned);
    const propsClean = runWorkspaceHistoricalAnalysis(x3fPropsLegs(), buildX3fReplayContext(), deps);
    expect(xrayPoisoned.interpretations).toEqual(xrayClean.interpretations);
    expect(JSON.stringify(xrayPoisoned.interpretations)).not.toMatch(OUTCOME_LEAK);
    expect(JSON.stringify(propsClean.interpretations)).not.toMatch(OUTCOME_LEAK);
  });

  it('treats a hard-refresh reset as an empty Workspace after XRay handoff', () => {
    importConfirmedXrayLegsToStore(
      mustHandoff({
        confirmed: true,
        legs: buildX3fConfirmedLegs(),
        catalog: X3F_CATALOG,
        historicalReplay: HISTORICAL_REPLAY,
        resolveContext: { eventDate: X3F_HISTORICAL_DATE },
      })
    );
    resetParlaySelectionStoreForTests();
    expect(getCanonicalParlaySelection().legs).toEqual([]);
    expect(isXrayImportEdited()).toBe(false);
  });
});
