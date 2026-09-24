import { describe, expect, it } from 'vitest';
import {
  aggregateCertificationReport,
  assessLevel3ProviderReady,
  assertNoSecretsInReport,
  classifyDeeplinkCoverageState,
  classifyTimeToTipBucket,
  documentedAccessLimitation,
  formatCertificationMarkdown,
  hoursUntilCommence,
  observeBookMarket,
  resolveAccessLimitation,
  runLevel3Certification,
  validateOutcomeLink,
  buildSidStabilityPair,
} from '../certification';
import { FIXTURE_EVENTS, FIXTURE_EVENT_ID } from '../odds-api/fixtures/events';
import { FIXTURE_FANDUEL_EXACT, FIXTURE_MISSING_LINK } from '../odds-api/fixtures/odds';
import type { OddsApiEventRaw } from '../odds-api/types';

describe('time-to-tip buckets', () => {
  it('classifies recommended buckets', () => {
    expect(classifyTimeToTipBucket(30)).toBe('gt_24h');
    expect(classifyTimeToTipBucket(18)).toBe('h_12_24');
    expect(classifyTimeToTipBucket(8)).toBe('h_6_12');
    expect(classifyTimeToTipBucket(4)).toBe('h_3_6');
    expect(classifyTimeToTipBucket(2)).toBe('h_1_3');
    expect(classifyTimeToTipBucket(0.5)).toBe('lt_1h');
    expect(classifyTimeToTipBucket(-1)).toBe('started_or_past');
  });

  it('computes hours until commence', () => {
    const now = new Date('2026-10-21T12:00:00.000Z');
    const hours = hoursUntilCommence('2026-10-21T18:00:00.000Z', now);
    expect(hours).toBe(6);
  });
});

describe('coverage classification', () => {
  it('distinguishes book absent vs market absent', () => {
    expect(
      classifyDeeplinkCoverageState({
        bookPresent: false,
        marketPresent: false,
        outcomeCount: 0,
        outcomesWithSid: 0,
        outcomesWithLink: 0,
      })
    ).toBe('BOOK_ENTIRELY_ABSENT');

    expect(
      classifyDeeplinkCoverageState({
        bookPresent: true,
        marketPresent: false,
        outcomeCount: 0,
        outcomesWithSid: 0,
        outcomesWithLink: 0,
      })
    ).toBe('BOOK_RETURNED_NO_MARKET');
  });

  it('classifies SID-no-link and deeplink available', () => {
    expect(
      classifyDeeplinkCoverageState({
        bookPresent: true,
        marketPresent: true,
        outcomeCount: 2,
        outcomesWithSid: 2,
        outcomesWithLink: 0,
      })
    ).toBe('SID_NO_LINK');

    expect(
      classifyDeeplinkCoverageState({
        bookPresent: true,
        marketPresent: true,
        outcomeCount: 2,
        outcomesWithSid: 2,
        outcomesWithLink: 1,
      })
    ).toBe('DEEPLINK_AVAILABLE');
  });

  it('classifies allowlist failure when all links rejected', () => {
    expect(
      classifyDeeplinkCoverageState({
        bookPresent: true,
        marketPresent: true,
        outcomeCount: 1,
        outcomesWithSid: 1,
        outcomesWithLink: 1,
        allLinksAllowlistFailed: true,
      })
    ).toBe('DEEPLINK_REJECTED_ALLOWLIST');
  });
});

describe('link validity', () => {
  it('accepts allowlisted FanDuel link and rejects foreign host', () => {
    const ok = validateOutcomeLink(
      'https://sportsbook.fanduel.com/addToBetslip?marketId=1&selectionId=2',
      'fanduel'
    );
    expect(ok.allowlisted).toBe(true);
    expect(ok.https).toBe(true);
    expect(ok.urlShape).toContain('marketId=…');

    const bad = validateOutcomeLink('https://evil.example.com/x', 'fanduel');
    expect(bad.allowlisted).toBe(false);
  });
});

describe('observeBookMarket', () => {
  it('observes FanDuel deeplink available vs missing link', () => {
    const available = observeBookMarket({
      event: FIXTURE_FANDUEL_EXACT,
      sportsbook: 'fanduel',
      marketKey: 'player_points',
    });
    expect(available.state).toBe('DEEPLINK_AVAILABLE');
    expect(available.outcomesWithLink).toBeGreaterThan(0);

    const missing = observeBookMarket({
      event: FIXTURE_MISSING_LINK,
      sportsbook: 'fanduel',
      marketKey: 'player_points',
    });
    expect(missing.state).toBe('SID_NO_LINK');
  });

  it('marks book entirely absent when bookmaker missing', () => {
    const empty: OddsApiEventRaw = { ...FIXTURE_EVENTS[0]!, bookmakers: [] };
    const obs = observeBookMarket({
      event: empty,
      sportsbook: 'draftkings',
      marketKey: 'player_points',
    });
    expect(obs.state).toBe('BOOK_ENTIRELY_ABSENT');
  });
});

