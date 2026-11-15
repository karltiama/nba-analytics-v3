import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, beforeEach } from 'vitest';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { mergeLast5Players } from '@/lib/content/video/last5/historical-board';
import type { TonightPropPlayer } from '@/lib/content/video/last5/queries';
import { resolveLast5Line } from '@/lib/content/video/last5/snapshot';
import { adaptPropsExplorerOffer } from '@/lib/parlay/adapt-props-explorer-offer';
import { legsThatNeedArchive, quotesFromValidatedManifest } from '@/lib/parlay/historical-board-quotes';
import { savedOfferTrueCostInput } from '@/lib/parlay/true-cost-presentation';
import {
  CURRENT_BOARD_BACKUP_ID,
  CURRENT_BOARD_BACKUP_SHA256,
  CURRENT_BOARD_MANIFEST_SHA256,
  FROZEN_BOARD_DELETE_ROWS,
} from '@/lib/props/current-board-reclamation';
import {
  HISTORICAL_BOARD_ARCHIVE_VERSION,
  HISTORICAL_BOARD_COLUMNS,
  HISTORICAL_BOARD_MANIFEST_SHA256,
  HISTORICAL_BOARD_MAX_COMPRESSED_BYTES,
  HISTORICAL_BOARD_MAX_UNCOMPRESSED_BYTES,
  HISTORICAL_BOARD_S3_PREFIX,
  HISTORICAL_BOARD_SERIALIZATION,
  consensusByPlayer,
  decodePartition,
  encodePartition,
  historicalBoardObjectKey,
  sha256,
  type HistoricalBoardArchiveManifest,
  type HistoricalBoardRow,
} from '@/lib/props/historical-board-archive';
import {
  HISTORICAL_BOARD_BUCKET,
  HISTORICAL_BOARD_REGION,
  historicalBoardSourceFromEnv,
  shouldReadHistoricalBoard,
} from '@/lib/props/historical-board-config';
import { clearHistoricalBoardCache, assertReadableArchiveManifest } from '@/lib/props/historical-board-read';
import {
  HISTORICAL_BOARD_PREVIEW_ROLE_ARN,
  HISTORICAL_BOARD_PRODUCTION_ROLE_ARN,
  historicalBoardCredentialProvider,
  historicalBoardS3ClientStore,
} from '@/lib/props/historical-board-s3';

const ARCHIVE = 'D:\\court-context-backups\\cc-pg-logical-20261114T191459Z\\historical-board-archive';
const NOVEMBER_12 = '2026-11-12';

function row(overrides: Partial<HistoricalBoardRow> = {}): HistoricalBoardRow {
  return {
    gameId: 21718012,
    playerId: 203999,
    playerName: 'Nikola Jokic',
    teamId: 8,
    sportsbook: 'DraftKings',
    propType: 'points',
    marketType: 'over_under',
    side: 'over',
    lineText: '27.5',
    oddsAmerican: -125,
    oddsDecimalText: '1.80',
    impliedText: '0.556',
    snapshotAt: '2026-11-12T23:00:00.000000Z',
    snapshotMicros: '1762988400000000',
    observedAt: null,
    observationClock: null,
    controllerEnqueuedAt: null,
    providerUpdatedAt: null,
    ...overrides,
  };
}

function player(overrides: Partial<TonightPropPlayer> = {}): TonightPropPlayer {
  return {
    playerId: '2',
    playerName: 'Protected',
    gameId: '21718094',
    teamAbbr: 'DEN',
    opponentAbbr: 'OKC',
    isHome: true,
    startTime: '2026-11-12T00:00:00Z',
    quotes: [{ sportsbook: 'DraftKings', side: 'over', line: 8.5, impliedProbability: 0.5 }],
    linesAsOf: '2026-11-12T23:00:00.000000Z',
    ...overrides,
  };
}

