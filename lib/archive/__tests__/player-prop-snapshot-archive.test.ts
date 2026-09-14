import { describe, expect, it } from 'vitest';
import {
  InMemoryArchiveStore,
  LEGACY_PROTECTED_PREFIX,
  archiveSuccessInvariant,
  buildArchiveEnvelope,
  buildPlayerPropSnapshotArchiveKey,
  classifySnapshotTiming,
  compactUtcTimestamp,
  decideIdempotentWrite,
  filterPregameRows,
  gunzipEnvelope,
  gzipEnvelope,
  isProtectedHistoricalKey,
  isValidPregameResearchSnapshot,
  mayPruneRawSnapshot,
  nbaSeasonStartYearFromGameDate,
  rowsFromNormalized,
  writeArchiveObject,
  type NormalizedPropLike,
} from '@/lib/archive/player-prop-snapshot-archive';

function norm(partial: Partial<NormalizedPropLike> = {}): NormalizedPropLike {
  return {
    game_id: 12345,
    player_id: 77,
    player_name: 'Luka Doncic',
    team_id: 14,
    sportsbook: 'draftkings',
    prop_type: 'points',
    market_type: 'over_under',
    side: 'over',
    line_value: 27.5,
    odds_american: -110,
    odds_decimal: 1.91,
    implied_probability: 0.524,
    raw_json: { id: 1, vendor: 'DraftKings' },
    provider_updated_at: new Date('2026-10-21T17:00:00.000Z'),
    ...partial,
  };
}

describe('player-prop snapshot archive keys', () => {
  it('builds one deterministic object key per pull/game', () => {
    const key = buildPlayerPropSnapshotArchiveKey({
      season: 2026,
      gameDate: '2026-10-21',
      gameId: '12345',
      pullRunId: 99,
      snapshotAt: '2026-10-21T18:00:00.000Z',
    });
    expect(key).toBe(
      'raw/source=balldontlie/league=nba/season=2026/entity=player_prop_snapshots/game_date=2026-10-21/game_id=12345/snapshot_at=2026-10-21T18-00-00Z__pull=99.json.gz'
    );
    expect(isProtectedHistoricalKey(key)).toBe(false);
  });

  it('never treats the recovered existing_ingestion prefix as writable', () => {
    expect(isProtectedHistoricalKey(LEGACY_PROTECTED_PREFIX + '/dt=2026-04-02/data.jsonl')).toBe(
      true
    );
    expect(
      isProtectedHistoricalKey(
        'raw/source=existing_ingestion/league=nba/season=2025/entity=player_props_raw_v2/foo'
      )
    ).toBe(true);
  });
});

describe('gzip envelope round-trip', () => {
  it('archives all normalized rows for one game/run and reads them back', async () => {
    const snapshotAt = new Date('2026-10-21T18:00:00.000Z');
    const start = new Date('2026-10-21T23:30:00.000Z');
    const rows = rowsFromNormalized({
      normalized: [norm(), norm({ side: 'under', odds_american: -110 })],
      analyticsGameId: '12345',
      pullRunId: 99,
      snapshotAt,
      gameStartTime: start,
      opponentId: '2',
    });
    const envelope = buildArchiveEnvelope({
      season: 2026,
      pullRunId: 99,
      gameId: '12345',
      sourceGameId: 12345,
      gameDate: '2026-10-21',
      snapshotAt,
      gameStartTime: start,
      rows,
    });
    expect(envelope.row_count).toBe(2);
    expect(envelope.timing).toBe('pregame');
    const store = new InMemoryArchiveStore();
    const key = buildPlayerPropSnapshotArchiveKey({
      season: 2026,
      gameDate: '2026-10-21',
      gameId: '12345',
      pullRunId: 99,
      snapshotAt,
    });
    const first = await writeArchiveObject({ store, key, envelope });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result).toBe('written');
    const raw = await store.get(key);
    expect(raw).not.toBeNull();
    const back = gunzipEnvelope(raw!.body);
    expect(back.rows).toHaveLength(2);
    expect(back.checksum).toBe(envelope.checksum);
    expect(back.rows[0].raw_json).toEqual({ id: 1, vendor: 'DraftKings' });

    const retry = await writeArchiveObject({ store, key, envelope });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.result).toBe('already_exists');
    expect(store.objects.size).toBe(1);
  });

  it('fails safely when the same key has a different payload', async () => {
    const snapshotAt = new Date('2026-10-21T18:00:00.000Z');
    const store = new InMemoryArchiveStore();
    const key = buildPlayerPropSnapshotArchiveKey({
      season: 2026,
      gameDate: '2026-10-21',
      gameId: '12345',
      pullRunId: 99,
      snapshotAt,
    });
    const a = buildArchiveEnvelope({
      season: 2026,
      pullRunId: 99,
      gameId: '12345',
      sourceGameId: 12345,
      gameDate: '2026-10-21',
      snapshotAt,
      gameStartTime: null,
      rows: rowsFromNormalized({
        normalized: [norm()],
        analyticsGameId: '12345',
        pullRunId: 99,
        snapshotAt,
        gameStartTime: null,
      }),
    });
    const b = buildArchiveEnvelope({
      season: 2026,
      pullRunId: 99,
      gameId: '12345',
      sourceGameId: 12345,
      gameDate: '2026-10-21',
      snapshotAt,
      gameStartTime: null,
      rows: rowsFromNormalized({
        normalized: [norm({ line_value: 30.5 })],
        analyticsGameId: '12345',
        pullRunId: 99,
        snapshotAt,
        gameStartTime: null,
      }),
    });
    expect((await writeArchiveObject({ store, key, envelope: a })).ok).toBe(true);
    const conflict = await writeArchiveObject({ store, key, envelope: b });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error).toBe('conflict');
    expect(gunzipEnvelope((await store.get(key))!.body).rows[0].line_value).toBe(27.5);
  });

  it('refuses writes to the recovered historical prefix', async () => {
    const store = new InMemoryArchiveStore();
    const envelope = buildArchiveEnvelope({
      season: 2025,
      pullRunId: 1,
      gameId: '1',
      sourceGameId: 1,
      gameDate: '2026-04-02',
      snapshotAt: new Date('2026-04-02T00:00:00.000Z'),
      gameStartTime: null,
      rows: [],
    });
    const out = await writeArchiveObject({
      store,
      key: `${LEGACY_PROTECTED_PREFIX}/dt=2026-04-02/data.jsonl`,
      envelope,
    });
    expect(out.ok).toBe(false);
    expect(store.objects.size).toBe(0);
  });
});

