import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalOfferIdentity, canonicalWagerIdentity } from '../adapt-props-explorer-offer';
import { adaptQuickBuildLeg, assessQuickBuildPair, handoffQuickBuild, handoffQuickBuildSelection, type QuickBuildHandoffLeg } from '../adapt-quick-build';
import { shouldRequestCurrentParlayPrices } from '../research-snapshot-cost';
import { snapshotDisplayLabel, workspaceSourceLabel } from '../selection';
import {
  getParlaySelectionLegs,
  getWorkspaceAnalysisRecord,
  replaceParlaySelectionLegs,
  resetParlaySelectionStoreForTests,
  setWorkspaceAnalysisRecord,
} from '../selection-store';
import { selectionFingerprint } from '../workspace-analysis';

const NOW = Date.parse('2026-11-09T18:00:00.000Z');
const OBSERVED = '2026-11-09T16:00:00.000Z';
const START = '2026-11-10T00:30:00.000Z';

function leg(overrides: Partial<QuickBuildHandoffLeg> = {}): QuickBuildHandoffLeg {
  return {
    displayReady: true,
    playerId: '11',
    playerName: 'Jayson Tatum',
    gameId: 'g1',
    market: 'points',
    side: 'over',
    line: 22.5,
    sportsbook: 'draftkings',
    oddsAmerican: -115,
    observedAt: OBSERVED,
    gameStartTime: START,
    gameStatus: 'Scheduled',
    ...overrides,
  };
}

function pair(): [QuickBuildHandoffLeg, QuickBuildHandoffLeg] {
  return [leg(), leg({ playerId: '22', playerName: 'Jaylen Brown', gameId: 'g2', market: 'rebounds', side: 'under', line: 8.5, oddsAmerican: -110 })];
}

