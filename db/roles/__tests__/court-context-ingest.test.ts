import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sqlPath = path.resolve(__dirname, '../court_context_ingest.sql');
const root = path.resolve(__dirname, '../../..');

function quotedTables(source: string, constantName: string): string[] {
  const start = source.indexOf(constantName);
  const end = source.indexOf('] as const', start);
  if (start < 0 || end < 0) throw new Error(`${constantName} is missing`);
  const block = source.slice(start, end);
  return [...block.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((match) => match[1]);
}

function grantStatements(sql: string): string[] {
  return [...sql.matchAll(/grant\s+[\s\S]*?;/gi)].map((match) => match[0].replace(/\s+/g, ' '));
}

describe('court_context_ingest SQL', () => {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const grants = grantStatements(sql);

  it('covers every active admission table and the two stat functions', () => {
    const nightly = fs.readFileSync(path.join(root, 'lambda/nightly-bdl-updater/storage-admission.ts'), 'utf8');
    const scoreboard = fs.readFileSync(path.join(root, 'lib/scoreboard/lambda.ts'), 'utf8');
    const gameStatus = fs.readFileSync(path.join(root, 'lib/games/status-sync-lambda.ts'), 'utf8');
    const tables = [
      ...quotedTables(nightly, 'NIGHTLY_ADMISSION_TABLES'),
      ...quotedTables(scoreboard, 'SCOREBOARD_ADMISSION_TABLES'),
      ...quotedTables(gameStatus, 'GAME_STATUS_ADMISSION_TABLES'),
    ];
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(sql).toContain(`on table ${table} to court_context_ingest`);
    }
    expect(sql).toContain('raw.upsert_player_game_stat(');
    expect(sql).toContain('raw.upsert_player_game_stat_document(jsonb)');
    expect(sql).toContain('raw.player_game_stat_document_document_id_seq');
  });

  it('grants delete only for stale scoreboard player lines', () => {
    const deletes = grants.filter((statement) => /\bdelete\b/i.test(statement));
    expect(deletes).toEqual([
      'grant select, insert, update, delete on table display.scoreboard_player_lines to court_context_ingest;',
    ]);
    expect(sql.toLowerCase()).not.toContain('player_game_stats_row to court_context_ingest;\ngrant delete');
    expect(grants.some((statement) => /player_game_stats_row/.test(statement) && /\bdelete\b/i.test(statement))).toBe(false);
    expect(grants.some((statement) => /acquisition_requests/.test(statement) && /\bdelete\b/i.test(statement))).toBe(false);
  });

  it('keeps ownership, schema creation, and secrets out of the role', () => {
    expect(sql).toContain('nosuperuser');
    expect(sql).toContain('nocreatedb');
    expect(sql).toContain('nocreaterole');
    expect(sql).toContain('nobypassrls');
    expect(sql).toContain('noinherit');
    expect(sql.toLowerCase()).not.toContain('all privileges');
    expect(sql.toLowerCase()).not.toContain('grant create');
    expect(sql.toLowerCase()).not.toContain('truncate');
    expect(sql.toLowerCase()).not.toMatch(/password|postgresql:\/\/|postgres:\/\/|supabase\.co/i);
    expect(sql).not.toContain('court_context_app');
    expect(sql).toContain('unexpected membership');
    expect(sql).toContain('unexpected role attributes');
  });
});
