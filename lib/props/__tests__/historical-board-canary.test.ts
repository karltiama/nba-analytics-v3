import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HISTORICAL_BOARD_MANIFEST_SHA256, HISTORICAL_BOARD_S3_PREFIX, historicalBoardObjectKey } from '@/lib/props/historical-board-archive';
import {
  buildHistoricalBoardCanaryReport,
  historicalBoardCanaryAllowed,
  publicFailureCategory,
  readCanaryArchive,
} from '@/lib/props/historical-board-canary';

const ARCHIVE = 'D:\\court-context-backups\\cc-pg-logical-20261114T191459Z\\historical-board-archive';

describe('historical board preview canary', () => {
  it('stays closed outside preview and hides credential text', () => {
    expect(historicalBoardCanaryAllowed({})).toBe(false);
    expect(historicalBoardCanaryAllowed({ VERCEL_ENV: 'production' })).toBe(false);
    expect(historicalBoardCanaryAllowed({ VERCEL_ENV: 'development' })).toBe(false);
    expect(historicalBoardCanaryAllowed({ VERCEL_ENV: 'preview' })).toBe(true);
    expect(publicFailureCategory(new Error('eyJhbGciOiJSUzI1NiJ9.secret'))).toBe('credential_rejected');
    expect(publicFailureCategory({ name: 'InvalidIdentityToken', message: 'eyJhbGciOiJSUzI1NiJ9.secret' })).toBe('InvalidIdentityToken');
    expect(publicFailureCategory(new Error('archive_checksum_mismatch'))).toBe('archive_checksum_mismatch');
    const route = readFileSync('app/api/admin/historical-board-canary/route.ts', 'utf8');
    expect(route).toContain('preview_only');
    expect(route).toContain('withAdminJson');
    expect(route).toContain('GetCallerIdentityCommand');
    expect(route).not.toContain('PutObject');
    expect(route).not.toContain('console.error(error');
    const client = readFileSync('components/parlay/WorkspaceTrueCost.tsx', 'utf8');
    expect(client).not.toContain('historical-board-canary');
    expect(client).not.toContain('@aws-sdk');
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
    const report = buildHistoricalBoardCanaryReport({ ...loaded, todayEt: '2026-11-14' });
    expect(report.manifest).toMatchObject({ sha256: HISTORICAL_BOARD_MANIFEST_SHA256, rows: 142602, games: 95, partitions: 13 });
    expect(report.november12.rows).toBe(11934);
    expect(report.november12.protectedGamePresent).toBe(false);
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
    expect(report.current.todayReadsArchive).toBe(false);
    expect(report.current.openGameArchiveLegs).toBe(0);
    expect(report.current.objectsRead).toEqual(['manifest.json', 'date=2026-11-12.json.gz']);
    expect(JSON.stringify(report)).not.toContain('playerName');
  });
});
