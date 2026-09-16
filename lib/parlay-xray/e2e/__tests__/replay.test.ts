import { describe, expect, it } from 'vitest';
import { resolveCanonicalParlayLeg } from '@/lib/parlay-xray/resolution/resolve-leg';
import {
  X3F_AJAY_ID,
  X3F_CUTOFF_AT,
  X3F_DORT_ID,
  X3F_GAME_ID,
  X3F_GROUND_TRUTH_LEGS,
  X3F_KNOWN_GAPS,
  X3F_LUKA_ID,
} from '../ground-truth';
import {
  X3F_CATALOG,
  X3F_FUTURE_SENTINEL_LOG,
  X3F_TARGET_GAME_SENTINEL_LOG,
  buildX3fConfirmedLegs,
  buildX3fContextSources,
  buildX3fExtractedLegs,
  buildX3fReplayContext,
  buildX3fReplayDeps,
} from '../fixture';
import { runHistoricalXrayReplay } from '../run';
import { scaleParlayContract } from '../scale';
import { assertHistoricalReplayContext } from '../types';

const OUTCOME_LEAK = /finalPoints|\bhit\b|\bmiss\b|wager result|final score|box score/i;

function canonicalReplay() {
  return runHistoricalXrayReplay(buildX3fConfirmedLegs(), buildX3fReplayContext(), buildX3fReplayDeps());
}

