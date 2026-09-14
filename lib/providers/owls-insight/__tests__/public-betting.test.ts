import { describe, expect, it, vi } from 'vitest';
import { InMemoryOwlsStore, entityForEndpoint } from '../archive';
import { MemoryCheckpointStore } from '../checkpoint';
import { OwlsInsightClient, extractRows } from '../client';
import { runOwlsClosingOddsBackfill } from '../closing-odds-backfill';
import { OWLS_ENTITY_PUBLIC_BETTING, OWLS_PATHS } from '../contract';
import { loadOwlsFixtures, FIXTURE_COURT_CONTEXT_GAMES } from '../fixtures';
import {
  PUBLIC_BETTING_HISTORY_TARGET,
  captureTimingClass,
  classifyPublicMarket,
  pickPercent,
  readLivePublicBettingRow,
  researchTicketMoney,
} from '../public-betting';
import { reconcileOwlsClosingOddsBackfill } from '../reconcile';

describe('public-betting research helpers', () => {
  it('never rewrites missing percentages to 0', () => {
    expect(pickPercent({}, ['betPercent', 'moneyPercent'])).toBeNull();
    expect(pickPercent({ betPercent: null }, ['betPercent'])).toBeNull();
    expect(pickPercent({ betPercent: '' }, ['betPercent'])).toBeNull();
    expect(researchTicketMoney({ market: 'spread', side: 'home', betPercent: 55 }).moneyPct).toBeNull();
    expect(researchTicketMoney({ market: 'spread', side: 'home', betPercent: 55 }).ticketMoneyGap).toBeNull();
    expect(researchTicketMoney({ betPercent: 0, moneyPercent: 0 }).betPct).toBe(0);
    expect(researchTicketMoney({ betPercent: 62.4, moneyPercent: 48.1 }).ticketMoneyGap).toBeCloseTo(-14.3);
    const liveZero = readLivePublicBettingRow({
      eventId: 'e1',
      gameDate: '2023-12-25T00:00:00.000Z',
      spread: { homePct: 0, awayPct: 0 },
      total: { overPct: 0, underPct: 0 },
    });
    expect(liveZero.spreadHomePct).toBe(0);
    expect(liveZero.allZeroSnapshot).toBe(true);
    expect(liveZero.hasMoneyShareField).toBe(false);
    expect(liveZero.hasMoneylineObject).toBe(false);
    expect(captureTimingClass({ gameDate: '2023-12-25T00:00:00.000Z' })).toBe('TIMING_UNKNOWN');
  });

  it('classifies common market labels without inventing extra markets', () => {
    expect(classifyPublicMarket('moneyline')).toBe('MONEYLINE');
    expect(classifyPublicMarket('spread')).toBe('SPREAD');
    expect(classifyPublicMarket('total')).toBe('TOTAL');
    expect(classifyPublicMarket('player_points')).toBe('OTHER');
  });
});

describe('public-betting backfill', () => {
  it('archives under historical_public_betting using the live betting[] wrapper', async () => {
    const fetchImpl = vi.fn();
    const store = new InMemoryOwlsStore();
    const checkpoints = new MemoryCheckpointStore();
    const client = new OwlsInsightClient({
      mode: 'fixture',
      fixtures: loadOwlsFixtures(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      historyConcurrency: 2,
    });
    const eventId = 'nba:Boston Celtics@Los Angeles Lakers-20231225';
    const first = await runOwlsClosingOddsBackfill({
      runId: 'owls-fixture-public',
      phase: 6,
      mode: 'fixture',
      games: FIXTURE_COURT_CONTEXT_GAMES,
      eventIds: { '1037995': { eventId, fromState: 'POPULATED' } },
      client,
      store,
      checkpoints,
      yes: true,
      gameConcurrency: 1,
      target: PUBLIC_BETTING_HISTORY_TARGET,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(first.rows).toBe(1);
    expect(first.archivedKeys.every((k) => k.includes(`entity=${OWLS_ENTITY_PUBLIC_BETTING}`))).toBe(true);
    expect(first.archivedKeys.every((k) => !k.includes('historical_closing_odds'))).toBe(true);
    expect(entityForEndpoint(OWLS_PATHS.historyPublicBetting)).toBe(OWLS_ENTITY_PUBLIC_BETTING);
    expect(extractRows(loadOwlsFixtures()[OWLS_PATHS.historyPublicBetting])).toHaveLength(1);

    const state = await checkpoints.load('owls-fixture-public');
    expect(state?.game_acquisition?.['1037995']?.state).toBe('POPULATED');
    expect(state?.run.endpoint).toBe('history_public_betting');
    const recon = await reconcileOwlsClosingOddsBackfill({
      runId: 'owls-fixture-public',
      state,
      store,
      universeGameIds: ['1037995'],
    });
    expect(recon.ok).toBe(true);
  });
});
