import { readFileSync } from 'node:fs';
import path from 'node:path';

import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { getPlayerPropsForExplorer } from '@/lib/betting/props-explorer-serving';
import { readCurrentBoard } from '@/lib/props/s3-current-board/read';
import { resetVerifiedSnapshotCacheForTests } from '@/lib/props/s3-current-board/snapshot-cache';
import type { CurrentPointer } from '@/lib/props/s3-current-board/pointer';
import {
  CURRENT_BOARD_READ_ROLE_ARN,
  currentBoardCredentialProvider,
  openWebsiteCurrentBoardStore,
  websiteCurrentBoardStore,
} from '@/lib/props/s3-current-board/website-store';
import {
  envelopeToObjectMeta,
  gunzipEnvelope,
  s3UserMetadata,
} from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;

const FIXTURE = path.join(__dirname, 'fixtures', 'bos-was-21718182');
const REVIEW_CLOCK = '2026-11-24T16:00:00.000Z';
const IN_WINDOW_CLOCK = '2026-11-24T14:12:07.929Z';

function fixturePointer(): CurrentPointer {
  return JSON.parse(readFileSync(path.join(FIXTURE, 'pointer.json'), 'utf8')) as CurrentPointer;
}

function fixtureObjects(): Map<string, { body: Buffer; metadata: Record<string, string> }> {
  const pointer = fixturePointer();
  const archive = readFileSync(path.join(FIXTURE, 'archive.json.gz'));
  const envelope = gunzipEnvelope(archive);
  return new Map([
    [pointerKeyFor(pointer), { body: readFileSync(path.join(FIXTURE, 'pointer.json')), metadata: {} }],
    [pointer.manifestKey, { body: readFileSync(path.join(FIXTURE, 'manifest.json')), metadata: {} }],
    [pointer.archiveKey, { body: archive, metadata: s3UserMetadata(envelopeToObjectMeta(envelope)) }],
  ]);
}

function pointerKeyFor(pointer: CurrentPointer): string {
  return `current/source=balldontlie/league=nba/entity=player_prop_current/game_id=${pointer.gameId}/pointer.json`;
}

