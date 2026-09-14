import { describe, expect, it } from 'vitest';
import { archiveGameSnapshot } from '../../src/archive-game';
import {
  InMemoryArchiveStore,
  gunzipEnvelope,
} from '../../src/player-prop-snapshot-archive';
import type { LambdaEnv } from '../../src/env';
import type { NormalizedPropRow } from '../../src/types';

function env(partial: Partial<LambdaEnv> = {}): LambdaEnv {
  return {
    dbUrl: 'postgresql://localhost/test',
    apiKey: 'x',
    preferredVendor: 'draftkings',
    storePropRawJson: false,
    propRawJsonSampleRate: 0,
    s3ArchiveEnabled: true,
    nbaDataBucket: 'test-bucket',
    nbaRawPrefix: 'raw',
    awsRegion: 'us-east-1',
    ...partial,
  };
}

function row(): NormalizedPropRow {
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
    raw_json: { id: 1 },
    provider_updated_at: new Date('2026-10-21T17:00:00.000Z'),
  };
}

describe('archiveGameSnapshot', () => {
  it('stays pending when the archive flag is off', async () => {
    const out = await archiveGameSnapshot({
      env: env({ s3ArchiveEnabled: false }),
      pullRunId: 99,
      gameId: '12345',
      bdlGameId: 12345,
      gameDate: '2026-10-21',
      snapshotAt: new Date('2026-10-21T18:00:00.000Z'),
      gameStartTime: new Date('2026-10-21T23:30:00.000Z'),
      season: '2026',
      opponentId: null,
      normalized: [row()],
      rowsStored: 1,
    });
    expect(out.archiveStatus).toBe('pending');
    expect(out.skipped).toBe(true);
  });

  it('writes one gzip object and records rows_archived', async () => {
    const store = new InMemoryArchiveStore();
    const out = await archiveGameSnapshot({
      env: env(),
      pullRunId: 99,
      gameId: '12345',
      bdlGameId: 12345,
      gameDate: '2026-10-21',
      snapshotAt: new Date('2026-10-21T18:00:00.000Z'),
      gameStartTime: new Date('2026-10-21T23:30:00.000Z'),
      season: '2026',
      opponentId: null,
      normalized: [row(), { ...row(), side: 'under' }],
      rowsStored: 2,
      store,
    });
    expect(out.archiveStatus).toBe('archived');
    expect(out.rowsArchived).toBe(2);
    expect(out.archiveObjectCount).toBe(1);
    expect(store.objects.size).toBe(1);
    const body = gunzipEnvelope([...store.objects.values()][0].body);
    expect(body.rows).toHaveLength(2);
  });

  it('marks archival failure when S3 put throws after DB-shaped rows were stored', async () => {
    const store = {
      async head() {
        return null;
      },
      async get() {
        return null;
      },
      async put() {
        throw new Error('AccessDenied');
      },
    };
    const out = await archiveGameSnapshot({
      env: env(),
      pullRunId: 99,
      gameId: '12345',
      bdlGameId: 12345,
      gameDate: '2026-10-21',
      snapshotAt: new Date('2026-10-21T18:00:00.000Z'),
      gameStartTime: null,
      season: '2026',
      opponentId: null,
      normalized: [row()],
      rowsStored: 1,
      store,
    });
    expect(out.archiveStatus).toBe('failed');
    expect(out.rowsArchived).toBe(0);
    expect(out.archiveError).toMatch(/AccessDenied/);
  });

  it('does not duplicate on retry of the same run/game payload', async () => {
    const store = new InMemoryArchiveStore();
    const args = {
      env: env(),
      pullRunId: 99,
      gameId: '12345',
      bdlGameId: 12345,
      gameDate: '2026-10-21',
      snapshotAt: new Date('2026-10-21T18:00:00.000Z'),
      gameStartTime: new Date('2026-10-21T23:30:00.000Z'),
      season: '2026',
      opponentId: null,
      normalized: [row()],
      rowsStored: 1,
      store,
    };
    const first = await archiveGameSnapshot(args);
    const second = await archiveGameSnapshot(args);
    expect(first.outcome && first.outcome.ok && first.outcome.result).toBe('written');
    expect(second.outcome && second.outcome.ok && second.outcome.result).toBe('already_exists');
    expect(store.objects.size).toBe(1);
  });
});
