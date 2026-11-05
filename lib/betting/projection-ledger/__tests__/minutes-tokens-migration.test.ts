import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '../../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

describe('ledger view migration for 2026-27 minutes tokens', () => {
  const original = read('db/schemas/MIGRATION_projection_ledger.sql');
  const next = read('db/schemas/MIGRATION_projection_ledger_minutes_tokens.sql');
  const viewOf = (sql: string) =>
    sql.slice(
      sql.indexOf('CREATE OR REPLACE VIEW analytics.v_projection_performance AS'),
      sql.indexOf('AND p.capture_eligible_at_write;')
    );
  const withoutResolution = (view: string) =>
    view.slice(0, view.indexOf("    WHEN l.minutes IS NULL")) + view.slice(view.indexOf("    WHEN COALESCE(l.points, 0)"));

  it('changes only the minutes branch of resolution_state', () => {
    expect(withoutResolution(viewOf(next))).toBe(withoutResolution(viewOf(original)));
  });

  it('reads clock minutes and voids a "0" with no stats', () => {
    const view = viewOf(next);
    expect(view).toContain("btrim(l.minutes) !~ '^[0-9]+:[0-5]?[0-9]$'");
    expect(view).toContain("split_part(btrim(l.minutes), ':', 2)::numeric / 60");
    expect(view).not.toContain("IN ('0', '0.0') THEN 'PLAYED'");
    // Casts stay inside CASE so a clock token never reaches ::numeric (AND is not short-circuited).
    expect(view).not.toMatch(/AND btrim\(l\.minutes\)::numeric/);
  });

  it('is marked not applied and leaves the applied migration untouched', () => {
    expect(next).toMatch(/NOT APPLIED/);
    expect(original).toContain("WHEN btrim(l.minutes) IN ('0', '0.0') THEN 'PLAYED'");
  });
});
