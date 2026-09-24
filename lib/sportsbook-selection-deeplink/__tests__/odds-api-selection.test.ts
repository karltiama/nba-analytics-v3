import { describe, expect, it } from 'vitest';
import type { CanonicalBetLeg } from '@/lib/bet-slip/types';
import { assertHandoffDestinationUrl, getVerifiedSportsbookHomeUrl } from '@/lib/sportsbook-handoff';
import { resolveSportsbookHandoff } from '@/lib/sportsbook-handoff/resolve-handoff';
import {
  isOddsApiPlayerPropMarketSupported,
  mapCanonicalPropToOddsApiMarket,
  matchNormalizedSelection,
  matchProviderEvent,
  OddsApiSelectionDeeplinkAdapter,
} from '../index';
import { FIXTURE_EVENTS, FIXTURE_GAME_CONTEXT, FIXTURE_EVENT_ID } from '../odds-api/fixtures/events';
import {
  FIXTURE_AMBIGUOUS_ALTERNATES,
  FIXTURE_BETMGM_EXACT,
  FIXTURE_CAESARS_EXACT,
  FIXTURE_DRAFTKINGS_EXACT,
  FIXTURE_FANATICS_EXACT,
  FIXTURE_FANDUEL_EXACT,
  FIXTURE_LINE_CHANGED,
  FIXTURE_MISSING_LINK,
  FIXTURE_UNSAFE_LINK,
  buildCoverageFixtureMap,
  oddsFixtureKey,
} from '../odds-api/fixtures/odds';
import { normalizeBookmakerMarket } from '../odds-api/normalize';

function sampleLeg(overrides: Partial<CanonicalBetLeg> = {}): CanonicalBetLeg {
  return {
    selectionKey: 'nba|g1|p1|points|over|28.5',
    sport: 'nba',
    gameId: 'cc-game-bos-mia',
    playerId: 'p-tatum',
    market: 'points',
    side: 'over',
    line: 28.5,
    playerName: 'Jayson Tatum',
    teamAbbreviation: 'BOS',
    opponentAbbreviation: 'MIA',
    gameLabel: 'BOS @ MIA',
    selectedSportsbook: 'fanduel',
    selectedOdds: -110,
    selectedAt: '2026-10-21T12:00:00.000Z',
    ...overrides,
  };
}

function adapterWithOdds(odds: Record<string, (typeof FIXTURE_FANDUEL_EXACT)>) {
  return new OddsApiSelectionDeeplinkAdapter({
    eventsFixture: FIXTURE_EVENTS,
    eventOddsFixtureByKey: odds,
    now: () => new Date('2026-10-21T18:00:00.000Z'),
  });
}

describe('Odds API market mapping', () => {
  it('maps required Court Context prop types to documented Odds API keys', () => {
    expect(mapCanonicalPropToOddsApiMarket('points')).toBe('player_points');
    expect(mapCanonicalPropToOddsApiMarket('rebounds')).toBe('player_rebounds');
    expect(mapCanonicalPropToOddsApiMarket('assists')).toBe('player_assists');
    expect(mapCanonicalPropToOddsApiMarket('threes')).toBe('player_threes');
    expect(mapCanonicalPropToOddsApiMarket('points_rebounds_assists')).toBe(
      'player_points_rebounds_assists'
    );
    expect(isOddsApiPlayerPropMarketSupported('points')).toBe(true);
  });
});

describe('event matching', () => {
  it('matches exact home/away abbreviations + commence within tolerance', () => {
    const result = matchProviderEvent({
      game: FIXTURE_GAME_CONTEXT,
      events: FIXTURE_EVENTS.map((e) => ({
        providerEventId: e.id,
        homeTeam: e.home_team,
        awayTeam: e.away_team,
        commenceTimeIso: e.commence_time,
      })),
    });
    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.event.providerEventId).toBe(FIXTURE_EVENT_ID);
    }
  });

  it('does not match wrong game', () => {
    const result = matchProviderEvent({
      game: {
        homeAbbreviation: 'LAL',
        awayAbbreviation: 'BOS',
        commenceTimeIso: FIXTURE_GAME_CONTEXT.commenceTimeIso,
      },
      events: FIXTURE_EVENTS.map((e) => ({
        providerEventId: e.id,
        homeTeam: e.home_team,
        awayTeam: e.away_team,
        commenceTimeIso: e.commence_time,
      })),
    });
    expect(result.status).toBe('not_found');
  });
});

