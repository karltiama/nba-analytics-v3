import { describe, expect, it } from 'vitest';
import { archiveGameSnapshot } from '../archive-game';
import { mapConditionalPutError } from '../s3-archive';
import {
  S3ConditionalWriteError,
  buildArchiveEnvelope,
  gunzipEnvelope,
  rowsFromNormalized,
  writeArchiveObject,
} from '../player-prop-snapshot-archive';
import type { LambdaEnv } from '../env';
import type { NormalizedPropRow } from '../types';

function row(line = 27.5): NormalizedPropRow {
  return {
    game_id: 21717855,
    player_id: 77,
    player_name: 'Player',
    team_id: 1,
    sportsbook: 'draftkings',
    prop_type: 'points',
    market_type: 'over_under',
    side: 'over',
    line_value: line,
    odds_american: -110,
    odds_decimal: 1.91,
    implied_probability: 0.524,
    raw_json: { id: 1 },
    provider_updated_at: new Date('2026-10-20T18:00:00.000Z'),
  };
}

function envelope(line = 27.5) {
  const snapshotAt = new Date('2026-10-19T22:50:15.593Z');
  return buildArchiveEnvelope({
    season: 2026,
    pullRunId: 576,
    gameId: '21717855',
    sourceGameId: 21717855,
    gameDate: '2026-10-20',
    snapshotAt,
    gameStartTime: new Date('2026-10-20T19:00:00.000Z'),
    rows: rowsFromNormalized({
      normalized: [row(line)],
      analyticsGameId: '21717855',
      pullRunId: 576,
      snapshotAt,
      gameStartTime: new Date('2026-10-20T19:00:00.000Z'),
    }),
  });
}

function store() {
  const objects = new Map<string, { body: Buffer; metadata: Record<string, string> }>();
  return {
    objects,
    async get(key: string) {
      return objects.get(key) ?? null;
    },
    async put(key: string, body: Buffer, metadata: Record<string, string>) {
      if (objects.has(key)) throw new S3ConditionalWriteError(412, 'exists');
      objects.set(key, { body, metadata });
    },
  };
}

const key = 'raw/source=balldontlie/league=nba/season=2026/entity=player_prop_snapshots/game_date=2026-10-20/game_id=21717855/snapshot_at=20261019T225015Z__pull=576.json.gz';

describe('conditional player-prop archive writes', () => {
  it('writes a missing key without calling HeadObject', async () => {
    const target = store();
    const out = await writeArchiveObject({ store: target, key, envelope: envelope() });
    expect(out.ok && out.result).toBe('written');
    expect(target.objects.size).toBe(1);
    expect(gunzipEnvelope(target.objects.get(key)!.body).rows).toHaveLength(1);
  });

  it('treats a matching existing object as idempotent success', async () => {
    const target = store();
    await writeArchiveObject({ store: target, key, envelope: envelope() });
    const again = await writeArchiveObject({ store: target, key, envelope: envelope() });
    expect(again.ok && again.result).toBe('already_exists');
    expect(target.objects.size).toBe(1);
  });

  it('does not overwrite a conflicting existing object', async () => {
    const target = store();
    await writeArchiveObject({ store: target, key, envelope: envelope(27.5) });
    const conflict = await writeArchiveObject({ store: target, key, envelope: envelope(30.5) });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error).toBe('conflict');
    expect(gunzipEnvelope(target.objects.get(key)!.body).rows[0].line_value).toBe(27.5);
  });

  it('fails a PutObject 403 without treating it as a missing key', async () => {
    const target = {
      async get() {
        return null;
      },
      async put() {
        throw new S3ConditionalWriteError(403, 'S3 PutObject 403: AccessDenied');
      },
    };
    const out = await writeArchiveObject({ store: target, key, envelope: envelope() });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('write_failed');
    expect(out.message).toMatch(/403/);
  });

  it('reports HTTP 409 without retrying the put', async () => {
    let calls = 0;
    const target = {
      async get() {
        return null;
      },
      async put() {
        calls += 1;
        throw new S3ConditionalWriteError(409, 'Conflict');
      },
    };
    const out = await writeArchiveObject({ store: target, key, envelope: envelope() });
    expect(calls).toBe(1);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('conflict');
    expect(out.message).toMatch(/409/);
  });

  it('fails a network error explicitly', async () => {
    const target = {
      async get() {
        return null;
      },
      async put() {
        throw new Error('socket timeout');
      },
    };
    const out = await writeArchiveObject({ store: target, key, envelope: envelope() });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/socket timeout/);
  });

  it('maps SDK statuses without treating 403 as missing', () => {
    expect(mapConditionalPutError({ $metadata: { httpStatusCode: 403 }, message: 'AccessDenied' })?.statusCode).toBe(403);
    expect(mapConditionalPutError({ $metadata: { httpStatusCode: 412 }, name: 'PreconditionFailed' })?.statusCode).toBe(412);
    expect(mapConditionalPutError({ $metadata: { httpStatusCode: 409 }, message: 'Conflict' })?.statusCode).toBe(409);
    expect(mapConditionalPutError(new Error('socket timeout'))).toBeNull();
  });

  it('fails before constructing S3 when the bucket is missing', async () => {
    const env = {
      dbUrl: 'postgresql://localhost/test',
      apiKey: 'x',
      preferredVendor: 'draftkings',
      storePropRawJson: false,
      propRawJsonSampleRate: 0,
      s3ArchiveEnabled: true,
      nbaDataBucket: null,
      nbaRawPrefix: 'raw',
      awsRegion: 'us-east-1',
    } satisfies LambdaEnv;
    const out = await archiveGameSnapshot({
      env,
      pullRunId: 576,
      gameId: '21717855',
      bdlGameId: 21717855,
      gameDate: '2026-10-20',
      snapshotAt: new Date('2026-10-19T22:50:15.593Z'),
      gameStartTime: null,
      season: '2026',
      opponentId: null,
      normalized: [row()],
      rowsStored: 1,
    });
    expect(out.archiveStatus).toBe('failed');
    expect(out.archiveError).toMatch(/NBA_DATA_BUCKET/);
  });
});
