import { beforeEach, describe, expect, it } from 'vitest';
import { adaptPropsExplorerOffer, type PropsExplorerOfferInput } from '../adapt-props-explorer-offer';
import {
  X3F_AJAY_ID,
  X3F_CUTOFF_AT,
  X3F_GAME_ID,
  X3F_GROUND_TRUTH_LEGS,
} from '@/lib/parlay-xray/e2e/ground-truth';
import {
  X3F_FUTURE_SENTINEL_LOG,
  X3F_TARGET_GAME_SENTINEL_LOG,
  buildX3fConfirmedLegs,
  buildX3fReplayContext,
  buildX3fReplayDeps,
} from '@/lib/parlay-xray/e2e/fixture';
import { runHistoricalXrayReplay } from '@/lib/parlay-xray/e2e/run';
import {
  getWorkspaceAnalysisRecord,
  replaceParlaySelectionLegs,
  resetParlaySelectionStoreForTests,
  setWorkspaceAnalysisRecord,
} from '../selection-store';
import type { SelectedParlayLeg } from '../selection';
import {
  evaluateWorkspaceAnalysisEligibility,
  runWorkspaceHistoricalAnalysis,
  selectionFingerprint,
} from '../workspace-analysis';

const OUTCOME_LEAK = /finalPoints|\bhit\b|\bmiss\b|wager result|final score|box score/i;