describe('selection matching', () => {
  const snapshot = normalizeBookmakerMarket({
    event: FIXTURE_FANDUEL_EXACT,
    bookmakerKey: 'fanduel',
    marketKey: 'player_points',
  })!;

  it('exact match on player/market/side/line', () => {
    const result = matchNormalizedSelection(snapshot, {
      playerName: 'Jayson Tatum',
      side: 'over',
      line: 28.5,
    });
    expect(result.status).toBe('EXACT');
    if (result.status === 'EXACT') {
      expect(result.outcome.selectionSid).toBe('29165');
      expect(result.outcome.link).toContain('addToBetslip');
    }
  });

  it('uses under outcome for under side', () => {
    const result = matchNormalizedSelection(snapshot, {
      playerName: 'Jayson Tatum',
      side: 'under',
      line: 28.5,
    });
    expect(result.status).toBe('EXACT');
    if (result.status === 'EXACT') {
      expect(result.outcome.selectionSid).toBe('29178');
    }
  });

  it('returns LINE_CHANGED when only one clear main line differs', () => {
    const changed = normalizeBookmakerMarket({
      event: FIXTURE_LINE_CHANGED,
      bookmakerKey: 'fanduel',
      marketKey: 'player_points',
    })!;
    const result = matchNormalizedSelection(changed, {
      playerName: 'Jayson Tatum',
      side: 'over',
      line: 28.5,
    });
    expect(result.status).toBe('LINE_CHANGED');
    if (result.status === 'LINE_CHANGED') {
      expect(result.currentLine).toBe(29.5);
    }
  });

  it('does not arbitrarily pick among multiple alternate lines', () => {
    const alt = normalizeBookmakerMarket({
      event: FIXTURE_AMBIGUOUS_ALTERNATES,
      bookmakerKey: 'fanduel',
      marketKey: 'player_points',
    })!;
    const result = matchNormalizedSelection(alt, {
      playerName: 'Jayson Tatum',
      side: 'over',
      line: 28.5,
    });
    expect(result.status).toBe('NOT_FOUND');
    if (result.status === 'NOT_FOUND') {
      expect(result.reason).toBe('ambiguous_alternate_lines');
    }
  });

  it('wrong player → NOT_FOUND', () => {
    const result = matchNormalizedSelection(snapshot, {
      playerName: 'Jaylen Brown',
      side: 'over',
      line: 28.5,
    });
    expect(result.status).toBe('NOT_FOUND');
  });
});