describe('adaptQuickBuildLeg', () => {
  beforeEach(() => resetParlaySelectionStoreForTests());

  it('preserves both prices and the research-snapshot identity', () => {
    const result = handoffQuickBuild({ current: [], legs: pair(), nowMs: NOW, confirmed: false });
    expect(result.status).toBe('replaced');
    if (result.status !== 'replaced') return;
    expect(result.legs.map((row) => row.offer.oddsAmerican)).toEqual([-115, -110]);
    expect(result.legs.map((row) => row.offer.snapshotAt)).toEqual([OBSERVED, OBSERVED]);
    for (const row of result.legs) {
      expect(row.offer.source).toBe('quick_build');
      expect(row.offer.sourceProvenance).toBe('quick_build_research_snapshot');
      expect(row.offer.snapshotKind).toBe('research_snapshot');
      expect(row.offer.offerIdentity).toBe(
        canonicalOfferIdentity({
          source: 'quick_build',
          snapshotKind: 'research_snapshot',
          playerId: row.offer.playerId,
          gameId: row.offer.gameId,
          market: row.offer.market,
          side: row.offer.side,
          line: row.offer.line,
          sportsbookVendor: row.offer.sportsbook.vendor,
        }),
      );
      expect(row.offer.wagerIdentity).toBe(
        canonicalWagerIdentity({
          playerId: row.offer.playerId,
          gameId: row.offer.gameId,
          market: row.offer.market,
          side: row.offer.side,
          line: row.offer.line,
          sportsbookVendor: row.offer.sportsbook.vendor,
        }),
      );
      expect(row.awayAbbr).toBeNull();
      expect(row.homeAbbr).toBeNull();
      expect(row.nbaPlayerId).toBeUndefined();
    }
    expect(snapshotDisplayLabel('research_snapshot')).toBe('Research Snapshot');
    expect(workspaceSourceLabel(result.legs)).toBe('Research Snapshot from Quick Builds');
  });

  it('copies a verified scheduled matchup and NBA headshot id without changing the wager', () => {
    const result = adaptQuickBuildLeg(leg({ awayAbbr: ' por ', homeAbbr: 'bos', nbaPlayerId: '1631210' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leg.awayAbbr).toBe('POR');
    expect(result.leg.gameStartTime).toBe(START);
    expect(result.leg.gameStatus).toBe('Scheduled');
    expect(result.leg.homeAbbr).toBe('BOS');
    expect(result.leg.gameLabel).toBe('POR @ BOS');
    expect(result.leg.nbaPlayerId).toBe('1631210');
    expect(result.leg.offer.playerId).toBe('11');
    expect(result.leg.offer.oddsAmerican).toBe(-115);
    expect(result.leg.offer.line).toBe(22.5);

    const bare = adaptQuickBuildLeg(leg());
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.leg.nbaPlayerId).toBeUndefined();
    expect(bare.leg.awayAbbr).toBeNull();
    expect(bare.leg.gameLabel).toBeNull();

    const clock = adaptQuickBuildLeg(leg({ gameStatus: START, awayAbbr: null, homeAbbr: 'BOS' }));
    expect(clock.ok).toBe(true);
    if (!clock.ok) return;
    expect(clock.leg.gameStatus).toBe('Scheduled');
    expect(clock.leg.gameStartTime).toBe(START);
    expect(clock.leg.gameStatus).not.toBe(START);
    expect(clock.leg.gameLabel).toBeNull();
    expect(clock.leg.awayAbbr).toBeNull();

    const half = adaptQuickBuildLeg(leg({ awayAbbr: 'POR' }));
    expect(half.ok).toBe(true);
    if (!half.ok) return;
    expect(half.leg.awayAbbr).toBeNull();
    expect(half.leg.homeAbbr).toBeNull();
  });

  it('assesses the whole pair without mutating the selection or reading the clock', () => {
    expect(assessQuickBuildPair(pair()).ok).toBe(true);
    const cases: Array<[Partial<QuickBuildHandoffLeg>, string]> = [
      [{ market: 'winner' }, 'UNSUPPORTED_MARKET'],
      [{ sportsbook: 'pinnacle' }, 'UNSUPPORTED_BOOK'],
      [{ oddsAmerican: 50 }, 'INVALID_PRICE'],
      [{ playerName: '' }, 'INVALID_PLAYER_NAME'],
      [{ gameStartTime: null }, 'MISSING_GAME_START'],
      [{ observedAt: null }, 'MISSING_OBSERVED_AT'],
    ];
    for (const [patch, code] of cases) {
      const result = assessQuickBuildPair([leg(patch), pair()[1]]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
    const tipped = pair();
    tipped[1] = { ...tipped[1], gameStartTime: '2026-11-09T17:00:00.000Z' };
    expect(assessQuickBuildPair(tipped).ok).toBe(true);
    expect(handoffQuickBuild({ current: [], legs: tipped, nowMs: NOW, confirmed: true }).status).toBe('tipped');
    expect(getParlaySelectionLegs()).toEqual([]);
  });

  it('rejects a missing name, timestamp, price, market, book, or the player id used as a name', () => {
    expect(adaptQuickBuildLeg(leg({ playerName: '  ' })).ok).toBe(false);
    expect(adaptQuickBuildLeg(leg({ playerName: '11' })).ok).toBe(false);
    expect(adaptQuickBuildLeg(leg({ playerName: '203999' })).ok).toBe(false);
    expect(adaptQuickBuildLeg(leg({ observedAt: null })).ok).toBe(false);
    expect(adaptQuickBuildLeg(leg({ observedAt: 'yesterday' })).ok).toBe(false);
    expect(adaptQuickBuildLeg(leg({ oddsAmerican: 50 })).ok).toBe(false);
    expect(adaptQuickBuildLeg(leg({ market: 'winner' })).ok).toBe(false);
    expect(adaptQuickBuildLeg(leg({ sportsbook: 'pinnacle' })).ok).toBe(false);
    expect(adaptQuickBuildLeg(leg({ displayReady: false })).ok).toBe(false);
    expect(adaptQuickBuildLeg(leg({ playerId: ' ' })).ok).toBe(false);
  });

  it('rejects the whole pair before any selection change when one leg is invalid', () => {
    replaceParlaySelectionLegs([]);
    const before = getParlaySelectionLegs();
    const result = handoffQuickBuild({
      current: before,
      legs: [leg(), leg({ playerId: '22', playerName: 'Jaylen Brown', gameId: 'g2', observedAt: null })],
      nowMs: NOW,
      confirmed: true,
    });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.code).toBe('MISSING_OBSERVED_AT');
    expect(getParlaySelectionLegs()).toEqual(before);
  });

  it('accepts an empty slip without confirmation and replaces an existing slip only after confirmation', () => {
    const empty = handoffQuickBuild({ current: [], legs: pair(), nowMs: NOW, confirmed: false });
    expect(empty.status).toBe('replaced');
    if (empty.status !== 'replaced') return;
    replaceParlaySelectionLegs(empty.legs);
    const existing = handoffQuickBuild({
      current: [],
      legs: [leg({ playerId: '99', playerName: 'Existing Player', gameId: 'g9', line: 10.5 }), leg({ playerId: '98', playerName: 'Other Player', gameId: 'g8', line: 11.5 })],
      nowMs: NOW,
      confirmed: false,
    });
    if (existing.status !== 'replaced') throw new Error(existing.status);
    replaceParlaySelectionLegs(existing.legs);
    setWorkspaceAnalysisRecord({ fingerprint: selectionFingerprint(existing.legs), result: {} as never });
    const before = getParlaySelectionLegs();
    const pending = handoffQuickBuild({ current: before, legs: pair(), nowMs: NOW, confirmed: false });
    expect(pending.status).toBe('needs_confirmation');
    expect(getParlaySelectionLegs()).toEqual(before);
    expect(getWorkspaceAnalysisRecord()).not.toBeNull();

    const replaced = handoffQuickBuild({ current: before, legs: pair(), nowMs: NOW, confirmed: true });
    expect(replaced.status).toBe('replaced');
    if (replaced.status !== 'replaced') return;
    expect(replaced.legs).toHaveLength(2);
    expect(selectionFingerprint(replaced.legs)).not.toBe(selectionFingerprint(before));
    replaceParlaySelectionLegs(replaced.legs);
    expect(getParlaySelectionLegs()).toHaveLength(2);
    expect(getParlaySelectionLegs().map((row) => row.offer.playerDisplayName)).toEqual(['Jayson Tatum', 'Jaylen Brown']);
    expect(getWorkspaceAnalysisRecord()).toBeNull();
  });

  it('does not append and does not transfer a game that has tipped', () => {
    const tipped = handoffQuickBuild({
      current: [],
      legs: pair().map((row, index) => (index === 1 ? { ...row, gameStartTime: '2026-11-09T17:00:00.000Z' } : row)) as [
        QuickBuildHandoffLeg,
        QuickBuildHandoffLeg,
      ],
      nowMs: NOW,
      confirmed: true,
    });
    expect(tipped.status).toBe('tipped');
    const started = handoffQuickBuild({
      current: [],
      legs: [leg(), leg({ playerId: '22', playerName: 'Jaylen Brown', gameId: 'g2', gameStatus: 'In Progress' })],
      nowMs: NOW,
      confirmed: true,
    });
    expect(started.status).toBe('tipped');
    const futureUnknown = handoffQuickBuild({
      current: [],
      legs: [leg({ gameStatus: 'Unknown' }), leg({ playerId: '22', playerName: 'Jaylen Brown', gameId: 'g2', gameStatus: null })],
      nowMs: NOW,
      confirmed: false,
    });
    expect(futureUnknown.status).toBe('replaced');
  });

  it('replaces an empty ticket with three legs and rejects the whole build when one leg fails', () => {
    const legs = [
      leg({ playerId: '11', gameId: 'g1' }),
      leg({ playerId: '22', playerName: 'Jaylen Brown', gameId: 'g2', market: 'rebounds' }),
      leg({ playerId: '33', playerName: 'Derrick White', gameId: 'g3', market: 'assists', oddsAmerican: 120 }),
    ] as [QuickBuildHandoffLeg, QuickBuildHandoffLeg, QuickBuildHandoffLeg];
    const replaced = handoffQuickBuildSelection({ current: [], legs, nowMs: NOW, confirmed: false });
    expect(replaced.status).toBe('replaced');
    if (replaced.status !== 'replaced') return;
    expect(replaced.legs).toHaveLength(3);
    expect(replaced.legs.map((row) => row.offer.oddsAmerican)).toEqual([-115, -115, 120]);
    expect(replaced.legs.every((row) => row.offer.snapshotAt === OBSERVED)).toBe(true);
    expect(replaced.legs.every((row) => row.offer.snapshotKind === 'research_snapshot')).toBe(true);
    expect(shouldRequestCurrentParlayPrices(replaced.legs)).toBe(false);

    const invalid = handoffQuickBuildSelection({
      current: [],
      legs: [legs[0], legs[1], { ...legs[2], observedAt: null }],
      nowMs: NOW,
      confirmed: true,
    });
    expect(invalid.status).toBe('rejected');
    expect(getParlaySelectionLegs()).toEqual([]);

    const tipped = handoffQuickBuildSelection({
      current: [],
      legs: [legs[0], legs[1], { ...legs[2], gameStartTime: '2026-11-09T17:00:00.000Z' }],
      nowMs: NOW,
      confirmed: true,
    });
    expect(tipped.status).toBe('tipped');

    replaceParlaySelectionLegs(replaced.legs);
    const pending = handoffQuickBuildSelection({ current: getParlaySelectionLegs(), legs, nowMs: NOW, confirmed: false });
    expect(pending.status).toBe('needs_confirmation');
    expect(getParlaySelectionLegs()).toHaveLength(3);
  });

  it('replaces a ticket with four or five legs and rejects one invalid leg', () => {
    const names = ['Jayson Tatum', 'Jaylen Brown', 'Derrick White', 'Jrue Holiday', 'Al Horford'];
    const legs = names.map((playerName, index) => leg({
      playerId: String(11 + index),
      playerName,
      gameId: `g${index + 1}`,
      market: index % 2 === 0 ? 'points' : 'rebounds',
      line: 10.5 + index,
    })) as [
      QuickBuildHandoffLeg,
      QuickBuildHandoffLeg,
      QuickBuildHandoffLeg,
      QuickBuildHandoffLeg,
      QuickBuildHandoffLeg,
    ];
    const five = handoffQuickBuildSelection({ current: [], legs, nowMs: NOW, confirmed: true });
    expect(five.status).toBe('replaced');
    if (five.status !== 'replaced') return;
    expect(five.legs).toHaveLength(5);
    expect(five.legs.every((row) => row.offer.snapshotKind === 'research_snapshot')).toBe(true);
    expect(shouldRequestCurrentParlayPrices(five.legs)).toBe(false);

    const four = handoffQuickBuildSelection({
      current: five.legs,
      legs: [legs[0], legs[1], legs[2], legs[3]],
      nowMs: NOW,
      confirmed: false,
    });
    expect(four.status).toBe('needs_confirmation');
    const confirmed = handoffQuickBuildSelection({
      current: five.legs,
      legs: [legs[0], legs[1], legs[2], legs[3]],
      nowMs: NOW,
      confirmed: true,
    });
    expect(confirmed.status).toBe('replaced');
    if (confirmed.status !== 'replaced') return;
    expect(confirmed.legs).toHaveLength(4);

    const duplicate = handoffQuickBuildSelection({
      current: [],
      legs: [legs[0], legs[1], legs[2], { ...legs[3], playerId: legs[0].playerId, playerName: legs[0].playerName }],
      nowMs: NOW,
      confirmed: true,
    });
    expect(duplicate.status).toBe('rejected');
    const started = handoffQuickBuildSelection({
      current: [],
      legs: [legs[0], legs[1], legs[2], { ...legs[3], gameStatus: 'In Progress' }],
      nowMs: NOW,
      confirmed: true,
    });
    expect(started.status).toBe('tipped');
  });
});