describe('X3F historical replay orchestration', () => {
  it('fails closed without an explicit historical replay context', () => {
    expect(() =>
      assertHistoricalReplayContext({
        historicalDate: '',
        cutoffAt: X3F_CUTOFF_AT,
        gameId: X3F_GAME_ID,
        dateLabel: 'x',
        season: '2025',
        slateLabel: 'x',
      })
    ).toThrow(/INCOMPLETE/);
  });

  it('replays the locked 4-leg case with 3 exact matches and 1 partial', () => {
    const result = canonicalReplay();
    expect(result.interpretations).toHaveLength(4);
    expect(result.matches.map((row) => row.status)).toEqual([
      'MATCHED',
      'MATCHED',
      'PARTIAL_MATCH',
      'MATCHED',
    ]);
    expect(result.parlayInterpretation.reviewNeeded.some((row) => row.flags.includes('PARTIAL_MARKET_MATCH'))).toBe(
      true
    );
    expect(result.parlayInterpretation.contextCoverage.legCount).toBe(4);
    expect(result.historicalReplay.dateLabel).toMatch(/Historical Replay|April 2, 2026|LAL @ OKC/);
    expect(result.historicalReplay.dateLabel).toMatch(/April 2, 2026/);
    expect(result.historicalReplay.gameId).toBe(X3F_GAME_ID);
  });

  it('keeps OCR, confirmed, and canonical identity layers distinct', () => {
    const extracted = buildX3fExtractedLegs();
    const confirmed = buildX3fConfirmedLegs();
    const lukaExtracted = extracted.find((leg) => leg.id === 'leg-luka-pts')!;
    const lukaConfirmed = confirmed.find((leg) => leg.id === 'leg-luka-pts')!;
    expect(lukaExtracted.rawSnippet).toMatch(/Luka Doncik/);
    expect(lukaExtracted.playerDisplayName.value).toBe('Luka Doncik');
    expect(lukaConfirmed.rawSnippet).toBe(lukaExtracted.rawSnippet);
    expect(lukaConfirmed.playerDisplayName.value).toBe('Luka Doncic');

    const result = canonicalReplay();
    const layer = result.identityLayers.find((row) => row.legId === 'leg-luka-pts')!;
    expect(layer.ocr).toMatch(/Luka Doncik/);
    expect(layer.confirmedPlayerName).toBe('Luka Doncic');
    expect(layer.canonicalPlayerName).toBe('Luka Doncic');
    expect(layer.canonicalPlayerId).toBe(X3F_LUKA_ID);
    expect(result.resolutions[3]?.originalLeg.rawSnippet).toMatch(/Luka Doncik/);
    expect(result.resolutions[3]?.originalLeg.playerDisplayName.value).toBe('Luka Doncic');
  });

  it('uses the confirmed player name, not the stale OCR typo, for canonicalization', () => {
    const extracted = buildX3fExtractedLegs();
    const luka = extracted.find((leg) => leg.id === 'leg-luka-pts')!;
    const before = resolveCanonicalParlayLeg(luka, X3F_CATALOG, { eventDate: '2026-04-02' });
    expect(before.playerResolution.status).toBe('NEEDS_CONFIRMATION');
    expect(before.playerResolution.value).toBeNull();

    const confirmed = buildX3fConfirmedLegs().find((leg) => leg.id === 'leg-luka-pts')!;
    const after = resolveCanonicalParlayLeg(confirmed, X3F_CATALOG, { eventDate: '2026-04-02' });
    expect(after.playerResolution.status).toBe('RESOLVED');
    expect(after.playerResolution.value?.playerId).toBe(X3F_LUKA_ID);
    expect(after.originalLeg.rawSnippet).toMatch(/Luka Doncik/);

    const stale = runHistoricalXrayReplay(extracted, buildX3fReplayContext(), buildX3fReplayDeps());
    expect(stale.resolutions[3]?.playerResolution.status).toBe('NEEDS_CONFIRMATION');
    expect(stale.matches[3]?.status).not.toBe('MATCHED');
    const fixed = canonicalReplay();
    expect(fixed.resolutions[3]?.playerResolution.value?.playerId).toBe(X3F_LUKA_ID);
    expect(fixed.matches[3]?.status).toBe('MATCHED');
  });

  it('preserves historical match exactness from locked ground truth', () => {
    const result = canonicalReplay();
    result.matches.forEach((match, index) => {
      const expected = X3F_GROUND_TRUTH_LEGS[index]!;
      expect(match.input.gameId).toBe(X3F_GAME_ID);
      expect(match.input.playerId).toBe(expected.canonicalPlayerId);
      expect(match.input.market).toBe(expected.market);
      expect(match.requestedLine).toBe(expected.requestedLine);
      expect(match.matchedVendor).toBe(expected.book);
      expect(match.status).toBe(expected.matchStatus);
      expect(match.lineQuality).toBe(expected.lineQuality);
      expect(match.reason).toBe(expected.matchReason);
      expect(match.exactness.playerExact).toBe(expected.playerExact);
      expect(match.exactness.gameExact).toBe(expected.gameExact);
      expect(match.exactness.marketExact).toBe(expected.marketExact);
      expect(match.exactness.lineExact).toBe(expected.lineExact);
      expect(match.exactness.bookExact).toBe(expected.bookExact);
      expect(match.reference.available).toBe(true);
      expect(match.comparison.available).toBe(true);
      expect(match.reference.line).toBe(expected.threeHourLine);
      expect(match.comparison.line).toBe(expected.closeLine);
      expect(match.matchedVendor).not.toBe('fanduel');
    });
  });

  it('assembles pre-tip context and advertised historical gaps', () => {
    const result = canonicalReplay();
    for (const packet of result.contexts) {
      expect(packet.identity.contextCutoffAt).toBe(X3F_CUTOFF_AT);
      expect(packet.identity.gameId).toBe(X3F_GAME_ID);
      expect(packet.playerForm.last5.gameCount).toBeGreaterThan(0);
      expect(packet.playerForm.last10.gameCount).toBeGreaterThan(0);
      expect(packet.role.seasonToDateMinutes.gameCount).toBeGreaterThan(0);
      expect(packet.matchup.status).not.toBe('UNAVAILABLE');
      expect(packet.wowy.status).toBe('UNAVAILABLE');
      expect(packet.projection.status).toBe('UNAVAILABLE');
      expect(packet.availability.status).toBe('UNAVAILABLE');
      expect(packet.playerForm.seasonToDate.average).not.toBe(99);
    }
    expect(result.parlayInterpretation.dataQuality.wowy.have).toBe(0);
    expect(result.parlayInterpretation.dataQuality.projection.have).toBe(0);
    expect(result.parlayInterpretation.dataQuality.availability.have).toBe(0);
    expect(X3F_KNOWN_GAPS).toEqual(['WOWY', 'projection', 'availability']);
    const dort = result.contexts[2]!;
    expect(dort.playerForm.last5.gameCount).toBe(3);
    expect(dort.dataQuality.marketPartial).toBe(true);
  });

  it('keeps 3 resolved legs when one market is only a partial match', () => {
    const result = canonicalReplay();
    const matched = result.matches.filter((row) => row.status === 'MATCHED');
    const partial = result.matches.filter((row) => row.status === 'PARTIAL_MATCH');
    expect(matched).toHaveLength(3);
    expect(partial).toHaveLength(1);
    expect(result.interpretations).toHaveLength(4);
    expect(result.parlayInterpretation.reviewNeeded.some((row) => row.legIndex === 2)).toBe(true);
    expect(result.interpretations[2]?.identity.playerDisplayName).toBe('Luguentz Dort');
  });

  it('traces displayed interpretation text to the context packet', () => {
    const result = canonicalReplay();
    const blob = JSON.stringify(result.interpretations);
    expect(blob).not.toMatch(/probability|win%|take the over|best bet|lock this/i);
    expect(blob).not.toMatch(OUTCOME_LEAK);
    expect(result.parlayInterpretation.summarySentence).not.toMatch(/correlat/i);
    expect(result.parlayInterpretation.dependencyGroups.some((g) => g.kind === 'SHARED_PLAYER')).toBe(true);
    expect(result.parlayInterpretation.dependencyGroups.some((g) => g.kind === 'SHARED_GAME')).toBe(true);
    expect(result.parlayInterpretation.whyThisParlayCouldFail.length).toBeGreaterThan(1);
    expect(
      result.parlayInterpretation.whyThisParlayCouldFail.some((row) =>
        /same player|same game|WOWY|projection|availability|partial/i.test(row.detail)
      )
    ).toBe(true);
  });

  it('does not change when target or future outcome rows are injected', () => {
    const before = canonicalReplay();
    const deps = buildX3fReplayDeps();
    const poisoned = {
      ...deps,
      sourcesByPlayerId: {
        ...deps.sourcesByPlayerId,
        [X3F_AJAY_ID]: {
          ...deps.sourcesByPlayerId[X3F_AJAY_ID]!,
          priorPlayerLogs: [
            ...deps.sourcesByPlayerId[X3F_AJAY_ID]!.priorPlayerLogs,
            X3F_TARGET_GAME_SENTINEL_LOG,
            X3F_FUTURE_SENTINEL_LOG,
          ],
        },
      },
    };
    const after = runHistoricalXrayReplay(buildX3fConfirmedLegs(), buildX3fReplayContext(), poisoned);
    expect(after.interpretations).toEqual(before.interpretations);
    expect(after.parlayInterpretation).toEqual(before.parlayInterpretation);
    expect(JSON.stringify(after.interpretations)).not.toMatch(/"points":99/);
    expect(after.contexts[0]?.playerForm.seasonToDate.average).not.toBe(99);
  });

  it('is deterministic for the same confirmed legs and deps', () => {
    const a = canonicalReplay();
    const b = canonicalReplay();
    expect(a.resolutions).toEqual(b.resolutions);
    expect(a.matches).toEqual(b.matches);
    expect(a.interpretations).toEqual(b.interpretations);
    expect(a.parlayInterpretation).toEqual(b.parlayInterpretation);
    expect(a.identityLayers).toEqual(b.identityLayers);
  });

  it('does not assume exactly four legs in the data contract', () => {
    for (const count of [1, 8, 12] as const) {
      const contract = scaleParlayContract(count);
      expect(contract.interpretationCount).toBe(count);
      expect(contract.parlayLegCount).toBe(count);
      expect(new Set(contract.originalLegIds).size).toBe(count);
      expect(new Set(contract.uniqueKeys).size).toBe(count);
    }
  });

  it('labels the replay historically and never as live', () => {
    const result = canonicalReplay();
    expect(result.historicalReplay.dateLabel).toMatch(/April 2, 2026/);
    expect(result.historicalReplay.dateLabel).toMatch(/LAL @ OKC/);
    expect(result.historicalReplay.cutoffAt).toBe(X3F_CUTOFF_AT);
    expect(JSON.stringify(result.historicalReplay)).not.toMatch(/live season|current season recommendation/i);
    expect(result.resolutions[0]?.playerResolution.value?.playerId).toBe(X3F_AJAY_ID);
    expect(result.resolutions[2]?.playerResolution.value?.playerId).toBe(X3F_DORT_ID);
  });
});
