import { existsSync, readFileSync } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORICAL_BOARD_MANIFEST_SHA256, HISTORICAL_BOARD_S3_PREFIX, historicalBoardObjectKey } from '@/lib/props/historical-board-archive';
import {
  buildHistoricalBoardCanaryReport,
  historicalBoardCanaryAllowed,
  productionCanaryOriginAllowed,
  publicFailureCategory,
  readCanaryArchive,
} from '@/lib/props/historical-board-canary';
import { HISTORICAL_BOARD_PRODUCTION_ROLE_ARN } from '@/lib/props/historical-board-s3';
import { GET, POST } from '@/app/api/admin/historical-board-canary/route';

const ARCHIVE = 'D:\\court-context-backups\\cc-pg-logical-20261114T191459Z\\historical-board-archive';
const NOVEMBER_12_SHA = '9fa7157d0b25822ccd27097f75e1999e4ce98764d20f2baf4785f42c99898bfd';
const ASSUMED = 'arn:aws:sts::260029269390:assumed-role/court-context-historical-board-read-production/fixture';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  stsSend: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock('@/lib/model-lab/admin-route', () => ({
  withAdminJson: (...args: unknown[]) => mocks.admin(...args),
}));

vi.mock('@/lib/props/historical-board-s3', async () => {
  const actual = await vi.importActual<typeof import('@/lib/props/historical-board-s3')>(
    '@/lib/props/historical-board-s3'
  );
  return {
    ...actual,
    historicalBoardCredentialProvider: () => ({ accessKeyId: 'fixture' }),
    historicalBoardS3ClientStore: () => ({ getObject: (key: string) => mocks.getObject(key) }),
  };
});

vi.mock('@aws-sdk/client-sts', () => ({
  GetCallerIdentityCommand: class GetCallerIdentityCommand {},
  STSClient: class STSClient {
    send(command: unknown) {
      return mocks.stsSend(command);
    }
  },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class S3Client {},
  GetObjectCommand: class GetObjectCommand {},
}));

function productionRequest(origin = 'https://courtcontext.com', fetchSite = 'same-origin') {
  return new NextRequest('https://courtcontext.com/api/admin/historical-board-canary', {
    method: 'POST',
    headers: {
      origin,
      'sec-fetch-site': fetchSite,
    },
  });
}

