/**
 * Core Level-3 coverage certification runner (read-only; no DB writes).
 */

import type { CanonicalBetLeg } from '@/lib/bet-slip/types';
import {
  SPORTSBOOK_HANDOFF_PROVIDERS,
  type SportsbookHandoffProvider,
} from '@/lib/sportsbook-handoff/types';
import { OddsApiSelectionDeeplinkAdapter } from '../odds-api/adapter';
import { oddsApiBookmakerKey } from '../odds-api/bookmaker-map';
import type { OddsApiClient } from '../odds-api/client';
import type { OddsApiEventRaw } from '../odds-api/types';
import { teamNameToAbbreviation } from '../event-match';
import { aggregateCertificationReport } from './aggregate';
import { CERT_MARKETS } from './types';
import type {
  CertMarketKey,
  EventObservation,
  Level3CertificationReport,
  ResolutionProbe,
  SidStabilityPair,
} from './types';
import { certMarketToCanonical } from './market-reverse';
import { observeBookMarket } from './observe';
import { buildSidStabilityPair } from './sid-stability';
import {
  classifyTimeToTipBucket,
  hoursUntilCommence,
  isFutureTipBucket,
} from './time-to-tip';
import { assertNoSecretsInReport } from './sanitize';

export type CertificationRunOptions = {
  client?: OddsApiClient | null;
  /** Inject events list (fixture mode). */
  eventsFixture?: OddsApiEventRaw[] | null;
  /**
   * Inject odds by provider event id. When set, network odds calls are skipped.
   */
  oddsByEventId?: Record<string, OddsApiEventRaw> | null;
  /** Second snapshot for SID stability (same event ids). */
  oddsByEventIdPass2?: Record<string, OddsApiEventRaw> | null;
  now?: Date;
  maxEvents?: number;
  maxEventsPerBucket?: number;
  /** Max resolution probes per book (cost/CPU). */
  maxResolutionProbesPerBook?: number;
  priorProbeRunsByBook?: Partial<Record<SportsbookHandoffProvider, number>>;
  mode?: 'live' | 'fixture';
};

function selectEventsForCertification(
  events: OddsApiEventRaw[],
  now: Date,
  maxEvents: number,
  maxPerBucket: number
): OddsApiEventRaw[] {
  const byBucket = new Map<string, OddsApiEventRaw[]>();
  const future = events
    .map((e) => ({ e, hours: hoursUntilCommence(e.commence_time, now) }))
    .filter((x) => x.hours != null && x.hours >= 0)
    .sort((a, b) => (a.hours ?? 0) - (b.hours ?? 0));

  for (const { e, hours } of future) {
    const bucket = classifyTimeToTipBucket(hours);
    if (!isFutureTipBucket(bucket)) continue;
    const list = byBucket.get(bucket) ?? [];
    if (list.length >= maxPerBucket) continue;
    list.push(e);
    byBucket.set(bucket, list);
  }

  const selected: OddsApiEventRaw[] = [];
  for (const list of byBucket.values()) {
    for (const e of list) {
      if (selected.length >= maxEvents) return selected;
      selected.push(e);
    }
  }
  return selected;
}

function buildLegFromOutcome(input: {
  event: OddsApiEventRaw;
  marketKey: CertMarketKey;
  playerName: string;
  side: 'over' | 'under';
  line: number;
  oddsAmerican: number;
  sportsbook: SportsbookHandoffProvider;
}): CanonicalBetLeg {
  const home = teamNameToAbbreviation(input.event.home_team) ?? 'UNK';
  const away = teamNameToAbbreviation(input.event.away_team) ?? 'UNK';
  const market = certMarketToCanonical(input.marketKey);
  return {
    selectionKey: `nba|${input.event.id}|cert|${market}|${input.side}|${input.line}|${input.playerName}`,
    sport: 'nba',
    gameId: `cc-cert-${input.event.id}`,
    playerId: `name:${input.playerName}`,
    market,
    side: input.side,
    line: input.line,
    playerName: input.playerName,
    teamAbbreviation: away,
    opponentAbbreviation: home,
    gameLabel: `${away} @ ${home}`,
    selectedSportsbook: null,
    selectedOdds: input.oddsAmerican,
    selectedAt: new Date().toISOString(),
  };
}

