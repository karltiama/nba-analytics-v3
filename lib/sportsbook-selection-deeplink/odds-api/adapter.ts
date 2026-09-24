/**
 * The Odds API implementation of SportsbookSelectionDeeplinkProvider (Phase 4A spike).
 * Prefer fixture/injected event odds in tests; live client is optional and removable.
 */

import { assertHandoffDestinationUrl } from '@/lib/sportsbook-handoff/allowlist';
import type { SportsbookHandoffProvider } from '@/lib/sportsbook-handoff/types';
import { DEFAULT_SPIKE_CACHE_TTL_MS, TtlCache } from '../cache';
import {
  matchProviderEvent,
  resolveGameMatchContext,
  type ProviderEventCandidate,
} from '../event-match';
import { mapCanonicalPropToOddsApiMarket } from '../market-map';
import { matchNormalizedSelection } from '../match-selection';
import type {
  ResolveSelectionInput,
  SportsbookSelectionDeeplinkProvider,
  SportsbookSelectionResolution,
} from '../types';
import { oddsApiBookmakerKey } from './bookmaker-map';
import type { OddsApiClient } from './client';
import { normalizeBookmakerMarket } from './normalize';
import type { OddsApiEventRaw } from './types';

export type OddsApiSelectionAdapterOptions = {
  /** Live client — omit for fixture-only / no-key environments. */
  client?: OddsApiClient | null;
  /** Inject event list for tests (skips listNbaEvents). */
  eventsFixture?: OddsApiEventRaw[] | null;
  /**
   * Inject per-event odds payloads keyed by `${eventId}:${bookmaker}:${market}`.
   * When set, getEventOdds is not called.
   */
  eventOddsFixtureByKey?: Record<string, OddsApiEventRaw> | null;
  /** Tip-time tolerance override (ms). */
  commenceToleranceMs?: number;
  cacheTtlMs?: number;
  now?: () => Date;
};

function emptyResolution(
  sportsbook: SportsbookHandoffProvider,
  status: SportsbookSelectionResolution['status'],
  now: Date,
  notes?: string
): SportsbookSelectionResolution {
  return {
    status,
    sportsbook,
    verifiedLevel: 0,
    resolvedAt: now.toISOString(),
    notes,
  };
}

function fixtureOddsKey(eventId: string, bookmaker: string, market: string): string {
  return `${eventId}:${bookmaker}:${market}`;
}

export class OddsApiSelectionDeeplinkAdapter implements SportsbookSelectionDeeplinkProvider {
  private readonly client: OddsApiClient | null;
  private readonly eventsFixture: OddsApiEventRaw[] | null;
  private readonly eventOddsFixtureByKey: Record<string, OddsApiEventRaw> | null;
  private readonly commenceToleranceMs: number | undefined;
  private readonly now: () => Date;
  private readonly eventsCache: TtlCache<OddsApiEventRaw[]>;
  private readonly oddsCache: TtlCache<OddsApiEventRaw>;

  constructor(options: OddsApiSelectionAdapterOptions = {}) {
    this.client = options.client ?? null;
    this.eventsFixture = options.eventsFixture ?? null;
    this.eventOddsFixtureByKey = options.eventOddsFixtureByKey ?? null;
    this.commenceToleranceMs = options.commenceToleranceMs;
    this.now = options.now ?? (() => new Date());
    const ttl = options.cacheTtlMs ?? DEFAULT_SPIKE_CACHE_TTL_MS;
    this.eventsCache = new TtlCache(ttl);
    this.oddsCache = new TtlCache(ttl);
  }