describe('historical board production canary', () => {
  beforeEach(() => {
    mocks.admin.mockReset();
    mocks.stsSend.mockReset();
    mocks.getObject.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('AWS_ROLE_ARN', HISTORICAL_BOARD_PRODUCTION_ROLE_ARN);
    delete process.env.HISTORICAL_BOARD_ARCHIVE;
  });

  it('stays closed outside production and rejects another site', () => {
    expect(historicalBoardCanaryAllowed({})).toBe(false);
    expect(historicalBoardCanaryAllowed({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(historicalBoardCanaryAllowed({ VERCEL_ENV: 'development' })).toBe(false);
    expect(historicalBoardCanaryAllowed({ VERCEL_ENV: 'production' })).toBe(true);
    expect(productionCanaryOriginAllowed({ origin: 'https://courtcontext.com', fetchSite: 'same-origin' })).toBe(true);
    expect(productionCanaryOriginAllowed({ origin: 'https://www.courtcontext.com', fetchSite: null })).toBe(true);
    expect(productionCanaryOriginAllowed({ origin: 'https://nba-analytics-v3.vercel.app', fetchSite: 'same-origin' })).toBe(false);
    expect(productionCanaryOriginAllowed({ origin: null, fetchSite: 'same-origin' })).toBe(false);
    expect(productionCanaryOriginAllowed({ origin: 'https://courtcontext.com', fetchSite: 'cross-site' })).toBe(false);
    expect(publicFailureCategory(new Error('eyJhbGciOiJSUzI1NiJ9.secret'))).toBe('credential_rejected');
    expect(publicFailureCategory({ name: 'AccessDenied', message: 'eyJhbGciOiJSUzI1NiJ9.secret' })).toBe('AccessDenied');
    expect(publicFailureCategory(new Error('archive_checksum_mismatch'))).toBe('archive_checksum_mismatch');
    const route = readFileSync('app/api/admin/historical-board-canary/route.ts', 'utf8');
    expect(route).toContain('export async function POST');
    expect(route).toContain('Cache-Control');
    expect(route).toContain('withAdminJson');
    expect(route).toContain('noStore(response)');
    expect(route).toContain('GetCallerIdentityCommand');
    expect(route).toContain('HISTORICAL_BOARD_PRODUCTION_ROLE_ARN');
    expect(route).toContain("mode !== 'off'");
    expect(route).toContain('historicalBoardS3ClientStore');
    expect(route).toContain('SELECT game_id::text');
    expect(route).not.toContain('getVercelOidcToken');
    expect(route).not.toContain('request.json');
    expect(route).not.toContain('PutObject');
    expect(route).not.toContain('DeleteObject');
    expect(route).not.toContain('INSERT ');
    expect(route).not.toContain('UPDATE ');
    expect(route).not.toContain('DELETE ');
    expect(route).not.toContain('VACUUM');
    expect(route).not.toContain('console.error(error');
    const client = readFileSync('components/parlay/WorkspaceTrueCost.tsx', 'utf8');
    expect(client).not.toContain('historical-board-canary');
  });

  it('returns 404 outside production and does not call admin auth', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const response = await POST(productionRequest());
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('rejects a foreign origin before admin auth', async () => {
    const response = await POST(productionRequest('https://evil.example', 'cross-site'));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'origin_rejected' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('keeps no-store on an unauthenticated denial', async () => {
    mocks.admin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const response = await POST(productionRequest());
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.stsSend).not.toHaveBeenCalled();
  });

  it('keeps no-store on a non-admin denial', async () => {
    mocks.admin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const response = await POST(productionRequest());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.stsSend).not.toHaveBeenCalled();
  });

  it('hides credential text when the archive flag is on', async () => {
    vi.stubEnv('HISTORICAL_BOARD_ARCHIVE', 's3');
    mocks.admin.mockImplementation(async (_request: NextRequest, handler: () => Promise<NextResponse>) => handler());
    const response = await POST(productionRequest());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'archive_config_rejected' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.stsSend).not.toHaveBeenCalled();
  });

  it('does not serve GET', async () => {
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('validates the local November 12 archive without returning a player quote', async () => {
    const manifestFile = `${ARCHIVE}\\manifest.json`;
    const partitionFile = `${ARCHIVE}\\date=2026-11-12.json.gz`;
    if (!existsSync(manifestFile) || !existsSync(partitionFile)) return;
    const manifestBytes = readFileSync(manifestFile);
    const partitionBytes = readFileSync(partitionFile);
    const loaded = await readCanaryArchive({
      async getObject(objectKey: string) {
        if (objectKey === `${HISTORICAL_BOARD_S3_PREFIX}manifest.json`) return manifestBytes;
        if (objectKey === historicalBoardObjectKey('2026-11-12')) return partitionBytes;
        return null;
      },
    });
    const report = buildHistoricalBoardCanaryReport({ ...loaded, todayEt: '2026-11-14', archiveMode: 'off' });
    expect(report.manifest).toMatchObject({ sha256: HISTORICAL_BOARD_MANIFEST_SHA256, rows: 142602, games: 95, partitions: 13 });
    expect(report.november12).toMatchObject({ sha256: NOVEMBER_12_SHA, bytes: 171936, rows: 11934, protectedGamePresent: false });
    expect(report.last5.consensusGroups).toBe(42);
    expect(report.last5.protectedGameInArchive).toBe(false);
    expect(report.last5.duplicateGames).toBe(false);
    expect(report.last5.mergedGameIds).toContain('21718094');
    expect(report.last5.researchCloseSubstituted).toBe(false);
    expect(report.last5.boardLineReady).toBe(true);
    expect(report.trueCost.savedPriceAmerican).toBe(-110);
    expect(report.trueCost.oppositePresent).toBe(true);
    expect(report.trueCost.quoteCountAtOtherLine).toBe(0);
    expect(report.trueCost.missingOppositeRemainsEmpty).toBe(true);
    expect(report.current.archiveFlagOff).toBe(true);
    expect(report.current.todayReadsArchive).toBe(false);
    expect(report.current.openGameArchiveLegs).toBe(0);
    expect(report.current.objectsRead).toEqual(['manifest.json', 'date=2026-11-12.json.gz']);
    const body = JSON.stringify(report);
    expect(body).not.toContain('playerName');
    expect(body).not.toContain('eyJ');
  });

  it('lets an allowlisted caller read only the fixed archive objects', async () => {
    const manifestFile = `${ARCHIVE}\\manifest.json`;
    const partitionFile = `${ARCHIVE}\\date=2026-11-12.json.gz`;
    if (!existsSync(manifestFile) || !existsSync(partitionFile)) return;
    const manifestBytes = readFileSync(manifestFile);
    const partitionBytes = readFileSync(partitionFile);
    mocks.stsSend.mockResolvedValue({ Arn: ASSUMED, Account: '260029269390' });
    mocks.getObject.mockImplementation(async (objectKey: string) => {
      if (objectKey === `${HISTORICAL_BOARD_S3_PREFIX}manifest.json`) return manifestBytes;
      if (objectKey === historicalBoardObjectKey('2026-11-12')) return partitionBytes;
      return null;
    });
    mocks.admin.mockImplementation(async (_request: NextRequest, handler: () => Promise<NextResponse>) => handler());
    const response = await POST(productionRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.assumedRole).toBe('court-context-historical-board-read-production');
    expect(body.account).toBe('260029269390');
    expect(body.manifest.sha256).toBe(HISTORICAL_BOARD_MANIFEST_SHA256);
    expect(body.november12).toMatchObject({ sha256: NOVEMBER_12_SHA, rows: 11934 });
    expect(body.last5.consensusGroups).toBe(42);
    expect(body.trueCost.savedPriceAmerican).toBe(-110);
    expect(body.current.objectsRead).toEqual(['manifest.json', 'date=2026-11-12.json.gz']);
    expect(JSON.stringify(body)).not.toContain('eyJ');
    expect(JSON.stringify(body)).not.toContain('playerName');
  });
});