function fixtureClient(objects: Map<string, { body: Buffer; metadata: Record<string, string> }>, commands: string[]) {
  return {
    async send(command: GetObjectCommand) {
      commands.push(command.constructor.name);
      const key = command.input.Key ?? '';
      const found = objects.get(key);
      if (!found) {
        const error = new Error('not authorized to perform: s3:ListBucket on resource');
        Object.assign(error, { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
        throw error;
      }
      return {
        ETag: '"fixture"',
        Metadata: found.metadata,
        Body: { transformToByteArray: async () => new Uint8Array(found.body) },
      };
    },
  } as unknown as S3Client;
}

describe('production website current-board reader', () => {
  beforeEach(() => {
    resetVerifiedSnapshotCacheForTests();
  });

  afterEach(() => {
    delete process.env.CURRENT_PROPS_SOURCE;
    mockQuery.mockReset();
    mockQueryOne.mockReset();
  });

  it('selects only the production role and does not read a token while selecting it', () => {
    const calls: string[] = [];
    let invoked = false;
    const provider = currentBoardCredentialProvider(
      {
        VERCEL: '1',
        VERCEL_ENV: 'production',
        AWS_ROLE_ARN: 'arn:aws:iam::260029269390:role/court-context-historical-board-read-production',
      },
      (roleArn) => {
        calls.push(roleArn);
        return async () => {
          invoked = true;
          throw new Error('token');
        };
      }
    );
    expect(calls).toEqual([CURRENT_BOARD_READ_ROLE_ARN]);
    expect(invoked).toBe(false);
    expect(provider).toEqual(expect.any(Function));
    expect(currentBoardCredentialProvider({})).toBeUndefined();
    expect(() => currentBoardCredentialProvider({ VERCEL: '1', VERCEL_ENV: 'preview' })).toThrow('current_board_config_rejected');
    expect(() => currentBoardCredentialProvider({ VERCEL: '1' })).toThrow('current_board_config_rejected');
  });

  it('keeps the website role to GetObject on the current pointer, archive, and manifest', () => {
    const policy = readFileSync(path.join(process.cwd(), 'infra', 'vercel-current-board.tf'), 'utf8');
    expect(policy).toContain('oidc.vercel.com/karltiamas-projects');
    expect(policy).toContain('https://vercel.com/karltiamas-projects');
    expect(policy).toMatch(/vercel_current_board_project\s+=\s+"nba-analytics-v3"/);
    expect(policy).toMatch(/vercel_current_board_environment\s+=\s+"production"/);
    expect(policy).toContain('project:${local.vercel_current_board_project}:environment:${local.vercel_current_board_environment}');
    expect(policy).toContain('s3:GetObject');
    expect(policy).toContain('entity=player_prop_current/game_id=*/pointer.json');
    expect(policy).toContain('entity=player_prop_snapshots/*');
    expect(policy).not.toMatch(/PutObject|DeleteObject|ListBucket|dynamodb|historical-board|player_props_raw_v2|existing_ingestion/);
  });

  it('does not construct a store or call S3 when the flag is off', () => {
    const open = vi.fn();
    expect(websiteCurrentBoardStore({}, open)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it('reads the BOS @ WAS fixture through the read-only adapter and rejects writes', async () => {
    const pointer = fixturePointer();
    const commands: string[] = [];
    const client = fixtureClient(fixtureObjects(), commands);
    const store = openWebsiteCurrentBoardStore({ client });
    await expect(store.put(
      pointerKeyFor(pointer),
      Buffer.from('{}'),
      {},
      { kind: 'if-none-match', etag: '*' }
    )).rejects.toThrow(/read only/);
    expect(commands).toEqual([]);

    const readable = await readCurrentBoard({ store, gameId: pointer.gameId, now: IN_WINDOW_CLOCK });
    expect(readable.available).toBe(true);
    if (!readable.available) return;
    expect(readable.snapshot.pullRunId).toBe(717);
    expect(readable.observedAt).toBe('2026-11-24T14:11:07.929Z');
    expect(readable.completeness).toMatchObject({ rowsFetched: 2574, rowCount: 2956 });
    expect(readable.rows).toHaveLength(2956);
    expect(readable.rows).toContainEqual(expect.objectContaining({
      playerId: '434',
      sportsbook: 'draftkings',
      propType: 'points',
      side: 'over',
      line: 26.5,
      oddsAmerican: -117,
    }));
    expect(commands.every((name) => name === 'GetObjectCommand')).toBe(true);
    expect(new Set(commands)).toEqual(new Set(['GetObjectCommand']));

    const stale = await readCurrentBoard({ store, gameId: pointer.gameId, now: REVIEW_CLOCK });
    const expired = await readCurrentBoard({ store, gameId: pointer.gameId, now: pointer.gameStartTime });
    expect(stale).toMatchObject({ available: false, reason: 'stale' });
    expect(expired).toMatchObject({ available: false, reason: 'expired' });

    const missingClient = fixtureClient(new Map(), []);
    const missing = await readCurrentBoard({
      store: openWebsiteCurrentBoardStore({ client: missingClient }),
      gameId: pointer.gameId,
      now: IN_WINDOW_CLOCK,
    });
    expect(missing).toMatchObject({ available: false, reason: 'missing' });

    const denied = {
      async send() {
        const error = new Error('not authorized to perform: s3:GetObject');
        Object.assign(error, { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
        throw error;
      },
    } as unknown as S3Client;
    const inaccessible = await readCurrentBoard({
      store: openWebsiteCurrentBoardStore({ client: denied }),
      gameId: pointer.gameId,
      now: IN_WINDOW_CLOCK,
    });
    expect(inaccessible).toMatchObject({ available: false, reason: 'unavailable' });
  });

  it('serves the fixture to Props Explorer without a PostgreSQL market read', async () => {
    const pointer = fixturePointer();
    const store = openWebsiteCurrentBoardStore({ client: fixtureClient(fixtureObjects(), []) });
    process.env.CURRENT_PROPS_SOURCE = 's3';
    mockQueryOne.mockResolvedValue({ start_time: pointer.gameStartTime, away_abbr: 'BOS', home_abbr: 'WAS' });
    mockQuery.mockImplementation(async (sql: string) => {
      if (/player_props_current|player_prop_snapshots|player_prop_game_runs/i.test(sql)) throw new Error('postgres props read');
      return [];
    });
    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-11-24',
      todayEt: '2026-11-24',
      gameId: pointer.gameId,
      now: new Date(IN_WINDOW_CLOCK),
      sportsbook: 'draftkings',
      propType: 'points',
      side: 'over',
      marketType: 'over_under',
      limit: 20,
      offset: 0,
      store,
    });
    expect(result.sourceTable).toBe('s3.player_prop_current');
    expect(result.rows).toContainEqual(expect.objectContaining({
      playerId: 434,
      sportsbook: 'draftkings',
      side: 'over',
      lineValue: 26.5,
      oddsAmerican: -117,
    }));
  });

  it('does not call S3 for explorer when the flag is off', async () => {
    const store = {
      async get(): Promise<never> {
        throw new Error('s3 was called');
      },
    };
    mockQueryOne.mockResolvedValue({ start_time: '2026-11-25T01:00:00.000Z', away_abbr: 'BOS', home_abbr: 'WAS' });
    mockQuery.mockResolvedValue([]);
    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-11-24',
      todayEt: '2026-11-24',
      gameId: '21718182',
      now: new Date(REVIEW_CLOCK),
      limit: 5,
      offset: 0,
      store,
    });
    expect(result.sourceTable).not.toBe('s3.player_prop_current');
    expect(result.rows).toEqual([]);
  });

  it('keeps AWS credentials out of client-side source', () => {
    const source = readFileSync(path.join(process.cwd(), 'lib', 'props', 's3-current-board', 'website-store.ts'), 'utf8');
    expect(source).toContain("typeof window !== 'undefined'");
    expect(source).not.toMatch(/NEXT_PUBLIC_|accessKeyId|secretAccessKey/);
  });
});