describe('access limitation', () => {
  it('marks Caesars and Fanatics as paid-access-required per docs', () => {
    expect(documentedAccessLimitation('caesars')).toBe('PAID_ACCESS_REQUIRED');
    expect(documentedAccessLimitation('fanatics')).toBe('PAID_ACCESS_REQUIRED');
    expect(resolveAccessLimitation({ sportsbook: 'caesars', bookObservedOnThisKey: false })).toBe(
      'PAID_ACCESS_REQUIRED'
    );
    expect(
      resolveAccessLimitation({ sportsbook: 'fanduel', bookObservedOnThisKey: true })
    ).toBe('FREE_KEY_OBSERVED');
  });
});

describe('SID stability pairs', () => {
  it('detects stable SID when odds move but line stays', () => {
    const pair = buildSidStabilityPair({
      sportsbook: 'fanduel',
      marketKey: 'player_points',
      playerName: 'Jayson Tatum',
      side: 'over',
      line: 28.5,
      sampleA: {
        eventSid: 'e1',
        marketSid: 'm1',
        selectionSid: 'sel-1',
        oddsAmerican: -110,
        line: 28.5,
        deeplink: 'https://sportsbook.fanduel.com/addToBetslip?marketId=1&selectionId=sel-1',
        at: '2026-10-21T12:00:00.000Z',
      },
      sampleB: {
        eventSid: 'e1',
        marketSid: 'm1',
        selectionSid: 'sel-1',
        oddsAmerican: -105,
        line: 28.5,
        deeplink: 'https://sportsbook.fanduel.com/addToBetslip?marketId=1&selectionId=sel-1',
        at: '2026-10-21T12:05:00.000Z',
      },
    });
    expect(pair.sameSelectionSid).toBe(true);
    expect(pair.oddsChanged).toBe(true);
    expect(pair.lineChanged).toBe(false);
  });
});

describe('gates + aggregation + sanitize', () => {
  it('requires multiple games/runs for YES', () => {
    const gate = assessLevel3ProviderReady({
      liveOddsObserved: true,
      exactResolutionVerified: true,
      outcomeLinkReturned: true,
      allowlistPasses: true,
      multipleGames: false,
      multipleProbeRuns: true,
      fallbackRemainsFunctional: true,
      noUrlSynthesisRequired: true,
    });
    expect(gate.ready).toBe('INSUFFICIENT_SAMPLE');
  });

  it('aggregates and refuses credential serialization', async () => {
    const report = await runLevel3Certification({
      mode: 'fixture',
      eventsFixture: FIXTURE_EVENTS,
      oddsByEventId: {
        [FIXTURE_EVENT_ID]: FIXTURE_FANDUEL_EXACT,
      },
      now: new Date('2026-10-21T12:00:00.000Z'),
      maxEvents: 2,
      priorProbeRunsByBook: { fanduel: 2 },
    });

    expect(report.apiKeyPresentInArtifact).toBe(false);
    expect(() => assertNoSecretsInReport(report)).not.toThrow();
    expect(() =>
      assertNoSecretsInReport({ ...report, apiKey: 'ffa7ee7b303ca96cf1458669bbf77e3b' })
    ).toThrow();

    const md = formatCertificationMarkdown(report);
    expect(md).toContain('FanDuel');
    expect(md).not.toMatch(/apiKey=/i);

    const fd = report.perBook.find((b) => b.provider === 'fanduel');
    expect(fd?.outcomesWithLink).toBeGreaterThan(0);
    expect(fd?.maxVerifiedLevel).toBe(3);

    // DraftKings absent in this single-book fixture payload
    const dk = report.perBook.find((b) => b.provider === 'draftkings');
    expect(dk?.coverageStateCounts.BOOK_ENTIRELY_ABSENT).toBeGreaterThan(0);
  });

  it('aggregateCertificationReport exposes percentages with N', () => {
    const report = aggregateCertificationReport({
      runTimestamp: '2026-10-21T12:00:00.000Z',
      mode: 'fixture',
      events: [],
      resolutionProbes: [],
      sidStability: [],
      credits: {
        startingRemaining: 500,
        endingRemaining: 500,
        observedCostSum: 0,
        requestsRecorded: 0,
      },
      priorProbeRunsByBook: {},
      paidTierNotes: [],
      architectureNotes: [],
    });
    expect(report.eventsInspected).toBe(0);
    expect(report.perBook).toHaveLength(5);
    expect(report.perBook[0]!.bookPresentPct).toBeNull();
  });
});
