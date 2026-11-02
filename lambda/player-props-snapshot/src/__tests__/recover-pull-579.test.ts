import { describe, expect, it } from 'vitest';
import { InMemoryArchiveStore } from '../player-prop-snapshot-archive';
import {
  PULL_579_ARCHIVE_SUCCESS_SQL,
  PULL_579_RECOVERY,
  buildArchiveRecovery,
  writeRecoveredArchive,
  type RawSnapshotRecoveryRow,
} from '../recover-pull-579';

function raw(overrides: Partial<RawSnapshotRecoveryRow> = {}): RawSnapshotRecoveryRow {
  return {
    game_id: 21717922,
    player_id: 77,
    player_name: 'Player',
    team_id: 14,
    sportsbook: 'draftkings',
    prop_type: 'points',
    market_type: 'over_under',
    side: 'over',
    line_value: '27.5',
    odds_american: -110,
    odds_decimal: '1.91',
    implied_probability: '0.524',
    raw_json: null,
    provider_updated_at: '2026-10-21T19:00:00.000Z',
    observed_at: '2026-10-21T19:51:49.799Z',
    controller_enqueued_at: PULL_579_RECOVERY.snapshotAt,
    ...overrides,
  };
}

describe('pull 579 archive recovery', () => {
  it('rebuilds the historical key from the preserved controller clock and does not put when the count differs', async () => {
    const built = buildArchiveRecovery({
      rows: [raw()],
      expectedRows: 1,
      pullRunId: PULL_579_RECOVERY.pullRunId,
      gameId: PULL_579_RECOVERY.gameId,
      bdlGameId: PULL_579_RECOVERY.bdlGameId,
      gameDate: PULL_579_RECOVERY.gameDate,
      season: PULL_579_RECOVERY.season,
      gameStartTime: '2026-10-21T23:00:00.000Z',
    });
    expect(built.key).toBe(
      'raw/source=balldontlie/league=nba/season=2026/entity=player_prop_snapshots/game_date=2026-10-21/game_id=21717922/snapshot_at=2026-10-21T19-51-47Z__pull=579.json.gz'
    );
    expect(built.envelope.row_count).toBe(1);
    expect(built.envelope.observation_clock).toBe('RESPONSE_RECEIVED');
    expect(built.envelope.rows[0]?.line_value).toBe(27.5);

    const store = new InMemoryArchiveStore();
    await expect(
      writeRecoveredArchive({
        store,
        rows: [raw()],
        expectedRows: PULL_579_RECOVERY.expectedRawRows,
        pullRunId: PULL_579_RECOVERY.pullRunId,
        gameId: PULL_579_RECOVERY.gameId,
        bdlGameId: PULL_579_RECOVERY.bdlGameId,
        gameDate: PULL_579_RECOVERY.gameDate,
        season: PULL_579_RECOVERY.season,
        gameStartTime: '2026-10-21T23:00:00.000Z',
      })
    ).rejects.toThrow(/expected 3043 raw rows, found 1/);
    expect(store.objects.size).toBe(0);
  });

  it('writes one object and leaves the failure predicate in the bookkeeping update', async () => {
    const store = new InMemoryArchiveStore();
    const written = await writeRecoveredArchive({
      store,
      rows: [raw(), raw({ side: 'under', player_id: 78 })],
      expectedRows: 2,
      pullRunId: PULL_579_RECOVERY.pullRunId,
      gameId: PULL_579_RECOVERY.gameId,
      bdlGameId: PULL_579_RECOVERY.bdlGameId,
      gameDate: PULL_579_RECOVERY.gameDate,
      season: PULL_579_RECOVERY.season,
      gameStartTime: '2026-10-21T23:00:00.000Z',
    });
    expect(written.outcome.ok && written.outcome.result).toBe('written');
    expect(store.objects.size).toBe(1);
    expect(PULL_579_ARCHIVE_SUCCESS_SQL).toContain("archive_status = 'failed'");
    expect(PULL_579_ARCHIVE_SUCCESS_SQL).toContain("archive_error = 'UnknownError'");
    expect(PULL_579_ARCHIVE_SUCCESS_SQL).toContain('provider_attempts = 1');
  });
});
