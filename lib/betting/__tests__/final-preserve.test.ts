import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FINAL_PRESERVE_SQL_MARKER,
  FINAL_PRESERVE_SQL_EXISTING_ANALYTICS,
  FINAL_PRESERVE_SQL_EXISTING_RAW,
  FINAL_PRESERVE_SQL_INCOMING_NOT_FINAL,
  shouldPreserveCertifiedFinal,
} from '@/lib/betting/final-preserve';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

describe('shouldPreserveCertifiedFinal', () => {
  it('blocks Final → Scheduled', () => {
    expect(
      shouldPreserveCertifiedFinal({ existingStatus: 'Final', incomingStatus: 'Scheduled' })
    ).toBe(true);
  });

  it('blocks Final → tipoff ISO (stale schedule refresh)', () => {
    expect(
      shouldPreserveCertifiedFinal({
        existingStatus: 'Final',
        incomingStatus: '2026-10-22T23:30:00Z',
      })
    ).toBe(true);
  });

  it('blocks Final → In Progress', () => {
    expect(
      shouldPreserveCertifiedFinal({ existingStatus: 'Final', incomingStatus: 'In Progress' })
    ).toBe(true);
  });

  it('allows Scheduled → Final', () => {
    expect(
      shouldPreserveCertifiedFinal({ existingStatus: 'Scheduled', incomingStatus: 'Final' })
    ).toBe(false);
  });

  it('allows Scheduled → Scheduled (tip changes)', () => {
    expect(
      shouldPreserveCertifiedFinal({
        existingStatus: '2026-10-22T23:30:00Z',
        incomingStatus: '2026-10-22T00:00:00Z',
      })
    ).toBe(false);
  });

  it('allows Final → Final score corrections', () => {
    expect(
      shouldPreserveCertifiedFinal({ existingStatus: 'Final', incomingStatus: 'final' })
    ).toBe(false);
  });
});

describe('schedule upsert SQL guard', () => {
  const files = [
    'lib/balldontlie/refresh-schedule-from-bdl.ts',
    'lambda/nightly-bdl-updater/index.ts',
    'scripts/transform-raw-to-analytics.ts',
    'lib/betting/final-preserve.ts',
  ];

  it('embeds the Final-preserve marker and predicates in live upsert SQL', () => {
    for (const file of files) {
      const src = read(file);
      expect(src, file).toContain(FINAL_PRESERVE_SQL_MARKER);
      expect(src, file).toContain(FINAL_PRESERVE_SQL_EXISTING_ANALYTICS);
      expect(src, file).toContain(FINAL_PRESERVE_SQL_INCOMING_NOT_FINAL);
    }
    for (const file of [
      'lib/balldontlie/refresh-schedule-from-bdl.ts',
      'lambda/nightly-bdl-updater/index.ts',
    ]) {
      expect(read(file), file).toContain(FINAL_PRESERVE_SQL_EXISTING_RAW);
    }
  });
});