  async resolveSelection(input: ResolveSelectionInput): Promise<SportsbookSelectionResolution> {
    const now = this.now();
    const { leg, sportsbook } = input;

    const marketKey = mapCanonicalPropToOddsApiMarket(leg.market);
    if (!marketKey) {
      return emptyResolution(sportsbook, 'UNSUPPORTED_MARKET', now, 'canonical_market_unmapped');
    }

    const game = resolveGameMatchContext({
      game: input.game,
      gameLabel: leg.gameLabel,
      // Spike: tip time must come from explicit game context when label-only.
      commenceTimeIso: input.game?.commenceTimeIso ?? null,
      teamAbbreviation: leg.teamAbbreviation,
      opponentAbbreviation: leg.opponentAbbreviation,
    });

    if (!game) {
      return emptyResolution(sportsbook, 'NOT_FOUND', now, 'missing_game_match_context');
    }

    const events = await this.loadEvents();
    const candidates: ProviderEventCandidate[] = events.map((e) => ({
      providerEventId: e.id,
      homeTeam: e.home_team,
      awayTeam: e.away_team,
      commenceTimeIso: e.commence_time,
    }));

    const matched = matchProviderEvent({
      game,
      events: candidates,
      toleranceMs: this.commenceToleranceMs,
    });

    if (matched.status === 'not_found') {
      return emptyResolution(sportsbook, 'NOT_FOUND', now, 'event_not_found');
    }
    if (matched.status === 'ambiguous') {
      return emptyResolution(sportsbook, 'NOT_FOUND', now, 'event_ambiguous');
    }

    const bookmaker = oddsApiBookmakerKey(sportsbook);
    const eventOdds = await this.loadEventOdds({
      eventId: matched.event.providerEventId,
      bookmaker,
      market: marketKey,
    });

    if (!eventOdds) {
      return emptyResolution(sportsbook, 'NOT_FOUND', now, 'event_odds_unavailable');
    }

    const snapshot = normalizeBookmakerMarket({
      event: eventOdds,
      bookmakerKey: bookmaker,
      marketKey,
    });

    if (!snapshot) {
      return emptyResolution(sportsbook, 'NOT_FOUND', now, 'bookmaker_or_market_missing');
    }

    const match = matchNormalizedSelection(snapshot, {
      playerName: leg.playerName,
      side: leg.side,
      line: leg.line,
    });

    if (match.status === 'NOT_FOUND') {
      return emptyResolution(sportsbook, 'NOT_FOUND', now, match.reason);
    }

    const outcome = match.outcome;
    const base: SportsbookSelectionResolution = {
      status: match.status === 'EXACT' ? 'EXACT' : 'LINE_CHANGED',
      sportsbook,
      currentLine: match.status === 'LINE_CHANGED' ? match.currentLine : outcome.line,
      currentOdds: outcome.oddsAmerican,
      sportsbookEventId: match.eventSid,
      sportsbookMarketId: match.marketSid,
      sportsbookSelectionId: outcome.selectionSid,
      deeplink: null,
      verifiedLevel: 0,
      resolvedAt: now.toISOString(),
    };

    if (match.status === 'LINE_CHANGED') {
      // Line changed: do not claim a safe selection deeplink for the original line.
      // Still report SIDs/odds for the *current* main line for diagnostics.
      base.notes = 'line_changed_no_original_selection_deeplink';
      base.verifiedLevel = match.eventSid ? 1 : 0;
      return base;
    }

    const link = outcome.link?.trim() || null;
    if (!link) {
      return {
        ...base,
        status: 'DEEPLINK_UNAVAILABLE',
        deeplink: null,
        verifiedLevel: outcome.selectionSid ? 3 : match.marketSid ? 2 : match.eventSid ? 1 : 0,
        notes: 'exact_selection_missing_provider_link',
      };
    }

    const asserted = assertHandoffDestinationUrl(link);
    if (!asserted.ok) {
      return {
        ...base,
        status: 'DEEPLINK_UNAVAILABLE',
        deeplink: null,
        verifiedLevel: 0,
        notes: `unsafe_deeplink_host:${asserted.reason}`,
      };
    }

    return {
      ...base,
      status: 'EXACT',
      deeplink: asserted.url.toString(),
      verifiedLevel: 3,
      notes: 'provider_generated_selection_link',
    };
  }

  private async loadEvents(): Promise<OddsApiEventRaw[]> {
    if (this.eventsFixture) return this.eventsFixture;

    const cached = this.eventsCache.get('nba-events');
    if (cached) return cached;

    if (!this.client) {
      throw new Error('OddsApiSelectionDeeplinkAdapter: no client and no eventsFixture');
    }

    const { data } = await this.client.listNbaEvents();
    this.eventsCache.set('nba-events', data);
    return data;
  }

  private async loadEventOdds(input: {
    eventId: string;
    bookmaker: string;
    market: string;
  }): Promise<OddsApiEventRaw | null> {
    const key = fixtureOddsKey(input.eventId, input.bookmaker, input.market);

    if (this.eventOddsFixtureByKey) {
      return this.eventOddsFixtureByKey[key] ?? null;
    }

    const cached = this.oddsCache.get(key);
    if (cached) return cached;

    if (!this.client) {
      throw new Error('OddsApiSelectionDeeplinkAdapter: no client and no eventOddsFixtureByKey');
    }

    const { data } = await this.client.getEventOdds({
      eventId: input.eventId,
      markets: [input.market],
      bookmakers: [input.bookmaker],
      includeLinks: true,
      includeSids: true,
    });

    this.oddsCache.set(key, data);
    return data;
  }
}