describe('timing / research pregame', () => {
  it('archives post-tip raw truth but does not treat it as pregame research', () => {
    const snap = '2026-10-21T23:40:00.000Z';
    const start = '2026-10-21T23:30:00.000Z';
    expect(classifySnapshotTiming(snap, start)).toBe('post_tip');
    expect(isValidPregameResearchSnapshot(snap, start)).toBe(false);
    const rows = rowsFromNormalized({
      normalized: [norm()],
      analyticsGameId: '12345',
      pullRunId: 1,
      snapshotAt: snap,
      gameStartTime: start,
    });
    expect(filterPregameRows(rows)).toHaveLength(0);
    expect(gzipEnvelope(buildArchiveEnvelope({
      season: 2026,
      pullRunId: 1,
      gameId: '12345',
      sourceGameId: 12345,
      gameDate: '2026-10-21',
      snapshotAt: snap,
      gameStartTime: start,
      rows,
    })).length).toBeGreaterThan(0);
  });
});

describe('invariants', () => {
  it('rows_stored > 0 without rows_archived is not a successful archive', () => {
    expect(archiveSuccessInvariant(10, 0, 'failed')).toBe(false);
    expect(archiveSuccessInvariant(10, 0, 'pending')).toBe(false);
    expect(archiveSuccessInvariant(10, 10, 'archived')).toBe(true);
    expect(archiveSuccessInvariant(0, 0, 'pending')).toBe(true);
  });

  it('prune refuses required missing archives and allows verified + legacy', () => {
    const after = new Date('2026-10-01T00:00:00.000Z');
    expect(
      mayPruneRawSnapshot({
        requireArchive: true,
        requiredAfter: after,
        snapshotFetchedAt: '2026-10-22T00:00:00.000Z',
        snapshotPullRunId: 9,
        gameRunStartedAt: '2026-10-21T18:00:00.000Z',
        archiveStatus: 'failed',
      }).eligible
    ).toBe(false);
    expect(
      mayPruneRawSnapshot({
        requireArchive: true,
        requiredAfter: after,
        snapshotFetchedAt: '2026-10-22T00:00:00.000Z',
        snapshotPullRunId: 9,
        gameRunStartedAt: '2026-10-21T18:00:00.000Z',
        archiveStatus: 'archived',
      }).eligible
    ).toBe(true);
    expect(
      mayPruneRawSnapshot({
        requireArchive: true,
        requiredAfter: after,
        snapshotFetchedAt: '2026-04-02T00:00:00.000Z',
        snapshotPullRunId: null,
        gameRunStartedAt: null,
        archiveStatus: null,
      }).eligible
    ).toBe(true);
    expect(
      mayPruneRawSnapshot({
        requireArchive: true,
        requiredAfter: after,
        snapshotFetchedAt: '2026-04-02T00:00:00.000Z',
        snapshotPullRunId: 3,
        gameRunStartedAt: '2026-04-02T00:00:00.000Z',
        archiveStatus: 'pending',
      }).eligible
    ).toBe(true);
  });
});

describe('helpers', () => {
  it('season start year and compact UTC', () => {
    expect(nbaSeasonStartYearFromGameDate('2026-10-21')).toBe(2026);
    expect(nbaSeasonStartYearFromGameDate('2027-04-02')).toBe(2026);
    expect(compactUtcTimestamp('2026-10-21T18:00:00.123Z')).toBe('2026-10-21T18-00-00Z');
  });

  it('does not skip when checksums differ', () => {
    const d = decideIdempotentWrite({
      key: 'raw/source=balldontlie/x.json.gz',
      existing: { checksum: 'aaa', rowCount: 1, pullRunId: 1, gameId: '1' },
      next: { checksum: 'bbb', rowCount: 1, pullRunId: 1, gameId: '1', archiveVersion: 'player_prop_snapshots.v1' },
    });
    expect(d.action).toBe('conflict');
  });
});
