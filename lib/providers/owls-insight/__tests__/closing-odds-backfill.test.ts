import { describe, expect, it, vi } from 'vitest';
import { InMemoryOwlsStore, buildOwlsArchiveKey, entityForEndpoint, sanitizeProviderGameId } from '../archive';
import { MemoryCheckpointStore } from '../checkpoint';
import { OwlsInsightClient } from '../client';
import { runOwlsClosingOddsBackfill } from '../closing-odds-backfill';
import { OWLS_ENTITY_CLOSING_ODDS, OWLS_PATHS } from '../contract';
import { flagClosingOddsBookRow, flagDuplicateBookSource } from '../closing-odds';
import { loadOwlsFixtures, FIXTURE_COURT_CONTEXT_GAMES } from '../fixtures';
import { reconcileOwlsClosingOddsBackfill } from '../reconcile';

describe('closing-odds backfill', () => {
  it('archives fixture closing odds under a distinct entity and resumes', async () => {
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
      runId: 'owls-fixture-closing',
      phase: 4,
      mode: 'fixture',
      games: FIXTURE_COURT_CONTEXT_GAMES,
      eventIds: { '1037995': { eventId, fromState: 'POPULATED' } },
      client,
      store,
      checkpoints,
      yes: true,
      gameConcurrency: 1,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(first.rows).toBe(2);
    expect(first.archivedKeys.every((k) => k.includes(`entity=${OWLS_ENTITY_CLOSING_ODDS}`))).toBe(true);
    expect(first.archivedKeys.every((k) => !k.includes('historical_player_props'))).toBe(true);
    expect(entityForEndpoint(OWLS_PATHS.historyClosingOdds)).toBe(OWLS_ENTITY_CLOSING_ODDS);
    expect(sanitizeProviderGameId(eventId)).toBe('nba:Boston_Celtics@Los_Angeles_Lakers-20231225');

    const state = await checkpoints.load('owls-fixture-closing');
    expect(state?.game_acquisition?.['1037995']?.state).toBe('POPULATED');
    expect(state?.run.endpoint).toBe('history_closing_odds');
    const recon = await reconcileOwlsClosingOddsBackfill({
      runId: 'owls-fixture-closing',
      state,
      store,
      universeGameIds: ['1037995'],
    });
    expect(recon.ok).toBe(true);

    const second = await runOwlsClosingOddsBackfill({
      runId: 'owls-fixture-closing',
      phase: 4,
      mode: 'fixture',
      games: FIXTURE_COURT_CONTEXT_GAMES,
      eventIds: { '1037995': { eventId, fromState: 'POPULATED' } },
      client,
      store,
      checkpoints,
      resume: true,
      yes: true,
      gameConcurrency: 1,
    });
    expect(second.skipped).toBeGreaterThan(0);
  });

  it('records GAME_MAPPING_FAILED without fetching when eventId is missing', async () => {
    const fetchImpl = vi.fn();
    const store = new InMemoryOwlsStore();
    const checkpoints = new MemoryCheckpointStore();
    const client = new OwlsInsightClient({
      mode: 'fixture',
      fixtures: loadOwlsFixtures(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await runOwlsClosingOddsBackfill({
      runId: 'owls-fixture-closing-unmap',
      phase: 4,
      mode: 'fixture',
      games: FIXTURE_COURT_CONTEXT_GAMES,
      eventIds: { '1037995': { eventId: null, fromState: 'GAME_MAPPING_FAILED' } },
      client,
      store,
      checkpoints,
      yes: true,
    });
    const state = await checkpoints.load('owls-fixture-closing-unmap');
    expect(state?.game_acquisition?.['1037995']?.state).toBe('GAME_MAPPING_FAILED');
    expect(fetchImpl).not.toHaveBeenCalled();
    const recon = await reconcileOwlsClosingOddsBackfill({
      runId: 'owls-fixture-closing-unmap',
      state,
      store,
      universeGameIds: ['1037995'],
    });
    expect(recon.ok).toBe(true);
  });

  it('flags research quality issues without rewriting rows', () => {
    const flags = flagClosingOddsBookRow({
      book: 'betmgm',
      source: 'archive-1',
      moneyline: { home: 155 },
      spread: { home: 4.5, away: -3.5, homePrice: -105 },
      total: { line: 234.5, overPrice: -115 },
    });
    expect(flags).toContain('MONEYLINE_MISSING_SIDE');
    expect(flags).toContain('SPREAD_HOME_NOT_NEGATIVE_AWAY');
    expect(flags).toContain('MISSING_SPREAD_PRICE');
    expect(flags).toContain('MISSING_TOTAL_PRICE');
    expect(
      flagDuplicateBookSource([
        { book: 'betmgm', source: 'archive-1' },
        { book: 'betmgm', source: 'archive-1' },
      ])
    ).toBe(1);
    expect(
      buildOwlsArchiveKey({
        season: '2023',
        entity: OWLS_ENTITY_CLOSING_ODDS,
        gameDate: '2023-12-25',
        providerGameId: 'x',
        pageIndex: 1,
      })
    ).not.toContain('historical_prop_snapshots');
  });
});
