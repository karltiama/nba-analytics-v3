/**
 * Aggregate event observations into the Level-3 certification report.
 */

import { SPORTSBOOK_HANDOFF_PROVIDERS } from '@/lib/sportsbook-handoff/types';
import { resolveAccessLimitation } from './access';
import { assessLevel3ProviderReady, gateEvidenceFromBookSummaryStrict } from './gates';
import type {
  BucketCounters,
  CertMarketKey,
  DeeplinkCoverageState,
  EventObservation,
  FanDuelCertificationSummary,
  Level3CertificationReport,
  PerBookSummary,
  ResolutionProbe,
  SidStabilityPair,
  TimeToTipBucket,
} from './types';
import { CERT_MARKETS } from './types';

function emptyBucket(): BucketCounters {
  return {
    eventsChecked: 0,
    eventsWithSportsbook: 0,
    eventsWithRequestedMarket: 0,
    eventsWithOutcomes: 0,
    outcomesWithSid: 0,
    outcomesWithLink: 0,
    exactSelectableLegs: 0,
  };
}

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

export function aggregateCertificationReport(input: {
  runTimestamp: string;
  mode: 'live' | 'fixture';
  events: EventObservation[];
  resolutionProbes: ResolutionProbe[];
  sidStability: SidStabilityPair[];
  credits: Level3CertificationReport['credits'];
  priorProbeRunsByBook: Partial<Record<string, number>>;
  paidTierNotes: string[];
  architectureNotes: string[];
}): Level3CertificationReport {
  const allowlistFailures: Level3CertificationReport['allowlistFailures'] = [];
  const maskedLinkSamples: Level3CertificationReport['maskedLinkSamples'] = [];

  const perBook: PerBookSummary[] = SPORTSBOOK_HANDOFF_PROVIDERS.map((provider) => {
    const byBucket: Partial<Record<TimeToTipBucket, BucketCounters>> = {};
    const byMarket: PerBookSummary['byMarket'] = {};
    const coverageStateCounts: Partial<Record<DeeplinkCoverageState, number>> = {};

    let bookPresentEvents = 0;
    let propMarketPresentEvents = 0;
    let outcomeCount = 0;
    let outcomesWithSid = 0;
    let outcomesWithLink = 0;
    let outcomesAllowlisted = 0;
    let maxVerifiedLevel: 0 | 1 | 2 | 3 = 0;

    const eventsWithBook = new Set<string>();
    const eventsWithProp = new Set<string>();

    for (const ev of input.events) {
      const bookMarkets = ev.markets.filter((m) => m.sportsbook === provider);
      const bookPresent = bookMarkets.some((m) => m.bookPresent);
      const anyMarket = bookMarkets.some((m) => m.marketPresent && m.outcomeCount > 0);

      const bucket = byBucket[ev.timeToTipBucket] ?? emptyBucket();
      bucket.eventsChecked += 1;
      if (bookPresent) {
        bucket.eventsWithSportsbook += 1;
        eventsWithBook.add(ev.providerEventId);
      }
      if (anyMarket) {
        bucket.eventsWithRequestedMarket += 1;
        bucket.eventsWithOutcomes += 1;
        eventsWithProp.add(ev.providerEventId);
      }

      for (const m of bookMarkets) {
        coverageStateCounts[m.state] = (coverageStateCounts[m.state] ?? 0) + 1;

        const mk = byMarket[m.marketKey] ?? {
          marketReturnedEvents: 0,
          outcomeCount: 0,
          outcomesWithSid: 0,
          outcomesWithLink: 0,
        };
        if (m.marketPresent && m.outcomeCount > 0) mk.marketReturnedEvents += 1;
        mk.outcomeCount += m.outcomeCount;
        mk.outcomesWithSid += m.outcomesWithSid;
        mk.outcomesWithLink += m.outcomesWithLink;
        byMarket[m.marketKey] = mk;

        outcomeCount += m.outcomeCount;
        outcomesWithSid += m.outcomesWithSid;
        outcomesWithLink += m.outcomesWithLink;
        outcomesAllowlisted += m.outcomesAllowlisted;
        bucket.outcomesWithSid += m.outcomesWithSid;
        bucket.outcomesWithLink += m.outcomesWithLink;
        bucket.exactSelectableLegs += m.outcomesAllowlisted;

        if (m.eventSid) maxVerifiedLevel = Math.max(maxVerifiedLevel, 1) as 0 | 1 | 2 | 3;
        if (m.marketSid) maxVerifiedLevel = Math.max(maxVerifiedLevel, 2) as 0 | 1 | 2 | 3;
        if (m.outcomesWithSid > 0) maxVerifiedLevel = Math.max(maxVerifiedLevel, 3) as 0 | 1 | 2 | 3;
        if (m.outcomesAllowlisted > 0) maxVerifiedLevel = 3;

        for (const o of m.outcomes) {
          if (o.hasLink && o.linkValidity && !o.linkValidity.allowlisted && o.linkValidity.host) {
            allowlistFailures.push({
              sportsbook: provider,
              host: o.linkValidity.host,
              urlShape: o.linkValidity.urlShape ?? '',
            });
          }
          if (
            o.hasLink &&
            o.linkValidity?.allowlisted &&
            o.linkValidity.host &&
            o.linkValidity.urlShape &&
            maskedLinkSamples.length < 12
          ) {
            maskedLinkSamples.push({
              sportsbook: provider,
              host: o.linkValidity.host,
              urlShape: o.linkValidity.urlShape,
            });
          }
        }
      }

      byBucket[ev.timeToTipBucket] = bucket;
    }

    bookPresentEvents = eventsWithBook.size;
    propMarketPresentEvents = eventsWithProp.size;

    const probes = input.resolutionProbes.filter((p) => p.sportsbook === provider);
    const exactResolverSuccess = probes.filter((p) => p.status === 'EXACT').length;
    const deeplinkResolverSuccess = probes.filter(
      (p) => p.status === 'EXACT' && p.hasDeeplink && p.allowlistOk
    ).length;

    for (const p of probes) {
      if (p.verifiedLevel > maxVerifiedLevel) {
        maxVerifiedLevel = Math.min(3, p.verifiedLevel) as 0 | 1 | 2 | 3;
      }
    }

    const accessLimitation = resolveAccessLimitation({
      sportsbook: provider,
      bookObservedOnThisKey: bookPresentEvents > 0,
    });

    const draft: PerBookSummary = {
      provider,
      eventsObserved: input.events.length,
      bookPresentEvents,
      propMarketPresentEvents,
      outcomeCount,
      outcomesWithSid,
      outcomesWithLink,
      outcomesAllowlisted,
      exactResolverProbes: probes.length,
      exactResolverSuccess,
      deeplinkResolverSuccess,
      maxVerifiedLevel,
      accessLimitation,
      level3ProviderReady: 'NO',
      gateNotes: [],
      bookPresentPct: pct(bookPresentEvents, input.events.length),
      propMarketPresentPct: pct(propMarketPresentEvents, input.events.length),
      outcomeSidPct: pct(outcomesWithSid, outcomeCount),
      outcomeLinkPct: pct(outcomesWithLink, outcomeCount),
      exactResolverPct: pct(exactResolverSuccess, probes.length),
      byBucket,
      byMarket,
      coverageStateCounts,
    };

    const priorRuns = input.priorProbeRunsByBook[provider] ?? 1;
    const gate = assessLevel3ProviderReady(
      gateEvidenceFromBookSummaryStrict(draft, {
        multipleProbeRuns: priorRuns >= 2,
      })
    );
    draft.level3ProviderReady = gate.ready;
    draft.gateNotes = gate.notes;

    return draft;
  });

  const fd = perBook.find((b) => b.provider === 'fanduel');
  let fanDuel: FanDuelCertificationSummary | null = null;
  if (fd) {
    const marketsSampled = CERT_MARKETS.filter(
      (m) => (fd.byMarket[m as CertMarketKey]?.outcomeCount ?? 0) > 0
    ).length;
    fanDuel = {
      gamesSampled: fd.propMarketPresentEvents,
      marketsSampled,
      eligibleSelections: fd.outcomeCount,
      selectionsWithOutcomeSid: fd.outcomesWithSid,
      selectionsWithDeeplink: fd.outcomesWithLink,
      allowlistPassRate: pct(fd.outcomesAllowlisted, fd.outcomesWithLink),
      resolutionPassRate: pct(fd.deeplinkResolverSuccess, fd.exactResolverProbes),
    };
  }

  return {
    schemaVersion: 1,
    phase: 'PROP_HANDOFF_PHASE_4B_LEVEL3_CERTIFICATION',
    runTimestamp: input.runTimestamp,
    mode: input.mode,
    marketsRequested: CERT_MARKETS,
    eventsInspected: input.events.length,
    credits: input.credits,
    perBook,
    fanDuel,
    resolutionProbes: input.resolutionProbes,
    sidStability: input.sidStability,
    allowlistFailures,
    maskedLinkSamples,
    paidTierNotes: input.paidTierNotes,
    architectureNotes: input.architectureNotes,
    apiKeyPresentInArtifact: false,
  };
}
