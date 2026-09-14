import { describe, expect, it, vi } from 'vitest';
import { InMemoryOwlsStore, buildOwlsArchiveKey, isProtectedOwlsKey, readOwlsEnvelope } from '../archive';
import { runOwlsPropBackfill, normalizeOwlsArchiveOffline } from '../backfill';
import { MemoryCheckpointStore } from '../checkpoint';
import { OwlsInsightClient } from '../client';
import { OWLS_PATHS } from '../contract';
import { FIXTURE_COURT_CONTEXT_GAMES, loadOwlsFixtures } from '../fixtures';
import { matchOwlsPlayer } from '../mapping';
import { attachArchiveKey, normalizePayloadRows } from '../normalize';
import { planOwlsPropBackfill } from '../planner';
import { reconcileOwlsPropBackfill } from '../reconcile';
import { FIXTURE_PLAYERS } from '../fixtures';
import { OwlsExecuteRequiredError } from '../errors';

describe('planner', () => {
  it('plans without touching fetch', () => {
    const fetchImpl = vi.fn();
    const plan = planOwlsPropBackfill({ games: FIXTURE_COURT_CONTEXT_GAMES, season: '2023' });
    expect(plan.courtContextGames).toBe(1);
    expect(plan.estimatedRuntime).toMatch(/unknown until live probe/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('fixture pipeline', () => {
  it('archives then normalizes, maps, checkpoints, and resumes', async () => {
    const store = new InMemoryOwlsStore();
    const checkpoints = new MemoryCheckpointStore();
    const client = new OwlsInsightClient({
      mode: 'fixture',
      fixtures: loadOwlsFixtures(),
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const first = await runOwlsPropBackfill({
      runId: 'owls-fixture-pipeline',
      phase: 0,
      mode: 'fixture',
      games: FIXTURE_COURT_CONTEXT_GAMES,
      client,
      store,
      checkpoints,
      yes: true,
      logger: () => undefined,
      normalize: true,
    });
    expect(first.pages).toBeGreaterThan(0);
    expect(first.archivedKeys.length).toBeGreaterThan(0);
    expect(first.archivedKeys.every((k) => k.includes('owls_insight_fixture'))).toBe(true);
    expect(first.archivedKeys.every((k) => !isProtectedOwlsKey(k))).toBe(true);

    const key = first.archivedKeys.find((k) => k.includes('historical_player_props'));
    expect(key).toBeTruthy();
    const envelope = await readOwlsEnvelope(store, key!);
    const rows = attachArchiveKey(
      normalizePayloadRows({
        envelope,
        courtContextGameId: '1037995',
        gameMatch: 'MATCHED',
        playerResolver: (rec) => {
          const name = String(rec.player ?? rec.playerName ?? '');
          const mapped = matchOwlsPlayer({
            providerPlayerName: name,
            providerPlayerId: typeof rec.playerId === 'string' ? rec.playerId : null,
            index: FIXTURE_PLAYERS,
          });
          return { courtContextPlayerId: mapped.courtContextPlayerId, playerMatch: mapped.status };
        },
      }),
      key!
    );
    expect(rows.some((r) => r.court_context_prop === 'PTS')).toBe(true);
    expect(rows.some((r) => r.court_context_prop === '3PM')).toBe(true);
    expect(rows.every((r) => r.snapshot_type === 'closing_archive')).toBe(true);
    expect(rows.find((r) => r.prop_type === 'points')?.opening_line).toBe(25.5);
    expect(rows.find((r) => r.prop_type === 'points')?.closing_line).toBe(24.5);
    expect(rows.every((r) => r.source_archive_key === key)).toBe(true);

    const state = await checkpoints.load('owls-fixture-pipeline');
    expect(state).toBeTruthy();
    expect(Object.values(state!.units).some((u) => u.status === 'ARCHIVED' || u.status === 'NORMALIZED')).toBe(true);

    const second = await runOwlsPropBackfill({
      runId: 'owls-fixture-pipeline',
      phase: 0,
      mode: 'fixture',
      games: FIXTURE_COURT_CONTEXT_GAMES,
      client,
      store,
      checkpoints,
      resume: true,
      yes: true,
    });
    expect(second.skipped).toBeGreaterThan(0);

    const offline = await normalizeOwlsArchiveOffline({
      store,
      prefix: 'raw/source=owls_insight_fixture/',
    });
    expect(offline.rows).toBeGreaterThan(0);

    const reconcile = await reconcileOwlsPropBackfill({
      runId: 'owls-fixture-pipeline',
      state,
      store,
    });
    expect(reconcile.ok).toBe(true);
  });

  it('fails reconciliation when a required object is missing', async () => {
    const store = new InMemoryOwlsStore();
    const report = await reconcileOwlsPropBackfill({
      runId: 'missing',
      state: {
        run: {
          run_id: 'missing',
          started_at: '2026-09-14T00:00:00.000Z',
          completed_at: null,
          phase: 0,
          mode: 'fixture',
          target_seasons: ['2023'],
          endpoint: 'history_player_props',
          games_attempted: 1,
          games_completed: 0,
          requests_attempted: 1,
          requests_successful: 1,
          requests_retried: 0,
          status_429: 0,
          status_503: 0,
          rows: 1,
          failures: 0,
          s3_objects: 1,
          mapping_matched: 1,
          mapping_ambiguous: 0,
          mapping_unmatched: 0,
        },
        units: {
          u1: {
            unit_id: 'u1',
            endpoint: 'history_player_props',
            provider_game_id: 'e',
            court_context_game_id: '1037995',
            season: '2023',
            game_date: '2023-12-25',
            page_index: 1,
            offset: 0,
            limit: 100,
            status: 'ARCHIVED',
            archive_key: buildOwlsArchiveKey({
              fixture: true,
              season: '2023',
              entity: 'historical_player_props',
              gameDate: '2023-12-25',
              providerGameId: 'missing-event',
              pageIndex: 1,
            }),
            checksum: 'abc',
            row_count: 1,
            error: null,
            updated_at: '2026-09-14T00:00:00.000Z',
          },
        },
      },
      store,
    });
    expect(report.ok).toBe(false);
    expect(report.missing.length).toBeGreaterThan(0);
  });

  it('does not run backfill fetch in dry-run', async () => {
    await expect(
      runOwlsPropBackfill({
        runId: 'dry',
        phase: 0,
        mode: 'dry-run',
        games: FIXTURE_COURT_CONTEXT_GAMES,
        client: new OwlsInsightClient({ mode: 'dry-run' }),
        store: new InMemoryOwlsStore(),
        checkpoints: new MemoryCheckpointStore(),
      })
    ).rejects.toBeInstanceOf(OwlsExecuteRequiredError);
  });
});

describe('live nested quotes', () => {
  it('reads opening/closing objects from the live /history/player-props shape', () => {
    const rows = normalizePayloadRows({
      envelope: {
        schema: 'owls_historical_player_props.v1',
        provider: 'owls_insight',
        backfill_run_id: 'owls-2026-09-14-probe',
        requested_at: '2026-09-14T16:58:46.000Z',
        archived_at: '2026-09-14T16:58:46.000Z',
        request: {
          method: 'GET',
          path: OWLS_PATHS.historyPlayerProps,
          query: { eventId: 'nba:Boston Celtics@Los Angeles Lakers-20231225' },
        },
        response_metadata: { status: 200, headers: {}, durationMs: 1 },
        row_count: 1,
        checksum: 'x',
        page_index: 1,
        offset: 0,
        limit: 100,
        provider_game_id: 'nba:Boston Celtics@Los Angeles Lakers-20231225',
        season: '2023',
        game_date: '2023-12-25',
        fixture: false,
        payload: {
          success: true,
          data: {
            props: [
              {
                eventId: 'nba:Boston Celtics@Los Angeles Lakers-20231225',
                sport: 'nba',
                playerName: 'Al Horford',
                propType: 'threes',
                book: 'betmgm',
                gameDate: '2023-12-25T00:00:00.000Z',
                closing: { line: 1.5, overPrice: -130, underPrice: 110, americanPrice: null },
                opening: { line: 2.5, overPrice: -110, underPrice: -110, americanPrice: null },
              },
            ],
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        },
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.court_context_prop).toBe('3PM');
    expect(rows[0]?.provider_player_name).toBe('Al Horford');
    expect(rows[0]?.opening_line).toBe(2.5);
    expect(rows[0]?.closing_line).toBe(1.5);
    expect(rows[0]?.american_odds).toBe(-130);
    expect(rows[0]?.opening_price).toBe(-110);
    expect(rows[0]?.closing_price).toBe(-130);
    expect(rows[1]?.side).toBe('under');
    expect(rows[1]?.american_odds).toBe(110);
  });
});

describe('S3 key determinism', () => {
  it('uses the documented history/player-props path only', () => {
    expect(OWLS_PATHS.historyPlayerProps).toBe('/api/v1/history/player-props');
    expect(OWLS_PATHS.historyProps).toBe('/api/v1/history/props');
    expect(OWLS_PATHS.historyGames).toBe('/api/v1/history/games');
  });
});
