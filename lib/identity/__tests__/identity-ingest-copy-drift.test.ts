import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOAD_BRIDGES_SQL, LOAD_PROJECTIONS_SQL, UPSERT_QUARANTINE_SQL } from '../player-identity-store';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

describe('13R.3 identity ingest copy drift', () => {
  it('classify-sql-rows Lambda copies match lib/', () => {
    const canonical = read('lib/identity/classify-sql-rows.ts');
    for (const file of [
      'lambda/shared/classify-sql-rows.ts',
      'lambda/injuries-snapshot/classify-sql-rows.ts',
      'lambda/player-props-snapshot/src/classify-sql-rows.ts',
    ]) {
      expect(read(file), file).toBe(canonical);
    }
  });

  it('identity-sql Lambda copies match each other and store SQL', () => {
    const shared = read('lambda/shared/identity-sql.ts');
    expect(read('lambda/injuries-snapshot/identity-sql.ts')).toBe(shared);
    expect(read('lambda/player-props-snapshot/src/identity-sql.ts')).toBe(shared);
    expect(normalizeSql(shared)).toContain(normalizeSql(LOAD_BRIDGES_SQL));
    expect(normalizeSql(shared)).toContain(normalizeSql(LOAD_PROJECTIONS_SQL));
    expect(normalizeSql(shared)).toContain(normalizeSql(UPSERT_QUARANTINE_SQL));
  });

  it('injury analytics transform no longer assumes provider id is in analytics.players', () => {
    const src = read('lambda/injuries-snapshot/index.ts');
    expect(src).not.toMatch(
      /IN \(SELECT player_id FROM analytics\.players\)/
    );
    expect(src).toContain('classifyFromSqlRows');
  });

  it('player-props worker filters analytics writes through the classifier', () => {
    const src = read('lambda/player-props-snapshot/worker.ts');
    expect(src).toContain('classifyBdlPropPlayerIds');
    expect(src).toContain('filterRowsByServingProviderId');
    expect(src).toContain('bulkInsertRawV2(pool, normalized');
  });
});
