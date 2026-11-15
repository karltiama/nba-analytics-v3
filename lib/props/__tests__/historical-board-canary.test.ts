import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HISTORICAL_BOARD_MANIFEST_SHA256, HISTORICAL_BOARD_S3_PREFIX, historicalBoardObjectKey } from '@/lib/props/historical-board-archive';
import {
  buildHistoricalBoardCanaryReport,
  historicalBoardCanaryAllowed,
  productionCanaryOriginAllowed,
  publicFailureCategory,
  readCanaryArchive,
} from '@/lib/props/historical-board-canary';

const ARCHIVE = 'D:\\court-context-backups\\cc-pg-logical-20261114T191459Z\\historical-board-archive';
const NOVEMBER_12_SHA = '9fa7157d0b25822ccd27097f75e1999e4ce98764d20f2baf4785f42c99898bfd';

describe('historical board production canary', () => {
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
    expect(route).toContain('GetCallerIdentityCommand');
    expect(route).toContain('HISTORICAL_BOARD_PRODUCTION_ROLE_ARN');
    expect(route).toContain("mode !== 'off'");
    expect(route).toContain('historicalBoardS3ClientStore');
    expect(route).not.toContain('getVercelOidcToken');
    expect(route).not.toContain('request.json');
    expect(route).not.toContain('PutObject');
    expect(route).not.toContain('DeleteObject');
    expect(route).not.toContain('console.error(error');
    const client = readFileSync('components/parlay/WorkspaceTrueCost.tsx', 'utf8');
    expect(client).not.toContain('historical-board-canary');
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
});