function observeEvent(input: {
  event: OddsApiEventRaw;
  now: Date;
  requestCost: number | null;
}): EventObservation {
  const hours = hoursUntilCommence(input.event.commence_time, input.now);
  const markets = [];
  for (const sportsbook of SPORTSBOOK_HANDOFF_PROVIDERS) {
    for (const marketKey of CERT_MARKETS) {
      markets.push(
        observeBookMarket({
          event: input.event,
          sportsbook,
          marketKey,
        })
      );
    }
  }
  return {
    providerEventId: input.event.id,
    homeTeam: input.event.home_team,
    awayTeam: input.event.away_team,
    commenceTimeIso: input.event.commence_time,
    timeToTipBucket: classifyTimeToTipBucket(hours),
    hoursToTip: hours,
    markets,
    requestCost: input.requestCost,
  };
}

export async function runLevel3Certification(
  options: CertificationRunOptions = {}
): Promise<Level3CertificationReport> {
  const now = options.now ?? new Date();
  const maxEvents = options.maxEvents ?? 8;
  const maxPerBucket = options.maxEventsPerBucket ?? 2;
  const maxProbes = options.maxResolutionProbesPerBook ?? 8;
  const mode = options.mode ?? (options.oddsByEventId ? 'fixture' : 'live');

  let startingRemaining: number | null = null;
  let endingRemaining: number | null = null;
  let observedCostSum = 0;
  let requestsRecorded = 0;

  let eventsList: OddsApiEventRaw[];
  if (options.eventsFixture) {
    eventsList = options.eventsFixture;
  } else if (options.client) {
    const res = await options.client.listNbaEvents();
    eventsList = res.data;
    startingRemaining = res.meta.remainingCredits;
    if (res.meta.requestsCost != null) {
      observedCostSum += res.meta.requestsCost;
      requestsRecorded += 1;
    }
    endingRemaining = res.meta.remainingCredits;
  } else {
    throw new Error('runLevel3Certification requires client or eventsFixture');
  }

  const selected = selectEventsForCertification(eventsList, now, maxEvents, maxPerBucket);
  const eventObservations: EventObservation[] = [];
  const oddsCache: Record<string, OddsApiEventRaw> = { ...(options.oddsByEventId ?? {}) };

  for (const ev of selected) {
    let payload = oddsCache[ev.id];
    let cost: number | null = null;

    if (!payload) {
      if (!options.client) {
        continue;
      }
      const books = SPORTSBOOK_HANDOFF_PROVIDERS.map(oddsApiBookmakerKey);
      const res = await options.client.getEventOdds({
        eventId: ev.id,
        markets: [...CERT_MARKETS],
        bookmakers: books,
        includeLinks: true,
        includeSids: true,
      });
      payload = res.data;
      oddsCache[ev.id] = payload;
      cost = res.meta.requestsCost;
      if (cost != null) {
        observedCostSum += cost;
        requestsRecorded += 1;
      }
      endingRemaining = res.meta.remainingCredits;
      if (startingRemaining == null) startingRemaining = res.meta.remainingCredits;
    }

    eventObservations.push(
      observeEvent({
        event: { ...ev, bookmakers: payload.bookmakers },
        now,
        requestCost: cost,
      })
    );
  }

  // Resolution probes via Phase 4A adapter + injected odds
  const resolutionProbes: ResolutionProbe[] = [];
  const probesPerBook = new Map<SportsbookHandoffProvider, number>();

  for (const evObs of eventObservations) {
    const payload = oddsCache[evObs.providerEventId];
    if (!payload) continue;

    for (const sportsbook of SPORTSBOOK_HANDOFF_PROVIDERS) {
      const count = probesPerBook.get(sportsbook) ?? 0;
      if (count >= maxProbes) continue;

      for (const marketKey of CERT_MARKETS) {
        if ((probesPerBook.get(sportsbook) ?? 0) >= maxProbes) break;
        const mObs = evObs.markets.find(
          (m) => m.sportsbook === sportsbook && m.marketKey === marketKey
        );
        if (!mObs || mObs.outcomes.length === 0) continue;

        // Prefer an allowlisted linked outcome; else first outcome.
        const outcome =
          mObs.outcomes.find((o) => o.hasLink && o.linkValidity?.allowlisted) ??
          mObs.outcomes[0]!;

        const leg = buildLegFromOutcome({
          event: payload,
          marketKey,
          playerName: outcome.playerName,
          side: outcome.side,
          line: outcome.line,
          oddsAmerican: outcome.oddsAmerican,
          sportsbook,
        });

        const bookKey = oddsApiBookmakerKey(sportsbook);
        const adapter = new OddsApiSelectionDeeplinkAdapter({
          eventsFixture: [payload],
          eventOddsFixtureByKey: {
            [`${payload.id}:${bookKey}:${marketKey}`]: payload,
          },
          now: () => now,
        });

        const home = teamNameToAbbreviation(payload.home_team);
        const away = teamNameToAbbreviation(payload.away_team);
        if (!home || !away) continue;

        const resolution = await adapter.resolveSelection({
          leg,
          sportsbook,
          game: {
            homeAbbreviation: home,
            awayAbbreviation: away,
            commenceTimeIso: payload.commence_time,
          },
        });

        resolutionProbes.push({
          sportsbook,
          marketKey,
          playerName: outcome.playerName,
          side: outcome.side,
          line: outcome.line,
          status: resolution.status,
          verifiedLevel: resolution.verifiedLevel,
          hasDeeplink: Boolean(resolution.deeplink),
          hasSelectionSid: Boolean(resolution.sportsbookSelectionId),
          allowlistOk: resolution.deeplink
            ? true
            : resolution.status === 'DEEPLINK_UNAVAILABLE'
              ? false
              : null,
        });

        probesPerBook.set(sportsbook, (probesPerBook.get(sportsbook) ?? 0) + 1);
      }
    }
  }

  // SID stability: second pass if provided or live re-fetch of first event with FanDuel props
  const sidStability: SidStabilityPair[] = [];
  const pass2 = options.oddsByEventIdPass2 ?? null;
  if (pass2) {
    for (const [eventId, payloadB] of Object.entries(pass2)) {
      const payloadA = oddsCache[eventId];
      if (!payloadA) continue;
      const obsA = observeEvent({ event: payloadA, now, requestCost: null });
      const obsB = observeEvent({
        event: payloadB,
        now: new Date(now.getTime() + 60_000),
        requestCost: null,
      });

      for (const sportsbook of SPORTSBOOK_HANDOFF_PROVIDERS) {
        for (const marketKey of CERT_MARKETS) {
          const a = obsA.markets.find(
            (m) => m.sportsbook === sportsbook && m.marketKey === marketKey
          );
          const b = obsB.markets.find(
            (m) => m.sportsbook === sportsbook && m.marketKey === marketKey
          );
          if (!a?.outcomes.length || !b?.outcomes.length) continue;
          const oa = a.outcomes[0]!;
          const ob = b.outcomes.find(
            (o) =>
              o.playerName === oa.playerName && o.side === oa.side && o.line === oa.line
          );
          if (!ob) continue;
          sidStability.push(
            buildSidStabilityPair({
              sportsbook,
              marketKey,
              playerName: oa.playerName,
              side: oa.side,
              line: oa.line,
              sampleA: {
                eventSid: a.eventSid,
                marketSid: a.marketSid,
                selectionSid: oa.selectionSid,
                oddsAmerican: oa.oddsAmerican,
                line: oa.line,
                deeplink: oa.hasLink
                  ? `https://${oa.linkValidity?.host ?? 'example.com'}/masked`
                  : null,
                at: now.toISOString(),
              },
              sampleB: {
                eventSid: b.eventSid,
                marketSid: b.marketSid,
                selectionSid: ob.selectionSid,
                oddsAmerican: ob.oddsAmerican,
                line: ob.line,
                deeplink: ob.hasLink
                  ? `https://${ob.linkValidity?.host ?? 'example.com'}/masked`
                  : null,
                at: new Date(now.getTime() + 60_000).toISOString(),
              },
            })
          );
        }
      }
    }
  } else if (options.client && eventObservations.length > 0) {
    // Live: re-fetch first event that had any FanDuel outcomes for stability sample
    const candidate = eventObservations.find((e) =>
      e.markets.some(
        (m) => m.sportsbook === 'fanduel' && m.outcomeCount > 0 && m.outcomesWithLink > 0
      )
    );
    if (candidate) {
      const res = await options.client.getEventOdds({
        eventId: candidate.providerEventId,
        markets: [...CERT_MARKETS],
        bookmakers: SPORTSBOOK_HANDOFF_PROVIDERS.map(oddsApiBookmakerKey),
        includeLinks: true,
        includeSids: true,
      });
      if (res.meta.requestsCost != null) {
        observedCostSum += res.meta.requestsCost;
        requestsRecorded += 1;
      }
      endingRemaining = res.meta.remainingCredits;

      const payloadA = oddsCache[candidate.providerEventId]!;
      const payloadB = res.data;
      const obsA = observeEvent({ event: payloadA, now, requestCost: null });
      const obsB = observeEvent({
        event: payloadB,
        now: new Date(now.getTime() + 30_000),
        requestCost: null,
      });

      for (const marketKey of CERT_MARKETS) {
        const a = obsA.markets.find(
          (m) => m.sportsbook === 'fanduel' && m.marketKey === marketKey
        );
        const b = obsB.markets.find(
          (m) => m.sportsbook === 'fanduel' && m.marketKey === marketKey
        );
        if (!a?.outcomes.length || !b?.outcomes.length) continue;
        const oa = a.outcomes.find((o) => o.hasLink) ?? a.outcomes[0]!;
        const ob = b.outcomes.find(
          (o) =>
            o.playerName === oa.playerName && o.side === oa.side && o.line === oa.line
        );
        if (!ob) continue;

        // Recover raw link shapes only as host from validity (already masked in pair builder)
        sidStability.push(
          buildSidStabilityPair({
            sportsbook: 'fanduel',
            marketKey,
            playerName: oa.playerName,
            side: oa.side,
            line: oa.line,
            sampleA: {
              eventSid: a.eventSid,
              marketSid: a.marketSid,
              selectionSid: oa.selectionSid,
              oddsAmerican: oa.oddsAmerican,
              line: oa.line,
              deeplink: oa.linkValidity?.urlShape ?? null,
              at: now.toISOString(),
            },
            sampleB: {
              eventSid: b.eventSid,
              marketSid: b.marketSid,
              selectionSid: ob.selectionSid,
              oddsAmerican: ob.oddsAmerican,
              line: ob.line,
              deeplink: ob.linkValidity?.urlShape ?? null,
              at: new Date(now.getTime() + 30_000).toISOString(),
            },
          })
        );
      }
    }
  }

  const report = aggregateCertificationReport({
    runTimestamp: now.toISOString(),
    mode,
    events: eventObservations,
    resolutionProbes,
    sidStability,
    credits: {
      startingRemaining,
      endingRemaining,
      observedCostSum,
      requestsRecorded,
    },
    priorProbeRunsByBook: {
      fanduel: 2, // Phase 4A live + this run
      draftkings: 2,
      caesars: 2,
      fanatics: 2,
      betmgm: 2,
      ...(options.priorProbeRunsByBook ?? {}),
    },
    paidTierNotes: [
      'Official The Odds API bookmaker table marks williamhill_us (Caesars) and fanatics as "Only available on paid subscriptions".',
      'DraftKings, FanDuel, and BetMGM are not marked paid-only in that table; absence of props may be posting timing.',
      'Do not conflate the-odds-api.com with theoddsapi.com pricing pages.',
    ],
    architectureNotes: [
      'Phase 4A SportsbookSelectionDeeplinkProvider boundary reused without redesign.',
      'Certification is read-only tooling; no production handoff changes; no DB writes.',
      'Level 4 multi-selection is not probed and remains unsupported.',
    ],
  });

  assertNoSecretsInReport(report);
  return report;
}