describe('historical board source', () => {
  beforeEach(() => clearHistoricalBoardCache());

  it('stays off until the archive mode is explicit', () => {
    expect(historicalBoardSourceFromEnv({})).toEqual({ mode: 'off' });
    expect(historicalBoardSourceFromEnv({ HISTORICAL_BOARD_ARCHIVE_DIR: 'D:\\archive' })).toEqual({ mode: 'off' });
    expect(historicalBoardSourceFromEnv({ HISTORICAL_BOARD_ARCHIVE: 's3' })).toEqual({
      mode: 's3',
      bucket: HISTORICAL_BOARD_BUCKET,
      region: HISTORICAL_BOARD_REGION,
    });
    expect(() => historicalBoardSourceFromEnv({
      HISTORICAL_BOARD_ARCHIVE: 's3',
      HISTORICAL_BOARD_S3_BUCKET: 'other-bucket',
    })).toThrow('archive_config_rejected');
    expect(historicalBoardSourceFromEnv({ HISTORICAL_BOARD_ARCHIVE: 'local', HISTORICAL_BOARD_ARCHIVE_DIR: 'D:\\archive' })).toEqual({
      mode: 'local',
      directory: 'D:\\archive',
    });
    expect(shouldReadHistoricalBoard({ mode: 'off' }, '2026-11-12', '2026-11-14')).toBe(false);
    expect(shouldReadHistoricalBoard(
      { mode: 's3', bucket: HISTORICAL_BOARD_BUCKET, region: HISTORICAL_BOARD_REGION },
      '2026-11-14',
      '2026-11-14'
    )).toBe(false);
    expect(shouldReadHistoricalBoard(
      { mode: 's3', bucket: HISTORICAL_BOARD_BUCKET, region: HISTORICAL_BOARD_REGION },
      '2026-11-12',
      '2026-11-14'
    )).toBe(true);
  });

  it('rejects an oversized object, a denied read, and a missing object', async () => {
    expect(() => decodePartition(Buffer.alloc(HISTORICAL_BOARD_MAX_COMPRESSED_BYTES + 1))).toThrow('archive_too_large');
    const denied = historicalBoardS3ClientStore({
      send: async (command) => {
        expect(command).toBeInstanceOf(GetObjectCommand);
        expect(command.input.Bucket).toBe(HISTORICAL_BOARD_BUCKET);
        throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
      },
    });
    await expect(denied.getObject(historicalBoardObjectKey(NOVEMBER_12))).rejects.toThrow('archive_access_denied');
    const missing = historicalBoardS3ClientStore({
      send: async () => {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      },
    });
    await expect(missing.getObject(`${HISTORICAL_BOARD_S3_PREFIX}manifest.json`)).rejects.toThrow('archive_object_missing');
    await expect(denied.getObject('other/key')).rejects.toThrow('archive_key_rejected');
  });

  it('reads one date partition for several legs and leaves the saved price alone', async () => {
    const rows = [
      row(),
      row({ side: 'under', oddsAmerican: -105, impliedText: '0.512' }),
      row({ playerId: 203500, side: 'over', oddsAmerican: -110, lineText: '18.5' }),
      row({ playerId: 203500, side: 'under', oddsAmerican: -110, lineText: '18.5' }),
    ];
    const bytes = encodePartition(NOVEMBER_12, rows);
    const manifest = {
      version: HISTORICAL_BOARD_ARCHIVE_VERSION,
      serialization: HISTORICAL_BOARD_SERIALIZATION,
      columns: HISTORICAL_BOARD_COLUMNS,
      sourceBackupId: CURRENT_BOARD_BACKUP_ID,
      sourceBackupSha256: CURRENT_BOARD_BACKUP_SHA256,
      sourceManifestSha256: CURRENT_BOARD_MANIFEST_SHA256,
      rowCount: rows.length,
      games: [{ gameId: 21718012, dateEt: NOVEMBER_12, rows: rows.length }],
      partitions: [{
        id: NOVEMBER_12,
        fileName: `date=${NOVEMBER_12}.json.gz`,
        objectKey: historicalBoardObjectKey(NOVEMBER_12),
        rows: rows.length,
        byteLength: bytes.length,
        sha256: sha256(bytes),
      }],
    } as HistoricalBoardArchiveManifest;
    let reads = 0;
    const store = {
      async getObject(key: string) {
        reads += 1;
        expect(key).toBe(historicalBoardObjectKey(NOVEMBER_12));
        return bytes;
      },
    };
    const legs = [
      { gameId: '21718012', playerId: '203999', market: 'points', side: 'over' as const, line: 27.5 },
      { gameId: '21718012', playerId: '203500', market: 'points', side: 'over' as const, line: 18.5 },
    ];
    const first = await quotesFromValidatedManifest({ store, manifest, legs, cacheKey: 'test' });
    const second = await quotesFromValidatedManifest({ store, manifest, legs, cacheKey: 'test' });
    expect(reads).toBe(1);
    expect(first).toEqual(second);
    expect(first[0]?.find((quote) => quote.vendor === 'draftkings')).toMatchObject({
      priceAmerican: -125,
      oppositeAmerican: -105,
    });
    expect(first[1]?.[0]?.oppositeAmerican).toBe(-110);
    const adapted = adaptPropsExplorerOffer({
      playerId: '203999',
      playerName: 'Nikola Jokic',
      gameId: '21718012',
      propType: 'points',
      side: 'over',
      lineValue: 27.5,
      sportsbook: 'DraftKings',
      oddsAmerican: -110,
      snapshotAt: '2026-11-12T23:00:00.000Z',
      marketContext: 'historical',
      sourceTable: 'research.prop_decision_lines',
    });
    if (!adapted.ok) throw new Error(adapted.code);
    expect(savedOfferTrueCostInput({ offer: adapted.offer, gameLabel: 'DEN' }, first[0]).priceAmerican).toBe(-110);
    expect(legsThatNeedArchive(legs, [first[0] ?? [], []]).map((leg) => leg.playerId)).toEqual(['203500']);
    expect(legsThatNeedArchive(
      [{ gameId: '21718103', playerId: '1', market: 'points', side: 'over', line: 20.5 }],
      [[]]
    )).toEqual([]);
  });

  it('rejects a protected game and keeps the frozen manifest unchanged', () => {
    expect(() => assertReadableArchiveManifest({
      version: HISTORICAL_BOARD_ARCHIVE_VERSION,
      serialization: HISTORICAL_BOARD_SERIALIZATION,
      columns: HISTORICAL_BOARD_COLUMNS,
      sourceBackupId: CURRENT_BOARD_BACKUP_ID,
      sourceBackupSha256: CURRENT_BOARD_BACKUP_SHA256,
      sourceManifestSha256: CURRENT_BOARD_MANIFEST_SHA256,
      rowCount: FROZEN_BOARD_DELETE_ROWS,
      games: Array.from({ length: 95 }, () => ({ gameId: 21718094, dateEt: NOVEMBER_12, rows: 1 })),
      partitions: Array.from({ length: 13 }, (_, index) => ({
        id: `2026-10-${String(index + 1).padStart(2, '0')}`,
        fileName: 'x',
        objectKey: 'x',
        rows: 1,
        byteLength: 1,
        sha256: 'abc',
      })),
    })).toThrow('archive_game_rejected');
    const raw = readFileSync('lib/props/current-board-reclamation-manifest.json');
    expect(createHash('sha256').update(raw).digest('hex')).toBe(CURRENT_BOARD_MANIFEST_SHA256);
    const source = readFileSync('lib/props/historical-board-s3.ts', 'utf8');
    expect(source).toContain('GetObjectCommand');
    expect(source).toContain('awsCredentialsProvider');
    expect(source).toContain('region: HISTORICAL_BOARD_REGION');
    expect(HISTORICAL_BOARD_REGION).toBe('us-east-1');
    expect(source).not.toContain('PutObjectCommand');
    expect(source).not.toContain('accessKeyId');
    expect(source).not.toContain('AWS_SECRET');
    expect(source).not.toContain('AWS_ACCESS_KEY');
    const client = readFileSync('components/parlay/WorkspaceTrueCost.tsx', 'utf8');
    expect(client.startsWith("'use client'")).toBe(true);
    expect(client).not.toContain('@aws-sdk');
    expect(client).not.toContain('historical-board-s3');
    const route = readFileSync('app/api/betting/parlay-prices/route.ts', 'utf8');
    expect(route).not.toContain('PutObject');
    expect(route).not.toContain('AWS_SECRET');
  });

  it('parses the approved local manifest and keeps November 12 consensus', () => {
    if (!existsSync(`${ARCHIVE}\\manifest.json`)) return;
    const manifestBytes = readFileSync(`${ARCHIVE}\\manifest.json`);
    expect(sha256(manifestBytes)).toBe(HISTORICAL_BOARD_MANIFEST_SHA256);
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as HistoricalBoardArchiveManifest;
    assertReadableArchiveManifest(manifest);
    expect(manifest.games.some((game) => game.gameId === 21718094)).toBe(false);
    const partition = readFileSync(`${ARCHIVE}\\date=2026-11-12.json.gz`);
    const declared = manifest.partitions.find((item) => item.id === NOVEMBER_12);
    expect(partition.length).toBe(declared?.byteLength);
    expect(sha256(partition)).toBe(declared?.sha256);
    const decoded = decodePartition(partition);
    expect(decoded.rows.length).toBe(11934);
    expect(decoded.rows.some((item) => item.gameId === 21718094)).toBe(false);
    const consensus = consensusByPlayer(decoded.rows, 'rebounds');
    expect(consensus.size).toBeGreaterThan(0);
    const archivedGame = manifest.games.find((game) => game.dateEt === NOVEMBER_12);
    if (!archivedGame) throw new Error('archive_partition_missing');
    const archived = player({
      gameId: String(archivedGame.gameId),
      playerId: '10',
      quotes: [{ sportsbook: 'DraftKings', side: 'over', line: 24.5, impliedProbability: 0.52 }],
    });
    const merged = mergeLast5Players({
      sqlPlayers: [archived, player()],
      archivePlayers: [archived],
      archivedGameIds: new Set(manifest.games.filter((game) => game.dateEt === NOVEMBER_12).map((game) => String(game.gameId))),
    });
    expect(merged.map((item) => item.gameId).sort()).toEqual([String(archivedGame.gameId), '21718094'].sort());
    expect(merged.filter((item) => item.gameId === '21718094')).toHaveLength(1);
    expect(resolveLast5Line({
      date: NOVEMBER_12,
      todayEt: '2026-11-14',
      gamesOnDate: 8,
      boardQuotes: archived.quotes,
      researchCloses: [{ sportsbook: 'DraftKings', side: 'over', line: 20.5, impliedProbability: 0.8 }],
    }).status).toBe('ready');
  });

  it('selects the Vercel role only inside Vercel and does not fetch a token while selecting it', () => {
    const calls: string[] = [];
    let invoked = false;
    const provider = historicalBoardCredentialProvider(
      { VERCEL: '1', AWS_ROLE_ARN: HISTORICAL_BOARD_PREVIEW_ROLE_ARN },
      (roleArn) => {
        calls.push(roleArn);
        return async () => {
          invoked = true;
          throw new Error('token');
        };
      }
    );
    expect(calls).toEqual([HISTORICAL_BOARD_PREVIEW_ROLE_ARN]);
    expect(invoked).toBe(false);
    expect(provider).toEqual(expect.any(Function));
    expect(historicalBoardCredentialProvider({})).toBeUndefined();
    expect(historicalBoardCredentialProvider({
      VERCEL: '0',
      AWS_ROLE_ARN: HISTORICAL_BOARD_PRODUCTION_ROLE_ARN,
    })).toBeUndefined();
    expect(() => historicalBoardCredentialProvider({ VERCEL: '1' })).toThrow('archive_config_rejected');
    expect(() => historicalBoardCredentialProvider({
      VERCEL: '1',
      AWS_ROLE_ARN: 'arn:aws:iam::260029269390:role/Administrator',
    })).toThrow('archive_config_rejected');
    expect(() => historicalBoardCredentialProvider({
      VERCEL: '1',
      AWS_ROLE_ARN: `${HISTORICAL_BOARD_PRODUCTION_ROLE_ARN}*`,
    })).toThrow('archive_config_rejected');
  });

  it('replaces a credential failure with an archive code and drops the provider message', async () => {
    const store = historicalBoardS3ClientStore({
      async send() {
        throw new Error('eyJhbGciOiJSUzI1NiJ9.oidc-token');
      },
    });
    await expect(store.getObject(`${HISTORICAL_BOARD_S3_PREFIX}manifest.json`)).rejects.toThrow('archive_unavailable');
    try {
      await store.getObject(`${HISTORICAL_BOARD_S3_PREFIX}manifest.json`);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('eyJ');
    }
  });

  it('keeps the November 11 partition inside the compressed and uncompressed limits', () => {
    const file = `${ARCHIVE}\\date=2026-11-11.json.gz`;
    if (!existsSync(file)) return;
    const bytes = readFileSync(file);
    expect(bytes.length).toBe(593671);
    expect(bytes.length).toBeLessThanOrEqual(HISTORICAL_BOARD_MAX_COMPRESSED_BYTES);
    const uncompressed = gunzipSync(bytes);
    expect(uncompressed.length).toBe(11305521);
    expect(uncompressed.length).toBeLessThanOrEqual(HISTORICAL_BOARD_MAX_UNCOMPRESSED_BYTES);
    expect(decodePartition(bytes).rows.length).toBe(40863);
  });
});