function mustAdapt(input: PropsExplorerOfferInput) {
  const result = adaptPropsExplorerOffer(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.offer;
}

function x3fWorkspaceLegs(): SelectedParlayLeg[] {
  return X3F_GROUND_TRUTH_LEGS.map((row) => ({
    offer: mustAdapt({
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
    }),
    gameLabel: 'LAL @ OKC',
  }));
}

describe('Workspace historical analysis', () => {
  beforeEach(() => {
    resetParlaySelectionStoreForTests();
  });

  it('does not treat an empty Workspace as analyzable', () => {
    const eligibility = evaluateWorkspaceAnalysisEligibility([]);
    expect(eligibility.status).toBe('UNAVAILABLE');
    if (eligibility.status !== 'UNAVAILABLE') return;
    expect(eligibility.reasons[0]?.code).toBe('EMPTY');
    expect(() =>
      runWorkspaceHistoricalAnalysis([], buildX3fReplayContext(), buildX3fReplayDeps())
    ).toThrow(/EMPTY/);
  });

  it('requires explicit Analyze — opening the store does not create a result', () => {
    replaceParlaySelectionLegs(x3fWorkspaceLegs());
    expect(getWorkspaceAnalysisRecord()).toBeNull();
  });

  it('marks the certified X3F selection READY', () => {
    const eligibility = evaluateWorkspaceAnalysisEligibility(x3fWorkspaceLegs());
    expect(eligibility).toEqual({ status: 'READY', gameId: X3F_GAME_ID, reasons: [] });
  });

  it('fail-closes live_current instead of running historical matching', () => {
    const live: SelectedParlayLeg[] = [
      {
        offer: mustAdapt({
          playerId: X3F_AJAY_ID,
          playerName: 'Ajay Mitchell',
          gameId: X3F_GAME_ID,
          propType: 'points',
          side: 'over',
          lineValue: 12.5,
          sportsbook: 'DraftKings',
          oddsAmerican: -107,
          snapshotAt: X3F_CUTOFF_AT,
          marketContext: 'live',
          sourceTable: 'analytics.player_props_current',
        }),
        gameLabel: 'LAL @ OKC',
      },
    ];
    const eligibility = evaluateWorkspaceAnalysisEligibility(live);
    expect(eligibility.status).toBe('UNAVAILABLE');
    if (eligibility.status !== 'UNAVAILABLE') return;
    expect(eligibility.reasons.some((row) => row.code === 'LIVE_CURRENT')).toBe(true);
  });

  it('fail-closes a game outside the injectable historical fixture', () => {
    const other: SelectedParlayLeg[] = [
      {
        offer: mustAdapt({
          playerId: X3F_AJAY_ID,
          playerName: 'Ajay Mitchell',
          gameId: '99999999',
          propType: 'points',
          side: 'over',
          lineValue: 12.5,
          sportsbook: 'DraftKings',
          oddsAmerican: -110,
          snapshotAt: '2026-03-01T00:00:00.000Z',
          marketContext: 'historical',
          sourceTable: 'research.prop_decision_lines',
        }),
        gameLabel: 'Other',
      },
    ];
    const eligibility = evaluateWorkspaceAnalysisEligibility(other);
    expect(eligibility.status).toBe('UNAVAILABLE');
    if (eligibility.status !== 'UNAVAILABLE') return;
    expect(eligibility.reasons.some((row) => row.code === 'OUTSIDE_COVERAGE')).toBe(true);
  });

  it('fail-closes mixed games', () => {
    const legs = x3fWorkspaceLegs();
    legs[1] = {
      ...legs[1]!,
      offer: { ...legs[1]!.offer, gameId: 'other-game', offerIdentity: 'other' },
    };
    const eligibility = evaluateWorkspaceAnalysisEligibility(legs);
    expect(eligibility.status).toBe('UNAVAILABLE');
    if (eligibility.status !== 'UNAVAILABLE') return;
    expect(eligibility.reasons.some((row) => row.code === 'MULTI_GAME')).toBe(true);
  });

  it('preserves the selected Decision Close line and keeps 3-Hour as comparison', () => {
    const result = runWorkspaceHistoricalAnalysis(
      x3fWorkspaceLegs(),
      buildX3fReplayContext(),
      buildX3fReplayDeps()
    );
    const ajayPts = result.matches[0]!;
    expect(ajayPts.requestedLine).toBe(12.5);
    expect(ajayPts.comparison.line).toBe(12.5);
    expect(ajayPts.reference.line).toBe(11.5);
    expect(ajayPts.reference.label).toBe('3-Hour Pre-Tip');
    expect(ajayPts.comparison.label).toBe('Decision Close');
    expect(ajayPts.requestedLine).not.toBe(11.5);
  });

  it('keeps Dort as a partial historical match', () => {
    const result = runWorkspaceHistoricalAnalysis(
      x3fWorkspaceLegs(),
      buildX3fReplayContext(),
      buildX3fReplayDeps()
    );
    expect(result.matches.map((row) => row.status)).toEqual([
      'MATCHED',
      'MATCHED',
      'PARTIAL_MATCH',
      'MATCHED',
    ]);
    expect(result.interpretations).toHaveLength(4);
  });

  it('matches XRay basketball analysis for the same canonical X3F parlay', () => {
    const xray = runHistoricalXrayReplay(
      buildX3fConfirmedLegs(),
      buildX3fReplayContext(),
      buildX3fReplayDeps()
    );
    const workspace = runWorkspaceHistoricalAnalysis(
      x3fWorkspaceLegs(),
      buildX3fReplayContext(),
      buildX3fReplayDeps()
    );
    expect(workspace.matches.map((row) => row.status)).toEqual(xray.matches.map((row) => row.status));
    expect(workspace.matches.map((row) => row.requestedLine)).toEqual(
      xray.matches.map((row) => row.requestedLine)
    );
    expect(workspace.interpretations.map((row) => row.whyItCouldFail.map((item) => item.code))).toEqual(
      xray.interpretations.map((row) => row.whyItCouldFail.map((item) => item.code))
    );
    expect(workspace.parlayInterpretation.whyThisParlayCouldFail.map((item) => item.code)).toEqual(
      xray.parlayInterpretation.whyThisParlayCouldFail.map((item) => item.code)
    );
    expect(workspace.parlayInterpretation.dependencyGroups.map((g) => g.kind).sort()).toEqual(
      xray.parlayInterpretation.dependencyGroups.map((g) => g.kind).sort()
    );
    expect(JSON.stringify(workspace.parlayInterpretation)).not.toMatch(/correlat/i);
  });

  it('does not leak outcomes or future rows through the Workspace path', () => {
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
    const clean = runWorkspaceHistoricalAnalysis(x3fWorkspaceLegs(), buildX3fReplayContext(), deps);
    const after = runWorkspaceHistoricalAnalysis(x3fWorkspaceLegs(), buildX3fReplayContext(), poisoned);
    expect(after.interpretations).toEqual(clean.interpretations);
    expect(JSON.stringify(after.interpretations)).not.toMatch(OUTCOME_LEAK);
    expect(
      after.parlayInterpretation.whyThisParlayCouldFail.some((row) =>
        /WOWY|projection|availability|partial/i.test(row.detail)
      )
    ).toBe(true);
  });

  it('invalidates analysis when the selection fingerprint changes', () => {
    const legs = x3fWorkspaceLegs();
    const result = runWorkspaceHistoricalAnalysis(legs, buildX3fReplayContext(), buildX3fReplayDeps());
    replaceParlaySelectionLegs(legs);
    setWorkspaceAnalysisRecord({ fingerprint: selectionFingerprint(legs), result });
    expect(getWorkspaceAnalysisRecord()?.fingerprint).toBe(selectionFingerprint(legs));
    replaceParlaySelectionLegs(legs.slice(0, 1));
    expect(getWorkspaceAnalysisRecord()).toBeNull();
  });

  it('invalidates after clear', () => {
    const legs = x3fWorkspaceLegs();
    const result = runWorkspaceHistoricalAnalysis(legs, buildX3fReplayContext(), buildX3fReplayDeps());
    replaceParlaySelectionLegs(legs);
    setWorkspaceAnalysisRecord({ fingerprint: selectionFingerprint(legs), result });
    replaceParlaySelectionLegs([]);
    expect(getWorkspaceAnalysisRecord()).toBeNull();
  });
});