describe('OddsApiSelectionDeeplinkAdapter', () => {
  it('resolves EXACT FanDuel selection with provider link + sportsbook SIDs', async () => {
    const adapter = adapterWithOdds({
      [oddsFixtureKey(FIXTURE_EVENT_ID, 'fanduel', 'player_points')]: FIXTURE_FANDUEL_EXACT,
    });
    const result = await adapter.resolveSelection({
      leg: sampleLeg(),
      sportsbook: 'fanduel',
      game: FIXTURE_GAME_CONTEXT,
    });
    expect(result.status).toBe('EXACT');
    expect(result.verifiedLevel).toBe(3);
    expect(result.sportsbookEventId).toBe('fd_evt_33617147');
    expect(result.sportsbookMarketId).toBe('42.448600011');
    expect(result.sportsbookSelectionId).toBe('29165');
    expect(result.deeplink).toContain('sportsbook.fanduel.com/addToBetslip');
    expect(result.sportsbookEventId).not.toBe(sampleLeg().gameId);
  });

  it('LINE_CHANGED does not return original-line deeplink as EXACT', async () => {
    const adapter = adapterWithOdds({
      [oddsFixtureKey(FIXTURE_EVENT_ID, 'fanduel', 'player_points')]: FIXTURE_LINE_CHANGED,
    });
    const result = await adapter.resolveSelection({
      leg: sampleLeg({ line: 28.5 }),
      sportsbook: 'fanduel',
      game: FIXTURE_GAME_CONTEXT,
    });
    expect(result.status).toBe('LINE_CHANGED');
    expect(result.currentLine).toBe(29.5);
    expect(result.deeplink).toBeNull();
  });

  it('wrong game → NOT_FOUND', async () => {
    const adapter = adapterWithOdds({
      [oddsFixtureKey(FIXTURE_EVENT_ID, 'fanduel', 'player_points')]: FIXTURE_FANDUEL_EXACT,
    });
    const result = await adapter.resolveSelection({
      leg: sampleLeg(),
      sportsbook: 'fanduel',
      game: {
        homeAbbreviation: 'LAL',
        awayAbbreviation: 'GSW',
        commenceTimeIso: FIXTURE_GAME_CONTEXT.commenceTimeIso,
      },
    });
    // LAL/GSW exists in fixtures but odds map is empty for that event → event matched then odds miss
    // Use a game that is not in FIXTURE_EVENTS at all:
    const missing = await adapter.resolveSelection({
      leg: sampleLeg(),
      sportsbook: 'fanduel',
      game: {
        homeAbbreviation: 'NYK',
        awayAbbreviation: 'BOS',
        commenceTimeIso: FIXTURE_GAME_CONTEXT.commenceTimeIso,
      },
    });
    expect(missing.status).toBe('NOT_FOUND');
    expect(missing.notes).toBe('event_not_found');
    expect(result.status).toBe('NOT_FOUND');
  });

  it('wrong market → UNSUPPORTED or NOT_FOUND path is explicit', async () => {
    // All canonical markets are mapped; simulate unsupported via casting if needed.
    // blocks is supported — use resolve with missing odds market instead.
    const adapter = adapterWithOdds({});
    const result = await adapter.resolveSelection({
      leg: sampleLeg({ market: 'rebounds', selectionKey: 'x' }),
      sportsbook: 'fanduel',
      game: FIXTURE_GAME_CONTEXT,
    });
    expect(result.status).toBe('NOT_FOUND');
  });

  it('missing deeplink → DEEPLINK_UNAVAILABLE with SID retained', async () => {
    const adapter = adapterWithOdds({
      [oddsFixtureKey(FIXTURE_EVENT_ID, 'fanduel', 'player_points')]: FIXTURE_MISSING_LINK,
    });
    const result = await adapter.resolveSelection({
      leg: sampleLeg(),
      sportsbook: 'fanduel',
      game: FIXTURE_GAME_CONTEXT,
    });
    expect(result.status).toBe('DEEPLINK_UNAVAILABLE');
    expect(result.sportsbookSelectionId).toBe('sel_nolink');
    expect(result.deeplink).toBeNull();
  });

  it('unsafe host → DEEPLINK_UNAVAILABLE (allowlist not weakened)', async () => {
    const adapter = adapterWithOdds({
      [oddsFixtureKey(FIXTURE_EVENT_ID, 'fanduel', 'player_points')]: FIXTURE_UNSAFE_LINK,
    });
    const result = await adapter.resolveSelection({
      leg: sampleLeg(),
      sportsbook: 'fanduel',
      game: FIXTURE_GAME_CONTEXT,
    });
    expect(result.status).toBe('DEEPLINK_UNAVAILABLE');
    expect(result.notes).toMatch(/unsafe_deeplink_host/);
    expect(assertHandoffDestinationUrl('https://evil.example.com/x').ok).toBe(false);
  });

  it('covers all five sportsbooks at Level 3 with fixture links', async () => {
    const adapter = new OddsApiSelectionDeeplinkAdapter({
      eventsFixture: FIXTURE_EVENTS,
      eventOddsFixtureByKey: buildCoverageFixtureMap(),
      now: () => new Date('2026-10-21T18:00:00.000Z'),
    });

    const books = [
      'draftkings',
      'fanduel',
      'caesars',
      'fanatics',
      'betmgm',
    ] as const;

    for (const sportsbook of books) {
      const result = await adapter.resolveSelection({
        leg: sampleLeg(),
        sportsbook,
        game: FIXTURE_GAME_CONTEXT,
      });
      expect(result.status, sportsbook).toBe('EXACT');
      expect(result.verifiedLevel, sportsbook).toBe(3);
      expect(result.deeplink, sportsbook).toBeTruthy();
      expect(result.sportsbookSelectionId, sportsbook).toBeTruthy();
      expect(assertHandoffDestinationUrl(result.deeplink!).ok, sportsbook).toBe(true);
    }

    // Explicit fixtures exist for documentation / coverage spike.
    expect(FIXTURE_DRAFTKINGS_EXACT.bookmakers?.[0]?.key).toBe('draftkings');
    expect(FIXTURE_CAESARS_EXACT.bookmakers?.[0]?.key).toBe('williamhill_us');
    expect(FIXTURE_FANATICS_EXACT.bookmakers?.[0]?.key).toBe('fanatics');
    expect(FIXTURE_BETMGM_EXACT.bookmakers?.[0]?.key).toBe('betmgm');
  });
});

describe('Phase 3 homepage fallback remains functional', () => {
  it('resolveSportsbookHandoff still returns verified homepage', () => {
    const dest = resolveSportsbookHandoff({ sportsbook: 'fanduel' });
    expect(dest.level).toBe('sportsbook');
    expect(dest.url).toBe(getVerifiedSportsbookHomeUrl('fanduel'));
    expect(dest.verified).toBe(true);
  });
});
