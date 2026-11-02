import { describe, expect, it } from 'vitest';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { archiveGameSnapshot } from '../../src/archive-game';
import { PlayerPropArchiveS3Store, classifyConditionalPutError } from '../../src/s3-archive';
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
  it('fails closed when archival is on and the bucket is missing', async () => {
    const out = await archiveGameSnapshot({
      env: env({ nbaDataBucket: null }),
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
    expect(out.archiveStatus).toBe('failed');
    expect(out.skipped).toBe(false);
    expect(out.archiveError).toMatch(/NBA_DATA_BUCKET is missing/);
  });

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
      async get() {
        return null;
      },
      async putIfAbsent() {
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

  it('a missing archive object is written once', async () => {
    const puts: string[] = [];
    const store = {
      async get() {
        return null;
      },
      async putIfAbsent(key: string) {
        puts.push(key);
        return 'created' as const;
      },
    };
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
      normalized: [row()],
      rowsStored: 1,
      store,
    });
    expect(out.archiveStatus).toBe('archived');
    expect(puts).toHaveLength(1);
  });

  it('PutObject HTTP 403 fails the archive and does not read or overwrite', async () => {
    const gets: string[] = [];
    const store = {
      async get(key: string) {
        gets.push(key);
        return null;
      },
      async putIfAbsent() {
        const err = new Error('AccessDenied');
        err.name = 'AccessDenied';
        Object.assign(err, { $metadata: { httpStatusCode: 403 } });
        throw err;
      },
    };
    const out = await archiveGameSnapshot({
      env: env(),
      pullRunId: 579,
      gameId: '21717922',
      bdlGameId: 21717922,
      gameDate: '2026-10-21',
      snapshotAt: new Date('2026-10-21T19:51:47.684Z'),
      gameStartTime: new Date('2026-10-21T23:00:00.000Z'),
      season: '2026',
      opponentId: null,
      normalized: [row()],
      rowsStored: 3043,
      store,
    });
    expect(out.archiveStatus).toBe('failed');
    expect(out.rowsArchived).toBe(0);
    expect(out.archiveError).toMatch(/s3 put failed/);
    expect(out.archiveError).toMatch(/http=403/);
    expect(gets).toEqual([]);
    expect(out.archiveKey).toContain('game_id=21717922');
  });

  it('rejects a different payload for an existing key and leaves the first object in place', async () => {
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
    const conflict = await archiveGameSnapshot({
      ...args,
      normalized: [{ ...row(), odds_american: -125 }],
    });
    expect(first.archiveStatus).toBe('archived');
    expect(conflict.archiveStatus).toBe('failed');
    expect(conflict.archiveError).toMatch(/conflict/i);
    expect(store.objects.size).toBe(1);
    const kept = gunzipEnvelope([...store.objects.values()][0].body);
    expect(kept.rows[0]?.odds_american).toBe(-110);
  });

  it('treats HTTP 409 as one compare and does not put a second time', async () => {
    let puts = 0;
    let gets = 0;
    const store = {
      async get() {
        gets += 1;
        return null;
      },
      async putIfAbsent() {
        puts += 1;
        return 'conditional_conflict' as const;
      },
    };
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
      normalized: [row()],
      rowsStored: 1,
      store,
    });
    expect(puts).toBe(1);
    expect(gets).toBe(1);
    expect(out.archiveStatus).toBe('failed');
    expect(out.archiveError).toMatch(/http=409/);
  });
});

describe('PlayerPropArchiveS3Store conditional put', () => {
  it('sends IfNoneMatch * and does not head the key first', async () => {
    const commands: PutObjectCommand[] = [];
    const client = {
      async send(command: PutObjectCommand) {
        commands.push(command);
        return {};
      },
    };
    const store = new PlayerPropArchiveS3Store({ bucket: 'b', client: client as unknown as S3Client });
    await expect(store.putIfAbsent('new-key', Buffer.from('x'), { checksum: 'abc' })).resolves.toBe('created');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(commands[0].input).toMatchObject({
      Bucket: 'b',
      Key: 'new-key',
      IfNoneMatch: '*',
      ContentEncoding: 'gzip',
    });
  });

  it('maps HTTP 412 and HTTP 409 without treating HTTP 403 as either', () => {
    const precondition = Object.assign(new Error('PreconditionFailed'), { $metadata: { httpStatusCode: 412 } });
    const conflict = Object.assign(new Error('ConditionalRequestConflict'), { $metadata: { httpStatusCode: 409 } });
    const denied = Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
    expect(classifyConditionalPutError(precondition)).toBe('precondition_failed');
    expect(classifyConditionalPutError(conflict)).toBe('conditional_conflict');
    expect(classifyConditionalPutError(denied)).toBeNull();
  });
});

describe('PlayerPropArchiveS3Store head', () => {
  it('returns null only for a confirmed 404', async () => {
    const client = {
      async send() {
        const err = new Error('NotFound');
        err.name = 'NotFound';
        Object.assign(err, { $metadata: { httpStatusCode: 404 } });
        throw err;
      },
    };
    const store = new PlayerPropArchiveS3Store({ bucket: 'b', client: client as unknown as S3Client });
    expect(await store.head('missing')).toBeNull();
  });

  it('throws HTTP 403 instead of treating it as a missing object', async () => {
    const client = {
      async send() {
        const err = new Error('UnknownError');
        err.name = 'Unknown';
        Object.assign(err, { $metadata: { httpStatusCode: 403 } });
        throw err;
      },
    };
    const store = new PlayerPropArchiveS3Store({ bucket: 'b', client: client as unknown as S3Client });
    await expect(store.head('hidden')).rejects.toThrow(/UnknownError/);
  });
});
